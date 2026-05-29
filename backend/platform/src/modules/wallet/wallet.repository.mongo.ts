import { Injectable, OnModuleInit } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { getDb } from '@/config/database';
import { IWalletRepository } from './wallet.repository.interface';
import { Wallet } from './wallet.types';

@Injectable()
export class MongoWalletRepository implements IWalletRepository, OnModuleInit {
  async onModuleInit() {
    await getDb()
      .collection('wallets')
      .createIndex({ userId: 1 }, { unique: true });
  }

  async findById(id: string): Promise<Wallet | null> {
    const doc = await getDb()
      .collection('wallets')
      .findOne({ _id: new ObjectId(id) });
    return doc ? this.toWallet(doc) : null;
  }

  async findByUserId(userId: string): Promise<Wallet | null> {
    const doc = await getDb()
      .collection('wallets')
      .findOne({ userId: new ObjectId(userId) });
    return doc ? this.toWallet(doc) : null;
  }

  async create(userId: string, balance: number): Promise<Wallet> {
    const now = new Date();
    const result = await getDb()
      .collection('wallets')
      .insertOne({
        userId: new ObjectId(userId),
        balance,
        createdAt: now,
        updatedAt: now,
      });
    return {
      id: result.insertedId.toHexString(),
      userId,
      balance,
      createdAt: now,
      updatedAt: now,
    };
  }

  // LIMITATION: not transactional — requires replica set for production
  async deductBalance(userId: string, amount: number): Promise<Wallet | null> {
    const doc = await getDb()
      .collection('wallets')
      .findOneAndUpdate(
        { userId: new ObjectId(userId), balance: { $gte: amount } },
        { $inc: { balance: -amount }, $set: { updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
    return doc ? this.toWallet(doc) : null;
  }

  async addBalance(userId: string, amount: number): Promise<Wallet> {
    const doc = await getDb()
      .collection('wallets')
      .findOneAndUpdate(
        { userId: new ObjectId(userId) },
        { $inc: { balance: amount }, $set: { updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
    if (!doc) throw new Error(`Wallet not found for userId ${userId}`);
    return this.toWallet(doc);
  }

  async setBalance(userId: string, balance: number): Promise<Wallet> {
    const doc = await getDb()
      .collection('wallets')
      .findOneAndUpdate(
        { userId: new ObjectId(userId) },
        { $set: { balance, updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
    if (!doc) throw new Error(`Wallet not found for userId ${userId}`);
    return this.toWallet(doc);
  }

  private toWallet(doc: Record<string, unknown>): Wallet {
    return {
      id: (doc._id as ObjectId).toHexString(),
      userId: (doc.userId as ObjectId).toHexString(),
      balance: doc.balance as number,
      createdAt: doc.createdAt as Date,
      updatedAt: doc.updatedAt as Date,
    };
  }
}
