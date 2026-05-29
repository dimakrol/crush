import { IBaseRepository } from '@/shared/repositories/base.repository';
import { Bet, BetSlotId } from './bet.types';

export const BET_REPOSITORY = 'BET_REPOSITORY';

export interface IBetRepository extends IBaseRepository<Bet> {
  create(data: Omit<Bet, 'id'>): Promise<Bet>;
  findBySlot(
    roundId: string,
    userId: string,
    slotId: BetSlotId,
  ): Promise<Bet | null>;
  findActiveByRound(roundId: string): Promise<Bet[]>;
  findActiveByUser(userId: string, roundId: string): Promise<Bet[]>;
  findByUser(
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ bets: Bet[]; nextCursor: string | null }>;
  cashOut(
    betId: string,
    multiplier: number,
    payout: number,
  ): Promise<Bet | null>;
  resolveLosses(roundId: string): Promise<Bet[]>;
  cancelByUser(userId: string, roundId: string): Promise<void>;
}
