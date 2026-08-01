import { Injectable } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { executor } from '@/config/postgres';
import { bets } from '@/drizzle/schema';
import {
  DuplicateKeyError,
  isPostgresUniqueViolation,
} from '@/shared/errors/duplicate-key.error';
import { TxContext } from '@/shared/repositories/unit-of-work';
import { IBetRepository } from './bet.repository.interface';
import { Bet, BetSlotId } from './bet.types';

type BetRow = typeof bets.$inferSelect;

// Composite keyset cursor `${placedAt ISO}|${id}` — stable pagination with no
// skips/dupes when several bets share a placedAt.
const encodeCursor = (placedAt: Date, id: string) =>
  `${placedAt.toISOString()}|${id}`;
const decodeCursor = (cursor: string): { placedAt: Date; id: string } => {
  const idx = cursor.lastIndexOf('|');
  return { placedAt: new Date(cursor.slice(0, idx)), id: cursor.slice(idx + 1) };
};

// Postgres implementation of IBetRepository, bound to the BET_REPOSITORY token.
// Every write is a single statement: atomic compare-and-set (cashOut /
// cancelPlaced) is UPDATE ... WHERE status='PLACED' RETURNING, so concurrent
// callers can never both win.
@Injectable()
export class BetRepository implements IBetRepository {
  async findById(id: string): Promise<Bet | null> {
    const [row] = await executor()
      .select()
      .from(bets)
      .where(eq(bets.id, id))
      .limit(1);
    return row ? this.toBet(row) : null;
  }

  async create(data: Omit<Bet, 'id'>, ctx?: TxContext): Promise<Bet> {
    try {
      const [row] = await executor(ctx)
        .insert(bets)
        .values({
          userId: data.userId,
          currency: data.currency,
          roundId: data.roundId,
          slotId: data.slotId,
          amount: String(data.amount),
          autoCashOut: data.autoCashOut,
          status: data.status,
          cashOutMultiplier: data.cashOutMultiplier,
          payout: String(data.payout),
          placedAt: data.placedAt,
          cashedOutAt: data.cashedOutAt,
          resolvedAt: data.resolvedAt,
        })
        .returning();
      return this.toBet(row);
    } catch (err) {
      // Unique (round,user,slot) violation → driver-agnostic signal so the
      // service's slot-race handling never inspects a SQLSTATE.
      if (isPostgresUniqueViolation(err)) throw new DuplicateKeyError()
      throw err;
    }
  }

  // Must stay aligned with the PARTIAL unique index (`status <> 'REJECTED'`):
  // a refused stake keeps its audit row but does NOT occupy the slot, so
  // reporting it here would 409 the player before the index ever gets a say —
  // making the partial predicate pointless.
  async findBySlot(
    roundId: string,
    userId: string,
    slotId: BetSlotId,
  ): Promise<Bet | null> {
    const [row] = await executor()
      .select()
      .from(bets)
      .where(
        and(
          eq(bets.roundId, roundId),
          eq(bets.userId, userId),
          eq(bets.slotId, slotId),
          ne(bets.status, 'REJECTED'),
        ),
      )
      .limit(1);
    return row ? this.toBet(row) : null;
  }

  async findActiveByUser(userId: string, roundId: string): Promise<Bet[]> {
    const rows = await executor()
      .select()
      .from(bets)
      .where(
        and(
          eq(bets.userId, userId),
          eq(bets.roundId, roundId),
          eq(bets.status, 'PLACED'),
        ),
      );
    return rows.map((r) => this.toBet(r));
  }

  async findByUser(
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ bets: Bet[]; nextCursor: string | null }> {
    // Player-facing history: PENDING_STAKE and REJECTED are traces of the stake
    // handshake, not bets the player ever owned — they must not show up.
    const userCond = and(
      eq(bets.userId, userId),
      notInArray(bets.status, ['PENDING_STAKE', 'REJECTED']),
    );
    // Keyset: rows ordered (placedAt desc, id desc); the page after the cursor
    // is placedAt < c.placedAt OR (placedAt = c.placedAt AND id < c.id).
    const where = cursor
      ? and(
          userCond,
          (() => {
            const c = decodeCursor(cursor);
            return or(
              lt(bets.placedAt, c.placedAt),
              and(eq(bets.placedAt, c.placedAt), lt(bets.id, c.id)),
            );
          })(),
        )
      : userCond;

    const rows = await executor()
      .select()
      .from(bets)
      .where(where)
      .orderBy(desc(bets.placedAt), desc(bets.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map((r) => this.toBet(r));
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.placedAt, last.id) : null;
    return { bets: page, nextCursor };
  }

  async cashOut(
    betId: string,
    multiplier: number,
    payout: number,
    ctx?: TxContext,
  ): Promise<Bet | null> {
    const now = new Date();
    const [row] = await executor(ctx)
      .update(bets)
      .set({
        status: 'CASHED_OUT',
        cashOutMultiplier: multiplier,
        payout: String(payout),
        cashedOutAt: now,
        resolvedAt: now,
      })
      .where(and(eq(bets.id, betId), eq(bets.status, 'PLACED')))
      .returning();
    return row ? this.toBet(row) : null;
  }

  // Set-based auto-cashout: resolves every eligible bet of the round in one
  // round-trip. Runs inside the 100ms tick, which a per-bet loop would stall.
  //
  // The payout expression MUST stay bit-identical to calculatePayout()
  // (`Math.floor(amount * multiplier * 100) / 100`), or an auto-cashout and a
  // manual one at the same multiplier would pay different amounts. Hence the
  // explicit `::double precision`: it makes the product IEEE-754 float64 in the
  // same left-to-right order as JS, so `floor` truncates at the same boundary.
  // Only the final division is numeric, so the stored value is an exact decimal.
  async cashOutAuto(
    roundId: string,
    multiplier: number,
    ctx?: TxContext,
  ): Promise<Bet[]> {
    const now = new Date();
    const rows = await executor(ctx)
      .update(bets)
      .set({
        status: 'CASHED_OUT',
        cashOutMultiplier: multiplier,
        payout: sql`floor("amount"::double precision * ${multiplier} * 100)::numeric / 100`,
        cashedOutAt: now,
        resolvedAt: now,
      })
      .where(
        and(
          eq(bets.roundId, roundId),
          eq(bets.status, 'PLACED'),
          isNotNull(bets.autoCashOut),
          lte(bets.autoCashOut, multiplier),
        ),
      )
      .returning();
    return rows.map((r) => this.toBet(r));
  }

  async cancelPlaced(
    betId: string,
    userId: string,
    ctx?: TxContext,
  ): Promise<Bet | null> {
    const [row] = await executor(ctx)
      .update(bets)
      .set({ status: 'CANCELED', resolvedAt: new Date() })
      .where(
        and(
          eq(bets.id, betId),
          eq(bets.userId, userId),
          eq(bets.status, 'PLACED'),
        ),
      )
      .returning();
    return row ? this.toBet(row) : null;
  }

  async resolveLosses(roundId: string): Promise<Bet[]> {
    const rows = await executor()
      .update(bets)
      .set({ status: 'LOST', resolvedAt: new Date() })
      .where(and(eq(bets.roundId, roundId), eq(bets.status, 'PLACED')))
      .returning();
    return rows.map((r) => this.toBet(r));
  }

  async cancelByUser(userId: string, roundId: string): Promise<void> {
    await executor()
      .update(bets)
      .set({ status: 'CANCELED', resolvedAt: new Date() })
      .where(
        and(
          eq(bets.userId, userId),
          eq(bets.roundId, roundId),
          eq(bets.status, 'PLACED'),
        ),
      );
  }

  async findAllUnsettled(): Promise<Bet[]> {
    const rows = await executor()
      .select()
      .from(bets)
      .where(inArray(bets.status, ['PLACED', 'PENDING_STAKE']));
    return rows.map((r) => this.toBet(r));
  }

  // The stake handshake's three exits, each a guarded compare-and-set from
  // PENDING_STAKE so a late duplicate (or the outbox worker racing an inline
  // caller) can only ever lose, never overwrite a decided bet.
  async markPlaced(betId: string, ctx?: TxContext): Promise<Bet | null> {
    const [row] = await executor(ctx)
      .update(bets)
      .set({ status: 'PLACED' })
      .where(and(eq(bets.id, betId), eq(bets.status, 'PENDING_STAKE')))
      .returning();
    return row ? this.toBet(row) : null;
  }

  async markRejected(betId: string, ctx?: TxContext): Promise<void> {
    await executor(ctx)
      .update(bets)
      .set({ status: 'REJECTED', resolvedAt: new Date() })
      .where(and(eq(bets.id, betId), eq(bets.status, 'PENDING_STAKE')));
  }

  async markStakeCanceled(betId: string, ctx?: TxContext): Promise<void> {
    await executor(ctx)
      .update(bets)
      .set({ status: 'CANCELED', resolvedAt: new Date() })
      .where(and(eq(bets.id, betId), eq(bets.status, 'PENDING_STAKE')));
  }

  async markCanceled(betId: string, ctx?: TxContext): Promise<void> {
    await executor(ctx)
      .update(bets)
      .set({ status: 'CANCELED', resolvedAt: new Date() })
      .where(and(eq(bets.id, betId), eq(bets.status, 'PLACED')));
  }

  async markSettlementPending(betId: string, ctx?: TxContext): Promise<void> {
    await executor(ctx)
      .update(bets)
      .set({ status: 'SETTLEMENT_PENDING' })
      .where(and(eq(bets.id, betId), eq(bets.status, 'CASHED_OUT')));
  }

  // The inverse: a win the worker eventually delivered is a plain CASHED_OUT bet
  // again. Without this the flag would be a one-way door and history would keep
  // showing a settled win as unpaid.
  async restoreCashedOut(betId: string, ctx?: TxContext): Promise<void> {
    await executor(ctx)
      .update(bets)
      .set({ status: 'CASHED_OUT' })
      .where(and(eq(bets.id, betId), eq(bets.status, 'SETTLEMENT_PENDING')));
  }

  private toBet(row: BetRow): Bet {
    return {
      id: row.id,
      userId: row.userId,
      currency: row.currency ?? 'USD',
      roundId: row.roundId,
      slotId: row.slotId as BetSlotId,
      amount: Number(row.amount),
      autoCashOut: row.autoCashOut,
      status: row.status as Bet['status'],
      cashOutMultiplier: row.cashOutMultiplier,
      payout: Number(row.payout),
      placedAt: row.placedAt,
      cashedOutAt: row.cashedOutAt,
      resolvedAt: row.resolvedAt,
    };
  }
}
