export type GamePhase = 'WAITING' | 'RUNNING' | 'CRASHED'

export interface Round {
  id: string
  crashPoint: number
  startedAt: number | null
  crashedAt: number | null
}

export interface PlayerBet {
  amount: number
  placed: boolean
  cashedOut: boolean
  cashOutMultiplier: number | null
  payout: number
  autoCashOut: number | null
}

export interface GameState {
  balance: number
  phase: GamePhase
  countdown: number
  currentMultiplier: number
  currentRound: Round | null
  playerBet: PlayerBet | null
  nextRoundBet: PlayerBet | null
  roundHistory: Round[]
}
