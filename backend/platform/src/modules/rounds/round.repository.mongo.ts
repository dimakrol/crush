import { Injectable, OnModuleInit } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { getDb } from '@/config/database';
import { IRoundRepository } from './round.repository.interface';
import { Round, GamePhase } from './round.types';

@Injectable()
export class MongoRoundRepository implements IRoundRepository, OnModuleInit {
  async onModuleInit() {
    await getDb().collection('rounds').createIndex({ createdAt: -1 });
  }

  async findById(id: string): Promise<Round | null> {
    const doc = await getDb()
      .collection('rounds')
      .findOne({ _id: new ObjectId(id) });
    return doc ? this.toRound(doc) : null;
  }

  async create(crashPoint: number): Promise<Round> {
    const now = new Date();
    const result = await getDb().collection('rounds').insertOne({
      phase: 'WAITING',
      crashPoint,
      startedAt: null,
      crashedAt: null,
      createdAt: now,
    });
    return {
      id: result.insertedId.toHexString(),
      phase: 'WAITING',
      crashPoint,
      startedAt: null,
      crashedAt: null,
      createdAt: now,
    };
  }

  async updatePhase(
    id: string,
    phase: GamePhase,
    extra: Partial<Round> = {},
  ): Promise<Round> {
    const { id: _id, ...rest } = extra;
    void _id;
    const doc = await getDb()
      .collection('rounds')
      .findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { phase, ...rest } },
        { returnDocument: 'after' },
      );
    if (!doc) throw new Error(`Round ${id} not found`);
    return this.toRound(doc);
  }

  async findRecent(limit: number): Promise<Round[]> {
    const docs = await getDb()
      .collection('rounds')
      .find({ phase: 'CRASHED' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return docs.map((d) => this.toRound(d));
  }

  private toRound(doc: Record<string, unknown>): Round {
    return {
      id: (doc._id as ObjectId).toHexString(),
      phase: doc.phase as GamePhase,
      crashPoint: doc.crashPoint as number,
      startedAt: doc.startedAt as Date | null,
      crashedAt: doc.crashedAt as Date | null,
      createdAt: doc.createdAt as Date,
    };
  }
}
