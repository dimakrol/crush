import type { GamePhase } from '../services/types'
import { formatMultiplier } from '../utils/format'

interface GameCanvasProps {
  phase: GamePhase
  countdown: number
  currentMultiplier: number
  crashPoint: number | null
}

export function GameCanvas({ phase, countdown, currentMultiplier, crashPoint }: GameCanvasProps) {
  const isCrashed = phase === 'CRASHED'
  const isRunning = phase === 'RUNNING'

  // progress: 0 at 1x, approaches 1 asymptotically (log scale feels natural)
  const raw = Math.log(Math.max(currentMultiplier, 1)) / Math.log(20) // reaches 1 at 20x
  const progress = Math.min(raw, 1)

  // Plane travels from bottom-left to top-right across the container
  // Using percentage-based positioning so it works at any container size
  const xPct = isRunning || isCrashed ? 10 + progress * 70 : 10   // 10% → 80%
  const yPct = isRunning || isCrashed ? 80 - progress * 70 : 80   // 80% → 10% (top)
  const rotate = isCrashed ? 90 : isRunning ? -20 - progress * 15 : -20

  // Build SVG trail path points (quadratic curve from origin to plane)
  const trailPoints = isRunning || isCrashed
    ? `M 10 80 Q 15 ${80 - progress * 35} ${xPct} ${yPct}`
    : null

  return (
    <div
      className={[
        'relative h-64 md:h-80 rounded-2xl overflow-hidden select-none',
        isCrashed ? 'bg-red-950' : 'bg-gray-800',
      ].join(' ')}
    >
      {/* SVG layer: trail line */}
      {trailPoints && (
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d={trailPoints}
            stroke={isCrashed ? '#ef4444' : '#facc15'}
            strokeWidth="0.8"
            fill="none"
            strokeLinecap="round"
            opacity="0.5"
          />
        </svg>
      )}

      {/* Plane SVG — positioned absolutely as % of container */}
      {!isCrashed && (
        <div
          className="absolute transition-none pointer-events-none"
          style={{
            left: `${xPct}%`,
            top: `${yPct}%`,
            transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
          }}
          aria-hidden="true"
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 56 56"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={isRunning ? 'text-yellow-400' : 'text-gray-500'}
          >
            <path d="M8 28L44 18L48 28L44 32L8 28Z" fill="currentColor" />
            <path d="M20 28L32 14L38 20L28 28Z" fill="currentColor" opacity="0.85" />
            <path d="M8 28L14 22L18 26L12 30Z" fill="currentColor" opacity="0.7" />
            <circle cx="42" cy="25" r="3" fill="currentColor" opacity="0.6" />
          </svg>
        </div>
      )}

      {/* Crash explosion */}
      {isCrashed && (
        <div
          className="absolute pointer-events-none"
          style={{ left: `${xPct}%`, top: `${yPct}%`, transform: 'translate(-50%,-50%)' }}
          aria-hidden="true"
        >
          <span className="text-5xl animate-ping-once">💥</span>
        </div>
      )}

      {/* Central multiplier display */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
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
              Next round in{' '}
              <span className="text-yellow-400 font-bold">{countdown}s</span>
            </span>
          )}
          {isCrashed && crashPoint !== null && (
            <span className="text-red-400 font-bold animate-crash-shake">
              CRASHED @ {formatMultiplier(crashPoint)}
            </span>
          )}
        </div>
      </div>

      {/* Red flash overlay on crash */}
      {isCrashed && (
        <div
          className="absolute inset-0 rounded-2xl animate-crash-flash pointer-events-none"
          aria-hidden="true"
        />
      )}
    </div>
  )
}
