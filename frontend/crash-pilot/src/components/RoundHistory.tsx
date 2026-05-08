import type { Round } from '../types/game'
import { formatMultiplier } from '../utils/format'

interface RoundHistoryProps {
  history: Round[]
}

function pillClass(crashPoint: number): string {
  if (crashPoint < 2) return 'bg-red-900 text-red-300 border border-red-700'
  if (crashPoint <= 5) return 'bg-yellow-900 text-yellow-300 border border-yellow-700'
  return 'bg-green-900 text-green-300 border border-green-700'
}

function pillLabel(crashPoint: number): string {
  if (crashPoint < 2) return 'Low'
  if (crashPoint <= 5) return 'Mid'
  return 'High'
}

export function RoundHistory({ history }: RoundHistoryProps) {
  const visible = history.slice(0, 10)

  if (visible.length === 0) return null

  return (
    <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-hide" aria-label="Recent round results">
      {visible.map(round => (
        <span
          key={round.id}
          className={`shrink-0 inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${pillClass(round.crashPoint)}`}
          title={`${pillLabel(round.crashPoint)} crash`}
        >
          {formatMultiplier(round.crashPoint)}
        </span>
      ))}
    </div>
  )
}
