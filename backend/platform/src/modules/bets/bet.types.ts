export type BetSlotId = 1 | 2
export type BetStatus = 'PLACED' | 'CASHED_OUT' | 'LOST' | 'CANCELED'

export interface Bet {
  id: string
  userId: string
  roundId: string
  slotId: BetSlotId
  amount: number
  autoCashOut: number | null
  status: BetStatus
  cashOutMultiplier: number | null
  payout: number
  placedAt: Date
  cashedOutAt: Date | null
  resolvedAt: Date | null
}
