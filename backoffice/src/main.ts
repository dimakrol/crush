import './config/env'; // validates env vars on startup
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env } from './config/env';
import { closePostgres, connectPostgresReadonly } from './config/postgres';
import { closeSqlite, migrateSqlite, openSqlite } from './config/sqlite';
import { bootstrapAdmin } from './startup/bootstrap-admin';
import { ensureReadonlyRole } from './startup/readonly-role';
import { assertPlatformSchema } from './startup/schema-guard';
import { logger } from './shared/utils/logger';

async function bootstrap() {
  // Everything that can make the service useless is done here, before
  // NestFactory: a failure must stop the boot, not surface as a broken screen.
  // The order is not arbitrary — the role has to exist before anything logs in
  // as it, and the schema is checked before the long-lived pool so a stale copy
  // is reported with nothing else running yet.
  await ensureReadonlyRole();
  await assertPlatformSchema();
  await connectPostgresReadonly();
  openSqlite();
  migrateSqlite();
  await bootstrapAdmin();

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.use(helmet());
  // The session cookie is httpOnly, so the server is the only reader of it.
  app.use(cookieParser());

  // No CORS: Nest is the single origin — it proxies to the Vite dev server in
  // development and serves client/dist in production (phase 5).

  await app.listen(env.PORT);
  logger.info(`Backoffice started on port ${env.PORT}`);

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}, shutting down`);
    try {
      await app.close();
      await closePostgres();
      closeSqlite();
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
  console.error('Failed to start backoffice:', err);
  process.exit(1);
});
