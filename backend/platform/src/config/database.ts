import { MongoClient, Db } from 'mongodb';
import { env } from './env';

let client: MongoClient;
let db: Db;

export async function connectMongo(): Promise<Db> {
  // Only reached on the mongo driver branch, where env.ts's superRefine has
  // already guaranteed MONGODB_URI is set — assert it for the type narrowing.
  if (!env.MONGODB_URI) throw new Error('MONGODB_URI is required for the mongo driver');
  client = new MongoClient(env.MONGODB_URI);
  await client.connect();
  db = client.db();
  console.log('✅ MongoDB connected');
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('MongoDB not connected — call connectMongo() first');
  return db;
}

export async function closeMongo(): Promise<void> {
  await client?.close();
}
