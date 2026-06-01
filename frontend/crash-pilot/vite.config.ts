import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // The game is embedded in the white-label casino lobby's iframe. Authorize that
  // origin to frame us via CSP frame-ancestors (and intentionally set no
  // X-Frame-Options, which would otherwise forbid all framing).
  const env = loadEnv(mode, process.cwd(), '')
  const lobbyOrigin = env.VITE_LOBBY_ORIGIN || 'http://localhost:4200'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5174,
      strictPort: true,
      headers: {
        'Content-Security-Policy': `frame-ancestors 'self' ${lobbyOrigin}`,
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test-setup.ts',
      globals: true,
    },
  }
})
