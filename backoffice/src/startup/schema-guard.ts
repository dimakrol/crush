import { getTableColumns, getTableName } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { Client } from 'pg';
import { readonlyConnectionConfig } from '../config/postgres';
import { bets, rounds, walletOps } from '../drizzle/platform.schema';
import { logger } from '../shared/utils/logger';

// platform.schema.ts is a copy, and a copy silently goes stale. This compares it
// with the live database on every boot and refuses to start on any difference.
//
// Refusing on an EXTRA column is deliberate, even though a SELECT of named
// columns would survive it: an added column means the platform's model moved,
// and a backoffice showing a stale picture of the money domain without saying so
// is worse than one that will not start. The fix is a one-line copy edit.
//
// Only column names are compared. Type drift is rarer, and catching it needs a
// type map between Drizzle and Postgres that would itself drift — the smoke test
// (tests/platform-schema.smoke.spec.ts) is the deeper check.

const WATCHED: PgTable[] = [rounds, bets, walletOps];

interface TableDrift {
  table: string;
  missing: string[];
  extra: string[];
}

export async function assertPlatformSchema(): Promise<void> {
  // Its own short-lived connection, before the pool exists: this is also the
  // first real use of the read-only role, so a botched GRANT surfaces here with
  // the boot step that caused it still on screen.
  const client = new Client(readonlyConnectionConfig());
  await client.connect();

  try {
    const drift: TableDrift[] = [];

    for (const table of WATCHED) {
      const name = getTableName(table);
      const expected = new Set(
        Object.values(getTableColumns(table)).map((column) => column.name),
      );

      const { rows } = await client.query<{ column_name: string }>(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`,
        [name],
      );

      if (rows.length === 0) {
        drift.push({ table: name, missing: [...expected], extra: [] });
        continue;
      }

      const actual = new Set(rows.map((row) => row.column_name));
      const missing = [...expected].filter((c) => !actual.has(c));
      const extra = [...actual].filter((c) => !expected.has(c));

      if (missing.length || extra.length) {
        drift.push({ table: name, missing, extra });
      }
    }

    if (drift.length) {
      logger.error(
        'Platform schema drift detected — src/drizzle/platform.schema.ts no longer matches the database',
      );
      for (const { table, missing, extra } of drift) {
        if (missing.length) {
          logger.error(
            `  ${table}: expected but absent — ${missing.join(', ')}`,
          );
        }
        if (extra.length) {
          logger.error(`  ${table}: present but unknown — ${extra.join(', ')}`);
        }
      }
      logger.error(
        'Copy the current platform/src/drizzle/schema.ts into src/drizzle/platform.schema.ts and restart',
      );
      process.exit(1);
    }

    logger.info(`Platform schema verified (${WATCHED.length} tables)`);
  } finally {
    await client.end();
  }
}
