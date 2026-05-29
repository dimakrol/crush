import './config/env'; // validates env vars on startup
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { connectMongo } from './config/database';
import { connectRedis } from './config/redis';
import { env } from './config/env';
import { AppModule } from './app.module';
import { logger } from './shared/utils/logger';

async function bootstrap() {
  await connectMongo();
  await connectRedis();

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.use(helmet());
  app.enableCors({ origin: env.CORS_ORIGIN });

  app.use(
    '/api/auth/register',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(
    '/api/auth/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  await app.listen(env.PORT);
  logger.info(`Server started on port ${env.PORT}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
