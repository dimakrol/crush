import { useEffect, useRef, useState } from 'react'
import { useCrashGame, SLOT_IDS } from './hooks/useCrashGame'
import { useThrottledValue } from './hooks/useThrottledValue'
import { useAuth } from './auth/useAuth'
import { useGameSounds } from './audio/useGameSounds'
import { useMuteToggle } from './audio/useMuteToggle'
import { Header } from './components/Header'
import { GameCanvas } from './components/GameCanvas'
import { BettingPanel } from './components/BettingPanel'
import { RoundHistory } from './components/RoundHistory'
import { MyBetsModal } from './components/MyBetsModal'
import { notifyReady, notifyBalanceChanged, notifySessionEnded } from './services/lobbyBridge'

export default function App() {
  const { player, status, currency } = useAuth()
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
    clearError,
  } = useCrashGame()

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

  // ── Lobby postMessage bridge (game → parent casino lobby) ─────────────────
  // Announce we're embedded and ready once on mount.
  useEffect(() => {
    notifyReady()
  }, [])

  // Mirror every confirmed balance change up to the lobby header.
  useEffect(() => {
    if (authed && balance !== null && currency) {
      notifyBalanceChanged(balance, currency)
    }
  }, [authed, balance, currency])

  // Tell the lobby when the session ends (token expired / superseded → guest).
  const wasAuthed = useRef(false)
  useEffect(() => {
    if (status === 'authenticated') {
      wasAuthed.current = true
    } else if (status === 'guest' && wasAuthed.current) {
      wasAuthed.current = false
      notifySessionEnded()
    }
  }, [status])

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Header
        authed={authed}
        displayName={player?.displayName ?? null}
        currency={currency}
        balance={balance}
        connected={connected}
        muted={muted}
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
              currency={currency}
              onPlaceBet={placeBet}
              onCashOut={cashOut}
              onQueueNext={queueNext}
              onCancelNext={cancelNext}
            />
          ))}
        </div>
      </main>

      {showHistory && <MyBetsModal onClose={() => setShowHistory(false)} />}
    </div>
  )
}
