import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The port the operator's browser is actually talking to — Nest's, not this
// one. Vite is reached only through Nest's dev proxy and its own port is never
// published, so anything the *client* half of HMR needs has to be told the
// outside address explicitly.
const publicPort = Number(process.env.BACKOFFICE_PUBLIC_PORT ?? 4300);

// The client is served through Nest, never directly: in dev Nest proxies
// everything but /api here (including the HMR websocket), in prod it serves
// the build output. One origin means the httpOnly session cookie behaves
// identically in both.
export default defineConfig({
  // Explicit: vite is launched from the project root with `--config`, so the
  // default root would be the Nest project, not the client. `.mts` keeps this
  // file ESM — Vite 8 warns about ESM-in-CJS configs and will stop loading them.
  root: import.meta.dirname,
  plugins: [react()],
  base: '/',
  server: {
    // 0.0.0.0 so Nest can reach it from inside the container network namespace.
    host: '0.0.0.0',
    port: 5175,
    strictPort: true,
    // The page came from Nest, so the HMR client would otherwise dial 5175 on
    // the operator's machine and find nothing there. Only the port is
    // overridden — the host stays whatever the page was loaded from, so this
    // keeps working over a LAN address or an SSH tunnel.
    hmr: { clientPort: publicPort },
    // Vite's Host header check protects a dev server a browser can reach. This
    // one it cannot: it listens inside the container on a port nothing
    // publishes, and Nest is its only possible client. Left on, the check would
    // reject every host name but localhost — including the LAN address a second
    // machine would use to reach Nest.
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
