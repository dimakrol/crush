import { MongoClient, Db } from 'mongodb'
import { env } from './env'

let client: MongoClient
let db: Db

export async function connectMongo(): Promise<Db> {
  client = new MongoClient(env.MONGODB_URI)
  await client.connect()
  db = client.db()
  console.log('✅ MongoDB connected')
  return db
}

export function getDb(): Db {
  if (!db) throw new Error('MongoDB not connected — call connectMongo() first')
  return db
}

export async function closeMongo(): Promise<void> {
  await client?.close()
}
