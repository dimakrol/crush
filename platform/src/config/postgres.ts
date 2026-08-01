import { Pool } from 'pg';
import {
  drizzle,
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PgDatabase } from 'drizzle-orm/pg-core';
import { resolve } from 'path';
import { env } from './env';
import { TxContext } from '@/shared/repositories/unit-of-work';
import * as schema from '../drizzle/schema';

// The single long-lived store. A module-level singleton connected imperatively
// from main.ts before NestFactory, so a bad connection string fails the boot
// instead of surfacing as a runtime error on the first request.

let pool: Pool;
let db: NodePgDatabase<typeof schema>;

export type Drizzle = NodePgDatabase<typeof schema>;

// Create the platform's database if it does not exist yet, connecting to the
// `postgres` maintenance database on the same server. Without this the first
// boot depends on the Compose initdb script, which only runs on a *fresh*
// pg_data volume — an existing volume (the common case) would never get
// `crash_pilot` and every start would fail.
export async function ensureDatabase(): Promise<void> {
  const url = new URL(env.POSTGRES_URL);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!dbName) throw new Error('POSTGRES_URL has no database name');

  url.pathname = '/postgres';
  const admin = new Pool({ connectionString: url.toString() });
  try {
    const { rowCount } = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );
    if (rowCount) return;
    // CREATE DATABASE takes no bind parameters — quote the identifier instead.
    // dbName comes from our own env; doubling embedded quotes keeps it safe.
    await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    console.log(`✅ Postgres database "${dbName}" created`);
  } catch (err) {
    // 42P04 = duplicate_database: another process won the race, which is fine.
    if ((err as { code?: string }).code !== '42P04') throw err;
  } finally {
    await admin.end();
  }
}

export async function connectPostgres(): Promise<Drizzle> {
  pool = new Pool({ connectionString: env.POSTGRES_URL });
  // Fail fast if Postgres is unreachable rather than on the first query.
  await pool.query('SELECT 1');
  db = drizzle(pool, { schema });
  console.log('✅ Postgres connected');
  return db;
}

// Apply drizzle-kit-generated migrations on boot, before the app serves
// traffic — the schema and its indexes are owned by the committed migrations,
// not by any onModuleInit hook.
export async function migratePostgres(): Promise<void> {
  // Migrations live at the package root (drizzle/migrations) and are not
  // compiled into dist — resolve from cwd so the path is identical whether
  // running from source (ts-node/jest) or compiled (node dist/...).
  await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle/migrations') });
  console.log('✅ Postgres migrations applied');
}

export function getDrizzle(): Drizzle {
  if (!db) throw new Error('Postgres not connected — call connectPostgres() first');
  return db;
}

// Anything a repository can run a statement against: the pool-backed database or
// an open transaction. Both derive from the same PgDatabase base, so a
// repository method never has to care which one it got.
export type Executor = PgDatabase<NodePgQueryResultHKT, typeof schema>;

// Open a transaction and hand it to `work` as an opaque TxContext. This is the
// only place in the project that starts an explicit transaction: it exists so a
// bet-state change and the wallet_ops row that justifies it commit together —
// there must never be a money move nothing remembers, nor a remembered move
// whose bet never changed.
export function runInTransaction<T>(
  work: (ctx: TxContext) => Promise<T>,
): Promise<T> {
  return getDrizzle().transaction((tx) => work({ _executor: tx }));
}

// Unwrap a TxContext, defaulting to the pool when the caller isn't in one.
// Repositories call this instead of getDrizzle() so every write can be enlisted
// in a transaction without duplicating the method.
export function executor(ctx?: TxContext): Executor {
  return ctx ? (ctx._executor as Executor) : getDrizzle();
}

export async function closePostgres(): Promise<void> {
  await pool?.end();
}
