import { Injectable, OnModuleInit, Inject } from '@nestjs/common'
import { env } from '@/config/env'
import { getRedis } from '@/config/redis'
import { generateCrashPoint } from '@/shared/utils/crash'
import { logger } from '@/shared/utils/logger'
import { ROUND_REPOSITORY, IRoundRepository } from '@/modules/rounds/round.repository.interface'
import { Round } from '@/modules/rounds/round.types'
import { BetService } from '@/modules/bets/bet.service'
import { GameGateway } from '@/socket/game.gateway'

@Injectable()
export class RoundEngine implements OnModuleInit {
  private loopActive = false

  constructor(
    @Inject(ROUND_REPOSITORY) private readonly roundRepo: IRoundRepository,
    private readonly betService: BetService,
    private readonly gateway: GameGateway,
  ) {}

  onModuleInit(): void {
    this.startLoop()
  }

  private startLoop(): void {
    if (this.loopActive) return
    this.loopActive = true
    void this.runCycle()
  }

  private async runCycle(): Promise<void> {
    while (this.loopActive) {
      const round = await this.runWaiting()
      await this.runRunning(round)
      await this.runCrashed(round)
    }
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
    const startedAt = new Date()
    await this.roundRepo.updatePhase(round.id, 'RUNNING', { startedAt })

    const redis = getRedis()
    await redis.set('game:phase', 'RUNNING')

    logger.info('Round RUNNING', { roundId: round.id, crashPoint: round.crashPoint })
    this.gateway.emitToAll('round:started', { roundId: round.id, phase: 'RUNNING', startedAt })

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

        const cashouts = await this.betService.processAutoCashouts(round.id, multiplier)
        for (const { bet } of cashouts) {
          const balance = await this.betService.getUserBalance(bet.userId)
          this.gateway.emitToUser(bet.userId, 'bet:cashedOut', { bet })
          this.gateway.emitToUser(bet.userId, 'wallet:updated', { balance })
        }

        if (multiplier >= round.crashPoint) {
          clearInterval(tick)
          resolve()
        }
      }, 100)
    })
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
