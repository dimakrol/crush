// Shared types mirroring the platform backend's API/socket contract.
// Date fields arrive as ISO strings over JSON.

export type GamePhase = 'WAITING' | 'RUNNING' | 'CRASHED'

export type BetSlotId = 1 | 2
export type BetStatus = 'PLACED' | 'CASHED_OUT' | 'LOST' | 'CANCELED'

// The player identity minted by the white-label and returned by the platform's
// /api/auth/launch. `balance` is decimal currency (the platform converts from the
// operator's minor units at its wallet seam).
export interface Player {
  id: string
  displayName: string
  currency: string
  balance: number
}

// POST /api/auth/launch — exchanges a single-use launch token for a platform session.
export interface LaunchResult {
  player: Player
  accessToken: string
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
// Operator pause. Broadcast once when the engine enters the pause, and sent to a
// single socket that connects while a pause is already standing. Deliberately
// NOT a GamePhase: the pause sits *between* rounds, and folding it into the
// phase machine would make every phase check in the app a three-way one.
export interface RoundPausedEvent {
  paused: true
}
export interface RoundResumedEvent {
  paused: false
}
export interface BetCashedOutEvent {
  bet: Bet
}
export interface BetCanceledEvent {
  bet: Bet
}
// Next-round queue events.
export interface BetQueuedEvent {
  slotId: BetSlotId
  amount: number
  autoCashOut: number | null
}
export interface BetQueueCanceledEvent {
  slotId: BetSlotId
}
export interface BetQueuePlacedEvent {
  bet: Bet
  balance: number
}
export interface BetQueueDroppedEvent {
  slotId: BetSlotId
  code: string
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
