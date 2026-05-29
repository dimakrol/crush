import { useEffect, useState } from 'react'
import * as audioEngine from './audioEngine'

/**
 * Subscribes the calling component to the audio engine's mute state.
 *
 * Returns `{ muted, toggle }` — toggle flips the state via `audioEngine.setMuted`,
 * which also persists to localStorage and (on the unmute path) creates/resumes
 * the AudioContext under the click's user-gesture token.
 */
export function useMuteToggle(): { muted: boolean; toggle: () => void } {
  const [muted, setMuted] = useState(() => audioEngine.getMuted())

  useEffect(() => audioEngine.subscribeMuted(setMuted), [])

  return {
    muted,
    toggle: () => audioEngine.setMuted(!audioEngine.getMuted()),
  }
}
