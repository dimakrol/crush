import { useState } from 'react'
import { useCrashGame, SLOT_IDS } from './hooks/useCrashGame'
import { useThrottledValue } from './hooks/useThrottledValue'
import { useAuth } from './auth/useAuth'
import { useGameSounds } from './audio/useGameSounds'
import { useMuteToggle } from './audio/useMuteToggle'
import { Header } from './components/Header'
import { GameCanvas } from './components/GameCanvas'
import { BettingPanel } from './components/BettingPanel'
import { RoundHistory } from './components/RoundHistory'
import { AuthModal } from './components/AuthModal'
import { MyBetsModal } from './components/MyBetsModal'

export default function App() {
  const { user, status, logout } = useAuth()
  const authed = status === 'authenticated'
  const {
    connected,
    phase,
    countdown,
    currentMultiplier,
    crashPoint,
    roundHistory,
    balance,
    slots,
    actionError,
    placeBet,
    cashOut,
    queueNext,
    cancelNext,
    resetBalance,
    clearError,
  } = useCrashGame()

  const [showAuth, setShowAuth] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  // The canvas's centerpiece needs 60 Hz to feel smooth; the betting panels
  // display a derived credit amount in small text, which flickers at 60 Hz.
  // Tick that at 10 Hz instead (matching the server's own multiplier cadence).
  const panelMultiplier = useThrottledValue(currentMultiplier, 100)

  // Engine sound + crash boom, driven off phase transitions. The getter closes
  // over the latest currentMultiplier on each render — the hook re-syncs it via
  // a ref so the audio engine always polls the live value.
  useGameSounds(phase, () => currentMultiplier)
  const { muted, toggle: toggleMute } = useMuteToggle()

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Header
        authed={authed}
        email={user?.email ?? null}
        balance={balance}
        connected={connected}
        muted={muted}
        onLogin={() => setShowAuth(true)}
        onLogout={logout}
        onResetBalance={resetBalance}
        onShowHistory={() => setShowHistory(true)}
        onToggleMute={toggleMute}
      />

      <main className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-4 py-6 gap-4">
        <GameCanvas
          phase={phase}
          countdown={countdown}
          currentMultiplier={currentMultiplier}
          crashPoint={crashPoint}
        />

        <RoundHistory history={roundHistory} />

        {actionError && (
          <div
            className="flex items-center justify-between rounded-xl border border-red-700 bg-red-950 px-4 py-2 text-sm text-red-300"
            role="alert"
          >
            <span>{actionError}</span>
            <button onClick={clearError} className="text-red-400 hover:text-red-200" aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SLOT_IDS.map((slotId) => (
            <BettingPanel
              key={slotId}
              slotId={slotId}
              phase={phase}
              currentMultiplier={panelMultiplier}
              slot={slots[slotId]}
              authed={authed}
              onPlaceBet={placeBet}
              onCashOut={cashOut}
              onQueueNext={queueNext}
              onCancelNext={cancelNext}
              onRequireLogin={() => setShowAuth(true)}
            />
          ))}
        </div>
      </main>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      {showHistory && <MyBetsModal onClose={() => setShowHistory(false)} />}
    </div>
  )
}
