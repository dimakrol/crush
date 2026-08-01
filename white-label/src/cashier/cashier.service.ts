import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { AppError } from '@/shared/errors/AppError';
import { ErrorCode } from '@/shared/errors/error-codes';
import { WalletService } from '@/wallet/wallet.service';

export interface CashierResult {
  balance: number;
  currency: string;
}

// Player-initiated cashier: top up (deposit) or cash out (withdraw) the lobby
// account. Reuses the seamless-wallet credit/debit primitives so every movement
// lands in the same append-only ledger; withdraw inherits the no-overdraft guard
// (402 INSUFFICIENT_BALANCE). Each request gets a fresh txRef — a deposit is a
// new intent every time, not an idempotent retry.
@Injectable()
export class CashierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async deposit(playerId: string, amount: number): Promise<CashierResult> {
    const currency = await this.currencyFor(playerId);
    const balance = await this.wallet.credit({
      playerId,
      currency,
      txRef: `deposit:${playerId}:${randomUUID()}`,
      amount,
      gameId: 'cashier',
    });
    return { balance, currency };
  }

  async withdraw(playerId: string, amount: number): Promise<CashierResult> {
    const currency = await this.currencyFor(playerId);
    const balance = await this.wallet.debit({
      playerId,
      currency,
      txRef: `withdraw:${playerId}:${randomUUID()}`,
      amount,
      gameId: 'cashier',
    });
    return { balance, currency };
  }

  private async currencyFor(playerId: string): Promise<string> {
    const wallet = await this.prisma.wallet.findFirst({ where: { playerId } });
    if (!wallet) {
      throw new AppError(
        404,
        ErrorCode.WALLET_NOT_FOUND,
        `No wallet for player ${playerId}`,
      );
    }
    return wallet.currency;
  }
}
