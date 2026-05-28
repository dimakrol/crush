import { createContext } from 'react'
import type { AuthUser } from '../services/types'

export type AuthStatus = 'loading' | 'authenticated' | 'guest'

export interface AuthContextValue {
  user: AuthUser | null
  status: AuthStatus
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
