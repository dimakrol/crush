import { useCallback, useEffect, useRef, useState } from 'react'
import type { GamePhase, PlayerBet, Round } from '../types/game'
import { calculatePayout, validateBet } from '../utils/game'
import { fetchRoundResult } from '../services/gameService'

const INITIAL_BALANCE = 1000
const WAITING_SECONDS = 5
const CRASHED_SECONDS = 3
const HISTORY_LIMIT = 20

function loadBalance(): number {
  try {
    const raw = localStorage.getItem('crashPilot_balance')
    if (raw === null) return INITIAL_BALANCE
    const parsed = parseFloat(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : INITIAL_BALANCE
  } catch {
    return INITIAL_BALANCE
  }
}

function saveBalance(balance: number): void {
  try {
    localStorage.setItem('crashPilot_balance', String(balance))
  } catch {}
}

function loadHistory(): Round[] {
  try {
    const raw = localStorage.getItem('crashPilot_history')
    if (!raw) return []
    return JSON.parse(raw) as Round[]
  } catch {
    return []
  }
}

function saveHistory(history: Round[]): void {
  try {
    localStorage.setItem('crashPilot_history', JSON.stringify(history.slice(0, HISTORY_LIMIT)))
  } catch {}
}

function makeEmptyBet(): PlayerBet {
  return { amount: 0, placed: false, cashedOut: false, cashOutMultiplier: null, payout: 0, autoCashOut: null }
}

export interface UseCrashGameReturn {
  balance: number
  phase: GamePhase
  countdown: number
  currentMultiplier: number
  currentRound: Round | null
  playerBet: PlayerBet | null
  nextRoundBet: PlayerBet | null
  roundHistory: Round[]
  betError: string | null
  placeBet: (amount: number, autoCashOut?: number | null) => void
  queueNextRoundBet: (amount: number, autoCashOut?: number | null) => void
  cancelNextRoundBet: () => void
  cashOut: () => void
  resetBalance: () => void
}

export function useCrashGame(): UseCrashGameReturn {
  const [balance, setBalance] = useState<number>(loadBalance)
  const [phase, setPhase] = useState<GamePhase>('WAITING')
  const [countdown, setCountdown] = useState<number>(WAITING_SECONDS)
  const [currentMultiplier, setCurrentMultiplier] = useState<number>(1)
  const [currentRound, setCurrentRound] = useState<Round | null>(null)
  const [playerBet, setPlayerBet] = useState<PlayerBet | null>(null)
  const [nextRoundBet, setNextRoundBet] = useState<PlayerBet | null>(null)
  const [roundHistory, setRoundHistory] = useState<Round[]>(loadHistory)
  const [betError, setBetError] = useState<string | null>(null)

  const phaseRef = useRef<GamePhase>('WAITING')
  const playerBetRef = useRef<PlayerBet | null>(null)
  const multiplierRef = useRef<number>(1)
  const nextRoundBetRef = useRef<PlayerBet | null>(null)
  const rafRef = useRef<number | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const roundStartTimeRef = useRef<number>(0)
  const crashPointRef = useRef<number>(2)

  phaseRef.current = phase
  playerBetRef.current = playerBet
  multiplierRef.current = currentMultiplier
  nextRoundBetRef.current = nextRoundBet

  useEffect(() => {
    saveBalance(balance)
  }, [balance])

  const applyCashOut = useCallback((multiplier: number, bet: PlayerBet) => {
    const payout = calculatePayout(bet.amount, multiplier)
    const updatedBet: PlayerBet = { ...bet, cashedOut: true, cashOutMultiplier: multiplier, payout }
    setPlayerBet(updatedBet)
    playerBetRef.current = updatedBet
    setBalance(prev => {
      const next = Math.round((prev + payout) * 100) / 100
      saveBalance(next)
      return next
    })
  }, [])

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const startWaiting = useCallback((pendingBet: PlayerBet | null, history: Round[]) => {
    stopLoop()

    setPhase('WAITING')
    phaseRef.current = 'WAITING'
    setCountdown(WAITING_SECONDS)
    setCurrentMultiplier(1)
    multiplierRef.current = 1
    setCurrentRound(null)

    if (pendingBet) {
      setPlayerBet(pendingBet)
      playerBetRef.current = pendingBet
      setNextRoundBet(null)
      nextRoundBetRef.current = null
    } else {
      setPlayerBet(null)
      playerBetRef.current = null
    }

    let tick = WAITING_SECONDS
    intervalRef.current = setInterval(async () => {
      tick -= 1
      setCountdown(tick)
      if (tick > 0) return

      stopLoop()

      const crashPoint = await fetchRoundResult()
      crashPointRef.current = crashPoint
      const round: Round = {
        id: crypto.randomUUID(),
        crashPoint,
        startedAt: Date.now(),
        crashedAt: null,
      }
      setCurrentRound(round)
      setPhase('RUNNING')
      phaseRef.current = 'RUNNING'
      roundStartTimeRef.current = performance.now()

      const animate = (now: number) => {
        if (phaseRef.current !== 'RUNNING') return

        const elapsed = (now - roundStartTimeRef.current) / 1000
        const multiplier = Math.exp(0.06 * elapsed)
        setCurrentMultiplier(multiplier)
        multiplierRef.current = multiplier

        const bet = playerBetRef.current
        if (bet?.placed && !bet.cashedOut && bet.autoCashOut !== null && multiplier >= bet.autoCashOut) {
          applyCashOut(multiplier, bet)
          // Keep animating — round still runs until crash
          rafRef.current = requestAnimationFrame(animate)
          return
        }

        if (multiplier >= crashPointRef.current) {
          rafRef.current = null
          const crashedRound: Round = { ...round, crashedAt: Date.now() }
          setCurrentRound(crashedRound)
          setPhase('CRASHED')
          phaseRef.current = 'CRASHED'

          const newHistory = [crashedRound, ...history].slice(0, HISTORY_LIMIT)
          setRoundHistory(newHistory)
          saveHistory(newHistory)

          setTimeout(() => {
            startWaiting(nextRoundBetRef.current, newHistory)
          }, CRASHED_SECONDS * 1000)
          return
        }

        rafRef.current = requestAnimationFrame(animate)
      }

      rafRef.current = requestAnimationFrame(animate)
    }, 1000)
  }, [applyCashOut, stopLoop])

  useEffect(() => {
    startWaiting(null, loadHistory())
    return stopLoop
  }, [startWaiting, stopLoop])

  const placeBet = useCallback((amount: number, autoCashOut: number | null = null) => {
    if (phaseRef.current !== 'WAITING') {
      setBetError('Bets can only be placed during the waiting phase')
      return
    }
    if (playerBetRef.current?.placed) {
      setBetError('You already have an active bet this round')
      return
    }
    setBalance(prev => {
      const error = validateBet(amount, prev)
      if (error) {
        setBetError(error)
        return prev
      }
      setBetError(null)
      const bet: PlayerBet = { ...makeEmptyBet(), amount, placed: true, autoCashOut }
      setPlayerBet(bet)
      playerBetRef.current = bet
      const next = Math.round((prev - amount) * 100) / 100
      saveBalance(next)
      return next
    })
  }, [])

  const queueNextRoundBet = useCallback((amount: number, autoCashOut: number | null = null) => {
    if (phaseRef.current !== 'RUNNING') {
      setBetError('Next-round bets can only be queued during a running round')
      return
    }
    setBalance(prev => {
      const error = validateBet(amount, prev)
      if (error) {
        setBetError(error)
        return prev
      }
      setBetError(null)
      const bet: PlayerBet = { ...makeEmptyBet(), amount, placed: true, autoCashOut }
      setNextRoundBet(bet)
      nextRoundBetRef.current = bet
      return prev
    })
  }, [])

  const cancelNextRoundBet = useCallback(() => {
    setNextRoundBet(null)
    nextRoundBetRef.current = null
    setBetError(null)
  }, [])

  const cashOut = useCallback(() => {
    if (phaseRef.current !== 'RUNNING') return
    const bet = playerBetRef.current
    if (!bet?.placed || bet.cashedOut) return
    applyCashOut(multiplierRef.current, bet)
  }, [applyCashOut])

  const resetBalance = useCallback(() => {
    setBalance(INITIAL_BALANCE)
    saveBalance(INITIAL_BALANCE)
    setPlayerBet(null)
    playerBetRef.current = null
    setNextRoundBet(null)
    nextRoundBetRef.current = null
    setBetError(null)
  }, [])

  return {
    balance,
    phase,
    countdown,
    currentMultiplier,
    currentRound,
    playerBet,
    nextRoundBet,
    roundHistory,
    betError,
    placeBet,
    queueNextRoundBet,
    cancelNextRoundBet,
    cashOut,
    resetBalance,
  }
}
