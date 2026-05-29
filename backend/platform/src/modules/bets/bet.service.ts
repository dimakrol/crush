import { Inject, Injectable } from '@nestjs/common'
import { getRedis } from '@/config/redis'
import { AppError } from '@/shared/errors/AppError'
import { ErrorCode } from '@/shared/errors/error-codes'
import { calculatePayout, isValidBetAmount } from '@/shared/utils/money'
import { WalletService } from '../wallet/wallet.service'
import { BET_REPOSITORY, IBetRepository } from './bet.repository.interface'
import { Bet, BetSlotId } from './bet.types'

// Connection-scoped, one-shot intent to bet on the *next* round, stored in the
// Redis hash `queue:next` under the field `{userId}:{slotId}`. There is one
// socket per user (the gateway enforces it), so userId keying is unambiguous.
const QUEUE_KEY = 'queue:next'
const queueField = (userId: string, slotId: BetSlotId) => `${userId}:${slotId}`

interface QueuedIntent {
  amount: number
  autoCashOut: number | null
}

export type QueueOutcome =
  | { ok: true; userId: string; slotId: BetSlotId; bet: Bet; balance: number }
  | { ok: false; userId: string; slotId: BetSlotId; code: string }

@Injectable()
export class BetService {
  constructor(
    @Inject(BET_REPOSITORY) private readonly betRepo: IBetRepository,
    private readonly walletService: WalletService,
  ) {}

  async placeBet(userId: string, slotId: BetSlotId, amount: number, autoCashOut: number | null): Promise<{ bet: Bet; balance: number }> {
    const phase = await getRedis().get('game:phase')
    if (phase !== 'WAITING') throw new AppError(400, ErrorCode.ROUND_NOT_WAITING, 'Bets can only be placed during the waiting phase')

    if (!isValidBetAmount(amount)) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Invalid bet amount')
    if (autoCashOut !== null && autoCashOut <= 1) throw new AppError(400, ErrorCode.INVALID_AUTO_CASHOUT, 'Auto cashout must be greater than 1.00')

    const roundId = await getRedis().get('game:currentRound')
    if (!roundId) throw new AppError(400, ErrorCode.ROUND_NOT_WAITING, 'No active round')

    const existing = await this.betRepo.findBySlot(roundId, userId, slotId)
    if (existing) throw new AppError(409, ErrorCode.BET_ALREADY_EXISTS, `Slot ${slotId} already has a bet this round`)

    // LIMITATION: deduct + create are two separate operations (no replica set for transactions)
    const wallet = await this.walletService.deductBalance(userId, amount)
    const bet = await this.betRepo.create({
      userId,
      roundId,
      slotId,
      amount,
      autoCashOut,
      status: 'PLACED',
      cashOutMultiplier: null,
      payout: 0,
      placedAt: new Date(),
      cashedOutAt: null,
      resolvedAt: null,
    })
    return { bet, balance: wallet.balance }
  }

  async cashOut(userId: string, betId: string): Promise<{ bet: Bet; balance: number }> {
    const phase = await getRedis().get('game:phase')
    if (phase !== 'RUNNING') throw new AppError(400, ErrorCode.ROUND_NOT_RUNNING, 'Cashout only allowed during running phase')

    const multiplierStr = await getRedis().get('game:currentMultiplier')
    if (!multiplierStr) throw new AppError(503, ErrorCode.INTERNAL_SERVER_ERROR, 'Multiplier unavailable')
    const multiplier = parseFloat(multiplierStr)

    const existing = await this.betRepo.findById(betId)
    if (!existing || existing.userId !== userId) throw new AppError(404, ErrorCode.BET_NOT_FOUND, 'Bet not found')
    if (existing.status !== 'PLACED') throw new AppError(409, ErrorCode.BET_ALREADY_RESOLVED, 'Bet already resolved')

    const payout = calculatePayout(existing.amount, multiplier)
    // Idempotent: findOneAndUpdate with { status: PLACED } condition
    const bet = await this.betRepo.cashOut(betId, multiplier, payout)
    if (!bet) throw new AppError(409, ErrorCode.BET_ALREADY_RESOLVED, 'Bet already resolved')

    const wallet = await this.walletService.addBalance(userId, payout)
    return { bet, balance: wallet.balance }
  }

  async getActiveBets(userId: string, roundId: string): Promise<Bet[]> {
    return this.betRepo.findActiveByUser(userId, roundId)
  }

  async getBetHistory(userId: string, limit: number, cursor?: string) {
    return this.betRepo.findByUser(userId, limit, cursor)
  }

  async processAutoCashouts(roundId: string, multiplier: number): Promise<{ bet: Bet; payout: number }[]> {
    const bets = await this.betRepo.findActiveByRound(roundId)
    const results: { bet: Bet; payout: number }[] = []
    for (const bet of bets) {
      if (bet.autoCashOut !== null && multiplier >= bet.autoCashOut) {
        const payout = calculatePayout(bet.amount, multiplier)
        const updated = await this.betRepo.cashOut(bet.id, multiplier, payout)
        if (updated) {
          await this.walletService.addBalance(bet.userId, payout)
          results.push({ bet: updated, payout })
        }
      }
    }
    return results
  }

  async resolveLosses(roundId: string): Promise<Bet[]> {
    return this.betRepo.resolveLosses(roundId)
  }

  async cancelUserBets(userId: string, roundId: string): Promise<void> {
    return this.betRepo.cancelByUser(userId, roundId)
  }

  async getUserBalance(userId: string): Promise<number> {
    return this.walletService.getBalance(userId)
  }

  // ── Next-round queue (pure intent; no money moves until placement) ────────

  // Queue a bet for the next round. Allowed only mid-round (RUNNING/CRASHED) —
  // during WAITING the user just bets normally. Per-slot: rejects if the slot
  // already holds a bet this round, matching the unique (round,user,slot) index.
  async queueNextBet(userId: string, slotId: BetSlotId, amount: number, autoCashOut: number | null): Promise<QueuedIntent & { slotId: BetSlotId }> {
    const phase = await getRedis().get('game:phase')
    if (phase !== 'RUNNING' && phase !== 'CRASHED') {
      throw new AppError(400, ErrorCode.BET_QUEUE_NOT_ALLOWED, 'Next-round bets can only be queued while a round is in progress')
    }
    if (!isValidBetAmount(amount)) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Invalid bet amount')
    if (autoCashOut !== null && autoCashOut <= 1) throw new AppError(400, ErrorCode.INVALID_AUTO_CASHOUT, 'Auto cashout must be greater than 1.00')

    const roundId = await getRedis().get('game:currentRound')
    if (roundId) {
      const existing = await this.betRepo.findBySlot(roundId, userId, slotId)
      if (existing) throw new AppError(409, ErrorCode.BET_QUEUE_NOT_ALLOWED, `Slot ${slotId} already has a bet this round`)
    }

    await getRedis().hset(QUEUE_KEY, queueField(userId, slotId), JSON.stringify({ amount, autoCashOut } satisfies QueuedIntent))
    return { slotId, amount, autoCashOut }
  }

  async cancelNextBet(userId: string, slotId: BetSlotId): Promise<{ slotId: BetSlotId }> {
    await getRedis().hdel(QUEUE_KEY, queueField(userId, slotId))
    return { slotId }
  }

  // Drop all of a user's queued intents — used on socket disconnect.
  async cancelAllNextForUser(userId: string): Promise<void> {
    await getRedis().hdel(QUEUE_KEY, queueField(userId, 1), queueField(userId, 2))
  }

  // Consume the entire queue exactly once at the start of a WAITING phase and
  // place each intent through the normal placeBet flow (deduct happens here).
  // The hash is cleared up front so the intents are strictly one-shot.
  async consumeNextRoundQueue(): Promise<QueueOutcome[]> {
    const redis = getRedis()
    const all = await redis.hgetall(QUEUE_KEY)
    const fields = Object.keys(all)
    if (fields.length === 0) return []
    await redis.del(QUEUE_KEY)

    const outcomes: QueueOutcome[] = []
    for (const field of fields) {
      const sep = field.lastIndexOf(':')
      const userId = field.slice(0, sep)
      const slotId = Number(field.slice(sep + 1)) as BetSlotId
      let intent: QueuedIntent
      try {
        intent = JSON.parse(all[field]) as QueuedIntent
      } catch {
        continue
      }
      try {
        const { bet, balance } = await this.placeBet(userId, slotId, intent.amount, intent.autoCashOut)
        outcomes.push({ ok: true, userId, slotId, bet, balance })
      } catch (err) {
        const code = (err as AppError).code ?? ErrorCode.INTERNAL_SERVER_ERROR
        outcomes.push({ ok: false, userId, slotId, code })
      }
    }
    return outcomes
  }
}
