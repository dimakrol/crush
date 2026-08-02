import { useState } from 'react'
import type { GamePhase, BetSlotId } from '../services/types'
import type { SlotState } from '../hooks/useCrashGame'
import { formatCredits, formatMultiplier } from '../utils/format'

interface BettingPanelProps {
  slotId: BetSlotId
  phase: GamePhase
  paused: boolean
  currentMultiplier: number
  slot: SlotState
  authed: boolean
  currency: string | null
  onPlaceBet: (slotId: BetSlotId, amount: number, autoCashOut: number | null) => void
  onCashOut: (slotId: BetSlotId) => void
  onCancelBet: (slotId: BetSlotId) => void
  onQueueNext: (slotId: BetSlotId, amount: number, autoCashOut: number | null) => void
  onCancelNext: (slotId: BetSlotId) => void
}

const QUICK_AMOUNTS = [10, 25, 50, 100]
const MIN_AUTO_CASHOUT = 1.1

export function BettingPanel({
  slotId,
  phase,
  paused,
  currentMultiplier,
  slot,
  authed,
  currency,
  onPlaceBet,
  onCashOut,
  onCancelBet,
  onQueueNext,
  onCancelNext,
}: BettingPanelProps) {
  const [betInput, setBetInput] = useState('')
  const [autoCashOutInput, setAutoCashOutInput] = useState('')

  const { bet, queued, pending } = slot
  const parsedAmount = parseFloat(betInput)
  const isValidAmount = Number.isFinite(parsedAmount) && parsedAmount > 0
  const autoCashOutEntered = autoCashOutInput.trim() !== ''
  const parsedAutoCashOut = parseFloat(autoCashOutInput)
  const autoCashOutValid = Number.isFinite(parsedAutoCashOut) && parsedAutoCashOut >= MIN_AUTO_CASHOUT
  const autoCashOut = autoCashOutValid ? parsedAutoCashOut : null
  // Non-empty but below the minimum: block the bet rather than silently dropping the target.
  const autoCashOutError = autoCashOutEntered && !autoCashOutValid

  const isWaiting = phase === 'WAITING'
  const isMidRound = phase === 'RUNNING' || phase === 'CRASHED'
  const hasActiveBet = bet?.status === 'PLACED'
  const canUseInputs = !bet || (isMidRound && !hasActiveBet)
  // Both new-money actions die while the engine is paused. Cashing out and
  // cancelling stay available: they only ever unwind something already staked.
  const canPlace = authed && !paused && isWaiting && !bet && isValidAmount && !autoCashOutError && !pending
  const canQueue = authed && !paused && isMidRound && canUseInputs && !queued && isValidAmount && !autoCashOutError && !pending
  const canCashOut = phase === 'RUNNING' && hasActiveBet
  const canCancelBet = phase === 'WAITING' && hasActiveBet
  const inputsDisabled = !authed || !canUseInputs || !!queued || pending !== null
  const showInputs = canUseInputs && !queued

  function handlePlace() {
    if (!canPlace) return
    onPlaceBet(slotId, parsedAmount, autoCashOut)
  }

  function handleQueue() {
    if (!canQueue) return
    onQueueNext(slotId, parsedAmount, autoCashOut)
  }

  return (
    <div className="bg-gray-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Slot {slotId}</span>
        {queued ? <span className="text-xs font-semibold text-blue-400">Next round</span> : bet ? <StatusBadge slot={slot} phase={phase} /> : null}
      </div>

      {bet && <BetSummary slot={slot} phase={phase} currentMultiplier={currentMultiplier} currency={currency} />}
      {queued && <QueuedSummary queued={queued} currency={currency} />}

      {showInputs && (
        <div className="space-y-3">
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
            min={MIN_AUTO_CASHOUT}
            step="0.01"
            value={autoCashOutInput}
            onChange={(e) => setAutoCashOutInput(e.target.value)}
            placeholder="Auto cash out at ✕ e.g. 2.00 (optional)"
            disabled={inputsDisabled}
            aria-invalid={autoCashOutError}
            className={`w-full bg-gray-700 border rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none disabled:opacity-40 transition-colors ${
              autoCashOutError ? 'border-red-500 focus:border-red-500' : 'border-gray-600 focus:border-yellow-500'
            }`}
          />
          {autoCashOutError && (
            <p className="text-xs text-red-400">Auto cash out must be at least {MIN_AUTO_CASHOUT.toFixed(2)}✕</p>
          )}
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
        </div>
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
            : `Cash Out ${formatCredits(Math.floor((bet?.amount ?? 0) * currentMultiplier * 100) / 100, currency)}`}
        </button>
      ) : canCancelBet ? (
        <button
          onClick={() => onCancelBet(slotId)}
          disabled={pending === 'canceling'}
          className="w-full py-3 font-bold rounded-xl bg-gray-700 text-gray-200 hover:bg-gray-600 disabled:opacity-50 transition-colors"
        >
          {pending === 'canceling' ? 'Canceling…' : 'Cancel bet'}
        </button>
      ) : queued ? (
        <button
          onClick={() => onCancelNext(slotId)}
          disabled={pending === 'canceling'}
          className="w-full py-3 font-bold rounded-xl bg-gray-700 text-gray-200 hover:bg-gray-600 disabled:opacity-50 transition-colors"
        >
          {pending === 'canceling' ? 'Canceling…' : 'Cancel next-round bet'}
        </button>
      ) : !authed ? (
        <button
          disabled
          className="w-full py-3 text-sm font-semibold rounded-xl bg-gray-700 text-gray-400 cursor-not-allowed"
        >
          Launch from the casino lobby to play
        </button>
      ) : paused ? (
        // Queueing while paused would be harmless in money terms — the stake is
        // debited only when runWaiting() actually places the bet — but naming a
        // "next round" that nobody has scheduled is a promise the UI can't keep.
        // Placed above the isWaiting branch, below the cancel branches: a bet or
        // queue that already exists can still be taken back.
        <div className="space-y-1">
          <button
            disabled
            className="w-full py-3 text-sm font-semibold rounded-xl bg-gray-700 text-gray-400 cursor-not-allowed"
          >
            Betting paused
          </button>
          <p className="text-center text-xs text-gray-500">New bets open when rounds resume.</p>
        </div>
      ) : isWaiting ? (
        <button
          onClick={handlePlace}
          disabled={!canPlace}
          className="w-full py-3 font-bold rounded-xl bg-yellow-500 text-gray-900 hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {pending === 'placing' ? 'Placing…' : 'Place Bet'}
        </button>
      ) : hasActiveBet ? null : (
        <button
          onClick={handleQueue}
          disabled={!canQueue}
          className="w-full py-3 font-bold rounded-xl bg-blue-500 text-white hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {pending === 'queuing' ? 'Queuing…' : 'Bet (next round)'}
        </button>
      )}
    </div>
  )
}

function QueuedSummary({
  queued,
  currency,
}: {
  queued: NonNullable<SlotState['queued']>
  currency: string | null
}) {
  return (
    <div className="text-sm text-gray-300">
      Queued for next round: <span className="font-semibold text-white">{formatCredits(queued.amount, currency)}</span>
      {queued.autoCashOut && <span className="text-gray-400"> · auto @ {formatMultiplier(queued.autoCashOut)}</span>}
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
  currency,
}: {
  slot: SlotState
  phase: GamePhase
  currentMultiplier: number
  currency: string | null
}) {
  const bet = slot.bet!
  if (bet.status === 'CASHED_OUT' && bet.cashOutMultiplier !== null) {
    return (
      <div className="text-sm">
        <p className="text-green-400 font-semibold">✓ {formatMultiplier(bet.cashOutMultiplier)}</p>
        <p className="text-green-300 text-xs">Won {formatCredits(bet.payout, currency)}</p>
      </div>
    )
  }
  if (bet.status === 'LOST' || (bet.status === 'PLACED' && phase === 'CRASHED')) {
    return (
      <div className="text-sm">
        <p className="text-red-400 font-semibold">✗ Lost {formatCredits(bet.amount, currency)}</p>
      </div>
    )
  }
  // PLACED, waiting or running
  return (
    <div className="text-sm text-gray-300">
      Bet: <span className="font-semibold text-white">{formatCredits(bet.amount, currency)}</span>
      {bet.autoCashOut && <span className="text-gray-400"> · auto @ {formatMultiplier(bet.autoCashOut)}</span>}
      {phase === 'RUNNING' && (
        <span className="block text-xs text-gray-400 tabular-nums">
          Now worth {formatCredits(Math.floor(bet.amount * currentMultiplier * 100) / 100, currency)}
        </span>
      )}
    </div>
  )
}
