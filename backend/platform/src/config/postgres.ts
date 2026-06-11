import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'path';
import { env } from './env';
import * as schema from '../drizzle/schema';

// Symmetric with config/database.ts (Mongo): a module-level singleton connected
// imperatively from main.ts before NestFactory. Only the active driver
// (env.DB_DRIVER) is ever connected, so this stays cold when DB_DRIVER=mongo.

let pool: Pool;
let db: NodePgDatabase<typeof schema>;

export type Drizzle = NodePgDatabase<typeof schema>;

export async function connectPostgres(): Promise<Drizzle> {
  // POSTGRES_URL is guaranteed present here: env.ts superRefine requires it
  // whenever DB_DRIVER=postgres, and we only call this on that branch.
  pool = new Pool({ connectionString: env.POSTGRES_URL });
  // Fail fast if Postgres is unreachable, mirroring connectMongo()'s connect().
  await pool.query('SELECT 1');
  db = drizzle(pool, { schema });
  console.log('✅ Postgres connected');
  return db;
}

// Apply drizzle-kit-generated migrations on boot, before the app serves
// traffic — the Postgres analogue of the Mongo repos creating their indexes in
// onModuleInit. The folder is resolved relative to the compiled file so it
// works from both ts-node (src) and dist.
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

export async function closePostgres(): Promise<void> {
  await pool?.end();
}
