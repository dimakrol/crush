import {
  doublePrecision,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Postgres mirror of the domain persisted by the platform. The single source of
// truth for the contract stays the `IRoundRepository`/`IBetRepository`
// interfaces — this schema must round-trip those domain shapes exactly so the
// Mongo and Postgres drivers are interchangeable behind the repository tokens.
//
// Money (amount/payout) is numeric(20,4) for precise at-rest storage; the
// repository mapper casts it back to the domain's `number`. Multipliers and the
// crash point are NOT money — double precision matches the JS number they came
// from. Ids are DB-generated uuids; the domain only ever sees them as strings.

export const rounds = pgTable(
  'rounds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phase: text('phase').notNull(),
    crashPoint: doublePrecision('crash_point').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    crashedAt: timestamp('crashed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('rounds_created_at_idx').on(t.createdAt.desc())],
);

export const bets = pgTable(
  'bets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // White-label player UUID — a plain string, mirrors the Mongo repo which
    // stores userId as a string (not an ObjectId).
    userId: text('user_id').notNull(),
    currency: text('currency').notNull().default('USD'),
    roundId: uuid('round_id')
      .notNull()
      .references(() => rounds.id),
    slotId: smallint('slot_id').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    autoCashOut: doublePrecision('auto_cash_out'),
    status: text('status').notNull(),
    cashOutMultiplier: doublePrecision('cash_out_multiplier'),
    payout: numeric('payout', { precision: 20, scale: 4 })
      .notNull()
      .default('0'),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull(),
    cashedOutAt: timestamp('cashed_out_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    // Idempotency / slot race: one bet per (round, user, slot). The unique
    // violation (23505) is what BetService.placeBet relies on to detect a
    // concurrent winner of the shared idempotent debit.
    uniqueIndex('bets_round_user_slot_uniq').on(t.roundId, t.userId, t.slotId),
    index('bets_user_placed_idx').on(t.userId, t.placedAt.desc()),
    index('bets_round_idx').on(t.roundId),
    index('bets_round_user_idx').on(t.roundId, t.userId),
  ],
);
