import { Pool, PoolConfig } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { env } from './env';
import { parseAdminUrl } from '../startup/readonly-role';
import { logger } from '../shared/utils/logger';
import * as schema from '../drizzle/platform.schema';

// The read side of the backoffice: the platform's own database, opened with the
// read-only role created at boot (src/startup/readonly-role.ts). A module-level
// singleton connected imperatively from main.ts before NestFactory, so an
// unreachable or misconfigured database fails the boot rather than the first
// request.
//
// There is no transaction helper and no migrator here, and there will not be
// one: this project never writes to `crash_pilot`.

let pool: Pool;
let db: NodePgDatabase<typeof schema>;

export type Drizzle = NodePgDatabase<typeof schema>;

// Host, port and database come from POSTGRES_ADMIN_URL; only the credentials
// differ. Passing them as fields instead of assembling a URL avoids having to
// percent-encode a password that may contain anything.
export function readonlyConnectionConfig(): PoolConfig {
  const { host, port, database } = parseAdminUrl();
  return {
    host,
    port,
    database,
    user: env.POSTGRES_RO_USER,
    password: env.POSTGRES_RO_PASSWORD,
  };
}

export async function connectPostgresReadonly(): Promise<Drizzle> {
  pool = new Pool(readonlyConnectionConfig());
  // Fail fast if Postgres is unreachable rather than on the first query.
  await pool.query('SELECT 1');
  db = drizzle(pool, { schema });
  logger.info('Postgres connected (read-only)');
  return db;
}

export function getDrizzle(): Drizzle {
  if (!db) {
    throw new Error(
      'Postgres not connected — call connectPostgresReadonly() first',
    );
  }
  return db;
}

export async function closePostgres(): Promise<void> {
  await pool?.end();
}
