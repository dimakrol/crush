import { apiRequest } from './api'
import type { AuthResult, MeResult } from './types'

export async function register(email: string, password: string): Promise<AuthResult> {
  const res = await apiRequest<AuthResult>('/api/auth/register', {
    method: 'POST',
    body: { email, password },
    auth: false,
  })
  return res.data
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const res = await apiRequest<AuthResult>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  })
  return res.data
}

export async function me(): Promise<MeResult> {
  const res = await apiRequest<MeResult>('/api/auth/me')
  return res.data
}
