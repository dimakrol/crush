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

  // Postgres is the only long-lived transactional store (bets/rounds). Required:
  // the process cannot serve anything without it.
  POSTGRES_URL: z.string().min(1),

  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  CORS_ORIGIN: z.string().min(1),
  ROUND_WAITING_SECONDS: z.coerce.number().default(5),
  ROUND_CRASHED_SECONDS: z.coerce.number().default(3),
  ROUND_GROWTH_RATE: z.coerce.number().default(0.06),
  INITIAL_DEMO_BALANCE: z.coerce.number().default(1000),

  // White-label (operator) seamless-wallet API. The platform is a thin client:
  // money + identity live in the white-label, reached server-to-server over HMAC.
  WALLET_API_URL: z.string().min(1).default('http://localhost:4200'),
  OPERATOR_API_KEY: z.string().min(1).default('dev-operator-key'),
  OPERATOR_SECRET: z.string().min(1).default('dev-operator-secret-change-me'),
  GAME_ID: z.string().default('crash-pilot'),
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
