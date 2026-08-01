import { Injectable } from '@nestjs/common';
import { env } from '@/config/env';
import { PrismaService } from '@/prisma/prisma.service';
import { AppError } from '@/shared/errors/AppError';
import { ErrorCode } from '@/shared/errors/error-codes';

@Injectable()
export class PlayersService {
  constructor(private readonly prisma: PrismaService) {}

  // Restore the seed balance and record the correcting adjustment in the ledger.
  async resetBalance(
    playerId: string,
  ): Promise<{ balance: number; currency: string }> {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findFirst({ where: { playerId } });
      if (!wallet) {
        throw new AppError(
          404,
          ErrorCode.WALLET_NOT_FOUND,
          `No wallet for player ${playerId}`,
        );
      }

      const target = BigInt(env.INITIAL_DEMO_BALANCE);
      const delta = target - wallet.balance;

      const updated = await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: target },
      });

      if (delta !== 0n) {
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            type: delta > 0n ? 'CREDIT' : 'DEBIT',
            amount: delta > 0n ? delta : -delta,
            txRef: `reset:${playerId}:${Date.now()}`,
            gameId: 'admin-reset',
            balanceAfter: updated.balance,
          },
        });
      }

      return { balance: Number(updated.balance), currency: updated.currency };
    });
  }
}
