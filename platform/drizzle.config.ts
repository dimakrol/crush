import { defineConfig } from 'drizzle-kit';

// drizzle-kit only — generates/inspects migrations. Runtime migration is run by
// migratePostgres() in src/config/postgres.ts on boot. Migrations are committed
// under drizzle/migrations and applied for the active Postgres driver.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/drizzle/schema.ts',
  out: './drizzle/migrations',
  dbCredentials: {
    url:
      process.env.POSTGRES_URL ??
      'postgresql://whitelabel:whitelabel@localhost:5532/crash_pilot',
  },
});
