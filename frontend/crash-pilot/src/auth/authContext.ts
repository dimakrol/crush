import { createContext } from 'react'
import type { Player } from '../services/types'

export type AuthStatus = 'loading' | 'authenticated' | 'guest'

export interface AuthContextValue {
  player: Player | null
  status: AuthStatus
  // The session currency, known as soon as the launch URL is parsed (even while
  // the token is still being exchanged) so labels can render it immediately.
  currency: string | null
}

export const AuthContext = createContext<AuthContextValue | null>(null)
