import { defineConfig } from 'drizzle-kit';

// drizzle-kit only, and only for the backoffice's OWN SQLite store (operator
// accounts + audit log). The platform's Postgres schema is read-only here: its
// copy in src/drizzle/platform.schema.ts is deliberately not listed, so no
// migration for `crash_pilot` can ever be generated from this project.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/drizzle/admin.schema.ts',
  out: './drizzle/migrations',
  dbCredentials: {
    url: process.env.SQLITE_PATH ?? './data/backoffice.db',
  },
});
