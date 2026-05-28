import { apiRequest } from './api'
import type { RoundSummary } from './types'

// Public recent round crash points (no auth required).
export async function getRecentRounds(limit = 20): Promise<RoundSummary[]> {
  const res = await apiRequest<RoundSummary[]>('/api/history/rounds', {
    query: { limit },
    auth: false,
  })
  return res.data
}
