// Game → lobby postMessage channel (§2.9b of the white-label integration plan).
//
// The game runs in a dedicated window opened by the casino lobby. We notify the
// lobby of lifecycle and balance changes so its header can mirror the player's
// balance. The lobby is reachable via `window.opener` (the game is top-level in
// its own window) or, if still embedded, the parent frame. Outgoing messages
// are always pinned to the lobby's exact origin (never '*'); the lobby likewise
// validates `event.origin` before trusting us.

const LOBBY_ORIGIN = import.meta.env.VITE_LOBBY_ORIGIN ?? 'http://localhost:4200'

type LobbyMessage =
  | { type: 'crashpilot:ready' }
  | { type: 'crashpilot:balanceChanged'; balance: number; currency: string }
  | { type: 'crashpilot:sessionEnded' }

function post(message: LobbyMessage): void {
  // The lobby is the opener (game launched via window.open) or, if still
  // embedded, the parent frame. A standalone load has neither — nothing to do.
  const target = window.opener ?? (window.parent !== window ? window.parent : null)
  if (!target) return
  try {
    target.postMessage(message, LOBBY_ORIGIN)
  } catch {
    // ignore — a hostile/mismatched lobby origin just means the message is dropped
  }
}

export function notifyReady(): void {
  post({ type: 'crashpilot:ready' })
}

// The lobby renders balances from minor units (its ledger is integer-based), so
// convert the platform's decimal balance back to minor units at this seam.
export function notifyBalanceChanged(balance: number, currency: string): void {
  post({ type: 'crashpilot:balanceChanged', balance: Math.round(balance * 100), currency })
}

export function notifySessionEnded(): void {
  post({ type: 'crashpilot:sessionEnded' })
}
