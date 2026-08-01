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
  DATABASE_URL: z.string().min(1),

  // Lobby player session (the casino's own login).
  LOBBY_JWT_SECRET: z.string().min(1),
  LOBBY_JWT_EXPIRES_IN: z.string().default('1h'),

  // Server-to-server wallet API auth (platform -> white-label, HMAC).
  OPERATOR_API_KEY: z.string().min(1),
  OPERATOR_SECRET: z.string().min(1),

  // Game launch + iframe.
  GAME_FRONTEND_URL: z.string().min(1),
  GAME_ID: z.string().default('crash-pilot'),
  LAUNCH_TOKEN_TTL_SECONDS: z.coerce.number().default(60),

  // Seed balance in integer minor units (100000 = 1000.00 USD).
  INITIAL_DEMO_BALANCE: z.coerce.number().default(100000),

  CORS_ORIGIN: z.string().default('*'),
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
