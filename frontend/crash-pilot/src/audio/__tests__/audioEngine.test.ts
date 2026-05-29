import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as audioEngine from '../audioEngine'

// JSDOM has no AudioContext, so these tests intentionally only exercise the
// mute-state / persistence / subscription paths. The actual audio synthesis is
// guarded by ensureContext(), which short-circuits to null in JSDOM and makes
// startEngine/playCrash safe no-ops here.

describe('audioEngine — mute state', () => {
  beforeEach(() => {
    localStorage.clear()
    audioEngine.__test.reset()
  })

  it('defaults to muted when no value is persisted', () => {
    expect(audioEngine.getMuted()).toBe(true)
  })

  it('honors a persisted false value on (re-)init', () => {
    localStorage.setItem('crashpilot.muted', 'false')
    audioEngine.__test.reset()
    expect(audioEngine.getMuted()).toBe(false)
  })

  it('honors a persisted true value on (re-)init', () => {
    localStorage.setItem('crashpilot.muted', 'true')
    audioEngine.__test.reset()
    expect(audioEngine.getMuted()).toBe(true)
  })

  it('persists setMuted to localStorage', () => {
    audioEngine.setMuted(false)
    expect(localStorage.getItem('crashpilot.muted')).toBe('false')
    audioEngine.setMuted(true)
    expect(localStorage.getItem('crashpilot.muted')).toBe('true')
  })

  it('notifies subscribers on actual changes', () => {
    const listener = vi.fn()
    audioEngine.subscribeMuted(listener)
    audioEngine.setMuted(false)
    audioEngine.setMuted(true)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenNthCalledWith(1, false)
    expect(listener).toHaveBeenNthCalledWith(2, true)
  })

  it('does not notify subscribers when the value would not change', () => {
    // default is muted=true; calling setMuted(true) again must be a no-op
    const listener = vi.fn()
    audioEngine.subscribeMuted(listener)
    audioEngine.setMuted(true)
    expect(listener).not.toHaveBeenCalled()
  })

  it('subscribeMuted returns an unsubscribe function', () => {
    const listener = vi.fn()
    const off = audioEngine.subscribeMuted(listener)
    off()
    audioEngine.setMuted(false)
    expect(listener).not.toHaveBeenCalled()
    expect(audioEngine.__test.hasListeners()).toBe(0)
  })

  it('__test.reset() clears all listeners', () => {
    audioEngine.subscribeMuted(() => {})
    audioEngine.subscribeMuted(() => {})
    expect(audioEngine.__test.hasListeners()).toBe(2)
    audioEngine.__test.reset()
    expect(audioEngine.__test.hasListeners()).toBe(0)
  })
})
