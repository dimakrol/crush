import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { on as onSocket, getSocket, emitCashout, emitQueueNext, emitCancelNext } from '../services/socket'
import * as betApi from '../services/betApi'
import * as walletApi from '../services/walletApi'
import { getRecentRounds } from '../services/historyApi'
import { friendlyError } from '../services/errorMessages'
import type { Bet, BetSlotId, GamePhase, RoundSummary } from '../services/types'

// Must match the backend ROUND_GROWTH_RATE; the client only interpolates
// between 100ms server ticks, so small mismatches self-correct on each tick.
const GROWTH_RATE = 0.06
const HISTORY_LIMIT = 20
const SLOT_IDS: BetSlotId[] = [1, 2]

export type SlotPending = 'placing' | 'cashing' | 'queuing' | 'canceling' | null

// A one-shot intent to bet on the next round, mirrored from the server's queue.
export interface QueuedBet {
  amount: number
  autoCashOut: number | null
}

export interface SlotState {
  bet: Bet | null
  queued: QueuedBet | null
  pending: SlotPending
}

type Slots = Record<BetSlotId, SlotState>

const EMPTY_SLOTS: Slots = {
  1: { bet: null, queued: null, pending: null },
  2: { bet: null, queued: null, pending: null },
}

export interface UseCrashGameReturn {
  connected: boolean
  phase: GamePhase
  countdown: number
  currentMultiplier: number
  currentRoundId: string | null
  crashPoint: number | null
  roundHistory: RoundSummary[]
  balance: number | null
  slots: Slots
  actionError: string | null
  placeBet: (slotId: BetSlotId, amount: number, autoCashOut?: number | null) => Promise<void>
  cashOut: (slotId: BetSlotId) => void
  queueNext: (slotId: BetSlotId, amount: number, autoCashOut?: number | null) => void
  cancelNext: (slotId: BetSlotId) => void
  resetBalance: () => Promise<void>
  clearError: () => void
}

export function useCrashGame(): UseCrashGameReturn {
  const { status } = useAuth()
  const authed = status === 'authenticated'

  const [connected, setConnected] = useState(() => getSocket().connected)
  const [phase, setPhase] = useState<GamePhase>('WAITING')
  const [countdown, setCountdown] = useState(0)
  const [currentMultiplier, setCurrentMultiplier] = useState(1)
  const [currentRoundId, setCurrentRoundId] = useState<string | null>(null)
  const [crashPoint, setCrashPoint] = useState<number | null>(null)
  const [roundHistory, setRoundHistory] = useState<RoundSummary[]>([])
  const [balance, setBalance] = useState<number | null>(null)
  const [slots, setSlots] = useState<Slots>(EMPTY_SLOTS)
  const [actionError, setActionError] = useState<string | null>(null)

  // phaseRef mirrors `phase` for reads inside the RAF/socket callbacks. It is
  // written in the event handlers (never during render) so the animation loop
  // sees the new phase immediately, before passive effects run.
  const phaseRef = useRef<GamePhase>('WAITING')
  // slotsRef mirrors `slots` so `cashOut` can read the current slot synchronously
  // without putting a side effect inside a setState updater (StrictMode invokes
  // updaters twice in dev, which would double-emit the bet:cashout message).
  const slotsRef = useRef<Slots>(EMPTY_SLOTS)
  const rafRef = useRef<number | null>(null)
  // Latest server multiplier anchor, timestamped on client receipt to avoid clock skew.
  const anchorRef = useRef<{ multiplier: number; at: number }>({ multiplier: 1, at: 0 })

  useEffect(() => {
    slotsRef.current = slots
  }, [slots])

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  // Smoothly grow the displayed multiplier from the last server anchor.
  const runRaf = useCallback(() => {
    const animate = () => {
      if (phaseRef.current !== 'RUNNING') return
      const { multiplier, at } = anchorRef.current
      const elapsed = (performance.now() - at) / 1000
      setCurrentMultiplier(multiplier * Math.exp(GROWTH_RATE * elapsed))
      rafRef.current = requestAnimationFrame(animate)
    }
    stopRaf()
    rafRef.current = requestAnimationFrame(animate)
  }, [stopRaf])

  // ── Round lifecycle (broadcast events) ──────────────────────────────────
  useEffect(() => {
    const offs = [
      onSocket('round:waiting', (e) => {
        stopRaf()
        phaseRef.current = 'WAITING'
        setPhase('WAITING')
        setCurrentRoundId(e.roundId)
        setCountdown(e.countdown)
        setCurrentMultiplier(1)
        setCrashPoint(null)
        setSlots(EMPTY_SLOTS) // previous round resolved
      }),
      onSocket('round:countdown', (e) => setCountdown(e.countdown)),
      onSocket('round:started', (e) => {
        phaseRef.current = 'RUNNING'
        setPhase('RUNNING')
        setCurrentRoundId(e.roundId)
        setCrashPoint(null)
        anchorRef.current = { multiplier: 1, at: performance.now() }
        setCurrentMultiplier(1)
        runRaf()
      }),
      onSocket('round:multiplier', (e) => {
        // Re-anchor on each server tick; if we joined mid-round, this also
        // transitions us into RUNNING and starts the animation.
        anchorRef.current = { multiplier: e.multiplier, at: performance.now() }
        if (phaseRef.current !== 'RUNNING') {
          phaseRef.current = 'RUNNING'
          setPhase('RUNNING')
          setCrashPoint(null)
          runRaf()
        }
        setCurrentMultiplier(e.multiplier)
      }),
      onSocket('round:crashed', (e) => {
        stopRaf()
        phaseRef.current = 'CRASHED'
        setPhase('CRASHED')
        setCrashPoint(e.crashPoint)
        setCurrentMultiplier(e.crashPoint)
        setRoundHistory((prev) =>
          [
            { id: e.roundId, crashPoint: e.crashPoint, startedAt: null, crashedAt: e.crashedAt },
            ...prev,
          ].slice(0, HISTORY_LIMIT),
        )
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [runRaf, stopRaf])

  // ── Connection state + reconnect resync ─────────────────────────────────
  useEffect(() => {
    const socket = getSocket()
    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [])

  // ── Public round history (seed once) ────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    getRecentRounds(HISTORY_LIMIT)
      .then((rounds) => !cancelled && setRoundHistory(rounds))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // ── Private state: wallet + active bets, gated on auth ──────────────────
  const resync = useCallback(async () => {
    if (!authed) return
    try {
      const [bal, active] = await Promise.all([walletApi.getBalance(), betApi.getActiveBets()])
      setBalance(bal)
      setSlots(() => {
        const next: Slots = {
          1: { bet: null, queued: null, pending: null },
          2: { bet: null, queued: null, pending: null },
        }
        // The queue is server-ephemeral and tied to the old socket; a reconnect
        // is a fresh socket, so any prior queued intent is already gone.
        for (const bet of active) next[bet.slotId] = { bet, queued: null, pending: null }
        return next
      })
    } catch {
      // leave state as-is; a 401 will have dropped us to guest already
    }
  }, [authed])

  useEffect(() => {
    if (!authed) return // guest values are derived at return; nothing to fetch
    let active = true
    void (async () => {
      if (active) await resync()
    })()
    const socket = getSocket()
    socket.on('connect', resync) // re-pull after reconnect
    return () => {
      active = false
      socket.off('connect', resync)
    }
  }, [authed, resync])

  // ── Private bet/wallet events ───────────────────────────────────────────
  useEffect(() => {
    const offs = [
      onSocket('wallet:updated', (e) => setBalance(e.balance)),
      onSocket('bet:cashedOut', (e) => {
        const bet = e.bet
        setSlots((prev) => ({ ...prev, [bet.slotId]: { bet, pending: null } }))
      }),
      onSocket('bet:lost', (e) => {
        const { slotId } = e.bet
        setSlots((prev) => ({
          ...prev,
          [slotId]: prev[slotId].bet
            ? { ...prev[slotId], bet: { ...prev[slotId].bet!, status: 'LOST' }, pending: null }
            : prev[slotId],
        }))
      }),
      // ── Next-round queue ──
      onSocket('bet:queued', (e) => {
        setSlots((prev) => ({
          ...prev,
          [e.slotId]: { ...prev[e.slotId], queued: { amount: e.amount, autoCashOut: e.autoCashOut }, pending: null },
        }))
      }),
      onSocket('bet:queueCanceled', (e) => {
        setSlots((prev) => ({ ...prev, [e.slotId]: { ...prev[e.slotId], queued: null, pending: null } }))
      }),
      onSocket('bet:queuePlaced', (e) => {
        // The queued intent became a live bet at the start of WAITING.
        setSlots((prev) => ({ ...prev, [e.bet.slotId]: { bet: e.bet, queued: null, pending: null } }))
        setBalance(e.balance)
      }),
      onSocket('bet:queueDropped', (e) => {
        setSlots((prev) => ({ ...prev, [e.slotId]: { ...prev[e.slotId], queued: null, pending: null } }))
        setActionError(friendlyError(e))
      }),
      onSocket('session:superseded', () => {
        setActionError('This session was opened in another tab.')
      }),
      onSocket('error', (e) => setActionError(friendlyError(e))),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // ── Actions ─────────────────────────────────────────────────────────────
  const placeBet = useCallback(
    async (slotId: BetSlotId, amount: number, autoCashOut: number | null = null) => {
      setActionError(null)
      setSlots((prev) => ({ ...prev, [slotId]: { ...prev[slotId], pending: 'placing' } }))
      try {
        const { bet, balance: newBalance } = await betApi.placeBet(slotId, amount, autoCashOut)
        setSlots((prev) => ({ ...prev, [slotId]: { bet, pending: null } }))
        setBalance(newBalance)
      } catch (err) {
        setSlots((prev) => ({ ...prev, [slotId]: { ...prev[slotId], pending: null } }))
        setActionError(friendlyError(err))
      }
    },
    [],
  )

  const cashOut = useCallback((slotId: BetSlotId) => {
    const slot = slotsRef.current[slotId]
    if (!slot.bet || slot.bet.status !== 'PLACED' || slot.pending) return
    emitCashout(slot.bet.id)
    setSlots((prev) => {
      const cur = prev[slotId]
      if (!cur.bet || cur.pending) return prev
      return { ...prev, [slotId]: { ...cur, pending: 'cashing' } }
    })
  }, [])

  // Queue a bet for the next round (no optimistic state — wait for bet:queued).
  const queueNext = useCallback((slotId: BetSlotId, amount: number, autoCashOut: number | null = null) => {
    setActionError(null)
    setSlots((prev) => ({ ...prev, [slotId]: { ...prev[slotId], pending: 'queuing' } }))
    emitQueueNext(slotId, amount, autoCashOut)
  }, [])

  const cancelNext = useCallback((slotId: BetSlotId) => {
    setSlots((prev) => ({ ...prev, [slotId]: { ...prev[slotId], pending: 'canceling' } }))
    emitCancelNext(slotId)
  }, [])

  const resetBalance = useCallback(async () => {
    setActionError(null)
    try {
      const newBalance = await walletApi.resetBalance()
      setBalance(newBalance)
    } catch (err) {
      setActionError(friendlyError(err))
    }
  }, [])

  const clearError = useCallback(() => setActionError(null), [])

  useEffect(() => stopRaf, [stopRaf])

  return {
    connected,
    phase,
    countdown,
    currentMultiplier,
    currentRoundId,
    crashPoint,
    roundHistory,
    // Guest sees no private state even if stale values linger in state after logout.
    balance: authed ? balance : null,
    slots: authed ? slots : EMPTY_SLOTS,
    actionError,
    placeBet,
    cashOut,
    queueNext,
    cancelNext,
    resetBalance,
    clearError,
  }
}

export { SLOT_IDS }
