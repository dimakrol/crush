import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useThrottledValue } from '../useThrottledValue'

describe('useThrottledValue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useThrottledValue(1.0, 100))
    expect(result.current).toBe(1.0)
  })

  it('suppresses changes that arrive within the interval', () => {
    const { result, rerender } = renderHook(({ v }) => useThrottledValue(v, 100), {
      initialProps: { v: 1.0 },
    })
    rerender({ v: 1.1 })
    rerender({ v: 1.2 })
    rerender({ v: 1.3 })
    // No tick has fired yet.
    expect(result.current).toBe(1.0)
  })

  it('emits the latest value when the interval fires', () => {
    const { result, rerender } = renderHook(({ v }) => useThrottledValue(v, 100), {
      initialProps: { v: 1.0 },
    })
    rerender({ v: 1.5 })
    rerender({ v: 2.0 })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBe(2.0)
  })

  it('does not re-render when the latest value matches the throttled value', () => {
    const renders: number[] = []
    const { rerender } = renderHook(({ v }) => {
      const t = useThrottledValue(v, 100)
      renders.push(t)
      return t
    }, { initialProps: { v: 7 } })
    const before = renders.length
    rerender({ v: 7 })
    act(() => {
      vi.advanceTimersByTime(500) // 5 ticks, none should change state
    })
    // Only renders are the two rerender() calls; no extra renders from setState.
    expect(renders.length).toBe(before + 1)
  })
})
