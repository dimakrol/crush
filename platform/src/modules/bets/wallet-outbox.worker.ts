import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { env } from '@/config/env'
import { AppError } from '@/shared/errors/AppError'
import { logger } from '@/shared/utils/logger'
import { GameGateway } from '@/socket/game.gateway'
import { WalletOp } from '../wallet-ops/wallet-op.types'
import { IWalletOpsRepository, WALLET_OPS_REPOSITORY } from '../wallet-ops/wallet-ops.repository.interface'
import { WalletService } from '../wallet/wallet.service'
import { BET_REPOSITORY, IBetRepository } from './bet.repository.interface'
import { BetService } from './bet.service'

// In-process, single-instance: the platform cannot run horizontally anyway (the
// RoundEngine loop is a singleton), so a setInterval beats a queue broker here.
// The claim is still lock-safe, so adding an instance would not double-pay.
const TICK_MS = 3_000
const BATCH_SIZE = 20
const LEASE_MS = 30_000
const MAX_ATTEMPTS = 10
const BACKOFF_MIN_MS = 1_000
const BACKOFF_MAX_MS = 30_000

// 1s, 2s, 4s, 8s, 16s, then 30s until the budget runs out — roughly five minutes
// of grace for an operator restart before a human is told about it.
const backoffFor = (attempts: number): number =>
  Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (attempts - 1))

// Drains the wallet_ops outbox: every money move the inline path could not
// confirm gets replayed here until the operator acknowledges it or the retry
// budget runs out. Replays are safe because every op carries an idempotent
// txRef the white-label dedupes on.
@Injectable()
export class WalletOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout
  private draining?: Promise<void>

  constructor(
    @Inject(WALLET_OPS_REPOSITORY) private readonly walletOpsRepo: IWalletOpsRepository,
    @Inject(BET_REPOSITORY) private readonly betRepo: IBetRepository,
    private readonly betService: BetService,
    private readonly walletService: WalletService,
    private readonly gateway: GameGateway,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    logger.info('Wallet outbox worker started', { intervalMs: TICK_MS })
  }

  // Graceful shutdown: stop claiming, then let the batch in flight finish so a
  // shutdown never leaves a claimed op half-processed.
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    await this.draining
  }

  private tick(): Promise<void> {
    // Never overlap batches: a slow operator would otherwise pile up drains.
    if (this.draining) return this.draining
    this.draining = this.drain().finally(() => {
      this.draining = undefined
    })
    return this.draining
  }

  private async drain(): Promise<void> {
    try {
      const ops = await this.walletOpsRepo.claimBatch(BATCH_SIZE, LEASE_MS)
      if (ops.length === 0) return
      logger.info('Draining wallet outbox', { count: ops.length })
      // Sequential on purpose: these are retries against a service that is
      // probably already struggling, and parallel bursts only make that worse.
      for (const op of ops) await this.process(op)
    } catch (err) {
      logger.error('Wallet outbox drain failed', { error: (err as Error).message })
    }
  }

  private async process(op: WalletOp): Promise<void> {
    try {
      // A DEBIT still pending past its grace period means the process died
      // between recording the intent and confirming it — the stake is unresolved,
      // not owed. Never replay it: authorizing a stake for a round that is long
      // over would charge a player for a bet they cannot win.
      if (op.kind === 'DEBIT') {
        logger.warn('Stranded stake debit reclaimed by the outbox worker', { txRef: op.txRef, betId: op.betId })
        await this.betService.abandonStake(op, `stranded stake debit reclaimed after ${op.attempts} attempt(s)`)
        return
      }

      await this.deliver(op)
      await this.walletOpsRepo.markConfirmed(op.txRef)
      logger.info('Wallet op confirmed by the outbox worker', { txRef: op.txRef, kind: op.kind, attempts: op.attempts })
      await this.settleBet(op)
      await this.announceBalance(op)
    } catch (err) {
      await this.handleFailure(op, err)
    }
  }

  private async deliver(op: WalletOp): Promise<void> {
    if (op.kind === 'CREDIT') {
      await this.walletService.credit({
        playerId: op.playerId,
        currency: op.currency,
        txRef: op.txRef,
        amount: op.amount,
        roundId: op.roundId ?? undefined,
        slotId: op.slotId ?? undefined,
        gameId: env.GAME_ID,
      })
      return
    }
    // Guaranteed by the wallet_ops_rollback_has_ref CHECK constraint; asserted
    // here because a reversal without a reference would silently no-op.
    if (!op.refTxRef) throw new Error(`ROLLBACK op ${op.txRef} has no refTxRef`)
    await this.walletService.rollback({
      playerId: op.playerId,
      currency: op.currency,
      refTxRef: op.refTxRef,
    })
  }

  // A win the worker eventually delivered is a plain settled win again.
  private async settleBet(op: WalletOp): Promise<void> {
    if (op.kind !== 'CREDIT' || !op.betId) return
    await this.betRepo.restoreCashedOut(op.betId)
  }

  // The operator's replay response reports the balance as it was AT THE TIME of
  // the original movement, not the live one, so read the balance instead of
  // reusing what deliver() saw — otherwise a catch-up would push a stale number
  // to the player's screen.
  private async announceBalance(op: WalletOp): Promise<void> {
    try {
      const balance = await this.walletService.getBalance(op.playerId, op.currency)
      this.gateway.emitToUser(op.playerId, 'wallet:updated', { balance })
    } catch (err) {
      logger.warn('Could not announce the balance after an outbox catch-up', { txRef: op.txRef, error: (err as Error).message })
    }
  }

  private async handleFailure(op: WalletOp, err: unknown): Promise<void> {
    const reason = (err as Error).message
    // A deterministic answer (402 insufficient balance, 404 unknown wallet) will
    // not change by asking again — retrying it just delays the alert.
    const deterministic = err instanceof AppError && err.statusCode < 500

    if (!deterministic && op.attempts < MAX_ATTEMPTS) {
      const nextAttemptAt = new Date(Date.now() + backoffFor(op.attempts))
      await this.walletOpsRepo.scheduleRetry(op.txRef, nextAttemptAt, reason)
      logger.warn('Wallet op failed, retry scheduled', { txRef: op.txRef, kind: op.kind, attempts: op.attempts, nextAttemptAt, error: reason })
      return
    }

    await this.walletOpsRepo.markFailed(op.txRef, reason)
    // An undelivered win is money owed to the player, so the bet says so and
    // history stops claiming it was paid. A failed reversal leaves the bet
    // CANCELED — that status is still true — and the FAILED op is the record of
    // what is owed.
    if (op.kind === 'CREDIT' && op.betId) {
      await this.betRepo.markSettlementPending(op.betId)
    }
    logger.error('Wallet op abandoned, manual replay required', {
      txRef: op.txRef,
      kind: op.kind,
      betId: op.betId,
      playerId: op.playerId,
      amount: op.amount,
      attempts: op.attempts,
      deterministic,
      error: reason,
      retryWith: 'POST /api/admin/wallet-ops/retry',
    })
  }
}
