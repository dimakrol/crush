// Shared types mirroring the platform backend's API/socket contract.
// Date fields arrive as ISO strings over JSON.

export type GamePhase = 'WAITING' | 'RUNNING' | 'CRASHED'

export type BetSlotId = 1 | 2
export type BetStatus = 'PLACED' | 'CASHED_OUT' | 'LOST' | 'CANCELED'

export interface AuthUser {
  id: string
  email: string
}

export interface AuthResult {
  user: AuthUser
  accessToken: string
}

export interface MeResult {
  user: AuthUser
  balance: number
}

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
  placedAt: string
  cashedOutAt: string | null
  resolvedAt: string | null
}

export interface PlaceBetResult {
  bet: Bet
  balance: number
}

// GET /api/history/rounds item
export interface RoundSummary {
  id: string
  crashPoint: number
  startedAt: string | null
  crashedAt: string | null
}

// ── Socket event payloads ────────────────────────────────────────────────
export interface RoundWaitingEvent {
  roundId: string
  phase: 'WAITING'
  countdown: number
}
export interface RoundCountdownEvent {
  roundId: string
  countdown: number
}
export interface RoundStartedEvent {
  roundId: string
  phase: 'RUNNING'
  startedAt: string
}
export interface RoundMultiplierEvent {
  roundId: string
  multiplier: number
}
export interface RoundCrashedEvent {
  roundId: string
  phase: 'CRASHED'
  crashPoint: number
  crashedAt: string
}
export interface BetCashedOutEvent {
  bet: Bet
}
export interface BetLostEvent {
  bet: Pick<Bet, 'id' | 'roundId' | 'slotId' | 'status' | 'amount'>
}
export interface WalletUpdatedEvent {
  balance: number
}
export interface SocketErrorEvent {
  code: string
  message: string
}
