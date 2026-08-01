// Direction of a delegated money move. Mirrored one-to-one by the
// `wallet_op_kind` pg enum and by the white-label's own Transaction.type.
export type WalletOpKind = 'DEBIT' | 'CREDIT' | 'ROLLBACK';

// PENDING   — the intent is recorded but the operator has not confirmed it. The
//             outbox worker owns every row in this state.
// CONFIRMED — the operator acknowledged the move, or replayed it idempotently.
// FAILED    — terminal. Either a deterministic refusal (the money never moved)
//             or the retry budget ran out (the money may be owed — that is what
//             the admin retry endpoint is for).
export type WalletOpState = 'PENDING' | 'CONFIRMED' | 'FAILED';

export interface WalletOp {
  id: string;
  kind: WalletOpKind;
  state: WalletOpState;
  txRef: string;
  refTxRef: string | null;
  betId: string | null;
  playerId: string;
  currency: string;
  amount: number;
  roundId: string | null;
  slotId: number | null;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// What a caller has to supply to record an intent. `state`/`attempts` are always
// PENDING/0 at birth, so they are not part of the input.
export interface NewWalletOp {
  kind: WalletOpKind;
  txRef: string;
  refTxRef?: string | null;
  betId?: string | null;
  playerId: string;
  currency: string;
  amount: number;
  roundId?: string | null;
  slotId?: number | null;
  // When the worker may first claim the row. Defaults to now — pass a future
  // time for an op an inline caller is about to attempt itself.
  nextAttemptAt?: Date;
}
