// Game → lobby postMessage channel (§2.9b of the white-label integration plan).
//
// The game runs in an iframe owned by the casino lobby. We notify the parent of
// lifecycle and balance changes so its header can mirror the player's balance.
// Outgoing messages are always pinned to the lobby's exact origin (never '*');
// the lobby likewise validates `event.origin` before trusting us.

const LOBBY_ORIGIN = import.meta.env.VITE_LOBBY_ORIGIN ?? 'http://localhost:4200'

type LobbyMessage =
  | { type: 'crashpilot:ready' }
  | { type: 'crashpilot:balanceChanged'; balance: number; currency: string }
  | { type: 'crashpilot:sessionEnded' }

function post(message: LobbyMessage): void {
  // Only meaningful when embedded; a top-level (standalone) load has no parent.
  if (window.parent === window) return
  try {
    window.parent.postMessage(message, LOBBY_ORIGIN)
  } catch {
    // ignore — a hostile/mismatched parent origin just means the message is dropped
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
