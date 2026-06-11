import './config/env'; // validates env vars on startup
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { closeMongo, connectMongo } from './config/database';
import {
  closePostgres,
  connectPostgres,
  migratePostgres,
} from './config/postgres';
import { closeRedis, connectRedis } from './config/redis';
import { env } from './config/env';
import { AppModule } from './app.module';
import { logger } from './shared/utils/logger';

async function bootstrap() {
  // Connect only the active driver. Postgres also applies migrations on boot
  // (the analogue of the Mongo repos creating indexes in onModuleInit).
  if (env.DB_DRIVER === 'postgres') {
    await connectPostgres();
    await migratePostgres();
  } else {
    await connectMongo();
  }
  await connectRedis();

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.use(helmet());
  app.enableCors({ origin: env.CORS_ORIGIN });

  app.use(
    '/api/auth/launch',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  await app.listen(env.PORT);
  logger.info(`Server started on port ${env.PORT}`);


  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}, shutting down`);
    try {
      await app.close();
      await closeRedis();
      if (env.DB_DRIVER === 'postgres') {
        await closePostgres();
      } else {
        await closeMongo();
      }
      process.exit(0);
    } catch (err) {
      console.error('Failed to shut down cleanly:', err);
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
