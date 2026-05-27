import { Inject, Injectable } from '@nestjs/common'
import { getRedis } from '../../config/redis'
import { AppError } from '../../shared/errors/AppError'
import { ErrorCode } from '../../shared/errors/error-codes'
import { calculatePayout, isValidBetAmount } from '../../shared/utils/money'
import { WalletService } from '../wallet/wallet.service'
import { BET_REPOSITORY, IBetRepository } from './bet.repository.interface'
import { Bet, BetSlotId } from './bet.types'

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
}
