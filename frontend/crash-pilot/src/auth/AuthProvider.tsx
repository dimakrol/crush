import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { AuthContext, type AuthStatus } from './authContext'
import type { AuthUser } from '../services/types'
import * as authApi from '../services/authApi'
import { getToken, setToken, clearToken, onTokenChange } from '../services/token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>(getToken() ? 'loading' : 'guest')

  // Hydrate the session from a persisted token on first load.
  useEffect(() => {
    let cancelled = false
    if (!getToken()) return // initial status is already 'guest' when no token
    authApi
      .me()
      .then((res) => {
        if (cancelled) return
        setUser(res.user)
        setStatus('authenticated')
      })
      .catch(() => {
        if (cancelled) return
        clearToken() // expired/invalid → drop to guest
        setUser(null)
        setStatus('guest')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // If the token is cleared elsewhere (e.g. a 401 in the api layer), reflect it.
  useEffect(() => {
    return onTokenChange((token) => {
      if (!token) {
        setUser(null)
        setStatus('guest')
      }
    })
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password)
    setToken(res.accessToken)
    setUser(res.user)
    setStatus('authenticated')
  }, [])

  const register = useCallback(async (email: string, password: string) => {
    const res = await authApi.register(email, password)
    setToken(res.accessToken)
    setUser(res.user)
    setStatus('authenticated')
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
    setStatus('guest')
  }, [])

  return (
    <AuthContext.Provider value={{ user, status, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
