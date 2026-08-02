import { Client } from 'pg';
import { env } from '../config/env';
import { logger } from '../shared/utils/logger';

// Creates (and keeps in sync) the Postgres role the runtime pool logs in as.
// This is the ONLY place the superuser credentials are used, and it runs once,
// at boot, before any pool exists — see src/config/postgres.ts.
//
// The point is not politeness. Reads go straight to the platform's database
// while every write goes through its HTTP admin API, because the money outbox
// must stay the only path a balance can move along. A read-only role is what
// makes that a property of the deployment instead of a promise about the code:
// a bug, a wrong Drizzle call or a hand-typed query in this service physically
// cannot modify `crash_pilot`.

// Postgres identifiers are quoted by doubling embedded quotes; string literals
// by doubling embedded apostrophes. Both values come from our own env, but
// CREATE ROLE / ALTER ROLE take no bind parameters, so they are interpolated —
// and interpolation without escaping is how injection happens.
function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function parseAdminUrl(): {
  host: string;
  port: number;
  database: string;
} {
  const url = new URL(env.POSTGRES_ADMIN_URL);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error('POSTGRES_ADMIN_URL has no database name');
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database,
  };
}

export async function ensureReadonlyRole(): Promise<void> {
  const { database } = parseAdminUrl();
  const role = quoteIdent(env.POSTGRES_RO_USER);
  const password = quoteLiteral(env.POSTGRES_RO_PASSWORD);

  const admin = new Client({ connectionString: env.POSTGRES_ADMIN_URL });
  await admin.connect();
  try {
    const { rowCount } = await admin.query(
      'SELECT 1 FROM pg_roles WHERE rolname = $1',
      [env.POSTGRES_RO_USER],
    );

    if (!rowCount) {
      await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD ${password}`);
      logger.info(`Created read-only role ${env.POSTGRES_RO_USER}`);
    } else {
      // Re-apply the password every boot so rotating POSTGRES_RO_PASSWORD in
      // the environment is enough — otherwise the role would keep the old one
      // and the next start would fail authentication for no visible reason.
      await admin.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD ${password}`);
    }

    // Idempotent: re-granting an existing privilege is a no-op.
    await admin.query(
      `GRANT CONNECT ON DATABASE ${quoteIdent(database)} TO ${role}`,
    );
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`);
    // ALL TABLES only covers what exists right now. Default privileges cover
    // what the platform's migrations create later, so a new table does not
    // require a manual GRANT here. Caveat worth knowing: this only applies to
    // objects created by THIS role, which holds because the platform connects
    // with the same credentials as POSTGRES_ADMIN_URL.
    await admin.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${role}`,
    );

    logger.info(
      `Read-only role ${env.POSTGRES_RO_USER} ready on database ${database}`,
    );
  } finally {
    await admin.end();
  }
}
