import { Injectable, OnModuleInit, Inject } from '@nestjs/common'
import { env } from '@/config/env'
import { getRedis } from '@/config/redis'
import { generateCrashPoint } from '@/shared/utils/crash'
import { logger } from '@/shared/utils/logger'
import { ROUND_REPOSITORY, IRoundRepository } from '@/modules/rounds/round.repository.interface'
import { Round } from '@/modules/rounds/round.types'
import { BetService } from '@/modules/bets/bet.service'
import { Bet } from '@/modules/bets/bet.types'
import { GameGateway } from '@/socket/game.gateway'

// Operator pause. Kept in Redis rather than in memory so it survives a restart:
// a deploy in the middle of a paused night must not quietly resume the game.
const PAUSED_KEY = 'game:enginePaused'

// How often a paused loop re-reads the flag. Coarse on purpose — resuming half a
// second late costs nothing, and this poll runs forever while paused.
const PAUSE_POLL_MS = 1000

@Injectable()
export class RoundEngine implements OnModuleInit {
  private loopActive = false

  // Raised by the admin controller, consumed by the running tick. A plain field,
  // not Redis: unlike the pause, a force-crash only makes sense for the round
  // this very process is running, and must not survive a restart.
  private forceCrashRequested = false

  constructor(
    @Inject(ROUND_REPOSITORY) private readonly roundRepo: IRoundRepository,
    private readonly betService: BetService,
    private readonly gateway: GameGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    // Roll back any debits left open by an interrupted round before starting a
    // fresh loop, so the operator ledger never carries orphaned stakes.
    const recovered = await this.betService.recoverOpenBets()
    if (recovered > 0) logger.warn('Rolled back open bets from a previous run', { count: recovered })
    this.startLoop()
  }

  private startLoop(): void {
    if (this.loopActive) return
    this.loopActive = true
    void this.runCycle()
  }

  private async runCycle(): Promise<void> {
    while (this.loopActive) {
      // Before the round is created, never inside one: the pause is graceful by
      // definition — whatever is in flight plays out and settles, only the next
      // round is withheld.
      await this.awaitResumeIfPaused()
      const round = await this.runWaiting()
      await this.runRunning(round)
      await this.runCrashed(round)
    }
  }

  // Blocks the cycle while the flag is set. The loop stays alive and `loopActive`
  // untouched, so resuming is a Redis key away and never needs a restart.
  private async awaitResumeIfPaused(): Promise<void> {
    const redis = getRedis()
    if ((await redis.get(PAUSED_KEY)) !== '1') return

    logger.warn('Engine paused — no new rounds will start')
    // Announced once, on entering the pause. Clients that connect later are told
    // by GameGateway.handleConnection instead: without that, a page opened
    // during a pause would sit through silence with no idea why.
    this.gateway.emitToAll('round:paused', { paused: true })

    while (this.loopActive && (await redis.get(PAUSED_KEY)) === '1') {
      await sleep(PAUSE_POLL_MS)
    }

    logger.info('Engine resumed')
    this.gateway.emitToAll('round:resumed', { paused: false })
  }

  // Set/clear the pause. Idempotent: the value carries the intent, so a repeated
  // call from a nervous operator changes nothing.
  async setPaused(paused: boolean): Promise<void> {
    const redis = getRedis()
    if (paused) await redis.set(PAUSED_KEY, '1')
    else await redis.del(PAUSED_KEY)
  }

  async isPaused(): Promise<boolean> {
    return (await getRedis().get(PAUSED_KEY)) === '1'
  }

  // Ends the current round at whatever multiplier the next tick observes. The
  // request is only honoured by a tick loop that is already running; see
  // runRunning for why a stale request cannot leak into the following round.
  requestForceCrash(): void {
    this.forceCrashRequested = true
  }

  private async runWaiting(): Promise<Round> {
    const crashPoint = generateCrashPoint()
    const round = await this.roundRepo.create(crashPoint)

    const redis = getRedis()
    await redis.set('game:phase', 'WAITING')
    await redis.set('game:currentRound', round.id)
    await redis.set('game:currentMultiplier', '1')

    logger.info('Round WAITING', { roundId: round.id })
    this.gateway.emitToAll('round:waiting', { roundId: round.id, phase: 'WAITING', countdown: env.ROUND_WAITING_SECONDS })

    // Place one-shot next-round bets queued during the previous round. Done after
    // the round:waiting broadcast so clients clear last round's slots first, then
    // receive the placement result. Emitted per-user, mirroring the cashout path.
    const outcomes = await this.betService.consumeNextRoundQueue()
    for (const outcome of outcomes) {
      if (outcome.ok) {
        this.gateway.emitToUser(outcome.userId, 'bet:queuePlaced', { bet: outcome.bet, balance: outcome.balance })
        this.gateway.emitToUser(outcome.userId, 'wallet:updated', { balance: outcome.balance })
      } else {
        this.gateway.emitToUser(outcome.userId, 'bet:queueDropped', { slotId: outcome.slotId, code: outcome.code })
      }
    }

    for (let i = env.ROUND_WAITING_SECONDS; i > 0; i--) {
      await sleep(1000)
      this.gateway.emitToAll('round:countdown', { roundId: round.id, countdown: i - 1 })
    }

    return round
  }

  private async runRunning(round: Round): Promise<void> {
    // Clear anything raised while no round was running. The controller rejects
    // such requests with a 409, but the phase it checks lives in Redis and can
    // be a few milliseconds stale — this makes it impossible for that race to
    // insta-crash the *next* round at 1.01.
    this.forceCrashRequested = false

    const startedAt = new Date()
    await this.roundRepo.updatePhase(round.id, 'RUNNING', { startedAt })

    const redis = getRedis()
    await redis.set('game:phase', 'RUNNING')

    logger.info('Round RUNNING', { roundId: round.id, crashPoint: round.crashPoint })
    this.gateway.emitToAll('round:started', { roundId: round.id, phase: 'RUNNING', startedAt })

    // Auto-cashouts are detected, marked and recorded in the outbox inside the
    // tick (local DB writes), but their wallet credits are deferred: the 100ms
    // tick must never block on a network call to the operator. Each marked
    // cashout is collected here and credited after the interval is cleared.
    const pendingCredits: Bet[] = []

    await new Promise<void>((resolve) => {
      const start = Date.now()
      const tick = setInterval(async () => {
        const elapsed = (Date.now() - start) / 1000
        const multiplier = Math.exp(env.ROUND_GROWTH_RATE * elapsed)
        await redis.set('game:currentMultiplier', multiplier.toFixed(4))
        this.gateway.emitToAll('round:multiplier', {
          roundId: round.id,
          multiplier: parseFloat(multiplier.toFixed(2)),
        })

        const marked = await this.betService.markAutoCashouts(round.id, multiplier)
        for (const bet of marked) {
          pendingCredits.push(bet)
          // Tell the player they cashed out now; the balance follows once credited.
          this.gateway.emitToUser(bet.userId, 'bet:cashedOut', { bet })
        }

        // Checked after markAutoCashouts, so everyone whose auto-cashout the
        // round had already reached is paid: below the forced point they win,
        // above it they lose, exactly as in a natural crash.
        if (this.forceCrashRequested) {
          await this.applyForceCrash(round, multiplier)
          clearInterval(tick)
          resolve()
          return
        }

        if (multiplier >= round.crashPoint) {
          clearInterval(tick)
          resolve()
        }
      }, 100)
    })

    // Whether it fired or not, the request dies with the round it was aimed at.
    this.forceCrashRequested = false

    // Drain credits AFTER the tick loop has stopped — never inside the tick.
    // Each credit is already recorded in the outbox, so a failure here only
    // delays the money: the WalletOutboxWorker picks it up.
    for (const bet of pendingCredits) {
      try {
        const balance = await this.betService.creditWin(bet)
        this.gateway.emitToUser(bet.userId, 'wallet:updated', { balance })
      } catch (err) {
        logger.error('Auto-cashout credit failed', { betId: bet.id, error: (err as Error).message })
      }
    }
  }

  // Rewrite the round's crash point to the multiplier the tick just observed and
  // stamp it as manual. Two details are load-bearing:
  //
  //  - the clamp: crash_point carries a CHECK >= 1.01, so a force-crash in the
  //    first ~0.16s would otherwise be refused by the database and leave the
  //    round running with nothing to show for the operator's click;
  //  - the assignment to `round.crashPoint`: runCrashed broadcasts and logs the
  //    in-memory object, so without it every client would be told the round
  //    ended at its original, never-reached crash point.
  //
  // The exact multiplier is stored, not the two-decimal one that was broadcast:
  // it is the same value markAutoCashouts was just judged against, and history
  // must agree with what was paid.
  private async applyForceCrash(round: Round, multiplier: number): Promise<void> {
    const crashPoint = Math.max(1.01, multiplier)
    await this.roundRepo.updatePhase(round.id, 'RUNNING', { crashPoint, forcedAt: new Date() })
    round.crashPoint = crashPoint
    logger.warn('Round force-crashed by operator', { roundId: round.id, crashPoint })
  }

  private async runCrashed(round: Round): Promise<void> {
    const crashedAt = new Date()
    await this.roundRepo.updatePhase(round.id, 'CRASHED', { crashedAt })

    const redis = getRedis()
    await redis.set('game:phase', 'CRASHED')

    const lostBets = await this.betService.resolveLosses(round.id)
    for (const bet of lostBets) {
      this.gateway.emitToUser(bet.userId, 'bet:lost', {
        bet: { id: bet.id, roundId: bet.roundId, slotId: bet.slotId, status: 'LOST', amount: bet.amount },
      })
    }

    logger.info('Round CRASHED', { roundId: round.id, crashPoint: round.crashPoint })
    this.gateway.emitToAll('round:crashed', {
      roundId: round.id,
      phase: 'CRASHED',
      crashPoint: round.crashPoint,
      crashedAt,
    })

    await sleep(env.ROUND_CRASHED_SECONDS * 1000)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
