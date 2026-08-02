import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
