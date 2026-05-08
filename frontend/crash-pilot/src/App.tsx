import { useCrashGame } from './hooks/useCrashGame'
import { Header } from './components/Header'
import { GameCanvas } from './components/GameCanvas'
import { BettingPanel } from './components/BettingPanel'
import { RoundHistory } from './components/RoundHistory'
import { PlayerStatus } from './components/PlayerStatus'

export default function App() {
  const {
    balance,
    phase,
    countdown,
    currentMultiplier,
    currentRound,
    playerBet,
    nextRoundBet,
    roundHistory,
    betError,
    placeBet,
    queueNextRoundBet,
    cancelNextRoundBet,
    cashOut,
    resetBalance,
  } = useCrashGame()

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <Header balance={balance} onResetBalance={resetBalance} />

      {/* Main content — padded bottom on mobile for fixed panel */}
      <main className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-4 py-6 gap-4 pb-64 md:pb-6">
        <GameCanvas
          phase={phase}
          countdown={countdown}
          currentMultiplier={currentMultiplier}
          currentRound={currentRound}
        />

        <PlayerStatus phase={phase} playerBet={playerBet} />

        <RoundHistory history={roundHistory} />

        {/* Desktop betting panel */}
        <div className="hidden md:block">
          <BettingPanel
            phase={phase}
            currentMultiplier={currentMultiplier}
            playerBet={playerBet}
            nextRoundBet={nextRoundBet}
            betError={betError}
            onPlaceBet={placeBet}
            onQueueNextRoundBet={queueNextRoundBet}
            onCancelNextRoundBet={cancelNextRoundBet}
            onCashOut={cashOut}
          />
        </div>
      </main>

      {/* Mobile fixed bottom panel */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-700 p-4">
        <BettingPanel
          phase={phase}
          currentMultiplier={currentMultiplier}
          playerBet={playerBet}
          nextRoundBet={nextRoundBet}
          betError={betError}
          onPlaceBet={placeBet}
          onQueueNextRoundBet={queueNextRoundBet}
          onCancelNextRoundBet={cancelNextRoundBet}
          onCashOut={cashOut}
        />
      </div>
    </div>
  )
}
