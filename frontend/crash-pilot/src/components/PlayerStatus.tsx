import type { GamePhase, PlayerBet } from '../types/game'
import { formatCredits, formatMultiplier } from '../utils/format'

interface PlayerStatusProps {
  phase: GamePhase
  playerBet: PlayerBet | null
}

export function PlayerStatus({ phase, playerBet }: PlayerStatusProps) {
  if (!playerBet?.placed) {
    return (
      <div className="text-center text-sm text-gray-500 py-2">
        No bet placed this round
      </div>
    )
  }

  if (playerBet.cashedOut && playerBet.cashOutMultiplier !== null) {
    return (
      <div className="text-center py-2 space-y-0.5" role="status">
        <p className="text-green-400 font-semibold text-sm">
          ✓ Cashed out at {formatMultiplier(playerBet.cashOutMultiplier)}
        </p>
        <p className="text-green-300 text-xs">Won {formatCredits(playerBet.payout)}</p>
      </div>
    )
  }

  if (phase === 'CRASHED' && !playerBet.cashedOut) {
    return (
      <div className="text-center py-2 space-y-0.5" role="status">
        <p className="text-red-400 font-semibold text-sm">
          ✗ Lost — did not cash out in time
        </p>
        <p className="text-red-300 text-xs">Lost {formatCredits(playerBet.amount)}</p>
      </div>
    )
  }

  return (
    <div className="text-center text-sm text-gray-300 py-2" role="status">
      Bet placed: <span className="font-semibold text-white">{formatCredits(playerBet.amount)}</span>
      {playerBet.autoCashOut && (
        <span className="text-gray-400"> · Auto out @ {formatMultiplier(playerBet.autoCashOut)}</span>
      )}
    </div>
  )
}
