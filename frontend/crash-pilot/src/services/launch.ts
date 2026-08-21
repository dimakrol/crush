// Launch handshake for the iframe player.
//
// The white-label lobby embeds the game as `…/?token=<launchToken>&currency=…`.
// The launch token is a REUSABLE session ticket (absolute TTL on the white-label
// side), so we deliberately keep it in the URL: a page reload re-reads it and
// re-authenticates without a fresh launch from the lobby. The resulting platform
// JWT is still held only in memory (see token.ts) and is re-minted on every load.

import * as authApi from './authApi'
import type { LaunchResult } from './types'

function readLaunchParams(): { token: string | null; currency: string | null } {
  try {
    const url = new URL(window.location.href)
    return {
      token: url.searchParams.get('token'),
      currency: url.searchParams.get('currency'),
    }
  } catch {
    return { token: null, currency: null }
  }
}

export const launchParams = readLaunchParams()

// Memoize the launch call so React StrictMode's double-mount (and any re-render)
// only performs one token exchange per page load. The token is reusable now, but
// there's no reason to hit the white-label twice for a single mount.
let launchPromise: Promise<LaunchResult> | null = null

export function launchOnce(token: string): Promise<LaunchResult> {
  if (!launchPromise) launchPromise = authApi.launch(token)
  return launchPromise
}
