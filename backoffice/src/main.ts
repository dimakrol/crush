import './config/env'; // validates env vars on startup
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env } from './config/env';
import { closePostgres, connectPostgresReadonly } from './config/postgres';
import { closeSqlite, migrateSqlite, openSqlite } from './config/sqlite';
import { bootstrapAdmin } from './startup/bootstrap-admin';
import { ensureReadonlyRole } from './startup/readonly-role';
import { assertPlatformSchema } from './startup/schema-guard';
import { serveClient } from './startup/serve-client';
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

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const isDev = env.NODE_ENV !== 'production';
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // MUI's styling engine writes <style> tags at runtime, so the
          // console cannot run under a style-src that forbids inline.
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          // Two dev-only holes, both belonging to Vite: the react-refresh
          // preamble is an inline module script, and HMR is a websocket the
          // browser opens back to this same origin. Neither exists in the
          // build, so production keeps script-src at 'self'.
          'script-src': isDev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
          'connect-src': isDev ? ["'self'", 'ws:'] : ["'self'"],
          // Dropped from the defaults: the console is reached over plain http
          // on a workstation and behind a terminating proxy in production, and
          // in the first case this directive breaks every request it rewrites.
          'upgrade-insecure-requests': null,
        },
      },
    }),
  );
  // The session cookie is httpOnly, so the server is the only reader of it.
  app.use(cookieParser());

  // No CORS: Nest is the single origin — it proxies to the Vite dev server in
  // development and serves client/dist in production. Registered before
  // listen(), therefore ahead of Nest's own router, so the SPA fallback sees
  // every path the API did not claim.
  serveClient(app);

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
