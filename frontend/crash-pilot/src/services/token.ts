// Single source of truth for the JWT access token, persisted to localStorage.
// Subscribers (e.g. the socket layer) are notified on change so they can
// re-authenticate or drop to guest mode.

const STORAGE_KEY = 'crashPilot_token'

type Listener = (token: string | null) => void

let current: string | null = readInitial()
const listeners = new Set<Listener>()

function readInitial(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function getToken(): string | null {
  return current
}

export function setToken(token: string | null): void {
  current = token
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore storage failures (private mode, quota)
  }
  for (const listener of listeners) listener(token)
}

export function clearToken(): void {
  setToken(null)
}

export function onTokenChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
