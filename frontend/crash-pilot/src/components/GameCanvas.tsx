import { useState, type CSSProperties } from 'react'
import type { GamePhase } from '../services/types'
import { formatMultiplier } from '../utils/format'
import { useThrottledValue } from '../hooks/useThrottledValue'

interface GameCanvasProps {
  phase: GamePhase
  countdown: number
  currentMultiplier: number
  crashPoint: number | null
}

interface DebrisParticle {
  vx: number
  vy: number
  color: string
  size: number
  delay: number
}

const DEBRIS_COUNT = 16
const DEBRIS_COLORS = ['#facc15', '#fb923c', '#ef4444', '#fde047']
const DEBRIS_LIFETIME_MS = 800
// Total downward drift over the lifetime, in px. Layered on top of each particle's
// initial vy to give the burst a gravity-like falloff.
const DEBRIS_GRAVITY_PX = 60

function generateDebris(): DebrisParticle[] {
  return Array.from({ length: DEBRIS_COUNT }, () => {
    const angle = Math.random() * Math.PI * 2
    const speed = 40 + Math.random() * 60
    return {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 15, // small upward bias offset by gravity below
      color: DEBRIS_COLORS[Math.floor(Math.random() * DEBRIS_COLORS.length)]!,
      size: 3 + Math.random() * 5,
      delay: Math.random() * 50,
    }
  })
}

export function GameCanvas({ phase, countdown, currentMultiplier, crashPoint }: GameCanvasProps) {
  const isCrashed = phase === 'CRASHED'
  const isRunning = phase === 'RUNNING'

  // The radial glow tracks multiplier but at 10 Hz — re-rendering inline gradient
  // styles 60×/s buys nothing the eye can resolve, and the centerpiece text is the
  // thing that needs to feel smooth (it ticks on the parent's RAF loop).
  const glowMultiplier = useThrottledValue(currentMultiplier, 100)
  const glowIntensity = Math.min(
    Math.max(Math.log(Math.max(glowMultiplier, 1)) / Math.log(20), 0),
    1,
  )

  // Bump a sequence number on each entry into CRASHED so the <CrashOverlay key=...>
  // remounts and re-rolls fresh debris (its useState lazy initializer is the only
  // place we're allowed to call the impure generateDebris). Done via the React
  // docs' "adjust state when props change" pattern — pure functional updater, no
  // useEffect needed.
  const [prevPhase, setPrevPhase] = useState<GamePhase>(phase)
  const [crashSeq, setCrashSeq] = useState(0)
  if (phase !== prevPhase) {
    setPrevPhase(phase)
    if (phase === 'CRASHED') setCrashSeq((s) => s + 1)
  }

  // Plane position: log-scaled progress maps 1x → bottom-left, ~20x → top-right.
  const raw = Math.log(Math.max(currentMultiplier, 1)) / Math.log(20)
  const progress = Math.min(raw, 1)
  const xPct = isRunning || isCrashed ? 10 + progress * 70 : 10
  const yPct = isRunning || isCrashed ? 80 - progress * 70 : 80
  const rotate = isCrashed ? 90 : isRunning ? -20 - progress * 15 : -20

  const trailPath =
    isRunning || isCrashed ? `M 10 80 Q 15 ${80 - progress * 35} ${xPct} ${yPct}` : null

  return (
    <div
      className={[
        'relative h-64 md:h-80 rounded-2xl overflow-hidden select-none',
        isCrashed ? 'bg-red-950' : 'bg-gray-800',
      ].join(' ')}
    >
      {/* Scrolling grid backdrop. Visible during RUNNING and CRASHED; the animation
          class is only applied while RUNNING so CRASHED freezes the last frame. */}
      {(isRunning || isCrashed) && (
        <div
          aria-hidden="true"
          className={[
            'absolute inset-y-0 pointer-events-none',
            isRunning ? 'animate-grid-scroll' : '',
          ].join(' ')}
          style={{
            // Extends 40px past the right edge so one scroll loop (transform -40px)
            // returns to a visually-identical position.
            left: '-40px',
            right: '-40px',
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), ' +
              'linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
      )}

      {/* Radial multiplier glow. Size + opacity scale with the throttled multiplier,
          color shifts by phase. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none flex items-center justify-center"
      >
        <div
          className="rounded-full blur-3xl"
          style={{
            width: `${30 + glowIntensity * 60}%`,
            height: `${30 + glowIntensity * 60}%`,
            opacity: 0.25 + glowIntensity * 0.45,
            background: isCrashed
              ? 'radial-gradient(closest-side, rgba(239,68,68,0.9), rgba(239,68,68,0) 70%)'
              : isRunning
                ? 'radial-gradient(closest-side, rgba(250,204,21,0.9), rgba(251,146,60,0.5) 50%, rgba(251,146,60,0) 80%)'
                : 'radial-gradient(closest-side, rgba(156,163,175,0.35), rgba(156,163,175,0) 70%)',
          }}
        />
      </div>

      {/* Flight trail — gradient stroke with drop-shadow glow filter */}
      {trailPath && (
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient
              id="trail-grad"
              x1="10"
              y1="80"
              x2={xPct}
              y2={yPct}
              gradientUnits="userSpaceOnUse"
            >
              {isCrashed ? (
                <>
                  <stop offset="0%" stopColor="#7f1d1d" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#ef4444" />
                </>
              ) : (
                <>
                  <stop offset="0%" stopColor="#facc15" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#fb923c" />
                </>
              )}
            </linearGradient>
            <filter id="trail-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="0.7" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <path
            d={trailPath}
            stroke="url(#trail-grad)"
            strokeWidth="1.2"
            fill="none"
            strokeLinecap="round"
            filter="url(#trail-glow)"
            opacity="0.95"
          />
        </svg>
      )}

      {/* Plane — hidden on CRASHED (the fireball + debris replace it) */}
      {!isCrashed && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${xPct}%`,
            top: `${yPct}%`,
            transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
          }}
          aria-hidden="true"
        >
          <PlaneSvg />
        </div>
      )}

      {/* Crash sequence: flash + fireball + debris. Keyed on crashSeq so each
          new crash remounts the overlay and replays the CSS keyframes. The
          impure debris generation lives inside CrashOverlay's useState lazy
          initializer — the one place during a component lifecycle where
          Math.random() is allowed by react-hooks/purity. */}
      {isCrashed && <CrashOverlay key={crashSeq} xPct={xPct} yPct={yPct} />}

      {/* Central multiplier */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div
          className={[
            'text-6xl md:text-8xl font-black tabular-nums',
            isCrashed
              ? 'text-red-400 animate-crash-shake'
              : isRunning
                ? 'text-green-400'
                : 'text-gray-400',
          ].join(' ')}
          aria-live="polite"
          aria-label={`Current multiplier: ${formatMultiplier(currentMultiplier)}`}
        >
          {formatMultiplier(currentMultiplier)}
        </div>

        <div className="mt-3 text-lg text-gray-300 font-medium">
          {phase === 'WAITING' && (
            <span>
              Next round in <span className="text-yellow-400 font-bold">{countdown}s</span>
            </span>
          )}
          {isCrashed && crashPoint !== null && (
            <span className="text-red-400 font-bold animate-crash-shake">
              CRASHED @ {formatMultiplier(crashPoint)}
            </span>
          )}
        </div>
      </div>

      {/* Existing red bg flash overlay (kept) */}
      {isCrashed && (
        <div
          className="absolute inset-0 rounded-2xl animate-crash-flash pointer-events-none"
          aria-hidden="true"
        />
      )}
    </div>
  )
}

/**
 * Crash visuals — white-hot flash + yellow→orange→red fireball + 16 debris
 * particles. Generates the randomized particle vectors exactly once per mount
 * (inside the useState lazy initializer, the one place where impure calls are
 * permitted). The parent forces a fresh instance on each crash via the `key`
 * prop, which is what makes the CSS keyframes replay.
 */
function CrashOverlay({ xPct, yPct }: { xPct: number; yPct: number }) {
  const [particles] = useState<DebrisParticle[]>(generateDebris)

  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: `${xPct}%`, top: `${yPct}%` }}
      aria-hidden="true"
    >
      {/* White-hot flash (~150ms) */}
      <span
        className="absolute block rounded-full animate-flash-burst"
        style={{
          width: '60px',
          height: '60px',
          left: 0,
          top: 0,
          background: 'radial-gradient(closest-side, #fff, rgba(255,255,255,0) 70%)',
        }}
      />
      {/* Fireball (~500ms, grows to ~80px) */}
      <span
        className="absolute block rounded-full animate-fireball"
        style={{
          width: '80px',
          height: '80px',
          left: 0,
          top: 0,
          background:
            'radial-gradient(closest-side, #fde047 0%, #fb923c 40%, #b91c1c 75%, rgba(127,29,29,0) 100%)',
        }}
      />
      {/* Debris — each particle's translate target is set per-element as CSS
          variables that the debris-fly keyframe consumes. */}
      {particles.map((p, i) => (
        <span
          key={i}
          className="absolute block rounded-full"
          // CSS custom properties (`--end-x`, `--end-y`) aren't in React's
          // CSSProperties type; cast through unknown so the keyframe can read them.
          style={
            {
              width: `${p.size}px`,
              height: `${p.size}px`,
              background: p.color,
              left: 0,
              top: 0,
              '--end-x': `${p.vx}px`,
              '--end-y': `${p.vy + DEBRIS_GRAVITY_PX}px`,
              animation: `debris-fly ${DEBRIS_LIFETIME_MS}ms ease-out ${p.delay}ms forwards`,
              opacity: 0,
            } as unknown as CSSProperties
          }
        />
      ))}
    </div>
  )
}

/**
 * Top-down monoplane in classic Aviator-game styling. Nose points right; the
 * geometric center of the artwork sits at viewBox (100, 100), which matches the
 * wrapper's `translate(-50%, -50%)` so the rotation pivot stays on the plane.
 *
 * The "spinning propeller" effect is baked in as two vertical motion-blur
 * ellipses at the nose — no separate spinning/static states are needed.
 */
function PlaneSvg() {
  return (
    <svg
      width="96"
      height="96"
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <filter id="plane-drop-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="2" dy="5" stdDeviation="4" floodColor="#000000" floodOpacity="0.5" />
        </filter>
      </defs>

      <g transform="translate(100, 100)" filter="url(#plane-drop-shadow)">
        {/* Propeller motion-blur ellipses */}
        <ellipse cx="65" cy="0" rx="4" ry="28" fill="#ffffff" opacity="0.25" />
        <ellipse cx="65" cy="0" rx="2" ry="35" fill="#ffffff" opacity="0.15" />

        {/* Fuselage */}
        <path
          d="M -50 -9 L 35 -9 C 50 -9 60 -3 60 0 C 60 3 50 9 35 9 L -50 9 C -56 9 -62 5 -62 0 C -62 -5 -56 -9 -50 -9 Z"
          fill="#e01838"
        />

        {/* Cockpit canopy */}
        <path
          d="M 5 -9 C 15 -20 28 -20 32 -9 Z"
          fill="#1f1f2e"
          stroke="#c0152f"
          strokeWidth="1"
        />

        {/* Lower wing (right half) */}
        <path d="M -15 9 L 20 9 L 10 30 L -10 30 Z" fill="#a31026" />

        {/* Lower-rear tail stabilizer */}
        <path d="M -45 0 L -30 0 L -40 18 L -50 18 Z" fill="#a31026" />

        {/* Upper-rear tail fin */}
        <path d="M -45 -9 L -25 -9 L -40 -32 L -52 -32 Z" fill="#e01838" />

        {/* Upper wing (left/front half) */}
        <path d="M -15 -9 L 25 -9 L 5 -45 L -20 -45 Z" fill="#ff2a50" />

        {/* Upper-rear tail stabilizer */}
        <path d="M -45 0 L -30 0 L -40 -18 L -50 -18 Z" fill="#ff2a50" />

        {/* Nose tip / propeller hub */}
        <path d="M 60 -4 L 66 -2 L 66 2 L 60 4 Z" fill="#2a2a35" />
      </g>
    </svg>
  )
}
