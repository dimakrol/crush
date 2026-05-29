import { BetService } from '@/modules/bets/bet.service'
import { IBetRepository } from '@/modules/bets/bet.repository.interface'
import { WalletService } from '@/modules/wallet/wallet.service'
import { AppError } from '@/shared/errors/AppError'
import { ErrorCode } from '@/shared/errors/error-codes'
import { Bet } from '@/modules/bets/bet.types'
import { Wallet } from '@/modules/wallet/wallet.types'

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
  resolveLosses: jest.fn(),
  cancelByUser: jest.fn(),
}

const mockWalletService: jest.Mocked<Partial<WalletService>> = {
  deductBalance: jest.fn(),
  addBalance: jest.fn(),
  getBalance: jest.fn(),
}

const makeWallet = (balance: number): Wallet => ({
  id: 'wallet1', userId: 'user1', balance, createdAt: new Date(), updatedAt: new Date(),
})

const makeBet = (overrides: Partial<Bet> = {}): Bet => ({
  id: 'bet1', userId: 'user1', roundId: 'round1', slotId: 1, amount: 50, autoCashOut: null,
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
    await expect(service.placeBet('user1', 1, 50, null)).rejects.toMatchObject({ code: ErrorCode.ROUND_NOT_WAITING })
  })

  it('rejects duplicate slot bet', async () => {
    redisMock.get
      .mockResolvedValueOnce('WAITING') // phase
      .mockResolvedValueOnce('round1')   // currentRound
    mockBetRepo.findBySlot.mockResolvedValueOnce(makeBet())
    await expect(service.placeBet('user1', 1, 50, null)).rejects.toMatchObject({ code: ErrorCode.BET_ALREADY_EXISTS })
  })

  it('rejects insufficient balance', async () => {
    redisMock.get
      .mockResolvedValueOnce('WAITING')
      .mockResolvedValueOnce('round1')
    mockBetRepo.findBySlot.mockResolvedValueOnce(null)
    ;(mockWalletService.deductBalance as jest.Mock).mockRejectedValueOnce(
      new AppError(400, ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient balance'),
    )
    await expect(service.placeBet('user1', 1, 50, null)).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_BALANCE })
  })

  it('creates bet and deducts balance', async () => {
    redisMock.get
      .mockResolvedValueOnce('WAITING')
      .mockResolvedValueOnce('round1')
    mockBetRepo.findBySlot.mockResolvedValueOnce(null)
    ;(mockWalletService.deductBalance as jest.Mock).mockResolvedValueOnce(makeWallet(950))
    mockBetRepo.create.mockResolvedValueOnce(makeBet())
    const result = await service.placeBet('user1', 1, 50, null)
    expect(result.balance).toBe(950)
    expect(mockBetRepo.create).toHaveBeenCalledTimes(1)
  })
})

describe('BetService.queueNextBet', () => {
  it('rejects when the round is not in progress (WAITING)', async () => {
    redisMock.get.mockResolvedValueOnce('WAITING') // phase
    await expect(service.queueNextBet('user1', 1, 50, null)).rejects.toMatchObject({
      code: ErrorCode.BET_QUEUE_NOT_ALLOWED,
    })
    expect(redisMock.hset).not.toHaveBeenCalled()
  })

  it('rejects when the slot already has a bet this round', async () => {
    redisMock.get
      .mockResolvedValueOnce('RUNNING') // phase
      .mockResolvedValueOnce('round1') // currentRound
    mockBetRepo.findBySlot.mockResolvedValueOnce(makeBet())
    await expect(service.queueNextBet('user1', 1, 50, null)).rejects.toMatchObject({
      code: ErrorCode.BET_QUEUE_NOT_ALLOWED,
    })
    expect(redisMock.hset).not.toHaveBeenCalled()
  })

  it('stores the intent in the queue hash when mid-round and slot is free', async () => {
    redisMock.get
      .mockResolvedValueOnce('RUNNING') // phase
      .mockResolvedValueOnce('round1') // currentRound
    mockBetRepo.findBySlot.mockResolvedValueOnce(null)
    const result = await service.queueNextBet('user1', 2, 75, 2.5)
    expect(result).toEqual({ slotId: 2, amount: 75, autoCashOut: 2.5 })
    expect(redisMock.hset).toHaveBeenCalledWith('queue:next', 'user1:2', JSON.stringify({ amount: 75, autoCashOut: 2.5 }))
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
      'user1:1': JSON.stringify({ amount: 50, autoCashOut: null }),
      'user2:2': JSON.stringify({ amount: 999, autoCashOut: null }),
    })
    // user1 places fine; placeBet reads phase + currentRound from redis each call.
    redisMock.get
      .mockResolvedValueOnce('WAITING') // user1 phase
      .mockResolvedValueOnce('round2') // user1 currentRound
      .mockResolvedValueOnce('WAITING') // user2 phase
      .mockResolvedValueOnce('round2') // user2 currentRound
    mockBetRepo.findBySlot.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    ;(mockWalletService.deductBalance as jest.Mock)
      .mockResolvedValueOnce(makeWallet(950))
      .mockRejectedValueOnce(new AppError(400, ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient balance'))
    mockBetRepo.create.mockResolvedValueOnce(makeBet({ userId: 'user1', slotId: 1 }))

    const outcomes = await service.consumeNextRoundQueue()

    expect(redisMock.del).toHaveBeenCalledWith('queue:next')
    expect(outcomes).toContainEqual(expect.objectContaining({ ok: true, userId: 'user1', slotId: 1 }))
    expect(outcomes).toContainEqual(
      expect.objectContaining({ ok: false, userId: 'user2', slotId: 2, code: ErrorCode.INSUFFICIENT_BALANCE }),
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

  it('calculates payout using server multiplier and updates bet and wallet', async () => {
    redisMock.get
      .mockResolvedValueOnce('RUNNING')
      .mockResolvedValueOnce('2.50')
    mockBetRepo.findById.mockResolvedValueOnce(makeBet({ amount: 100 }))
    mockBetRepo.cashOut.mockResolvedValueOnce(makeBet({ status: 'CASHED_OUT', cashOutMultiplier: 2.5, payout: 250 }))
    ;(mockWalletService.addBalance as jest.Mock).mockResolvedValueOnce(makeWallet(1250))
    const result = await service.cashOut('user1', 'bet1')
    expect(result.bet.payout).toBe(250)
    expect(result.balance).toBe(1250)
    expect(mockWalletService.addBalance).toHaveBeenCalledWith('user1', 250)
  })
})
