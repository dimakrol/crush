import { useState } from 'react'
import type { GamePhase, BetSlotId } from '../services/types'
import type { SlotState } from '../hooks/useCrashGame'
import { formatCredits, formatMultiplier } from '../utils/format'

interface BettingPanelProps {
  slotId: BetSlotId
  phase: GamePhase
  currentMultiplier: number
  slot: SlotState
  authed: boolean
  onPlaceBet: (slotId: BetSlotId, amount: number, autoCashOut: number | null) => void
  onCashOut: (slotId: BetSlotId) => void
  onRequireLogin: () => void
}

const QUICK_AMOUNTS = [10, 25, 50, 100]

export function BettingPanel({
  slotId,
  phase,
  currentMultiplier,
  slot,
  authed,
  onPlaceBet,
  onCashOut,
  onRequireLogin,
}: BettingPanelProps) {
  const [betInput, setBetInput] = useState('')
  const [autoCashOutInput, setAutoCashOutInput] = useState('')

  const { bet, pending } = slot
  const parsedAmount = parseFloat(betInput)
  const isValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0
  const parsedAutoCashOut = parseFloat(autoCashOutInput)
  const autoCashOut = Number.isFinite(parsedAutoCashOut) && parsedAutoCashOut > 1 ? parsedAutoCashOut : null

  const canPlace = authed && phase === 'WAITING' && !bet && isValidAmount && !pending
  const isPlaced = bet?.status === 'PLACED'
  const canCashOut = phase === 'RUNNING' && isPlaced
  const inputsDisabled = !authed || phase !== 'WAITING' || !!bet || pending === 'placing'

  function handlePlace() {
    if (!authed) {
      onRequireLogin()
      return
    }
    if (!canPlace) return
    onPlaceBet(slotId, parsedAmount, autoCashOut)
  }

  return (
    <div className="bg-gray-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Slot {slotId}</span>
        {bet && <StatusBadge slot={slot} phase={phase} />}
      </div>

      {/* Resolved/active bet summary */}
      {bet ? (
        <BetSummary slot={slot} phase={phase} currentMultiplier={currentMultiplier} />
      ) : (
        <>
          <input
            type="number"
            min="1"
            value={betInput}
            onChange={(e) => setBetInput(e.target.value)}
            placeholder="Bet amount"
            disabled={inputsDisabled}
            className="w-full bg-gray-700 border border-gray-600 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 disabled:opacity-40 transition-colors"
          />
          <input
            type="number"
            min="1.01"
            step="0.01"
            value={autoCashOutInput}
            onChange={(e) => setAutoCashOutInput(e.target.value)}
            placeholder="Auto cash out (optional)"
            disabled={inputsDisabled}
            className="w-full bg-gray-700 border border-gray-600 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 disabled:opacity-40 transition-colors"
          />
          <div className="flex gap-1.5">
            {QUICK_AMOUNTS.map((amount) => (
              <button
                key={amount}
                onClick={() => setBetInput(String(amount))}
                disabled={inputsDisabled}
                className="flex-1 py-1.5 text-xs font-medium bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 hover:text-white disabled:opacity-40 transition-colors"
              >
                {amount}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Action button */}
      {canCashOut ? (
        <button
          onClick={() => onCashOut(slotId)}
          disabled={pending === 'cashing'}
          className="w-full py-3 font-bold rounded-xl bg-green-500 text-white hover:bg-green-400 disabled:opacity-50 transition-colors tabular-nums"
        >
          {pending === 'cashing'
            ? 'Cashing…'
            : `Cash Out ${formatCredits(Math.floor((bet?.amount ?? 0) * currentMultiplier * 100) / 100)}`}
        </button>
      ) : !bet ? (
        <button
          onClick={handlePlace}
          disabled={authed ? !canPlace : false}
          className="w-full py-3 font-bold rounded-xl bg-yellow-500 text-gray-900 hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {!authed
            ? 'Log in to bet'
            : pending === 'placing'
              ? 'Placing…'
              : phase === 'WAITING'
                ? 'Place Bet'
                : 'Round in progress'}
        </button>
      ) : null}
    </div>
  )
}

function StatusBadge({ slot, phase }: { slot: SlotState; phase: GamePhase }) {
  const status = slot.bet?.status
  if (status === 'CASHED_OUT') return <span className="text-xs font-semibold text-green-400">Cashed out</span>
  if (status === 'LOST') return <span className="text-xs font-semibold text-red-400">Lost</span>
  if (status === 'PLACED' && phase === 'CRASHED') return <span className="text-xs font-semibold text-red-400">Lost</span>
  if (status === 'PLACED') return <span className="text-xs font-semibold text-yellow-400">Active</span>
  return null
}

function BetSummary({
  slot,
  phase,
  currentMultiplier,
}: {
  slot: SlotState
  phase: GamePhase
  currentMultiplier: number
}) {
  const bet = slot.bet!
  if (bet.status === 'CASHED_OUT' && bet.cashOutMultiplier !== null) {
    return (
      <div className="text-sm">
        <p className="text-green-400 font-semibold">✓ {formatMultiplier(bet.cashOutMultiplier)}</p>
        <p className="text-green-300 text-xs">Won {formatCredits(bet.payout)}</p>
      </div>
    )
  }
  if (bet.status === 'LOST' || (bet.status === 'PLACED' && phase === 'CRASHED')) {
    return (
      <div className="text-sm">
        <p className="text-red-400 font-semibold">✗ Lost {formatCredits(bet.amount)}</p>
      </div>
    )
  }
  // PLACED, waiting or running
  return (
    <div className="text-sm text-gray-300">
      Bet: <span className="font-semibold text-white">{formatCredits(bet.amount)}</span>
      {bet.autoCashOut && <span className="text-gray-400"> · auto @ {formatMultiplier(bet.autoCashOut)}</span>}
      {phase === 'RUNNING' && (
        <span className="block text-xs text-gray-400 tabular-nums">
          Now worth {formatCredits(Math.floor(bet.amount * currentMultiplier * 100) / 100)}
        </span>
      )}
    </div>
  )
}
