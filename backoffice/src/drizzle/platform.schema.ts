import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// COPY of platform/src/drizzle/schema.ts. The single source of truth is the
// platform: it owns the tables and the migrations that shape them. Nothing here
// may ever be migrated — drizzle.config.ts deliberately does not list this file,
// so `npm run db:generate` physically cannot produce a migration for
// `crash_pilot`. The runtime pool logs in as a read-only role for the same
// reason (src/config/postgres.ts).
//
// The body below is kept byte-identical to the platform's file so drift is a
// plain `diff`. The checks and indexes are inert here — they are copied only to
// keep that diff clean, since nothing in this project creates them.
//
// Drift is caught twice: assertPlatformSchema() compares these columns with
// information_schema on every boot, and tests/platform-schema.smoke.spec.ts
// does the same against a live database when run explicitly.

// Round phase state machine: WAITING → RUNNING → CRASHED.
export const roundPhase = pgEnum('round_phase', [
  'WAITING',
  'RUNNING',
  'CRASHED',
]);

// Bet lifecycle. PENDING_STAKE and REJECTED belong to the stake-debit handshake
// (the intent row is written before the network call); see bet.types.ts for what
// each value means to the domain.
export const betStatus = pgEnum('bet_status', [
  'PENDING_STAKE',
  'PLACED',
  'CASHED_OUT',
  'LOST',
  'CANCELED',
  'REJECTED',
  'SETTLEMENT_PENDING',
]);

export const rounds = pgTable(
  'rounds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phase: roundPhase('phase').notNull(),
    crashPoint: doublePrecision('crash_point').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    crashedAt: timestamp('crashed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('rounds_created_at_idx').on(t.createdAt.desc()),
    // generateCrashPoint() is Math.max(1.01, …) — a round below that would mean
    // the generator broke, and every bet in it would lose instantly.
    check('rounds_crash_point_min', sql`"crash_point" >= 1.01`),
  ],
);

export const bets = pgTable(
  'bets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // White-label player UUID. Stored as text, not uuid: it is an identifier
    // owned by another service and there is no FK to enforce here.
    userId: text('user_id').notNull(),
    currency: text('currency').notNull().default('USD'),
    roundId: uuid('round_id')
      .notNull()
      .references(() => rounds.id),
    slotId: smallint('slot_id').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    autoCashOut: doublePrecision('auto_cash_out'),
    status: betStatus('status').notNull(),
    cashOutMultiplier: doublePrecision('cash_out_multiplier'),
    payout: numeric('payout', { precision: 20, scale: 4 })
      .notNull()
      .default('0'),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull(),
    cashedOutAt: timestamp('cashed_out_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    // Idempotency / slot race: one *live* bet per (round, user, slot). The
    // unique violation (23505) is what BetService.placeBet relies on to detect a
    // concurrent winner of the shared idempotent debit.
    //
    // PARTIAL, excluding REJECTED: a refused stake leaves its row behind as an
    // audit trace, and that trace must not occupy the slot — otherwise a player
    // who tops up could never retry the same slot in the same round. Every other
    // status (including CANCELED) still holds the slot, exactly as before.
    uniqueIndex('bets_round_user_slot_uniq')
      .on(t.roundId, t.userId, t.slotId)
      .where(sql`"status" <> 'REJECTED'`),
    index('bets_user_placed_idx').on(t.userId, t.placedAt.desc()),
    index('bets_round_idx').on(t.roundId),
    index('bets_round_user_idx').on(t.roundId, t.userId),
    // Value ranges the services already enforce — mirrored here so no code path
    // (or manual query) can bypass them.
    check('bets_amount_positive', sql`"amount" > 0`),
    check('bets_payout_non_negative', sql`"payout" >= 0`),
    check('bets_slot_id_valid', sql`"slot_id" IN (1, 2)`),
    check(
      'bets_auto_cash_out_gt_one',
      sql`"auto_cash_out" IS NULL OR "auto_cash_out" > 1`,
    ),
  ],
);

// Direction of a money move, mirroring the white-label's Transaction.type.
export const walletOpKind = pgEnum('wallet_op_kind', [
  'DEBIT',
  'CREDIT',
  'ROLLBACK',
]);

// PENDING   — intent recorded, the operator has not confirmed it.
// CONFIRMED — the operator acknowledged the move (or replayed it idempotently).
// FAILED    — terminal: refused deterministically, or the retry budget ran out.
export const walletOpState = pgEnum('wallet_op_state', [
  'PENDING',
  'CONFIRMED',
  'FAILED',
]);

// Transactional outbox for every money move delegated to the white-label. The
// row is written in the SAME transaction as the bet-state change that justifies
// it and BEFORE the network call, so a crash or an operator outage can never
// leave a money move that nothing remembers.
//
// Amounts are the platform's DOMAIN decimals (like bets.amount); the
// minor-unit conversion stays at the HttpWalletRepository seam.
export const walletOps = pgTable(
  'wallet_ops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: walletOpKind('kind').notNull(),
    state: walletOpState('state').notNull().default('PENDING'),
    // The idempotency key the white-label dedupes on. UNIQUE here is not
    // decoration: it makes enqueueing itself idempotent, so two callers that
    // both decide to reverse the same debit (cancelBet and recoverOpenBets, say)
    // physically cannot create two reversals.
    txRef: text('tx_ref').notNull().unique(),
    // Set for ROLLBACK only: the txRef of the debit being reversed.
    refTxRef: text('ref_tx_ref'),
    betId: uuid('bet_id').references(() => bets.id),
    playerId: text('player_id').notNull(),
    currency: text('currency').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    roundId: uuid('round_id'),
    slotId: smallint('slot_id'),
    attempts: integer('attempts').notNull().default(0),
    // When the worker may claim this row. Also acts as a lease: claiming pushes
    // it into the future, so a process that dies mid-call releases the op after
    // the lease instead of stranding it.
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The worker's only query. Partial: CONFIRMED rows are the overwhelming
    // majority and never need to be scanned.
    index('wallet_ops_pending_idx')
      .on(t.state, t.nextAttemptAt)
      .where(sql`"state" = 'PENDING'`),
    index('wallet_ops_bet_idx').on(t.betId),
    check('wallet_ops_amount_non_negative', sql`"amount" >= 0`),
    check('wallet_ops_attempts_non_negative', sql`"attempts" >= 0`),
    // A reversal without the debit it reverses is unreplayable; a plain move
    // with a ref would reverse something by accident.
    check(
      'wallet_ops_rollback_has_ref',
      sql`("kind" = 'ROLLBACK') = ("ref_tx_ref" IS NOT NULL)`,
    ),
  ],
);
