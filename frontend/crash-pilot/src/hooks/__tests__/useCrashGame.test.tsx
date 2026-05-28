import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AuthContext, type AuthContextValue } from '../../auth/authContext'

// Capture socket handlers so the test can dispatch server events.
const h = vi.hoisted(() => {
  const handlers: Record<string, ((payload: unknown) => void)[]> = {}
  return {
    handlers,
    on: (event: string, handler: (payload: unknown) => void) => {
      ;(handlers[event] ??= []).push(handler)
      return () => {}
    },
    fakeSocket: { connected: true, on: vi.fn(), off: vi.fn() },
    emitCashout: vi.fn(),
  }
})

vi.mock('../../services/socket', () => ({
  on: h.on,
  getSocket: () => h.fakeSocket,
  emitCashout: h.emitCashout,
}))

vi.mock('../../services/historyApi', () => ({
  getRecentRounds: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../services/betApi', () => ({
  getActiveBets: vi.fn().mockResolvedValue([]),
  placeBet: vi.fn(),
}))
vi.mock('../../services/walletApi', () => ({
  getBalance: vi.fn().mockResolvedValue(0),
  resetBalance: vi.fn(),
}))

// Import after mocks are registered.
import { useCrashGame } from '../useCrashGame'

function emit(event: string, payload: unknown) {
  act(() => {
    h.handlers[event]?.forEach((handler) => handler(payload))
  })
}

const guest: AuthContextValue = {
  user: null,
  status: 'guest',
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}

function wrapper({ children }: { children: ReactNode }) {
  return <AuthContext.Provider value={guest}>{children}</AuthContext.Provider>
}

beforeEach(() => {
  for (const key of Object.keys(h.handlers)) delete h.handlers[key]
  // rAF as a no-op so the interpolation loop doesn't run in tests; the event
  // handlers set currentMultiplier directly, which is what we assert on.
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

describe('useCrashGame socket reducer', () => {
  it('starts in WAITING', () => {
    const { result } = renderHook(() => useCrashGame(), { wrapper })
    expect(result.current.phase).toBe('WAITING')
  })

  it('applies the round lifecycle from socket events', () => {
    const { result } = renderHook(() => useCrashGame(), { wrapper })

    emit('round:waiting', { roundId: 'r1', phase: 'WAITING', countdown: 5 })
    expect(result.current.phase).toBe('WAITING')
    expect(result.current.countdown).toBe(5)
    expect(result.current.currentRoundId).toBe('r1')

    emit('round:countdown', { roundId: 'r1', countdown: 3 })
    expect(result.current.countdown).toBe(3)

    emit('round:started', { roundId: 'r1', phase: 'RUNNING', startedAt: new Date().toISOString() })
    expect(result.current.phase).toBe('RUNNING')

    emit('round:multiplier', { roundId: 'r1', multiplier: 1.84 })
    expect(result.current.currentMultiplier).toBeCloseTo(1.84)

    emit('round:crashed', { roundId: 'r1', phase: 'CRASHED', crashPoint: 2.31, crashedAt: new Date().toISOString() })
    expect(result.current.phase).toBe('CRASHED')
    expect(result.current.crashPoint).toBe(2.31)
    expect(result.current.currentMultiplier).toBe(2.31)
    expect(result.current.roundHistory[0]).toMatchObject({ id: 'r1', crashPoint: 2.31 })
  })

  it('transitions to RUNNING when joining mid-round via a multiplier tick', () => {
    const { result } = renderHook(() => useCrashGame(), { wrapper })
    emit('round:multiplier', { roundId: 'r9', multiplier: 3.5 })
    expect(result.current.phase).toBe('RUNNING')
    expect(result.current.currentMultiplier).toBeCloseTo(3.5)
  })

  it('keeps balance null and slots empty for a guest', async () => {
    const { result } = renderHook(() => useCrashGame(), { wrapper })
    await waitFor(() => expect(result.current.balance).toBeNull())
    expect(result.current.slots[1].bet).toBeNull()
    expect(result.current.slots[2].bet).toBeNull()
  })
})
