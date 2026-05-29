import { useEffect, useRef } from 'react'
import type { GamePhase } from '../services/types'
import * as audioEngine from './audioEngine'

/**
 * Drives phase-triggered audio. Mount once in App.tsx with the live phase and a
 * stable getter that returns the latest multiplier (we deliberately don't pass
 * the multiplier itself — the engine polls internally at 10 Hz, so a getter
 * avoids re-binding on every RAF tick).
 *
 * Phase transitions and their effects:
 *   WAITING|CRASHED → RUNNING : startEngine
 *   RUNNING        → CRASHED : stopEngine (no crash boom — sound design choice)
 *   anything else            : no-op
 *
 * Also: if the user unmutes mid-RUNNING, the engine is kicked in immediately
 * (otherwise sound wouldn't start until the next round).
 */
export function useGameSounds(phase: GamePhase, getMultiplier: () => number): void {
  // Mirrors of the live values for use inside subscription callbacks where we
  // can't depend on `phase` / `getMultiplier` without re-binding.
  const phaseRef = useRef(phase)
  const getMultiplierRef = useRef(getMultiplier)

  // Tracks the prior phase across renders so we can detect transitions. Initialized
  // to the current phase so the very first render is a no-op (no synthetic
  // transition from undefined → phase).
  const prevPhaseRef = useRef(phase)

  // Keep refs fresh without invalidating the audio bindings.
  useEffect(() => {
    phaseRef.current = phase
    getMultiplierRef.current = getMultiplier
  })

  useEffect(() => {
    const prev = prevPhaseRef.current
    prevPhaseRef.current = phase

    // RUNNING entry from any non-RUNNING phase
    if (prev !== 'RUNNING' && phase === 'RUNNING') {
      audioEngine.startEngine(() => getMultiplierRef.current())
      return
    }

    // CRASHED entry from RUNNING (the only legal source on the happy path)
    if (prev === 'RUNNING' && phase === 'CRASHED') {
      audioEngine.stopEngine()
    }
  }, [phase])

  // Mute mid-round: when the user unmutes while RUNNING, start the engine now
  // (otherwise they'd hear nothing until the next round started).
  useEffect(() => {
    const off = audioEngine.subscribeMuted((nowMuted) => {
      if (!nowMuted && phaseRef.current === 'RUNNING') {
        audioEngine.startEngine(() => getMultiplierRef.current())
      }
    })
    return off
  }, [])

  // Unmount: silence the engine.
  useEffect(() => {
    return () => {
      audioEngine.stopEngine()
    }
  }, [])
}
