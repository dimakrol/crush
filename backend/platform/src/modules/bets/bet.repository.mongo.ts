import { Injectable, OnModuleInit } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { getDb } from '@/config/database';
import {
  DuplicateKeyError,
  isMongoDuplicateKey,
} from '@/shared/errors/duplicate-key.error';
import { IBetRepository } from './bet.repository.interface';
import { Bet, BetSlotId } from './bet.types';

// Composite keyset cursor `${placedAt ISO}|${id}` — same format as the Postgres
// repo so the pagination contract is driver-independent and stable when several
// bets share a placedAt.
const encodeCursor = (placedAt: Date, id: string) =>
  `${placedAt.toISOString()}|${id}`;
const decodeCursor = (cursor: string): { placedAt: Date; id: string } => {
  const idx = cursor.lastIndexOf('|');
  return { placedAt: new Date(cursor.slice(0, idx)), id: cursor.slice(idx + 1) };
};

@Injectable()
export class MongoBetRepository implements IBetRepository, OnModuleInit {
  async onModuleInit() {
    const col = getDb().collection('bets');
    await Promise.all([
      col.createIndex({ userId: 1, placedAt: -1 }),
      col.createIndex({ roundId: 1 }),
      col.createIndex({ roundId: 1, userId: 1 }),
      col.createIndex({ roundId: 1, userId: 1, slotId: 1 }, { unique: true }),
    ]);
  }

  async findById(id: string): Promise<Bet | null> {
    const doc = await getDb()
      .collection('bets')
      .findOne({ _id: new ObjectId(id) });
    return doc ? this.toBet(doc) : null;
  }

  async create(data: Omit<Bet, 'id'>): Promise<Bet> {
    try {
      const result = await getDb()
        .collection('bets')
        .insertOne({
          ...data,
          // userId is the white-label player UUID — stored as a plain string,
          // not a Mongo ObjectId. roundId is an internal Mongo round id.
          roundId: new ObjectId(data.roundId),
        });
      return { id: result.insertedId.toHexString(), ...data };
    } catch (err) {
      // Unique (round,user,slot) violation → driver-agnostic signal so the
      // service's slot-race handling never inspects the Mongo error code.
      if (isMongoDuplicateKey(err)) throw new DuplicateKeyError();
      throw err;
    }
  }

  async findBySlot(
    roundId: string,
    userId: string,
    slotId: BetSlotId,
  ): Promise<Bet | null> {
    const doc = await getDb()
      .collection('bets')
      .findOne({
        roundId: new ObjectId(roundId),
        userId,
        slotId,
      });
    return doc ? this.toBet(doc) : null;
  }

  async findActiveByRound(roundId: string): Promise<Bet[]> {
    const docs = await getDb()
      .collection('bets')
      .find({ roundId: new ObjectId(roundId), status: 'PLACED' })
      .toArray();
    return docs.map((d) => this.toBet(d));
  }

  async findActiveByUser(userId: string, roundId: string): Promise<Bet[]> {
    const docs = await getDb()
      .collection('bets')
      .find({
        userId,
        roundId: new ObjectId(roundId),
        status: 'PLACED',
      })
      .toArray();
    return docs.map((d) => this.toBet(d));
  }

  async findByUser(
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ bets: Bet[]; nextCursor: string | null }> {
    const query: Record<string, unknown> = { userId };
    if (cursor) {
      // Keyset over (placedAt desc, _id desc): the page after the cursor is
      // placedAt < c.placedAt OR (placedAt = c.placedAt AND _id < c._id).
      const c = decodeCursor(cursor);
      query.$or = [
        { placedAt: { $lt: c.placedAt } },
        { placedAt: c.placedAt, _id: { $lt: new ObjectId(c.id) } },
      ];
    }
    const docs = await getDb()
      .collection('bets')
      .find(query)
      .sort({ placedAt: -1, _id: -1 })
      .limit(limit + 1)
      .toArray();
    const hasMore = docs.length > limit;
    const bets = docs.slice(0, limit).map((d) => this.toBet(d));
    const last = bets[bets.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor(last.placedAt, last.id) : null;
    return { bets, nextCursor };
  }

  // LIMITATION: not transactional — requires replica set for production
  async cashOut(
    betId: string,
    multiplier: number,
    payout: number,
  ): Promise<Bet | null> {
    const now = new Date();
    const doc = await getDb()
      .collection('bets')
      .findOneAndUpdate(
        { _id: new ObjectId(betId), status: 'PLACED' },
        {
          $set: {
            status: 'CASHED_OUT',
            cashOutMultiplier: multiplier,
            payout,
            cashedOutAt: now,
            resolvedAt: now,
          },
        },
        { returnDocument: 'after' },
      );
    return doc ? this.toBet(doc) : null;
  }

  async cancelPlaced(betId: string, userId: string): Promise<Bet | null> {
    const now = new Date();
    const doc = await getDb()
      .collection('bets')
      .findOneAndUpdate(
        { _id: new ObjectId(betId), userId, status: 'PLACED' },
        { $set: { status: 'CANCELED', resolvedAt: now } },
        { returnDocument: 'after' },
      );
    return doc ? this.toBet(doc) : null;
  }

  async resolveLosses(roundId: string): Promise<Bet[]> {
    const now = new Date();
    await getDb()
      .collection('bets')
      .updateMany(
        { roundId: new ObjectId(roundId), status: 'PLACED' },
        { $set: { status: 'LOST', resolvedAt: now } },
      );
    const docs = await getDb()
      .collection('bets')
      .find({ roundId: new ObjectId(roundId), status: 'LOST' })
      .toArray();
    return docs.map((d) => this.toBet(d));
  }

  async cancelByUser(userId: string, roundId: string): Promise<void> {
    await getDb()
      .collection('bets')
      .updateMany(
        {
          userId,
          roundId: new ObjectId(roundId),
          status: 'PLACED',
        },
        { $set: { status: 'CANCELED', resolvedAt: new Date() } },
      );
  }

  async findAllPlaced(): Promise<Bet[]> {
    const docs = await getDb()
      .collection('bets')
      .find({ status: 'PLACED' })
      .toArray();
    return docs.map((d) => this.toBet(d));
  }

  async markCanceled(betId: string): Promise<void> {
    await getDb()
      .collection('bets')
      .updateOne(
        { _id: new ObjectId(betId), status: 'PLACED' },
        { $set: { status: 'CANCELED', resolvedAt: new Date() } },
      );
  }

  async markSettlementPending(betId: string): Promise<void> {
    await getDb()
      .collection('bets')
      .updateOne(
        { _id: new ObjectId(betId) },
        { $set: { status: 'SETTLEMENT_PENDING' } },
      );
  }

  private toBet(doc: Record<string, unknown>): Bet {
    return {
      id: (doc._id as ObjectId).toHexString(),
      userId: doc.userId as string,
      currency: (doc.currency as string) ?? 'USD',
      roundId: (doc.roundId as ObjectId).toHexString(),
      slotId: doc.slotId as BetSlotId,
      amount: doc.amount as number,
      autoCashOut: doc.autoCashOut as number | null,
      status: doc.status as Bet['status'],
      cashOutMultiplier: doc.cashOutMultiplier as number | null,
      payout: doc.payout as number,
      placedAt: doc.placedAt as Date,
      cashedOutAt: doc.cashedOutAt as Date | null,
      resolvedAt: doc.resolvedAt as Date | null,
    };
  }
}
