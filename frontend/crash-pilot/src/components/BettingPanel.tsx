import { useState } from 'react'
import type { GamePhase, PlayerBet } from '../types/game'
import { formatCredits, formatMultiplier } from '../utils/format'

interface BettingPanelProps {
  phase: GamePhase
  currentMultiplier: number
  playerBet: PlayerBet | null
  nextRoundBet: PlayerBet | null
  betError: string | null
  onPlaceBet: (amount: number, autoCashOut: number | null) => void
  onQueueNextRoundBet: (amount: number, autoCashOut: number | null) => void
  onCancelNextRoundBet: () => void
  onCashOut: () => void
}

const QUICK_AMOUNTS = [10, 25, 50, 100]

export function BettingPanel({
  phase,
  currentMultiplier,
  playerBet,
  nextRoundBet,
  betError,
  onPlaceBet,
  onQueueNextRoundBet,
  onCancelNextRoundBet,
  onCashOut,
}: BettingPanelProps) {
  const [betInput, setBetInput] = useState('')
  const [autoCashOutInput, setAutoCashOutInput] = useState('')

  const parsedAmount = parseFloat(betInput)
  const parsedAutoCashOut = parseFloat(autoCashOutInput) || null
  const isValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0

  const canPlaceBet = phase === 'WAITING' && !playerBet?.placed && isValidAmount
  const canQueue = phase === 'RUNNING' && !nextRoundBet && isValidAmount
  const canCashOut = phase === 'RUNNING' && playerBet?.placed && !playerBet.cashedOut

  const possiblePayout =
    phase === 'RUNNING' && playerBet?.placed && !playerBet.cashedOut
      ? playerBet.amount * currentMultiplier
      : null

  function handleSubmit() {
    if (!isValidAmount) return
    const autoCashOut = parsedAutoCashOut && parsedAutoCashOut > 1 ? parsedAutoCashOut : null
    if (phase === 'WAITING') {
      onPlaceBet(parsedAmount, autoCashOut)
    } else if (phase === 'RUNNING') {
      onQueueNextRoundBet(parsedAmount, autoCashOut)
    }
  }

  function handleQuickAmount(amount: number) {
    setBetInput(String(amount))
  }

  return (
    <div className="bg-gray-800 rounded-2xl p-4 md:p-6 space-y-4">
      {/* Queued next-round bet display */}
      {nextRoundBet && (
        <div className="flex items-center justify-between bg-yellow-950 border border-yellow-700 rounded-xl px-4 py-3">
          <div className="text-sm text-yellow-300 font-medium">
            ⏳ Queued: {formatCredits(nextRoundBet.amount)}
            {nextRoundBet.autoCashOut && (
              <span className="text-yellow-500"> @ {formatMultiplier(nextRoundBet.autoCashOut)}</span>
            )}
          </div>
          <button
            onClick={onCancelNextRoundBet}
            className="text-xs text-yellow-600 hover:text-yellow-400 transition-colors px-2 py-1 rounded"
            aria-label="Cancel queued bet"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Bet amount input */}
      <div className="space-y-1">
        <label htmlFor="bet-amount" className="block text-sm text-gray-400 font-medium">
          Bet Amount
        </label>
        <input
          id="bet-amount"
          type="number"
          min="1"
          value={betInput}
          onChange={e => setBetInput(e.target.value)}
          placeholder="Enter amount"
          className="w-full bg-gray-700 border border-gray-600 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 transition-colors"
          disabled={!!nextRoundBet || (phase === 'WAITING' && !!playerBet?.placed)}
          aria-describedby={betError ? 'bet-error' : undefined}
        />
        {betError && (
          <p id="bet-error" className="text-xs text-red-400" role="alert">
            {betError}
          </p>
        )}
      </div>

      {/* Auto cashout input */}
      <div className="space-y-1">
        <label htmlFor="auto-cashout" className="block text-sm text-gray-400 font-medium">
          Auto Cash Out at (optional)
        </label>
        <input
          id="auto-cashout"
          type="number"
          min="1.01"
          step="0.01"
          value={autoCashOutInput}
          onChange={e => setAutoCashOutInput(e.target.value)}
          placeholder="e.g. 2.00"
          className="w-full bg-gray-700 border border-gray-600 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 transition-colors"
          disabled={!!nextRoundBet || (phase === 'WAITING' && !!playerBet?.placed)}
        />
      </div>

      {/* Quick amount buttons */}
      <div className="flex gap-2">
        {QUICK_AMOUNTS.map(amount => (
          <button
            key={amount}
            onClick={() => handleQuickAmount(amount)}
            disabled={!!nextRoundBet || (phase === 'WAITING' && !!playerBet?.placed)}
            className="flex-1 py-2 text-sm font-medium bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {amount}
          </button>
        ))}
      </div>

      {/* Possible payout */}
      {possiblePayout !== null && (
        <div className="text-center text-sm text-gray-400">
          Possible payout:{' '}
          <span className="text-green-400 font-semibold">{formatCredits(Math.floor(possiblePayout * 100) / 100)}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleSubmit}
          disabled={phase === 'WAITING' ? !canPlaceBet : phase === 'RUNNING' ? !canQueue || !!nextRoundBet : true}
          className="flex-1 py-3 font-bold rounded-xl bg-yellow-500 text-gray-900 hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label={phase === 'RUNNING' ? 'Queue bet for next round' : 'Place bet'}
        >
          {phase === 'RUNNING' ? 'Bet Next Round' : 'Place Bet'}
        </button>

        <button
          onClick={onCashOut}
          disabled={!canCashOut}
          className="flex-1 py-3 font-bold rounded-xl bg-green-500 text-white hover:bg-green-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Cash out"
        >
          Cash Out
        </button>
      </div>
    </div>
  )
}
