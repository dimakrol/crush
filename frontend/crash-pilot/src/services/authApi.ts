import { apiRequest } from './api'
import type { LaunchResult } from './types'

// Exchange a single-use launch token (minted by the white-label lobby) for a
// platform session: a JWT + the player's identity and starting balance.
export async function launch(token: string): Promise<LaunchResult> {
  const res = await apiRequest<LaunchResult>('/api/auth/launch', {
    method: 'POST',
    body: { token },
    auth: false,
  })
  return res.data
}
