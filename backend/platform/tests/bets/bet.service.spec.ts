import { BetService } from '@/modules/bets/bet.service'
import { IBetRepository } from '@/modules/bets/bet.repository.interface'
import { IWalletOpsRepository } from '@/modules/wallet-ops/wallet-ops.repository.interface'
import { WalletService } from '@/modules/wallet/wallet.service'
import { AppError } from '@/shared/errors/AppError'
import { DuplicateKeyError } from '@/shared/errors/duplicate-key.error'
import { ErrorCode } from '@/shared/errors/error-codes'
import { IUnitOfWork, TxContext } from '@/shared/repositories/unit-of-work'
import { Bet } from '@/modules/bets/bet.types'

const redisMock = {
  get: jest.fn(),
  set: jest.fn(),
  hset: jest.fn(),
  hdel: jest.fn(),
  hgetall: jest.fn(),
  del: jest.fn(),
}

jest.mock('@/config/redis', () => ({
  getRedis: () => redisMock,
}))

const mockBetRepo: jest.Mocked<IBetRepository> = {
  findById: jest.fn(),
  create: jest.fn(),
  findBySlot: jest.fn(),
  findActiveByUser: jest.fn(),
  findByUser: jest.fn(),
  cashOut: jest.fn(),
  cashOutAuto: jest.fn(),
  cancelPlaced: jest.fn(),
  resolveLosses: jest.fn(),
  cancelByUser: jest.fn(),
  findAllUnsettled: jest.fn(),
  markPlaced: jest.fn(),
  markRejected: jest.fn(),
  markStakeCanceled: jest.fn(),
  markCanceled: jest.fn(),
  markSettlementPending: jest.fn(),
  restoreCashedOut: jest.fn(),
}

// Money outbox: every delegated move is recorded here before the network call.
const mockWalletOpsRepo: jest.Mocked<IWalletOpsRepository> = {
  enqueue: jest.fn(),
  enqueueMany: jest.fn(),
  claimBatch: jest.fn(),
  markConfirmed: jest.fn(),
  markFailed: jest.fn(),
  scheduleRetry: jest.fn(),
  findByTxRef: jest.fn(),
  revive: jest.fn(),
}

// Runs the unit of work inline: what these tests check is which writes happen and
// in what order, not the transaction itself.
const mockUow: IUnitOfWork = {
  run: <T>(work: (ctx: TxContext) => Promise<T>) => work({ _executor: null }),
}

// The wallet is a thin client of the white-label: context-carrying
// debit/credit/rollback returning { balance } in decimal currency.
const mockWalletService: jest.Mocked<Partial<WalletService>> = {
  debit: jest.fn(),
  credit: jest.fn(),
  rollback: jest.fn(),
  getBalance: jest.fn(),
}

const makeBet = (overrides: Partial<Bet> = {}): Bet => ({
  id: 'bet1', userId: 'user1', currency: 'USD', roundId: 'round1', slotId: 1, amount: 50, autoCashOut: null,
  status: 'PLACED', cashOutMultiplier: null, payout: 0, placedAt: new Date(),
  cashedOutAt: null, resolvedAt: null, ...overrides,
})

let service: BetService

beforeEach(() => {
  jest.clearAllMocks()
  service = new BetService(
    mockBetRepo,
    mockWalletOpsRepo,
    mockUow,
    mockWalletService as unknown as WalletService,
  )
})

describe('BetService.placeBet', () => {
  it('rejects when phase is not WAITING', async () => {
    redisMock.get.mockResolvedValueOnce('RUNNING')
    await expect(service.placeBet('user1', 'USD', 1, 50, null)).rejects.toMatchObject({ code: ErrorCode.ROUND_NOT_WAITING })
  })

  it('rejects duplicate slot bet', async () => {
    redisMock.get
      .mockResolvedValueOnce('WAITING') // phase
      .mockResolvedValueOnce('round1')   // currentRound
    mockBetRepo.findBySlot.mockResolvedValueOnce(makeBet())
    await expect(service.placeBet('user1', 'USD', 1, 50, null)).rejects.toMatchObject({ code: ErrorCode.BET_ALREADY_EXISTS })
    expect(mockWalletService.debit).not.toHaveBeenCalled()
  })

  it('records the intent and the DEBIT op before calling the operator', async () => {
    redisMock.get
      .mockResolvedValueOnce('WAITING')
      .mockResolvedValueOnce('round1')
    mockBetRepo.findBySlot.mockResolvedValueOnce(null)
    mockBetRepo.create.mockResolvedValueOnce(makeBet({ status: 'PENDING_STAKE' }))
    ;(mockWalletService.debit as jest.Mock).mockResolvedValueOnce({ balance: 950 })
    mockBetRepo.markPlaced.mockResolvedValueOnce(makeBet())

    const result = await service.placeBet('user1', 'USD', 1, 50, null)

    expect(result.balance).toBe(950)
    expect(result.bet.status).toBe('PLACED')
    expect(mockBetRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PENDING_STAKE' }),
      expect.anything(),
    )
    expect(mockWalletOpsRepo.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'DEBIT', txRef: 'round1:user1:1:bet', amount: 50, betId: 'bet1' }),
      expect.anything(),
    )
    expect(mockWalletService.debit).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'user1', currency: 'USD', amount: 50, txRef: 'round1:user1:1:bet' }),
    )
    expect(mockWalletOpsRepo.markConfirmed).toHaveBeenCalledWith('round1:user1:1:bet', expect.anything())
  })

  it('leaves the DEBIT op unclaimable while it attempts the debit inline', async () => {
    redisMock.get
      .mockResolvedValueOnce('WAITING')
      .mockResolvedValueOnce('round1')
    mockBetRepo.findBySlot.mockResolvedValueOnce(null)
    mockBetRepo.create.mockResolvedValueOnce(makeBet({ status: 'PENDING_STAKE' }))
    ;(mockWalletService.debit as jest.Mock).mockResolvedValueOnce({ balance: 950 })
    mockBetRepo.markPlaced.mockResolvedValueOnce(makeBet())

    await service.placeBet('user1', 'USD', 1, 50, null)

    const [op] = mockWalletOpsRepo.enqueue.mock.calls[0]
    expect(op.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 30_000)
  })

  it('rejects the stake and frees the slot on a deterministic refusal (no retry on 4xx)', async () => {
    redisMock.get
      .mockResolvedValueOnce('WAITING')
      .mockResolvedValueOnce('round1')
    mockBetRepo.findBySlot.mockResolvedValueOnce(null)
    mockBetRepo.create.mockResolvedValueOnce(makeBet({ status: 'PENDING_STAKE' }))
    ;(mockWalletService.debit as jest.Mock).mockRejectedValueOnce(
      new AppError(402, ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient balance'),
    )

    await expect(service.placeBet('user1', 'USD', 1, 50, null)).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_BALANCE })

    expect(mockWalletService.debit).toHaveBeenCalledTimes(1)
    // No money moved, so the trace is REJECTED (which the partial unique index
    // ignores) and nothing has to be reversed.
    expect(mockBetRepo.markRejected).toHaveBeenCalledWith('bet1', expect.anything())
    expect(mockBetRepo.markStakeCanceled).not.toHaveBeenCalled()
    expect(mockWalletOpsRepo.markFailed).toHaveBeenCalledWith('round1:user1:1:bet', 'Insufficient balance', expect.anything())
    expect(mockWalletOpsRepo.enqueue).toHaveBeenCalledTimes(1) // the DEBIT only
  })

  it('queues a reversal and holds the slot when the debit outcome is unknown', async () => {
    redisMock.get
      .mockResolvedValueOnce('WAITING')
      .mockResolvedValueOnce('round1')
    mockBetRepo.findBySlot.mockResolvedValueOnce(null)
    mockBetRepo.create.mockResolvedValueOnce(makeBet({ status: 'PENDING_STAKE' }))
    ;(mockWalletService.debit as jest.Mock).mockRejectedValue(
      new AppError(503, ErrorCode.WALLET_UNAVAILABLE, 'Wallet service unreachable'),
    )

    await expect(service.placeBet('user1', 'USD', 1, 50, null)).rejects.toMatchObject({ code: ErrorCode.WALLET_UNAVAILABLE })

    // CANCELED, not REJECTED: the debit may have landed, and a retry would reuse
    // the same txRef — which the white-label would replay without charging.
    expect(mockBetRepo.markStakeCanceled).toHaveBeenCalledWith('bet1', expect.anything())
    expect(mockBetRepo.markRejected).not.toHaveBeenCalled()
    expect(mockWalletOpsRepo.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ROLLBACK', txRef: 'round1:user1:1:bet:rollback', refTxRef: 'round1:user1:1:bet' }),
      expect.anything(),
    )
    // The reversal is the worker's job — nothing is called inline here.
    expect(mockWalletService.rollback).not.toHaveBeenCalled()
  })

  it('never touches money when the slot race is lost', async () => {
    redisMock.get
      .mockResolvedValueOnce('WAITING')
      .mockResolvedValueOnce('round1')
    mockBetRepo.findBySlot.mockResolvedValueOnce(null)
    // The repository is the seam that translates the native unique violation
    // (Postgres SQLSTATE 23505) into a storage-agnostic DuplicateKeyError.
    mockBetRepo.create.mockRejectedValueOnce(new DuplicateKeyError())

    await expect(service.placeBet('user1', 'USD', 1, 50, null)).rejects.toMatchObject({ code: ErrorCode.BET_ALREADY_EXISTS })

    // The index decides the race BEFORE any money moves, so there is nothing to
    // compensate — the old skip-the-rollback special case is gone.
    expect(mockWalletService.debit).not.toHaveBeenCalled()
    expect(mockWalletService.rollback).not.toHaveBeenCalled()
  })
})

describe('BetService.queueNextBet', () => {
  it('rejects when the round is not in progress (WAITING)', async () => {
    redisMock.get.mockResolvedValueOnce('WAITING') // phase
    await expect(service.queueNextBet('user1', 'USD', 1, 50, null)).rejects.toMatchObject({
      code: ErrorCode.BET_QUEUE_NOT_ALLOWED,
    })
    expect(redisMock.hset).not.toHaveBeenCalled()
  })

  it('rejects when the slot already has an active bet this round', async () => {
    redisMock.get
      .mockResolvedValueOnce('RUNNING') // phase
      .mockResolvedValueOnce('round1') // currentRound
    mockBetRepo.findBySlot.mockResolvedValueOnce(makeBet())
    await expect(service.queueNextBet('user1', 'USD', 1, 50, null)).rejects.toMatchObject({
      code: ErrorCode.BET_QUEUE_NOT_ALLOWED,
    })
    expect(redisMock.hset).not.toHaveBeenCalled()
  })

  it('allows queueing after the current-round bet was cashed out', async () => {
    redisMock.get
      .mockResolvedValueOnce('RUNNING') // phase
      .mockResolvedValueOnce('round1') // currentRound
    mockBetRepo.findBySlot.mockResolvedValueOnce(makeBet({ status: 'CASHED_OUT' }))
    const result = await service.queueNextBet('user1', 'USD', 1, 50, null)
    expect(result).toEqual({ slotId: 1, amount: 50, autoCashOut: null })
    expect(redisMock.hset).toHaveBeenCalledWith('queue:next', 'user1:1', JSON.stringify({ amount: 50, autoCashOut: null, currency: 'USD' }))
  })

  it('stores the intent (with currency) in the queue hash when mid-round and slot is free', async () => {
    redisMock.get
      .mockResolvedValueOnce('RUNNING') // phase
      .mockResolvedValueOnce('round1') // currentRound
    mockBetRepo.findBySlot.mockResolvedValueOnce(null)
    const result = await service.queueNextBet('user1', 'USD', 2, 75, 2.5)
    expect(result).toEqual({ slotId: 2, amount: 75, autoCashOut: 2.5 })
    expect(redisMock.hset).toHaveBeenCalledWith('queue:next', 'user1:2', JSON.stringify({ amount: 75, autoCashOut: 2.5, currency: 'USD' }))
  })
})

describe('BetService.consumeNextRoundQueue', () => {
  it('returns empty and does not clear when the queue is empty', async () => {
    redisMock.hgetall.mockResolvedValueOnce({})
    const outcomes = await service.consumeNextRoundQueue()
    expect(outcomes).toEqual([])
    expect(redisMock.del).not.toHaveBeenCalled()
  })

  it('places each queued intent and reports success/failure per entry', async () => {
    redisMock.hgetall.mockResolvedValueOnce({
      'user1:1': JSON.stringify({ amount: 50, autoCashOut: null, currency: 'USD' }),
      'user2:2': JSON.stringify({ amount: 999, autoCashOut: null, currency: 'USD' }),
    })
    // user1 places fine; placeBet reads phase + currentRound from redis each call.
    redisMock.get
      .mockResolvedValueOnce('WAITING') // user1 phase
      .mockResolvedValueOnce('round2') // user1 currentRound
      .mockResolvedValueOnce('WAITING') // user2 phase
      .mockResolvedValueOnce('round2') // user2 currentRound
    mockBetRepo.findBySlot.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    mockBetRepo.create
      .mockResolvedValueOnce(makeBet({ userId: 'user1', slotId: 1, status: 'PENDING_STAKE' }))
      .mockResolvedValueOnce(makeBet({ id: 'bet2', userId: 'user2', slotId: 2, status: 'PENDING_STAKE' }))
    ;(mockWalletService.debit as jest.Mock)
      .mockResolvedValueOnce({ balance: 950 })
      .mockRejectedValueOnce(new AppError(402, ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient balance'))
    mockBetRepo.markPlaced.mockResolvedValueOnce(makeBet({ userId: 'user1', slotId: 1 }))

    const outcomes = await service.consumeNextRoundQueue()

    expect(redisMock.del).toHaveBeenCalledWith('queue:next')
    expect(outcomes).toContainEqual(expect.objectContaining({ ok: true, userId: 'user1', slotId: 1 }))
    expect(outcomes).toContainEqual(
      expect.objectContaining({ ok: false, userId: 'user2', slotId: 2, code: ErrorCode.INSUFFICIENT_BALANCE }),
    )
  })
})

describe('BetService.cancelBet', () => {
  it('rejects when phase is not WAITING', async () => {
    redisMock.get.mockResolvedValueOnce('RUNNING')
    await expect(service.cancelBet('user1', 'bet1')).rejects.toMatchObject({ code: ErrorCode.ROUND_NOT_WAITING })
  })

  it('rejects another user or stale round bet', async () => {
    redisMock.get
      .mockResolvedValueOnce('WAITING')
      .mockResolvedValueOnce('round2')
    mockBetRepo.findById.mockResolvedValueOnce(makeBet({ roundId: 'round1' }))
    await expect(service.cancelBet('user1', 'bet1')).rejects.toMatchObject({ code: ErrorCode.BET_NOT_FOUND })
    expect(mockBetRepo.cancelPlaced).not.toHaveBeenCalled()
  })

  it('records the reversal with the cancellation, then rolls the debit back', async () => {
    redisMock.get
      .mockResolvedValueOnce('WAITING')
      .mockResolvedValueOnce('round1')
    mockBetRepo.findById.mockResolvedValueOnce(makeBet())
    mockBetRepo.cancelPlaced.mockResolvedValueOnce(makeBet({ status: 'CANCELED' }))
    ;(mockWalletService.rollback as jest.Mock).mockResolvedValueOnce({ balance: 1000 })

    const result = await service.cancelBet('user1', 'bet1')

    expect(result.balance).toBe(1000)
    expect(mockBetRepo.cancelPlaced).toHaveBeenCalledWith('bet1', 'user1', expect.anything())
    expect(mockWalletOpsRepo.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ROLLBACK', txRef: 'round1:user1:1:bet:rollback', refTxRef: 'round1:user1:1:bet' }),
      expect.anything(),
    )
    expect(mockWalletService.rollback).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'user1', currency: 'USD', refTxRef: 'round1:user1:1:bet' }),
    )
    expect(mockWalletOpsRepo.markConfirmed).toHaveBeenCalledWith('round1:user1:1:bet:rollback')
  })

  it('leaves the reversal to the worker and reports the live balance when it fails', async () => {
    redisMock.get
      .mockResolvedValueOnce('WAITING')
      .mockResolvedValueOnce('round1')
    mockBetRepo.findById.mockResolvedValueOnce(makeBet())
    mockBetRepo.cancelPlaced.mockResolvedValueOnce(makeBet({ status: 'CANCELED' }))
    ;(mockWalletService.rollback as jest.Mock).mockRejectedValue(
      new AppError(503, ErrorCode.WALLET_UNAVAILABLE, 'down'),
    )
    ;(mockWalletService.getBalance as jest.Mock).mockResolvedValueOnce(950)

    const result = await service.cancelBet('user1', 'bet1')

    expect(result.bet.status).toBe('CANCELED')
    expect(result.balance).toBe(950)
    expect(mockWalletOpsRepo.markConfirmed).not.toHaveBeenCalled()
  })
})

describe('BetService.cashOut', () => {
  it('rejects when phase is not RUNNING', async () => {
    redisMock.get.mockResolvedValueOnce('WAITING')
    await expect(service.cashOut('user1', 'bet1')).rejects.toMatchObject({ code: ErrorCode.ROUND_NOT_RUNNING })
  })

  it('rejects already resolved bet', async () => {
    redisMock.get
      .mockResolvedValueOnce('RUNNING')  // phase
      .mockResolvedValueOnce('2.50')     // currentMultiplier
    mockBetRepo.findById.mockResolvedValueOnce(makeBet({ status: 'CASHED_OUT' }))
    await expect(service.cashOut('user1', 'bet1')).rejects.toMatchObject({ code: ErrorCode.BET_ALREADY_RESOLVED })
  })

  it('marks the bet and records the CREDIT op in one commit, then credits the win', async () => {
    redisMock.get
      .mockResolvedValueOnce('RUNNING')
      .mockResolvedValueOnce('2.50')
    mockBetRepo.findById.mockResolvedValueOnce(makeBet({ amount: 100 }))
    mockBetRepo.cashOut.mockResolvedValueOnce(makeBet({ status: 'CASHED_OUT', cashOutMultiplier: 2.5, payout: 250 }))
    ;(mockWalletService.credit as jest.Mock).mockResolvedValueOnce({ balance: 1250 })

    const result = await service.cashOut('user1', 'bet1')

    expect(result.bet.payout).toBe(250)
    expect(result.balance).toBe(1250)
    expect(mockBetRepo.cashOut).toHaveBeenCalledWith('bet1', 2.5, 250, expect.anything())
    expect(mockWalletOpsRepo.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'CREDIT', txRef: 'round1:user1:1:win', amount: 250 }),
      expect.anything(),
    )
    expect(mockWalletService.credit).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'user1', currency: 'USD', amount: 250, txRef: 'round1:user1:1:win' }),
    )
    expect(mockWalletOpsRepo.markConfirmed).toHaveBeenCalledWith('round1:user1:1:win')
  })

  it('leaves the op PENDING for the worker instead of flagging the bet when the credit fails', async () => {
    redisMock.get
      .mockResolvedValueOnce('RUNNING')
      .mockResolvedValueOnce('2.50')
    mockBetRepo.findById.mockResolvedValueOnce(makeBet({ amount: 100 }))
    mockBetRepo.cashOut.mockResolvedValueOnce(makeBet({ status: 'CASHED_OUT', cashOutMultiplier: 2.5, payout: 250 }))
    ;(mockWalletService.credit as jest.Mock).mockRejectedValue(
      new AppError(503, ErrorCode.WALLET_UNAVAILABLE, 'down'),
    )
    ;(mockWalletService.getBalance as jest.Mock).mockResolvedValueOnce(1000)

    const result = await service.cashOut('user1', 'bet1')

    expect(result.balance).toBe(1000)
    expect(mockWalletOpsRepo.markConfirmed).not.toHaveBeenCalled()
    // SETTLEMENT_PENDING now means "the worker gave up", not "one attempt missed".
    expect(mockBetRepo.markSettlementPending).not.toHaveBeenCalled()
  })
})

describe('BetService.markAutoCashouts', () => {
  it('records a CREDIT op for every bet the set-based update resolved', async () => {
    const resolved = [
      makeBet({ id: 'betA', status: 'CASHED_OUT', cashOutMultiplier: 1.5, payout: 75 }),
      makeBet({ id: 'betB', userId: 'user2', slotId: 2, status: 'CASHED_OUT', cashOutMultiplier: 1.5, payout: 30 }),
    ]
    mockBetRepo.cashOutAuto.mockResolvedValueOnce(resolved)

    const marked = await service.markAutoCashouts('round1', 1.5)

    expect(marked).toEqual(resolved)
    // One statement for the whole round: this runs inside the 100ms tick.
    expect(mockWalletOpsRepo.enqueueMany).toHaveBeenCalledTimes(1)
    const [ops] = mockWalletOpsRepo.enqueueMany.mock.calls[0]
    expect(ops).toEqual([
      expect.objectContaining({ kind: 'CREDIT', txRef: 'round1:user1:1:win', amount: 75, betId: 'betA' }),
      expect.objectContaining({ kind: 'CREDIT', txRef: 'round1:user2:2:win', amount: 30, betId: 'betB' }),
    ])
    // The payout queued is the one the database wrote, never a recomputed number.
    expect(mockWalletService.credit).not.toHaveBeenCalled()
  })
})

describe('BetService.recoverOpenBets', () => {
  it('queues a reversal for an orphaned PLACED bet without calling the operator', async () => {
    mockBetRepo.findAllUnsettled.mockResolvedValueOnce([makeBet()])

    const recovered = await service.recoverOpenBets()

    expect(recovered).toBe(1)
    expect(mockBetRepo.markCanceled).toHaveBeenCalledWith('bet1', expect.anything())
    expect(mockWalletOpsRepo.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ROLLBACK', txRef: 'round1:user1:1:bet:rollback', amount: 50 }),
      expect.anything(),
    )
    // Boot must not block on a possibly-down operator; the worker delivers.
    expect(mockWalletService.rollback).not.toHaveBeenCalled()
  })

  it('abandons a PENDING_STAKE bet whose debit outcome was never learned', async () => {
    mockBetRepo.findAllUnsettled.mockResolvedValueOnce([makeBet({ status: 'PENDING_STAKE' })])

    const recovered = await service.recoverOpenBets()

    expect(recovered).toBe(1)
    expect(mockBetRepo.markStakeCanceled).toHaveBeenCalledWith('bet1', expect.anything())
    expect(mockWalletOpsRepo.markFailed).toHaveBeenCalledWith(
      'round1:user1:1:bet',
      expect.stringContaining('restarted'),
      expect.anything(),
    )
    expect(mockWalletOpsRepo.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ROLLBACK', refTxRef: 'round1:user1:1:bet' }),
      expect.anything(),
    )
  })
})
