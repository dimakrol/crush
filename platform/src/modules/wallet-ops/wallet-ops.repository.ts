import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { executor, runInTransaction } from '@/config/postgres';
import { walletOps } from '@/drizzle/schema';
import { TxContext } from '@/shared/repositories/unit-of-work';
import { IWalletOpsRepository } from './wallet-ops.repository.interface';
import { NewWalletOp, WalletOp } from './wallet-op.types';

type WalletOpRow = typeof walletOps.$inferSelect;

// Postgres implementation of the money outbox, bound to WALLET_OPS_REPOSITORY.
@Injectable()
export class WalletOpsRepository implements IWalletOpsRepository {
  async enqueue(op: NewWalletOp, ctx?: TxContext): Promise<WalletOp | null> {
    const [row] = await executor(ctx)
      .insert(walletOps)
      .values(this.toRow(op))
      .onConflictDoUpdate(this.reviveOnConflict(op))
      .returning();
    return row ? this.toOp(row) : null;
  }

  async enqueueMany(ops: NewWalletOp[], ctx?: TxContext): Promise<void> {
    if (ops.length === 0) return;
    await executor(ctx)
      .insert(walletOps)
      .values(ops.map((op) => this.toRow(op)))
      // Same conflict rule as enqueue(): a live op keeps its row. Callers here
      // (the auto-cashout batch) only need "the move is tracked", not which row.
      .onConflictDoUpdate(this.reviveOnConflict(ops[0]));
  }

  async claimBatch(limit: number, leaseMs: number): Promise<WalletOp[]> {
    return runInTransaction(async (ctx) => {
      const db = executor(ctx);
      const now = new Date();
      // Two statements, no network call in between, so the locks are held for
      // microseconds. SKIP LOCKED keeps a second claimer from blocking; the
      // lease written below is what actually prevents a double attempt.
      const due = await db
        .select({ id: walletOps.id })
        .from(walletOps)
        .where(
          and(
            eq(walletOps.state, 'PENDING'),
            lte(walletOps.nextAttemptAt, now),
          ),
        )
        .orderBy(asc(walletOps.nextAttemptAt))
        .limit(limit)
        .for('update', { skipLocked: true });
      if (due.length === 0) return [];

      const rows = await db
        .update(walletOps)
        .set({
          attempts: sql`${walletOps.attempts} + 1`,
          nextAttemptAt: new Date(now.getTime() + leaseMs),
          updatedAt: now,
        })
        .where(
          inArray(
            walletOps.id,
            due.map((r) => r.id),
          ),
        )
        .returning();
      return rows.map((r) => this.toOp(r));
    });
  }

  // All three transitions are guarded on state='PENDING': only the holder of a
  // claimed op may retire it, and a CONFIRMED op can never regress.
  async markConfirmed(txRef: string, ctx?: TxContext): Promise<void> {
    await executor(ctx)
      .update(walletOps)
      .set({ state: 'CONFIRMED', lastError: null, updatedAt: new Date() })
      .where(and(eq(walletOps.txRef, txRef), eq(walletOps.state, 'PENDING')));
  }

  async markFailed(
    txRef: string,
    error: string,
    ctx?: TxContext,
  ): Promise<void> {
    await executor(ctx)
      .update(walletOps)
      .set({ state: 'FAILED', lastError: error, updatedAt: new Date() })
      .where(and(eq(walletOps.txRef, txRef), eq(walletOps.state, 'PENDING')));
  }

  async scheduleRetry(
    txRef: string,
    nextAttemptAt: Date,
    error: string,
  ): Promise<void> {
    await executor()
      .update(walletOps)
      .set({ nextAttemptAt, lastError: error, updatedAt: new Date() })
      .where(and(eq(walletOps.txRef, txRef), eq(walletOps.state, 'PENDING')));
  }

  async findByTxRef(txRef: string): Promise<WalletOp | null> {
    const [row] = await executor()
      .select()
      .from(walletOps)
      .where(eq(walletOps.txRef, txRef))
      .limit(1);
    return row ? this.toOp(row) : null;
  }

  async revive(txRef?: string): Promise<string[]> {
    const where = txRef
      ? and(eq(walletOps.state, 'FAILED'), eq(walletOps.txRef, txRef))
      : eq(walletOps.state, 'FAILED');
    const rows = await executor()
      .update(walletOps)
      .set({
        state: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(where)
      .returning({ txRef: walletOps.txRef });
    return rows.map((r) => r.txRef);
  }

  // A conflict on tx_ref means this money move is already recorded. Reviving is
  // allowed ONLY from FAILED: re-arming a PENDING op would let two attempts run
  // at once, and re-arming a CONFIRMED one would replay money that already moved.
  private reviveOnConflict(op: NewWalletOp) {
    return {
      target: walletOps.txRef,
      setWhere: eq(walletOps.state, 'FAILED'),
      set: {
        state: 'PENDING' as const,
        attempts: 0,
        nextAttemptAt: op.nextAttemptAt ?? new Date(),
        lastError: null,
        updatedAt: new Date(),
      },
    };
  }

  private toRow(op: NewWalletOp): typeof walletOps.$inferInsert {
    return {
      kind: op.kind,
      state: 'PENDING',
      txRef: op.txRef,
      refTxRef: op.refTxRef ?? null,
      betId: op.betId ?? null,
      playerId: op.playerId,
      currency: op.currency,
      amount: String(op.amount),
      roundId: op.roundId ?? null,
      slotId: op.slotId ?? null,
      attempts: 0,
      nextAttemptAt: op.nextAttemptAt ?? new Date(),
      lastError: null,
    };
  }

  private toOp(row: WalletOpRow): WalletOp {
    return {
      id: row.id,
      kind: row.kind,
      state: row.state,
      txRef: row.txRef,
      refTxRef: row.refTxRef,
      betId: row.betId,
      playerId: row.playerId,
      currency: row.currency,
      amount: Number(row.amount),
      roundId: row.roundId,
      slotId: row.slotId,
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt,
      lastError: row.lastError,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
