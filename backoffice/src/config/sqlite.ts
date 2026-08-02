import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { env } from './env';
import { logger } from '../shared/utils/logger';
import * as schema from '../drizzle/admin.schema';

// The backoffice's own store — operator accounts and the audit trail. Opened
// from main.ts before NestFactory, like the Postgres pool: a store that cannot
// be opened means nobody can log in, which is a failed boot, not a failed
// request.

let sqlite: Database.Database;
let db: BetterSQLite3Database<typeof schema>;

export type AdminDrizzle = BetterSQLite3Database<typeof schema>;

export function openSqlite(): AdminDrizzle {
  const path = resolve(process.cwd(), env.SQLITE_PATH);
  // The directory is a mount point in Docker but not necessarily on a host
  // checkout, where `data/` is gitignored and therefore absent on a fresh clone.
  mkdirSync(dirname(path), { recursive: true });

  sqlite = new Database(path);
  // WAL: the audit interceptor writes while the audit screen reads, and the
  // default journal mode would block one on the other.
  sqlite.pragma('journal_mode = WAL');
  // Off by default in SQLite. There are no foreign keys in admin.schema.ts
  // today, so this is here to make sure adding one later actually enforces
  // anything.
  sqlite.pragma('foreign_keys = ON');

  db = drizzle(sqlite, { schema });
  logger.info(`SQLite opened at ${path}`);
  return db;
}

// Applied on boot, like migratePostgres() in the platform. Migrations live at
// the package root and are not compiled into dist, so resolve from cwd — the
// path is then identical whether running from source or from dist.
export function migrateSqlite(): void {
  migrate(getSqlite(), {
    migrationsFolder: resolve(process.cwd(), 'drizzle/migrations'),
  });
  logger.info('SQLite migrations applied');
}

export function getSqlite(): AdminDrizzle {
  if (!db) throw new Error('SQLite not opened — call openSqlite() first');
  return db;
}

export function closeSqlite(): void {
  sqlite?.close();
}
