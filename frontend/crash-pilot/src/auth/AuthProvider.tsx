import { useEffect, useState, type ReactNode } from 'react'
import { AuthContext, type AuthStatus } from './authContext'
import type { Player } from '../services/types'
import { launchParams, launchOnce } from '../services/launch'
import { setToken, clearToken } from '../services/token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [player, setPlayer] = useState<Player | null>(null)
  // A launch token in the URL means we're embedded by the lobby and authenticating;
  // without one we stay a guest spectator.
  const [status, setStatus] = useState<AuthStatus>(launchParams.token ? 'loading' : 'guest')

  // Exchange the single-use launch token for a platform session on first load.
  useEffect(() => {
    const token = launchParams.token
    if (!token) return // tokenless → guest spectator (status already 'guest')
    let cancelled = false
    launchOnce(token)
      .then((res) => {
        if (cancelled) return
        setToken(res.accessToken) // in-memory; notifies the socket to authenticate
        setPlayer(res.player)
        setStatus('authenticated')
      })
      .catch(() => {
        if (cancelled) return
        clearToken() // expired / already-used / invalid → spectate
        setPlayer(null)
        setStatus('guest')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{ player, status, currency: player?.currency ?? launchParams.currency }}
    >
      {children}
    </AuthContext.Provider>
  )
}
