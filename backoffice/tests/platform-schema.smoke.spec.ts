// Schema-drift smoke test — the deeper half of the guard that runs on every boot.
//
// src/drizzle/platform.schema.ts is a COPY of platform/src/drizzle/schema.ts, and
// a copy goes stale silently. assertPlatformSchema() compares column *names*
// against information_schema at boot; this asks the database to actually hand
// back every column, which also proves the types are readable by the driver and
// that the read-only role may see the table at all.
//
// Opt-in, so `npm test` stays infra-free:
//
//   docker compose up -d postgres
//   RUN_PG_SMOKE=1 npm test
//
// Point it elsewhere with PG_SMOKE_URL (same shape as POSTGRES_ADMIN_URL — a
// superuser URL, because the first thing the run does is create the read-only
// role, exactly as a boot would):
//
//   RUN_PG_SMOKE=1 \
//   PG_SMOKE_URL=postgresql://whitelabel:whitelabel@localhost:5532/crash_pilot \
//     npm test
//
// Read-only against the game's data: it SELECTs, never writes. The one thing it
// does create is the backoffice's own role, which is idempotent.

import type { Column } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { Client } from 'pg';

const RUN = process.env.RUN_PG_SMOKE;
const describePg = RUN ? describe : describe.skip;

const DEFAULT_URL =
  'postgresql://whitelabel:whitelabel@localhost:5532/crash_pilot';

describePg('platform schema (smoke)', () => {
  // Everything is loaded dynamically inside beforeAll: importing config/env at
  // module scope would validate the environment — and process.exit(1) — before
  // the vars below are set, which for a skipped suite would kill the whole run.
  let client: Client;
  let tables: Record<string, PgTable>;
  let getTableColumns: (table: PgTable) => Record<string, Column>;
  let getTableName: (table: PgTable) => string;

  beforeAll(async () => {
    process.env.POSTGRES_ADMIN_URL = process.env.PG_SMOKE_URL ?? DEFAULT_URL;
    // A role of its own, always — never the one a running console logs in as.
    // ensureReadonlyRole() re-applies the password on every call, so reusing the
    // real role here would rotate it out from under a live pool's next
    // connection. Creating this one is idempotent and leaves nothing behind that
    // can write.
    process.env.POSTGRES_RO_USER = 'backoffice_ro_smoke';
    process.env.POSTGRES_RO_PASSWORD = 'backoffice_ro_smoke';
    // Required by config/env with no defaults; irrelevant to this test, but the
    // schema is validated as a whole.
    process.env.BACKOFFICE_JWT_SECRET ??= 'smoke_secret';
    process.env.ADMIN_API_KEY ??= 'smoke_admin_key';

    const drizzle = await import('drizzle-orm');
    getTableColumns = drizzle.getTableColumns;
    getTableName = drizzle.getTableName;

    const schema = await import('../src/drizzle/platform.schema');
    tables = {
      rounds: schema.rounds,
      bets: schema.bets,
      wallet_ops: schema.walletOps,
    };

    // Create/refresh the read-only role first, then connect AS it — so a broken
    // GRANT fails this test instead of being papered over by superuser rights,
    // which is the failure the console would actually hit at boot.
    const { ensureReadonlyRole } = await import('../src/startup/readonly-role');
    await ensureReadonlyRole();

    const { readonlyConnectionConfig } = await import('../src/config/postgres');
    const pg = await import('pg');
    client = new pg.Client(readonlyConnectionConfig());
    await client.connect();
  }, 30_000);

  afterAll(async () => {
    await client?.end();
  });

  // One test per table, so a failure names the table in its title.
  for (const name of ['rounds', 'bets', 'wallet_ops']) {
    it(`${name}: every declared column exists and is selectable`, async () => {
      const table = tables[name];
      expect(getTableName(table)).toBe(name);

      const columns = Object.values(getTableColumns(table)).map((c) => c.name);
      expect(columns.length).toBeGreaterThan(0);

      // LIMIT 0 is the point: the column list is resolved by the planner, so an
      // absent or renamed column is an error (42703) whether or not the table
      // has any rows — and no row data is read.
      const projection = columns.map((c) => `"${c}"`).join(', ');
      await expect(
        client.query(`SELECT ${projection} FROM "${name}" LIMIT 0`),
      ).resolves.toBeDefined();
    });
  }

  it('rejects a write — the runtime role is read-only', async () => {
    // The other boundary this project rests on. If this ever passes silently,
    // reads-direct/writes-through-the-API has stopped being enforced by the
    // deployment and is back to being a promise about the code.
    await expect(
      client.query(`UPDATE "rounds" SET "phase" = "phase" WHERE false`),
    ).rejects.toMatchObject({ code: '42501' }); // insufficient_privilege
  });

  it('finds no unknown columns the copy has not caught up with', async () => {
    const { rows } = await client.query<{
      table_name: string;
      column_name: string;
    }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])`,
      [Object.keys(tables)],
    );

    const unknown = rows.filter(
      (row) =>
        !Object.values(getTableColumns(tables[row.table_name])).some(
          (column) => column.name === row.column_name,
        ),
    );

    // Same reasoning as the boot guard: an extra column means the platform's
    // model moved, and this console would keep showing a stale picture of the
    // money domain without saying so.
    expect(
      unknown.map((row) => `${row.table_name}.${row.column_name}`),
    ).toEqual([]);
  });
});
