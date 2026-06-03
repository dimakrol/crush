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
  cancelPlaced(betId: string, userId: string): Promise<Bet | null>;
  resolveLosses(roundId: string): Promise<Bet[]>;
  cancelByUser(userId: string, roundId: string): Promise<void>;
  // Recovery: every still-PLACED bet across all rounds. On a clean boot this is
  // empty; after an interrupted round these are debited-but-unresolved orphans.
  findAllPlaced(): Promise<Bet[]>;
  markCanceled(betId: string): Promise<void>;
  markSettlementPending(betId: string): Promise<void>;
}
