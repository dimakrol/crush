import { TxContext } from '@/shared/repositories/unit-of-work';
import { NewWalletOp, WalletOp } from './wallet-op.types';

export const WALLET_OPS_REPOSITORY = 'WALLET_OPS_REPOSITORY';

export interface IWalletOpsRepository {
  // Record an intent. Idempotent on `txRef`: enqueueing the same money move
  // twice cannot create two rows. A row that is already PENDING or CONFIRMED is
  // left untouched and `null` comes back — the caller must treat that as "this
  // move is already owned by someone", never as a failure to retry. A FAILED row
  // is revived (attempts reset), which is what makes a stake retry after a
  // refusal, or an admin-driven replay, land on the same row.
  //
  // Pass `ctx` to commit the op together with the bet-state change that
  // justifies it — that pairing is the whole point of the table.
  enqueue(op: NewWalletOp, ctx?: TxContext): Promise<WalletOp | null>;
  // Batch form for the set-based auto-cashout: one statement for the whole
  // round, since it runs inside the 100ms tick.
  enqueueMany(ops: NewWalletOp[], ctx?: TxContext): Promise<void>;
  // Take ownership of up to `limit` due rows. Skips rows another worker holds and
  // pushes `nextAttemptAt` `leaseMs` into the future, so a process that dies
  // mid-call releases its ops instead of stranding them. `attempts` is already
  // incremented on the returned rows.
  claimBatch(limit: number, leaseMs: number): Promise<WalletOp[]>;
  markConfirmed(txRef: string, ctx?: TxContext): Promise<void>;
  markFailed(txRef: string, error: string, ctx?: TxContext): Promise<void>;
  scheduleRetry(txRef: string, nextAttemptAt: Date, error: string): Promise<void>;
  findByTxRef(txRef: string): Promise<WalletOp | null>;
  // Admin recovery: FAILED → PENDING with a clean retry budget. Returns the
  // txRefs actually revived. Safe by construction — every op is idempotent.
  revive(txRef?: string): Promise<string[]>;
}
