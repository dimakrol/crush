import { Injectable } from '@nestjs/common';
import { operatorPost } from '@/shared/whitelabel/operator.client';
import {
  CreditContext,
  DebitContext,
  IWalletRepository,
  RollbackContext,
  WalletResult,
} from './wallet.repository.interface';

// White-label ledger is integer minor units; the platform stays decimal. Both
// conversions live here (and only here). Lossless because bet amounts and
// payouts are already whole-cent (calculatePayout floors to 2 decimals).
const toMinor = (dollars: number): number => Math.round(dollars * 100);
const toDecimal = (minor: number): number => minor / 100;

interface WalletApiResponse {
  balance: number; // minor units
  currency: string;
}

@Injectable()
export class HttpWalletRepository implements IWalletRepository {
  async getBalance(playerId: string, currency: string): Promise<number> {
    const res = await operatorPost<WalletApiResponse>('/wallet/balance', {
      playerId,
      currency,
    });
    return toDecimal(res.balance);
  }

  async debit(ctx: DebitContext): Promise<WalletResult> {
    const res = await operatorPost<WalletApiResponse>('/wallet/debit', {
      playerId: ctx.playerId,
      currency: ctx.currency,
      txRef: ctx.txRef,
      amount: toMinor(ctx.amount),
      roundId: ctx.roundId,
      slotId: ctx.slotId,
      gameId: ctx.gameId,
    });
    return { balance: toDecimal(res.balance) };
  }

  async credit(ctx: CreditContext): Promise<WalletResult> {
    const res = await operatorPost<WalletApiResponse>('/wallet/credit', {
      playerId: ctx.playerId,
      currency: ctx.currency,
      txRef: ctx.txRef,
      amount: toMinor(ctx.amount),
      roundId: ctx.roundId,
      slotId: ctx.slotId,
      gameId: ctx.gameId,
    });
    return { balance: toDecimal(res.balance) };
  }

  async rollback(ctx: RollbackContext): Promise<WalletResult> {
    const res = await operatorPost<WalletApiResponse>('/wallet/rollback', {
      playerId: ctx.playerId,
      currency: ctx.currency,
      refTxRef: ctx.refTxRef,
    });
    return { balance: toDecimal(res.balance) };
  }
}
