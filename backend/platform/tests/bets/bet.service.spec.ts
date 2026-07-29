import { BetService } from '@/modules/bets/bet.service'
import { IBetRepository } from '@/modules/bets/bet.repository.interface'
import { WalletService } from '@/modules/wallet/wallet.service'
import { AppError } from '@/shared/errors/AppError'
import { DuplicateKeyError } from '@/shared/errors/duplicate-key.error'
import { ErrorCode } from '@/shared/errors/error-codes'
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
  findActiveByRound: jest.fn(),
  findActiveByUser: jest.fn(),
  findByUser: jest.fn(),
  cashOut: jest.fn(),
  cancelPlaced: jest.fn(),
  resolveLosses: jest.fn(),
  cancelByUser: jest.fn(),
  findAllPlaced: jest.fn(),
  markCanceled: jest.fn(),
  markSettlementPending: jest.fn(),
}

// The wallet is now a thin client of the white-label: context-carrying
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
  service = new BetService(mockBetRepo, mockWalletService as unknown as WalletService)
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
  })

  it('rejects insufficient balance from the operator (no retry on 4xx)', async () => {
    redisMock.get
      .mockResolvedValueOnce('WAITING')
      .mockResolvedValueOnce('round1')
    mockBetRepo.findBySlot.mockResolvedValueOnce(null)
    ;(mockWalletService.debit as jest.Mock).mockRejectedValueOnce(
      new AppError(402, ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient balance'),
    )
    await expect(service.placeBet('user1', 'USD', 1, 50, null)).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_BALANCE })
    expect(mockBetRepo.create).not.toHaveBeenCalled()
    expect(mockWalletService.debit).toHaveBeenCalledTimes(1)
  })

  it('debits the operator then creates the bet with an idempotent txRef', async () => {
    redisMock.get
      .mockResolvedValueOnce('WAITING')
      .mockResolvedValueOnce('round1')
    mockBetRepo.findBySlot.mockResolvedValueOnce(null)
    ;(mockWalletService.debit as jest.Mock).mockResolvedValueOnce({ balance: 950 })
    mockBetRepo.create.mockResolvedValueOnce(makeBet())
    const result = await service.placeBet('user1', 'USD', 1, 50, null)
    expect(result.balance).toBe(950)
    expect(mockBetRepo.create).toHaveBeenCalledTimes(1)
    expect(mockWalletService.debit).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'user1', currency: 'USD', amount: 50, txRef: 'round1:user1:1:bet' }),
    )
  })

  it('rolls back the debit when bet persistence fails', async () => {
    redisMock.get
      .mockResolvedValueOnce('WAITING')
      .mockResolvedValueOnce('round1')
    mockBetRepo.findBySlot.mockResolvedValueOnce(null)
    ;(mockWalletService.debit as jest.Mock).mockResolvedValueOnce({ balance: 950 })
    mockBetRepo.create.mockRejectedValueOnce(new Error('database down'))
    ;(mockWalletService.rollback as jest.Mock).mockResolvedValueOnce({ balance: 1000 })
    await expect(service.placeBet('user1', 'USD', 1, 50, null)).rejects.toThrow('database down')
    expect(mockWalletService.rollback).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'user1', currency: 'USD', refTxRef: 'round1:user1:1:bet' }),
    )
  })

  it('does NOT roll back when persistence fails on a duplicate-key race', async () => {
    redisMock.get
      .mockResolvedValueOnce('WAITING')
      .mockResolvedValueOnce('round1')
    mockBetRepo.findBySlot.mockResolvedValueOnce(null)
    ;(mockWalletService.debit as jest.Mock).mockResolvedValueOnce({ balance: 950 })
    // The repository is the seam that translates the native unique violation
    // (Postgres SQLSTATE 23505) into a storage-agnostic DuplicateKeyError.
    mockBetRepo.create.mockRejectedValueOnce(new DuplicateKeyError())
    await expect(service.placeBet('user1', 'USD', 1, 50, null)).rejects.toMatchObject({ code: ErrorCode.BET_ALREADY_EXISTS })
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
    ;(mockWalletService.debit as jest.Mock)
      .mockResolvedValueOnce({ balance: 950 })
      .mockRejectedValueOnce(new AppError(402, ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient balance'))
    mockBetRepo.create.mockResolvedValueOnce(makeBet({ userId: 'user1', slotId: 1 }))

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

  it('marks the bet canceled then rolls back the debit txRef', async () => {
    redisMock.get
      .mockResolvedValueOnce('WAITING')
      .mockResolvedValueOnce('round1')
    mockBetRepo.findById.mockResolvedValueOnce(makeBet())
    mockBetRepo.cancelPlaced.mockResolvedValueOnce(makeBet({ status: 'CANCELED' }))
    ;(mockWalletService.rollback as jest.Mock).mockResolvedValueOnce({ balance: 1000 })
    const result = await service.cancelBet('user1', 'bet1')
    expect(result.balance).toBe(1000)
    expect(mockBetRepo.cancelPlaced).toHaveBeenCalledWith('bet1', 'user1')
    expect(mockWalletService.rollback).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'user1', currency: 'USD', refTxRef: 'round1:user1:1:bet' }),
    )
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

  it('calculates payout using server multiplier, marks the bet, then credits the win', async () => {
    redisMock.get
      .mockResolvedValueOnce('RUNNING')
      .mockResolvedValueOnce('2.50')
    mockBetRepo.findById.mockResolvedValueOnce(makeBet({ amount: 100 }))
    mockBetRepo.cashOut.mockResolvedValueOnce(makeBet({ status: 'CASHED_OUT', cashOutMultiplier: 2.5, payout: 250 }))
    ;(mockWalletService.credit as jest.Mock).mockResolvedValueOnce({ balance: 1250 })
    const result = await service.cashOut('user1', 'bet1')
    expect(result.bet.payout).toBe(250)
    expect(result.balance).toBe(1250)
    expect(mockWalletService.credit).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'user1', currency: 'USD', amount: 250, txRef: 'round1:user1:1:win' }),
    )
  })

  it('marks SETTLEMENT_PENDING and returns live balance when the credit fails', async () => {
    redisMock.get
      .mockResolvedValueOnce('RUNNING')
      .mockResolvedValueOnce('2.50')
    mockBetRepo.findById.mockResolvedValueOnce(makeBet({ amount: 100 }))
    mockBetRepo.cashOut.mockResolvedValueOnce(makeBet({ status: 'CASHED_OUT', cashOutMultiplier: 2.5, payout: 250 }))
    ;(mockWalletService.credit as jest.Mock).mockRejectedValue(
      new AppError(503, ErrorCode.WALLET_UNAVAILABLE, 'down'),
    )
    mockBetRepo.markSettlementPending.mockResolvedValueOnce(undefined)
    ;(mockWalletService.getBalance as jest.Mock).mockResolvedValueOnce(1000)
    const result = await service.cashOut('user1', 'bet1')
    expect(result.balance).toBe(1000)
    expect(mockBetRepo.markSettlementPending).toHaveBeenCalledWith('bet1')
  })
})
