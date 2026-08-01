import { IBaseRepository } from '@/shared/repositories/base.repository';
import { TxContext } from '@/shared/repositories/unit-of-work';
import { Bet, BetSlotId } from './bet.types';

export const BET_REPOSITORY = 'BET_REPOSITORY';

// Methods that change a bet's money-bearing state take an optional TxContext so
// the caller can commit them together with the wallet_ops row that justifies the
// change. Everything else is a single autocommit statement.
export interface IBetRepository extends IBaseRepository<Bet> {
  create(data: Omit<Bet, 'id'>, ctx?: TxContext): Promise<Bet>;
  findBySlot(
    roundId: string,
    userId: string,
    slotId: BetSlotId,
  ): Promise<Bet | null>;
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
    ctx?: TxContext,
  ): Promise<Bet | null>;
  // Auto-cashout for a whole round in ONE statement: every PLACED bet whose
  // autoCashOut the multiplier just crossed is resolved and returned, payout
  // computed in SQL. Called from inside the 100ms tick, so it must stay a single
  // round-trip — never a read-then-write-per-bet loop.
  cashOutAuto(
    roundId: string,
    multiplier: number,
    ctx?: TxContext,
  ): Promise<Bet[]>;
  cancelPlaced(
    betId: string,
    userId: string,
    ctx?: TxContext,
  ): Promise<Bet | null>;
  resolveLosses(roundId: string): Promise<Bet[]>;
  cancelByUser(userId: string, roundId: string): Promise<void>;
  // Recovery: every bet across all rounds whose money question is still open —
  // PLACED (stake taken, round never resolved) and PENDING_STAKE (stake outcome
  // unknown). On a clean boot this is empty.
  findAllUnsettled(): Promise<Bet[]>;
  // Stake handshake outcomes, all guarded on PENDING_STAKE.
  markPlaced(betId: string, ctx?: TxContext): Promise<Bet | null>;
  markRejected(betId: string, ctx?: TxContext): Promise<void>;
  markStakeCanceled(betId: string, ctx?: TxContext): Promise<void>;
  markCanceled(betId: string, ctx?: TxContext): Promise<void>;
  // Set only when the outbox worker exhausts its retry budget for a win, and
  // cleared again if a later replay delivers it.
  markSettlementPending(betId: string, ctx?: TxContext): Promise<void>;
  restoreCashedOut(betId: string, ctx?: TxContext): Promise<void>;
}
