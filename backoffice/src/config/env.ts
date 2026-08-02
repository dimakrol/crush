import { z } from 'zod';

// Load .env into process.env if present (Node 20.12+). In test/production the
// vars may already be set in the environment, so a missing file is not fatal.
try {
  process.loadEnvFile();
} catch {
  // no .env file — rely on the ambient environment
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().default(4000),

  // Superuser credentials for the platform's `crash_pilot` database. Used ONLY
  // at boot, to create the read-only role below; the runtime pool never uses
  // them. Required: without a database there is nothing to show.
  POSTGRES_ADMIN_URL: z.string().min(1),

  // The read-only role the runtime pool logs in as. Its connection string is
  // assembled in code from POSTGRES_ADMIN_URL (same host/port/database), so the
  // two can never drift apart.
  POSTGRES_RO_USER: z.string().min(1).default('backoffice_ro'),
  POSTGRES_RO_PASSWORD: z.string().min(1),

  // The backoffice's own store: operator accounts + audit log.
  SQLITE_PATH: z.string().min(1).default('./data/backoffice.db'),

  // Signs the session cookie. No default on purpose — a guessable secret on an
  // operator console is worse than a service that refuses to boot.
  BACKOFFICE_JWT_SECRET: z.string().min(1),
  BACKOFFICE_JWT_EXPIRES_IN: z.string().default('8h'),

  // First admin, created at boot only while the users table is empty.
  BACKOFFICE_ADMIN_USER: z.string().min(1).default('admin'),
  BACKOFFICE_ADMIN_PASSWORD: z.string().min(1).default('admin'),

  // Every write goes through the platform's admin API, never straight into the
  // database — that is what keeps the money outbox authoritative. The key must
  // match the platform's ADMIN_API_KEY and never reaches the browser.
  PLATFORM_API_URL: z.string().min(1).default('http://localhost:4100'),
  ADMIN_API_KEY: z.string().min(1),

  // Dev only: Nest proxies everything but /api to the Vite dev server, so the
  // browser sees a single origin and the session cookie works without CORS.
  VITE_DEV_SERVER_URL: z.string().min(1).default('http://localhost:5175'),

  // How old a PENDING wallet op / PENDING_STAKE bet must be before the
  // dashboard counts it as stuck.
  STUCK_OP_MINUTES: z.coerce.number().default(5),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error(
    '❌ Invalid environment variables:',
    result.error.flatten().fieldErrors,
  );
  process.exit(1);
}

export const env = result.data;
export type Env = typeof env;
