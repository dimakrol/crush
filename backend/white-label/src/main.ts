import './config/env'; // validates env vars on startup
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env } from './config/env';
import { logger } from './shared/utils/logger';

// Prisma returns BigInt for money columns (minor units); Express' JSON
// serializer can't encode BigInt. Money responses are shaped explicitly at the
// wallet boundary, but this shim keeps any stray BigInt from crashing res.json.
// Minor-unit balances are well within Number's safe-integer range.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this);
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.use(helmet());
  app.enableCors({ origin: env.CORS_ORIGIN });

  await app.listen(env.PORT);
  logger.info(`White-label service started on port ${env.PORT}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
