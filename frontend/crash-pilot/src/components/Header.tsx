import { formatCredits } from '../utils/format'

interface HeaderProps {
  balance: number
  onResetBalance: () => void
}

export function Header({ balance, onResetBalance }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-6 py-4 bg-gray-900 border-b border-gray-700">
      <h1 className="text-2xl font-bold text-white tracking-wide">
        Crash <span className="text-yellow-400">Pilot</span>
      </h1>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Balance</p>
          <p className="text-lg font-semibold text-white">{formatCredits(balance)}</p>
        </div>
        <button
          onClick={onResetBalance}
          className="px-3 py-1.5 text-xs text-gray-400 border border-gray-600 rounded-lg hover:border-gray-400 hover:text-white transition-colors"
        >
          Reset Demo
        </button>
      </div>
    </header>
  )
}
