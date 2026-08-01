import { Inject, Injectable } from '@nestjs/common'
import { env } from '@/config/env'
import { getRedis } from '@/config/redis'
import { AppError } from '@/shared/errors/AppError'
import { DuplicateKeyError } from '@/shared/errors/duplicate-key.error'
import { ErrorCode } from '@/shared/errors/error-codes'
import { IUnitOfWork, UNIT_OF_WORK } from '@/shared/repositories/unit-of-work'
import { logger } from '@/shared/utils/logger'
import { calculatePayout, isValidBetAmount } from '@/shared/utils/money'
import { IWalletOpsRepository, WALLET_OPS_REPOSITORY } from '../wallet-ops/wallet-ops.repository.interface'
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
// Mirrors the white-label's own derivation, so our outbox row and its ledger row
// carry the same id.
const rollbackTxRef = (refTxRef: string) => `${refTxRef}:rollback`

// A freshly enqueued DEBIT is attempted inline by placeBet itself, so the outbox
// worker must not touch it yet. A minute is orders of magnitude more than the
// bounded inline retry needs (< 1s) and still fast enough that a crashed process
// resolves the stake long before a player would notice.
const STAKE_GRACE_MS = 60_000

interface QueuedIntent {
  amount: number
  autoCashOut: number | null
  currency: string
}

// A stake whose debit did not come back as a confirmed success. Structurally a
// subset of WalletOp, so the outbox worker can hand its row straight over.
export interface UnresolvedStake {
  betId: string | null
  txRef: string
  playerId: string
  currency: string
  amount: number
  roundId: string | null
  slotId: number | null
}

export type QueueOutcome =
  | { ok: true; userId: string; slotId: BetSlotId; bet: Bet; balance: number }
  | { ok: false; userId: string; slotId: BetSlotId; code: string }

@Injectable()
export class BetService {
  constructor(
    @Inject(BET_REPOSITORY) private readonly betRepo: IBetRepository,
    @Inject(WALLET_OPS_REPOSITORY) private readonly walletOpsRepo: IWalletOpsRepository,
    @Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork,
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

    const txRef = betTxRef(roundId, userId, slotId)

    // Intent first: the bet row and the money op commit together and BEFORE the
    // operator is called, so a crash mid-debit leaves a trace to replay instead
    // of a silently lost stake. The unique (round,user,slot) index settles the
    // slot race right here — while no money has moved and there is nothing to
    // compensate. The op is not claimable by the worker for STAKE_GRACE_MS,
    // because the inline debit below is its first attempt.
    let bet: Bet
    try {
      bet = await this.uow.run(async (ctx) => {
        const created = await this.betRepo.create(
          {
            userId,
            currency,
            roundId,
            slotId,
            amount,
            autoCashOut,
            status: 'PENDING_STAKE',
            cashOutMultiplier: null,
            payout: 0,
            placedAt: new Date(),
            cashedOutAt: null,
            resolvedAt: null,
          },
          ctx,
        )
        await this.walletOpsRepo.enqueue(
          {
            kind: 'DEBIT',
            txRef,
            betId: created.id,
            playerId: userId,
            currency,
            amount,
            roundId,
            slotId,
            nextAttemptAt: new Date(Date.now() + STAKE_GRACE_MS),
          },
          ctx,
        )
        return created
      })
    } catch (err) {
      if (err instanceof DuplicateKeyError) {
        throw new AppError(409, ErrorCode.BET_ALREADY_EXISTS, `Slot ${slotId} already has a bet this round`)
      }
      throw err
    }

    let balance: number
    try {
      ;({ balance } = await this.withRetry(() =>
        this.walletService.debit({ playerId: userId, currency, txRef, amount, roundId, slotId, gameId: env.GAME_ID }),
      ))
    } catch (err) {
      await this.retireUnpaidStake(bet, txRef, err)
      throw err
    }

    const placed = await this.uow.run(async (ctx) => {
      const row = await this.betRepo.markPlaced(bet.id, ctx)
      if (row) await this.walletOpsRepo.markConfirmed(txRef, ctx)
      return row
    })
    if (!placed) {
      // Only reachable if something else retired this stake while the debit was
      // in flight, which the grace period rules out. The stake is charged, so
      // say so loudly rather than hand back a bet that isn't live — the reversal
      // whoever retired it queued is what makes the player whole.
      logger.error('Stake debited but the bet was no longer PENDING_STAKE', { betId: bet.id, txRef })
      throw new AppError(500, ErrorCode.INTERNAL_SERVER_ERROR, 'Bet could not be confirmed')
    }

    return { bet: placed, balance }
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
    const txRef = winTxRef(existing.roundId, existing.userId, existing.slotId)

    // Mark and record the credit in ONE commit: the compare-and-set on
    // status='PLACED' means concurrent cashouts can't both win, and the op means
    // a credit that fails afterwards is still owed, not lost.
    const bet = await this.uow.run(async (ctx) => {
      const cashed = await this.betRepo.cashOut(betId, multiplier, payout, ctx)
      if (!cashed) return null
      await this.walletOpsRepo.enqueue(
        {
          kind: 'CREDIT',
          txRef,
          betId: cashed.id,
          playerId: cashed.userId,
          currency: cashed.currency,
          amount: cashed.payout,
          roundId: cashed.roundId,
          slotId: cashed.slotId,
        },
        ctx,
      )
      return cashed
    })
    if (!bet) throw new AppError(409, ErrorCode.BET_ALREADY_RESOLVED, 'Bet already resolved')

    const balance = await this.creditWin(bet)
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

    const refTxRef = betTxRef(existing.roundId, existing.userId, existing.slotId)
    const txRef = rollbackTxRef(refTxRef)

    const bet = await this.uow.run(async (ctx) => {
      const canceled = await this.betRepo.cancelPlaced(betId, userId, ctx)
      if (!canceled) return null
      await this.walletOpsRepo.enqueue(this.reversalOf(canceled, refTxRef), ctx)
      return canceled
    })
    if (!bet) throw new AppError(409, ErrorCode.BET_ALREADY_RESOLVED, 'Bet already resolved')

    try {
      const { balance } = await this.withRetry(() =>
        this.walletService.rollback({ playerId: bet.userId, currency: bet.currency, refTxRef }),
      )
      await this.walletOpsRepo.markConfirmed(txRef)
      return { bet, balance }
    } catch (err) {
      // The reversal is recorded, so the worker will deliver it; report the live
      // balance rather than pretend the stake is already back.
      logger.warn('Stake reversal deferred to the outbox worker', { betId: bet.id, txRef, error: (err as Error).message })
      const balance = await this.walletService.getBalance(bet.userId, bet.currency)
      return { bet, balance }
    }
  }

  // Deliver a cashed-out bet's winnings. The CREDIT op was committed together
  // with the CASHED_OUT status, so this is only the fast path: if it fails the op
  // stays PENDING and the outbox worker owns it. Deliberately does NOT set
  // SETTLEMENT_PENDING — that flag now means the worker gave up, not that one
  // attempt missed. Decoupled from the round tick so it can be drained after
  // clearInterval.
  async creditWin(bet: Bet): Promise<number> {
    const txRef = winTxRef(bet.roundId, bet.userId, bet.slotId)
    try {
      const { balance } = await this.withRetry(() =>
        this.walletService.credit({ playerId: bet.userId, currency: bet.currency, txRef, amount: bet.payout, roundId: bet.roundId, slotId: bet.slotId, gameId: env.GAME_ID }),
      )
      await this.walletOpsRepo.markConfirmed(txRef)
      return balance
    } catch (err) {
      logger.warn('Win credit deferred to the outbox worker', { betId: bet.id, txRef, error: (err as Error).message })
      return this.walletService.getBalance(bet.userId, bet.currency)
    }
  }

  // The stake debit did not come back as a confirmed success. The two cases are
  // not interchangeable, and conflating them either costs the player a stake or
  // hands out a free one.
  private async retireUnpaidStake(bet: Bet, txRef: string, err: unknown): Promise<void> {
    const reason = (err as Error).message
    if (err instanceof AppError && err.statusCode < 500) {
      // Deterministic refusal (402 insufficient balance, 404 no wallet): the
      // operator moved nothing. Keep the row as an audit trace and free the slot
      // — REJECTED is the one status the unique index ignores — so a top-up can
      // retry. Safe precisely because no debit exists under this txRef to replay.
      await this.uow.run(async (ctx) => {
        await this.betRepo.markRejected(bet.id, ctx)
        await this.walletOpsRepo.markFailed(txRef, reason, ctx)
      })
      return
    }
    await this.abandonStake(
      {
        betId: bet.id,
        txRef,
        playerId: bet.userId,
        currency: bet.currency,
        amount: bet.amount,
        roundId: bet.roundId,
        slotId: bet.slotId,
      },
      reason,
    )
  }

  // Unknown outcome: the debit may or may not have landed. Queue a reversal (a
  // no-op at the operator if the debit never happened) and retire the bet as
  // CANCELED, not REJECTED. That difference is load-bearing: CANCELED keeps the
  // (round,user,slot) occupied, so the player cannot re-bet the slot this round.
  // A retry would reuse this same debit txRef, which the white-label would treat
  // as a replay and NOT charge — right after we handed the stake back. That is a
  // free bet. Public because the outbox worker resolves stranded DEBIT ops the
  // same way.
  async abandonStake(stake: UnresolvedStake, reason: string): Promise<void> {
    await this.uow.run(async (ctx) => {
      if (stake.betId) await this.betRepo.markStakeCanceled(stake.betId, ctx)
      await this.walletOpsRepo.markFailed(stake.txRef, reason, ctx)
      await this.walletOpsRepo.enqueue(
        {
          kind: 'ROLLBACK',
          txRef: rollbackTxRef(stake.txRef),
          refTxRef: stake.txRef,
          betId: stake.betId,
          playerId: stake.playerId,
          currency: stake.currency,
          amount: stake.amount,
          roundId: stake.roundId,
          slotId: stake.slotId,
        },
        ctx,
      )
    })
    logger.warn('Unresolved stake abandoned, reversal queued', { betId: stake.betId, txRef: stake.txRef, reason })
  }

  async getActiveBets(userId: string, roundId: string): Promise<Bet[]> {
    return this.betRepo.findActiveByUser(userId, roundId)
  }

  async getBetHistory(userId: string, limit: number, cursor?: string) {
    return this.betRepo.findByUser(userId, limit, cursor)
  }

  // Tick-safe: marks auto-cashout-eligible bets as CASHED_OUT at the crossing
  // multiplier, records a CREDIT op for each in the SAME commit, and returns
  // them. Two statements, no per-bet round-trips and no wallet calls — this runs
  // inside the 100ms tick; the credits are delivered after the tick loop ends
  // (see RoundEngine) or by the outbox worker.
  //
  // The payout comes back from the row the database wrote, so what the player is
  // told, what is queued, and what gets credited cannot drift apart.
  async markAutoCashouts(roundId: string, multiplier: number): Promise<Bet[]> {
    return this.uow.run(async (ctx) => {
      const cashedOut = await this.betRepo.cashOutAuto(roundId, multiplier, ctx)
      await this.walletOpsRepo.enqueueMany(
        cashedOut.map((bet) => ({
          kind: 'CREDIT' as const,
          txRef: winTxRef(bet.roundId, bet.userId, bet.slotId),
          betId: bet.id,
          playerId: bet.userId,
          currency: bet.currency,
          amount: bet.payout,
          roundId: bet.roundId,
          slotId: bet.slotId,
        })),
        ctx,
      )
      return cashedOut
    })
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

  // On engine restart, every bet whose money question is still open has to be
  // closed. A PLACED bet is an orphan of an interrupted round: the stake was
  // taken but the round never resolved. A PENDING_STAKE bet's debit outcome is
  // unknown. Both get the same idempotent reversal — queued, not called: the
  // operator may still be down, and the worker keeps trying. Returns the number
  // of orphans recovered (0 on a clean boot).
  async recoverOpenBets(): Promise<number> {
    const orphans = await this.betRepo.findAllUnsettled()
    for (const bet of orphans) {
      const refTxRef = betTxRef(bet.roundId, bet.userId, bet.slotId)
      if (bet.status === 'PENDING_STAKE') {
        await this.abandonStake(
          {
            betId: bet.id,
            txRef: refTxRef,
            playerId: bet.userId,
            currency: bet.currency,
            amount: bet.amount,
            roundId: bet.roundId,
            slotId: bet.slotId,
          },
          'process restarted while the stake was unconfirmed',
        )
        continue
      }
      await this.uow.run(async (ctx) => {
        await this.betRepo.markCanceled(bet.id, ctx)
        await this.walletOpsRepo.enqueue(this.reversalOf(bet, refTxRef), ctx)
      })
    }
    return orphans.length
  }

  // Reversal of a confirmed stake debit, for a bet that is no longer live.
  private reversalOf(bet: Bet, refTxRef: string) {
    return {
      kind: 'ROLLBACK' as const,
      txRef: rollbackTxRef(refTxRef),
      refTxRef,
      betId: bet.id,
      playerId: bet.userId,
      currency: bet.currency,
      amount: bet.amount,
      roundId: bet.roundId,
      slotId: bet.slotId,
    }
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
  // during WAITING the user just bets normally. Per-slot: rejects only while
  // the current-round bet is still active; resolved bets may queue the next round.
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
      if (existing?.status === 'PLACED') throw new AppError(409, ErrorCode.BET_QUEUE_NOT_ALLOWED, `Slot ${slotId} already has an active bet this round`)
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
