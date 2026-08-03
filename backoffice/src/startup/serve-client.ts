import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'fs';
import { ServerResponse } from 'http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { join } from 'path';
import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../shared/utils/logger';

// The console is served from Nest, never from Vite directly — in development by
// proxying to the dev server, in production by serving its build output.
//
// One origin in both modes is the whole point. The session lives in an httpOnly
// cookie with SameSite=Lax; if the SPA were loaded from :5175 while the API
// answered on :4300, that cookie would need SameSite=None; Secure and a CORS
// policy with credentials, and development would be exercising a security
// posture production never uses. So the Vite port is not published at all.

// dist/startup/serve-client.js → the project root → client/dist.
const CLIENT_DIST = join(__dirname, '..', '..', 'client', 'dist');

// Everything the API owns. The client half must never shadow it: a fallback
// that answers `/api/whatever` with index.html turns a typo'd endpoint into a
// 200 full of HTML, which fetch() then fails to parse somewhere far away.
function isApi(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

export function serveClient(app: NestExpressApplication): void {
  if (env.NODE_ENV === 'production') {
    serveBuild(app);
  } else {
    proxyToVite(app);
  }
}

function proxyToVite(app: NestExpressApplication): void {
  const proxy = createProxyMiddleware({
    target: env.VITE_DEV_SERVER_URL,
    // The HMR socket. Without it the page loads and then quietly stops
    // updating, which reads as "Vite is broken" rather than "the websocket
    // never got through".
    ws: true,
    // The Host header is passed through unchanged so Vite sees the address the
    // operator actually typed; nothing downstream depends on the origin.
    changeOrigin: false,
    pathFilter: (pathname) => !isApi(pathname),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });

  // The upgrade listener is subscribed by the middleware itself on the first
  // proxied request, and the browser always loads the page before it opens the
  // HMR socket. Registering it here as well would attach a second listener to
  // the same server and proxy every upgrade twice.
  app.use(proxy);
  logger.info(`Proxying the console to ${env.VITE_DEV_SERVER_URL}`);
}

function serveBuild(app: NestExpressApplication): void {
  const index = join(CLIENT_DIST, 'index.html');

  if (!existsSync(index)) {
    // Refusing to boot would be worse: the API is the half that matters when
    // something is on fire, and it is fine. Say what is missing, on the route
    // where someone will look for it.
    logger.error(`Client build not found at ${CLIENT_DIST}`);
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (isApi(req.path)) return next();
      res
        .status(503)
        .type('text/plain')
        .send('Client build missing. Run `npm run build`.');
    });
    return;
  }

  app.useStaticAssets(CLIENT_DIST, {
    // index.html is served by the fallback below, so that one route decides
    // what an unknown path gets.
    index: false,
    setHeaders: (res: ServerResponse, filePath: string) => {
      // Vite fingerprints everything under assets/, so those are immutable.
      // index.html is the manifest that points at them and must never be.
      res.setHeader(
        'Cache-Control',
        filePath.endsWith('index.html')
          ? 'no-store'
          : 'public, max-age=31536000, immutable',
      );
    },
  });

  // SPA fallback: react-admin owns the client-side routes, so a reload on
  // /wallet-ops/<id>/show has to be answered with the app rather than a 404.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isApi(req.path)) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(index);
  });
  logger.info(`Serving the console from ${CLIENT_DIST}`);
}
