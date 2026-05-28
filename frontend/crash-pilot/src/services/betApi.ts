import { apiRequest } from './api'
import type { Bet, BetSlotId, PlaceBetResult } from './types'

// Place a bet during the WAITING phase. Cashout goes over the socket (see socket.ts).
export async function placeBet(
  slotId: BetSlotId,
  amount: number,
  autoCashOut: number | null = null,
): Promise<PlaceBetResult> {
  const res = await apiRequest<PlaceBetResult>('/api/bets', {
    method: 'POST',
    body: { slotId, amount, autoCashOut },
  })
  return res.data
}

// Active (still PLACED) bets for the current round — used to restore state on load/reconnect.
export async function getActiveBets(): Promise<Bet[]> {
  const res = await apiRequest<Bet[]>('/api/bets/active')
  return res.data
}

export interface BetHistoryPage {
  bets: Bet[]
  nextCursor: string | null
}

export async function getBetHistory(limit = 20, cursor?: string): Promise<BetHistoryPage> {
  const res = await apiRequest<Bet[]>('/api/bets/history', { query: { limit, cursor } })
  return { bets: res.data, nextCursor: (res.meta?.nextCursor as string | null) ?? null }
}
