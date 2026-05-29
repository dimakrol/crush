/**
 * Self-contained Web-Audio synthesis module for the crash game.
 *
 * Mirrors the singleton + subscription pattern used by `services/socket.ts` and
 * `services/token.ts`: module-level state, no React imports, a small public API.
 *
 * - Mute state is persisted to localStorage (`crashpilot.muted`) and **defaults to
 *   muted** so a user landing on the page never gets unexpected noise.
 * - The AudioContext is created lazily on the first unmute (the click that flips
 *   `setMuted(false)` is the user gesture browsers require for autoplay).
 * - When muted, every play API is a no-op — no AudioContext is touched.
 *
 * Tests do not exercise real Web Audio (JSDOM has no AudioContext); they mock this
 * module via `vi.mock` and assert on call signatures, OR they exercise the mute /
 * persistence / subscription paths only.
 */

const STORAGE_KEY = 'crashpilot.muted'

const ENGINE_BASE_FREQ = 100
// Soft cap on the engine pitch: at log-scaled "max" multiplier (~20x), the
// frequency lands at BASE * CAP. Past that, the synth doesn't keep climbing.
const ENGINE_PITCH_CAP = 2.5
// Steady-state engine volume. The crash boom internally peaks around 0.55–0.7
// on its own gains; keep this well below that so the engine sits as a background
// hum rather than the dominant sound.
const ENGINE_GAIN = 0.02
const FADE_IN_MS = 50
const FADE_OUT_MS = 100
const ENGINE_POLL_MS = 100

type MuteListener = (muted: boolean) => void

interface EngineState {
  osc1: OscillatorNode
  osc2: OscillatorNode
  filter: BiquadFilterNode
  engineGain: GainNode
  pollId: ReturnType<typeof setInterval>
  getMultiplier: () => number
}

function readPersistedMuted(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return true // default muted
    return raw === 'true'
  } catch {
    return true
  }
}

function writePersistedMuted(muted: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(muted))
  } catch {
    // localStorage unavailable (e.g. privacy mode); degrade silently
  }
}

let muted = readPersistedMuted()
const listeners = new Set<MuteListener>()

let ctx: AudioContext | null = null
let masterGain: GainNode | null = null
let engine: EngineState | null = null

function ensureContext(): AudioContext | null {
  if (ctx) return ctx
  if (typeof window === 'undefined') return null
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()
  masterGain = ctx.createGain()
  masterGain.gain.value = 1
  masterGain.connect(ctx.destination)
  return ctx
}

function pitchForMultiplier(m: number): number {
  // Log-scaled climb (matches the visual progress curve in GameCanvas).
  const ratio = Math.min(Math.log(Math.max(m, 1)) / Math.log(20), 1)
  return ENGINE_BASE_FREQ * (1 + ratio * (ENGINE_PITCH_CAP - 1))
}

export function getMuted(): boolean {
  return muted
}

export function subscribeMuted(listener: MuteListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setMuted(next: boolean): void {
  if (muted === next) return
  muted = next
  writePersistedMuted(next)

  if (!next) {
    // First unmute creates/resumes the AudioContext under the click handler
    // — the only place the browser's autoplay policy will let us do this.
    const c = ensureContext()
    if (c && c.state === 'suspended') void c.resume()
  } else if (engine) {
    // Muting mid-flight: stop the engine cleanly so we don't leak nodes.
    stopEngine()
  }

  listeners.forEach((l) => l(next))
}

/**
 * Start the engine loop. Reads the live multiplier via `getMultiplier` on a
 * 100ms poll and ramps oscillator frequencies via `setTargetAtTime` so the
 * climb is audibly smooth without zipper noise.
 *
 * No-op when muted or when Web Audio is unavailable (e.g. JSDOM in tests).
 * Safe to call repeatedly — a running engine is stopped first.
 */
export function startEngine(getMultiplier: () => number): void {
  if (muted) return
  const c = ensureContext()
  if (!c || !masterGain) return
  if (engine) stopEngine()

  const osc1 = c.createOscillator()
  const osc2 = c.createOscillator()
  const filter = c.createBiquadFilter()
  const engineGain = c.createGain()

  osc1.type = 'sawtooth'
  osc2.type = 'sawtooth'
  filter.type = 'lowpass'
  filter.frequency.value = 900
  filter.Q.value = 1.2

  const initial = pitchForMultiplier(getMultiplier())
  osc1.frequency.value = initial
  // Slight detune between the two saws gives a chorused "engine" character
  // rather than a clean pitch.
  osc2.frequency.value = initial * 1.012

  // Fade in over FADE_IN_MS — startEngine called inside a click handler must
  // not click audibly.
  const now = c.currentTime
  engineGain.gain.setValueAtTime(0, now)
  engineGain.gain.linearRampToValueAtTime(ENGINE_GAIN, now + FADE_IN_MS / 1000)

  osc1.connect(filter)
  osc2.connect(filter)
  filter.connect(engineGain)
  engineGain.connect(masterGain)

  osc1.start()
  osc2.start()

  const pollId = setInterval(() => {
    if (!engine || !ctx) return
    const target = pitchForMultiplier(engine.getMultiplier())
    engine.osc1.frequency.setTargetAtTime(target, ctx.currentTime, 0.05)
    engine.osc2.frequency.setTargetAtTime(target * 1.012, ctx.currentTime, 0.05)
  }, ENGINE_POLL_MS)

  engine = { osc1, osc2, filter, engineGain, pollId, getMultiplier }
}

/**
 * Fade the engine out over FADE_OUT_MS, then stop the oscillators. Safe to
 * call when nothing is playing.
 */
export function stopEngine(): void {
  if (!engine || !ctx) {
    engine = null
    return
  }
  const e = engine
  engine = null
  clearInterval(e.pollId)
  const now = ctx.currentTime
  e.engineGain.gain.cancelScheduledValues(now)
  e.engineGain.gain.setValueAtTime(e.engineGain.gain.value, now)
  e.engineGain.gain.linearRampToValueAtTime(0, now + FADE_OUT_MS / 1000)
  const stopAt = now + FADE_OUT_MS / 1000 + 0.02
  e.osc1.stop(stopAt)
  e.osc2.stop(stopAt)
}

/**
 * Test-only escape hatch: re-reads localStorage and clears subscribers. The
 * tests for this module avoid touching Web Audio at all; they only need to
 * reset the JS-level state between cases.
 */
export const __test = {
  reset(): void {
    muted = readPersistedMuted()
    listeners.clear()
  },
  hasListeners(): number {
    return listeners.size
  },
}
