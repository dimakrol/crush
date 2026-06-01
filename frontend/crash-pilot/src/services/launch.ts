// One-shot launch handshake for the iframe player.
//
// The white-label lobby embeds the game as `…/?token=<launchToken>&currency=…`.
// We read those params *once* at module load and immediately strip the token
// from the address bar so a refresh or browser-history entry can't replay the
// single-use ticket. The resulting platform JWT is held only in memory
// (see token.ts) — there is no persistent session in the iframe model.

import * as authApi from './authApi'
import type { LaunchResult } from './types'

function readAndStripLaunchParams(): { token: string | null; currency: string | null } {
  try {
    const url = new URL(window.location.href)
    const token = url.searchParams.get('token')
    const currency = url.searchParams.get('currency')
    if (token) {
      // Drop only the sensitive single-use token; keep currency/lang for clarity.
      url.searchParams.delete('token')
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
    return { token, currency }
  } catch {
    return { token: null, currency: null }
  }
}

export const launchParams = readAndStripLaunchParams()

// Memoize the launch call so React StrictMode's double-mount (and any re-render)
// can't exchange the same single-use token twice — the second exchange would 401.
let launchPromise: Promise<LaunchResult> | null = null

export function launchOnce(token: string): Promise<LaunchResult> {
  if (!launchPromise) launchPromise = authApi.launch(token)
  return launchPromise
}
