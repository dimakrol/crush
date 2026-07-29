import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { getDrizzle } from '@/config/postgres';
import { bets } from '@/drizzle/schema';
import {
  DuplicateKeyError,
  isPostgresUniqueViolation,
} from '@/shared/errors/duplicate-key.error';
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
    const [row] = await getDrizzle()
      .select()
      .from(bets)
      .where(eq(bets.id, id))
      .limit(1);
    return row ? this.toBet(row) : null;
  }

  async create(data: Omit<Bet, 'id'>): Promise<Bet> {
    try {
      const [row] = await getDrizzle()
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

  async findBySlot(
    roundId: string,
    userId: string,
    slotId: BetSlotId,
  ): Promise<Bet | null> {
    const [row] = await getDrizzle()
      .select()
      .from(bets)
      .where(
        and(
          eq(bets.roundId, roundId),
          eq(bets.userId, userId),
          eq(bets.slotId, slotId),
        ),
      )
      .limit(1);
    return row ? this.toBet(row) : null;
  }

  async findActiveByRound(roundId: string): Promise<Bet[]> {
    const rows = await getDrizzle()
      .select()
      .from(bets)
      .where(and(eq(bets.roundId, roundId), eq(bets.status, 'PLACED')));
    return rows.map((r) => this.toBet(r));
  }

  async findActiveByUser(userId: string, roundId: string): Promise<Bet[]> {
    const rows = await getDrizzle()
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
    const userCond = eq(bets.userId, userId);
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

    const rows = await getDrizzle()
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
  ): Promise<Bet | null> {
    const now = new Date();
    const [row] = await getDrizzle()
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

  async cancelPlaced(betId: string, userId: string): Promise<Bet | null> {
    const [row] = await getDrizzle()
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
    const rows = await getDrizzle()
      .update(bets)
      .set({ status: 'LOST', resolvedAt: new Date() })
      .where(and(eq(bets.roundId, roundId), eq(bets.status, 'PLACED')))
      .returning();
    return rows.map((r) => this.toBet(r));
  }

  async cancelByUser(userId: string, roundId: string): Promise<void> {
    await getDrizzle()
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

  async findAllPlaced(): Promise<Bet[]> {
    const rows = await getDrizzle()
      .select()
      .from(bets)
      .where(eq(bets.status, 'PLACED'));
    return rows.map((r) => this.toBet(r));
  }

  async markCanceled(betId: string): Promise<void> {
    await getDrizzle()
      .update(bets)
      .set({ status: 'CANCELED', resolvedAt: new Date() })
      .where(and(eq(bets.id, betId), eq(bets.status, 'PLACED')));
  }

  async markSettlementPending(betId: string): Promise<void> {
    await getDrizzle()
      .update(bets)
      .set({ status: 'SETTLEMENT_PENDING' })
      .where(eq(bets.id, betId));
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
