// Single source of truth for the platform JWT access token.
//
// In the iframe player model the session is launched fresh from the casino
// lobby each time (single-use launch token → platform JWT), so the JWT lives
// only in memory — it is never persisted. A refresh ends the session and the
// player re-launches from the lobby. Subscribers (the socket layer) are
// notified on change so they can (re-)authenticate or drop to guest mode.

type Listener = (token: string | null) => void

let current: string | null = null
const listeners = new Set<Listener>()

export function getToken(): string | null {
  return current
}

export function setToken(token: string | null): void {
  current = token
  for (const listener of listeners) listener(token)
}

export function clearToken(): void {
  setToken(null)
}

export function onTokenChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
