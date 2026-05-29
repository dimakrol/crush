import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// Stub the audio module wholesale — JSDOM can't run Web Audio, and these tests
// are about phase-transition logic, not synth behavior.
vi.mock('../audioEngine', () => ({
  startEngine: vi.fn(),
  stopEngine: vi.fn(),
  subscribeMuted: vi.fn(() => () => {}),
  getMuted: vi.fn(() => true),
}))

import * as audioEngine from '../audioEngine'
import { useGameSounds } from '../useGameSounds'
import type { GamePhase } from '../../services/types'

describe('useGameSounds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function mount(initial: GamePhase) {
    return renderHook(({ p }: { p: GamePhase }) => useGameSounds(p, () => 1), {
      initialProps: { p: initial },
    })
  }

  it('does nothing on initial WAITING mount', () => {
    mount('WAITING')
    expect(audioEngine.startEngine).not.toHaveBeenCalled()
    expect(audioEngine.stopEngine).not.toHaveBeenCalled()
  })

  it('starts engine on WAITING → RUNNING', () => {
    const { rerender } = mount('WAITING')
    rerender({ p: 'RUNNING' })
    expect(audioEngine.startEngine).toHaveBeenCalledTimes(1)
    expect(audioEngine.stopEngine).not.toHaveBeenCalled()
  })

  it('on RUNNING → CRASHED: stops the engine (no crash boom)', () => {
    const { rerender } = mount('WAITING')
    rerender({ p: 'RUNNING' })
    vi.clearAllMocks()

    rerender({ p: 'CRASHED' })
    expect(audioEngine.stopEngine).toHaveBeenCalledTimes(1)

    // Nothing else should fire afterwards — there is no scheduled crash sound.
    vi.advanceTimersByTime(500)
    expect(audioEngine.startEngine).not.toHaveBeenCalled()
  })

  it('CRASHED → WAITING does nothing (next round armed by next RUNNING transition)', () => {
    const { rerender } = mount('WAITING')
    rerender({ p: 'RUNNING' })
    rerender({ p: 'CRASHED' })
    vi.clearAllMocks()

    rerender({ p: 'WAITING' })
    expect(audioEngine.startEngine).not.toHaveBeenCalled()
    expect(audioEngine.stopEngine).not.toHaveBeenCalled()
  })

  it('unmount stops the engine', () => {
    const { rerender, unmount } = mount('WAITING')
    rerender({ p: 'RUNNING' })
    vi.clearAllMocks()

    unmount()
    expect(audioEngine.stopEngine).toHaveBeenCalled()
  })
})
