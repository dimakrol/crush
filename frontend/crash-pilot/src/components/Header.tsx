import { formatCredits } from '../utils/format'

interface HeaderProps {
  authed: boolean
  email: string | null
  balance: number | null
  connected: boolean
  onLogin: () => void
  onLogout: () => void
  onResetBalance: () => void
  onShowHistory: () => void
}

export function Header({
  authed,
  email,
  balance,
  connected,
  onLogin,
  onLogout,
  onResetBalance,
  onShowHistory,
}: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-4 md:px-6 py-4 bg-gray-900 border-b border-gray-700">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold text-white tracking-wide">
          Crash <span className="text-yellow-400">Pilot</span>
        </h1>
        <span
          className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-600'}`}
          title={connected ? 'Connected' : 'Disconnected'}
        />
      </div>

      {authed ? (
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-gray-400 uppercase tracking-wider">Balance</p>
            <p className="text-lg font-semibold text-white">
              {balance === null ? '—' : formatCredits(balance)}
            </p>
          </div>
          <button
            onClick={onShowHistory}
            className="px-3 py-1.5 text-xs text-gray-400 border border-gray-600 rounded-lg hover:border-gray-400 hover:text-white transition-colors"
          >
            My Bets
          </button>
          <button
            onClick={onResetBalance}
            className="px-3 py-1.5 text-xs text-gray-400 border border-gray-600 rounded-lg hover:border-gray-400 hover:text-white transition-colors"
          >
            Reset
          </button>
          <button
            onClick={onLogout}
            className="px-3 py-1.5 text-xs text-gray-400 border border-gray-600 rounded-lg hover:border-gray-400 hover:text-white transition-colors"
            title={email ?? undefined}
          >
            Log out
          </button>
        </div>
      ) : (
        <button
          onClick={onLogin}
          className="px-4 py-2 text-sm font-semibold bg-yellow-400 text-gray-900 rounded-lg hover:bg-yellow-300 transition-colors"
        >
          Log In / Sign Up
        </button>
      )}
    </header>
  )
}
