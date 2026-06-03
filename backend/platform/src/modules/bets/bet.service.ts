import { Inject, Injectable } from '@nestjs/common'
import { env } from '@/config/env'
import { getRedis } from '@/config/redis'
import { AppError } from '@/shared/errors/AppError'
import { ErrorCode } from '@/shared/errors/error-codes'
import { logger } from '@/shared/utils/logger'
import { calculatePayout, isValidBetAmount } from '@/shared/utils/money'
import { WalletService } from '../wallet/wallet.service'
import { BET_REPOSITORY, IBetRepository } from './bet.repository.interface'
import { Bet, BetSlotId } from './bet.types'

// Connection-scoped, one-shot intent to bet on the *next* round, stored in the
// Redis hash `queue:next` under the field `{userId}:{slotId}`. There is one
// socket per user (the gateway enforces it), so userId keying is unambiguous.
const QUEUE_KEY = 'queue:next'
const queueField = (userId: string, slotId: BetSlotId) => `${userId}:${slotId}`

// Game-generated idempotent transaction refs. Determinism is load-bearing: the
// white-label dedupes on these, so the same logical money move always collapses
// to one effect — across retries, races, and restart recovery.
const betTxRef = (roundId: string, userId: string, slotId: BetSlotId) => `${roundId}:${userId}:${slotId}:bet`
const winTxRef = (roundId: string, userId: string, slotId: BetSlotId) => `${roundId}:${userId}:${slotId}:win`

const isDuplicateKey = (err: unknown): boolean => (err as { code?: number }).code === 11000

interface QueuedIntent {
  amount: number
  autoCashOut: number | null
  currency: string
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

  async placeBet(userId: string, currency: string, slotId: BetSlotId, amount: number, autoCashOut: number | null): Promise<{ bet: Bet; balance: number }> {
    const phase = await getRedis().get('game:phase')
    if (phase !== 'WAITING') throw new AppError(400, ErrorCode.ROUND_NOT_WAITING, 'Bets can only be placed during the waiting phase')

    if (!isValidBetAmount(amount)) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Invalid bet amount')
    if (autoCashOut !== null && autoCashOut <= 1) throw new AppError(400, ErrorCode.INVALID_AUTO_CASHOUT, 'Auto cashout must be greater than 1.00')

    const roundId = await getRedis().get('game:currentRound')
    if (!roundId) throw new AppError(400, ErrorCode.ROUND_NOT_WAITING, 'No active round')

    const existing = await this.betRepo.findBySlot(roundId, userId, slotId)
    if (existing) throw new AppError(409, ErrorCode.BET_ALREADY_EXISTS, `Slot ${slotId} already has a bet this round`)

    // Money-first ordering (§2.12): debit the operator, then persist the bet.
    // The debit txRef is idempotent, so a retry never double-charges. If the
    // bet fails to persist *after* a successful debit, roll the debit back.
    const txRef = betTxRef(roundId, userId, slotId)
    const { balance } = await this.withRetry(() =>
      this.walletService.debit({ playerId: userId, currency, txRef, amount, roundId, slotId, gameId: env.GAME_ID }),
    )

    let bet: Bet
    try {
      bet = await this.betRepo.create({
        userId,
        currency,
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
    } catch (err) {
      // A concurrent request won the unique (round,user,slot) slot. It shares
      // this exact txRef, so the white-label already collapsed both debits into
      // one effect that the winner owns — we must NOT roll it back here.
      if (isDuplicateKey(err)) {
        throw new AppError(409, ErrorCode.BET_ALREADY_EXISTS, `Slot ${slotId} already has a bet this round`)
      }
      await this.walletService.rollback({ playerId: userId, currency, refTxRef: txRef }).catch((rbErr) => {
        logger.error('Rollback after failed bet create errored', { txRef, error: (rbErr as Error).message })
      })
      throw err
    }

    return { bet, balance }
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
    // Mark first (idempotent { status: PLACED } guard), then credit. Marking
    // before the network call guarantees a slow/failed credit can't be re-cashed.
    const bet = await this.betRepo.cashOut(betId, multiplier, payout)
    if (!bet) throw new AppError(409, ErrorCode.BET_ALREADY_RESOLVED, 'Bet already resolved')

    const balance = await this.creditWin(bet, payout)
    return { bet, balance }
  }

  async cancelBet(userId: string, betId: string): Promise<{ bet: Bet; balance: number }> {
    const phase = await getRedis().get('game:phase')
    if (phase !== 'WAITING') throw new AppError(400, ErrorCode.ROUND_NOT_WAITING, 'Bets can only be canceled before the round starts')

    const currentRoundId = await getRedis().get('game:currentRound')
    if (!currentRoundId) throw new AppError(400, ErrorCode.ROUND_NOT_WAITING, 'No active round')

    const existing = await this.betRepo.findById(betId)
    if (!existing || existing.userId !== userId || existing.roundId !== currentRoundId) {
      throw new AppError(404, ErrorCode.BET_NOT_FOUND, 'Bet not found')
    }
    if (existing.status !== 'PLACED') throw new AppError(409, ErrorCode.BET_ALREADY_RESOLVED, 'Bet already resolved')

    const bet = await this.betRepo.cancelPlaced(betId, userId)
    if (!bet) throw new AppError(409, ErrorCode.BET_ALREADY_RESOLVED, 'Bet already resolved')

    const refTxRef = betTxRef(bet.roundId, bet.userId, bet.slotId)
    try {
      const { balance } = await this.withRetry(() =>
        this.walletService.rollback({ playerId: bet.userId, currency: bet.currency, refTxRef }),
      )
      return { bet, balance }
    } catch (err) {
      logger.error('Bet cancellation rollback failed', { betId: bet.id, refTxRef, error: (err as Error).message })
      const balance = await this.walletService.getBalance(bet.userId, bet.currency)
      return { bet, balance }
    }
  }

  // Credit a cashed-out bet's winnings. The bet is already marked resolved; the
  // win txRef is idempotent so retries never double-pay. On unrecoverable
  // failure the bet is flagged SETTLEMENT_PENDING and the (still-uncredited)
  // live balance is returned — the player sees reality and a manual replay stays
  // safe. Decoupled from the round tick so it can be drained after clearInterval.
  async creditWin(bet: Bet, payout: number): Promise<number> {
    const txRef = winTxRef(bet.roundId, bet.userId, bet.slotId)
    try {
      const { balance } = await this.withRetry(() =>
        this.walletService.credit({ playerId: bet.userId, currency: bet.currency, txRef, amount: payout, roundId: bet.roundId, slotId: bet.slotId, gameId: env.GAME_ID }),
      )
      return balance
    } catch (err) {
      logger.error('Win credit failed; marking bet SETTLEMENT_PENDING', { betId: bet.id, txRef, error: (err as Error).message })
      await this.betRepo.markSettlementPending(bet.id).catch(() => undefined)
      return this.walletService.getBalance(bet.userId, bet.currency)
    }
  }

  async getActiveBets(userId: string, roundId: string): Promise<Bet[]> {
    return this.betRepo.findActiveByUser(userId, roundId)
  }

  async getBetHistory(userId: string, limit: number, cursor?: string) {
    return this.betRepo.findByUser(userId, limit, cursor)
  }

  // Tick-safe: marks auto-cashout-eligible bets as CASHED_OUT (a fast Mongo
  // write at the crossing multiplier) and returns them. NO wallet calls here —
  // the winnings are credited after the tick loop ends (see RoundEngine).
  async markAutoCashouts(roundId: string, multiplier: number): Promise<{ bet: Bet; payout: number }[]> {
    const bets = await this.betRepo.findActiveByRound(roundId)
    const results: { bet: Bet; payout: number }[] = []
    for (const bet of bets) {
      if (bet.autoCashOut !== null && multiplier >= bet.autoCashOut) {
        const payout = calculatePayout(bet.amount, multiplier)
        const updated = await this.betRepo.cashOut(bet.id, multiplier, payout)
        if (updated) results.push({ bet: updated, payout })
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

  async getUserBalance(userId: string, currency: string): Promise<number> {
    return this.walletService.getBalance(userId, currency)
  }

  // On engine restart, any still-PLACED bet is an orphan from an interrupted
  // round: its stake was debited but the round never resolved. Roll the debit
  // back (idempotent; no-op if it never landed) and cancel the bet. Returns the
  // number of orphans recovered (0 on a clean boot).
  async recoverOpenBets(): Promise<number> {
    const orphans = await this.betRepo.findAllPlaced()
    for (const bet of orphans) {
      const refTxRef = betTxRef(bet.roundId, bet.userId, bet.slotId)
      try {
        await this.walletService.rollback({ playerId: bet.userId, currency: bet.currency, refTxRef })
      } catch (err) {
        logger.error('Recovery rollback failed', { betId: bet.id, refTxRef, error: (err as Error).message })
      }
      await this.betRepo.markCanceled(bet.id)
    }
    return orphans.length
  }

  // Bounded inline retry for money calls (§2.12). Only transient failures retry:
  // a deterministic 4xx (insufficient balance, validation) throws immediately.
  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastErr: unknown
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastErr = err
        if (err instanceof AppError && err.statusCode < 500) throw err
        if (attempt < attempts) await sleep(100 * attempt)
      }
    }
    throw lastErr
  }

  // ── Next-round queue (pure intent; no money moves until placement) ────────

  // Queue a bet for the next round. Allowed only mid-round (RUNNING/CRASHED) —
  // during WAITING the user just bets normally. Per-slot: rejects if the slot
  // already holds a bet this round, matching the unique (round,user,slot) index.
  async queueNextBet(userId: string, currency: string, slotId: BetSlotId, amount: number, autoCashOut: number | null): Promise<{ slotId: BetSlotId; amount: number; autoCashOut: number | null }> {
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

    await getRedis().hset(QUEUE_KEY, queueField(userId, slotId), JSON.stringify({ amount, autoCashOut, currency } satisfies QueuedIntent))
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
  // place each intent through the normal placeBet flow (debit happens here).
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
        const { bet, balance } = await this.placeBet(userId, intent.currency, slotId, intent.amount, intent.autoCashOut)
        outcomes.push({ ok: true, userId, slotId, bet, balance })
      } catch (err) {
        const code = (err as AppError).code ?? ErrorCode.INTERNAL_SERVER_ERROR
        outcomes.push({ ok: false, userId, slotId, code })
      }
    }
    return outcomes
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
