import { WalletOutboxWorker } from '@/modules/bets/wallet-outbox.worker'
import { IBetRepository } from '@/modules/bets/bet.repository.interface'
import { BetService } from '@/modules/bets/bet.service'
import { IWalletOpsRepository } from '@/modules/wallet-ops/wallet-ops.repository.interface'
import { WalletOp } from '@/modules/wallet-ops/wallet-op.types'
import { WalletService } from '@/modules/wallet/wallet.service'
import { AppError } from '@/shared/errors/AppError'
import { ErrorCode } from '@/shared/errors/error-codes'
import { GameGateway } from '@/socket/game.gateway'

const mockOpsRepo: jest.Mocked<Partial<IWalletOpsRepository>> = {
  claimBatch: jest.fn(),
  markConfirmed: jest.fn(),
  markFailed: jest.fn(),
  scheduleRetry: jest.fn(),
}

const mockBetRepo: jest.Mocked<Partial<IBetRepository>> = {
  markSettlementPending: jest.fn(),
  restoreCashedOut: jest.fn(),
}

const mockBetService: jest.Mocked<Partial<BetService>> = {
  abandonStake: jest.fn(),
}

const mockWalletService: jest.Mocked<Partial<WalletService>> = {
  credit: jest.fn(),
  rollback: jest.fn(),
  getBalance: jest.fn(),
}

const mockGateway: jest.Mocked<Partial<GameGateway>> = {
  emitToUser: jest.fn(),
}

const makeOp = (overrides: Partial<WalletOp> = {}): WalletOp => ({
  id: 'op1',
  kind: 'CREDIT',
  state: 'PENDING',
  txRef: 'round1:user1:1:win',
  refTxRef: null,
  betId: 'bet1',
  playerId: 'user1',
  currency: 'USD',
  amount: 250,
  roundId: 'round1',
  slotId: 1,
  attempts: 1,
  nextAttemptAt: new Date(),
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

let worker: WalletOutboxWorker

const build = () =>
  new WalletOutboxWorker(
    mockOpsRepo as IWalletOpsRepository,
    mockBetRepo as IBetRepository,
    mockBetService as BetService,
    mockWalletService as WalletService,
    mockGateway as GameGateway,
  )

beforeEach(() => {
  jest.clearAllMocks()
  worker = build()
})

// The drain loop is driven by a private setInterval; these tests reach it through
// the one public trigger the runtime uses (onModuleInit) plus fake timers.
const runOneTick = async () => {
  jest.useFakeTimers()
  worker.onModuleInit()
  jest.advanceTimersByTime(3_000)
  jest.useRealTimers()
  await worker.onModuleDestroy()
}

describe('WalletOutboxWorker', () => {
  it('delivers a claimed CREDIT, confirms it and announces the live balance', async () => {
    ;(mockOpsRepo.claimBatch as jest.Mock).mockResolvedValueOnce([makeOp()])
    ;(mockWalletService.credit as jest.Mock).mockResolvedValueOnce({ balance: 1250 })
    ;(mockWalletService.getBalance as jest.Mock).mockResolvedValueOnce(1250)

    await runOneTick()

    expect(mockWalletService.credit).toHaveBeenCalledWith(
      expect.objectContaining({ txRef: 'round1:user1:1:win', amount: 250 }),
    )
    expect(mockOpsRepo.markConfirmed).toHaveBeenCalledWith('round1:user1:1:win')
    // A replay reports the balance as of the ORIGINAL movement, so the worker must
    // read the live balance rather than reuse what credit() returned.
    expect(mockWalletService.getBalance).toHaveBeenCalledWith('user1', 'USD')
    expect(mockGateway.emitToUser).toHaveBeenCalledWith('user1', 'wallet:updated', { balance: 1250 })
    // A win delivered late is a plain settled win again.
    expect(mockBetRepo.restoreCashedOut).toHaveBeenCalledWith('bet1')
  })

  it('schedules a backoff retry on a transient failure', async () => {
    ;(mockOpsRepo.claimBatch as jest.Mock).mockResolvedValueOnce([makeOp({ attempts: 3 })])
    ;(mockWalletService.credit as jest.Mock).mockRejectedValueOnce(
      new AppError(503, ErrorCode.WALLET_UNAVAILABLE, 'down'),
    )

    await runOneTick()

    expect(mockOpsRepo.scheduleRetry).toHaveBeenCalledWith('round1:user1:1:win', expect.any(Date), 'down')
    expect(mockOpsRepo.markFailed).not.toHaveBeenCalled()
    expect(mockBetRepo.markSettlementPending).not.toHaveBeenCalled()
  })

  it('fails a deterministic refusal immediately instead of burning the budget', async () => {
    ;(mockOpsRepo.claimBatch as jest.Mock).mockResolvedValueOnce([makeOp({ attempts: 1 })])
    ;(mockWalletService.credit as jest.Mock).mockRejectedValueOnce(
      new AppError(404, ErrorCode.NOT_FOUND, 'No USD wallet'),
    )

    await runOneTick()

    expect(mockOpsRepo.scheduleRetry).not.toHaveBeenCalled()
    expect(mockOpsRepo.markFailed).toHaveBeenCalledWith('round1:user1:1:win', 'No USD wallet')
    expect(mockBetRepo.markSettlementPending).toHaveBeenCalledWith('bet1')
  })

  it('gives up once the retry budget is spent and flags the unpaid win', async () => {
    ;(mockOpsRepo.claimBatch as jest.Mock).mockResolvedValueOnce([makeOp({ attempts: 10 })])
    ;(mockWalletService.credit as jest.Mock).mockRejectedValueOnce(
      new AppError(503, ErrorCode.WALLET_UNAVAILABLE, 'still down'),
    )

    await runOneTick()

    expect(mockOpsRepo.markFailed).toHaveBeenCalledWith('round1:user1:1:win', 'still down')
    expect(mockBetRepo.markSettlementPending).toHaveBeenCalledWith('bet1')
  })

  it('leaves a failed ROLLBACK bet alone — CANCELED is still true', async () => {
    ;(mockOpsRepo.claimBatch as jest.Mock).mockResolvedValueOnce([
      makeOp({ kind: 'ROLLBACK', txRef: 'round1:user1:1:bet:rollback', refTxRef: 'round1:user1:1:bet', attempts: 10 }),
    ])
    ;(mockWalletService.rollback as jest.Mock).mockRejectedValueOnce(
      new AppError(503, ErrorCode.WALLET_UNAVAILABLE, 'down'),
    )

    await runOneTick()

    expect(mockOpsRepo.markFailed).toHaveBeenCalled()
    expect(mockBetRepo.markSettlementPending).not.toHaveBeenCalled()
  })

  it('compensates a stranded DEBIT instead of replaying it', async () => {
    const stranded = makeOp({ kind: 'DEBIT', txRef: 'round1:user1:1:bet', amount: 50, attempts: 1 })
    ;(mockOpsRepo.claimBatch as jest.Mock).mockResolvedValueOnce([stranded])

    await runOneTick()

    // Replaying it would charge a player for a round that is already over.
    expect(mockWalletService.credit).not.toHaveBeenCalled()
    expect(mockWalletService.rollback).not.toHaveBeenCalled()
    expect(mockBetService.abandonStake).toHaveBeenCalledWith(stranded, expect.stringContaining('stranded'))
  })

  it('stops claiming on shutdown and waits for the batch in flight', async () => {
    let releaseClaim: (ops: WalletOp[]) => void = () => undefined
    ;(mockOpsRepo.claimBatch as jest.Mock).mockReturnValueOnce(
      new Promise<WalletOp[]>((resolve) => {
        releaseClaim = resolve
      }),
    )

    jest.useFakeTimers()
    worker.onModuleInit()
    jest.advanceTimersByTime(3_000)
    jest.useRealTimers()

    let drained = false
    const shutdown = worker.onModuleDestroy().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false) // still waiting on the claimed batch

    releaseClaim([makeOp()])
    ;(mockWalletService.credit as jest.Mock).mockResolvedValueOnce({ balance: 10 })
    ;(mockWalletService.getBalance as jest.Mock).mockResolvedValueOnce(10)
    await shutdown

    expect(drained).toBe(true)
    expect(mockOpsRepo.markConfirmed).toHaveBeenCalled()
    // The interval is gone: advancing time must not claim again.
    jest.useFakeTimers()
    jest.advanceTimersByTime(30_000)
    jest.useRealTimers()
    expect(mockOpsRepo.claimBatch).toHaveBeenCalledTimes(1)
  })
})
