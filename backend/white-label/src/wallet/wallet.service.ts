import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AppError } from '@/shared/errors/AppError';
import { ErrorCode } from '@/shared/errors/error-codes';

export interface MovementContext {
  playerId: string;
  currency: string;
  txRef: string;
  amount: number;
  roundId?: string;
  slotId?: number;
  gameId?: string;
}

export interface RollbackInput {
  playerId: string;
  currency: string;
  refTxRef: string;
}

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(playerId: string, currency: string): Promise<number> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { playerId_currency: { playerId, currency } },
    });
    if (!wallet) {
      throw new AppError(
        404,
        ErrorCode.WALLET_NOT_FOUND,
        `No ${currency} wallet for player ${playerId}`,
      );
    }
    return Number(wallet.balance);
  }

  // Atomic subtract. Idempotent on txRef: a replay returns the original result
  // without moving money. Rejects if the wallet can't cover the amount.
  async debit(ctx: MovementContext): Promise<number> {
    const replay = await this.findByTxRef(ctx.txRef);
    if (replay !== null) return replay;

    const amount = BigInt(ctx.amount);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const moved = await tx.wallet.updateMany({
          where: {
            playerId: ctx.playerId,
            currency: ctx.currency,
            balance: { gte: amount },
          },
          data: { balance: { decrement: amount } },
        });

        if (moved.count === 0) {
          const wallet = await tx.wallet.findUnique({
            where: {
              playerId_currency: {
                playerId: ctx.playerId,
                currency: ctx.currency,
              },
            },
          });
          if (!wallet) {
            throw new AppError(
              404,
              ErrorCode.WALLET_NOT_FOUND,
              `No ${ctx.currency} wallet for player ${ctx.playerId}`,
            );
          }
          throw new AppError(
            402,
            ErrorCode.INSUFFICIENT_BALANCE,
            'Insufficient balance',
          );
        }

        const wallet = await tx.wallet.findUnique({
          where: {
            playerId_currency: {
              playerId: ctx.playerId,
              currency: ctx.currency,
            },
          },
        });
        // A duplicate txRef here (concurrent replay) throws P2002, rolling back
        // the decrement above — the whole movement is undone, never double-spent.
        await tx.transaction.create({
          data: {
            walletId: wallet!.id,
            type: 'DEBIT',
            amount,
            txRef: ctx.txRef,
            roundId: ctx.roundId,
            slotId: ctx.slotId,
            gameId: ctx.gameId,
            balanceAfter: wallet!.balance,
          },
        });
        return Number(wallet!.balance);
      });
    } catch (err) {
      return this.resolveDuplicate(err, ctx.txRef);
    }
  }

  // Add funds. Idempotent on txRef.
  async credit(ctx: MovementContext): Promise<number> {
    const replay = await this.findByTxRef(ctx.txRef);
    if (replay !== null) return replay;

    const amount = BigInt(ctx.amount);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.wallet.findUnique({
          where: {
            playerId_currency: {
              playerId: ctx.playerId,
              currency: ctx.currency,
            },
          },
        });
        if (!existing) {
          throw new AppError(
            404,
            ErrorCode.WALLET_NOT_FOUND,
            `No ${ctx.currency} wallet for player ${ctx.playerId}`,
          );
        }
        const wallet = await tx.wallet.update({
          where: { id: existing.id },
          data: { balance: { increment: amount } },
        });
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            type: 'CREDIT',
            amount,
            txRef: ctx.txRef,
            roundId: ctx.roundId,
            slotId: ctx.slotId,
            gameId: ctx.gameId,
            balanceAfter: wallet.balance,
          },
        });
        return Number(wallet.balance);
      });
    } catch (err) {
      return this.resolveDuplicate(err, ctx.txRef);
    }
  }

  // Reverse a named debit. Idempotent (own txRef = `${refTxRef}:rollback`).
  // No-op (returns current balance) if the referenced debit never happened.
  async rollback(input: RollbackInput): Promise<number> {
    const rollbackRef = `${input.refTxRef}:rollback`;
    const replay = await this.findByTxRef(rollbackRef);
    if (replay !== null) return replay;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({
          where: {
            playerId_currency: {
              playerId: input.playerId,
              currency: input.currency,
            },
          },
        });
        if (!wallet) {
          throw new AppError(
            404,
            ErrorCode.WALLET_NOT_FOUND,
            `No ${input.currency} wallet for player ${input.playerId}`,
          );
        }

        const original = await tx.transaction.findUnique({
          where: { txRef: input.refTxRef },
        });
        if (!original || original.type !== 'DEBIT') {
          // Nothing to reverse.
          return Number(wallet.balance);
        }

        const updated = await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: original.amount } },
        });
        await tx.transaction.create({
          data: {
            walletId: updated.id,
            type: 'ROLLBACK',
            amount: original.amount,
            txRef: rollbackRef,
            refTxRef: input.refTxRef,
            roundId: original.roundId,
            slotId: original.slotId,
            gameId: original.gameId,
            balanceAfter: updated.balance,
          },
        });
        return Number(updated.balance);
      });
    } catch (err) {
      return this.resolveDuplicate(err, rollbackRef);
    }
  }

  private async findByTxRef(txRef: string): Promise<number | null> {
    const tx = await this.prisma.transaction.findUnique({ where: { txRef } });
    return tx ? Number(tx.balanceAfter) : null;
  }

  // A unique-constraint violation means a concurrent request already committed
  // this txRef. Re-read and return its result so the op stays idempotent.
  private async resolveDuplicate(err: unknown, txRef: string): Promise<number> {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const replay = await this.findByTxRef(txRef);
      if (replay !== null) return replay;
    }
    throw err;
  }
}
