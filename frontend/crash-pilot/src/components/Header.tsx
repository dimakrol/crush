import { formatCredits } from '../utils/format'

interface HeaderProps {
  authed: boolean
  email: string | null
  balance: number | null
  connected: boolean
  muted: boolean
  onLogin: () => void
  onLogout: () => void
  onResetBalance: () => void
  onShowHistory: () => void
  onToggleMute: () => void
}

export function Header({
  authed,
  email,
  balance,
  connected,
  muted,
  onLogin,
  onLogout,
  onResetBalance,
  onShowHistory,
  onToggleMute,
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

      <div className="flex items-center gap-3">
        {/* Mute toggle — global preference, visible for guests + authed alike.
            First unmute click is also the gesture that creates the AudioContext
            (handled inside audioEngine.setMuted). */}
        <MuteButton muted={muted} onToggle={onToggleMute} />

        {authed ? (
          <>
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
          </>
        ) : (
          <button
            onClick={onLogin}
            className="px-4 py-2 text-sm font-semibold bg-yellow-400 text-gray-900 rounded-lg hover:bg-yellow-300 transition-colors"
          >
            Log In / Sign Up
          </button>
        )}
      </div>
    </header>
  )
}

function MuteButton({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-label={muted ? 'Unmute' : 'Mute'}
      title={muted ? 'Unmute' : 'Mute'}
      className="flex items-center justify-center w-9 h-9 text-gray-400 border border-gray-600 rounded-lg hover:border-gray-400 hover:text-white transition-colors"
    >
      {muted ? (
        // Speaker with X — sound off
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      ) : (
        // Speaker with sound waves — sound on
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      )}
    </button>
  )
}
