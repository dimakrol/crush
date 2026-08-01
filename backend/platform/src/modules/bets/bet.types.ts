export type BetSlotId = 1 | 2;

// Bet lifecycle. Mirrored one-to-one by the `bet_status` pg enum, so an
// impossible value can't reach the table.
//
// PENDING_STAKE       — intent recorded together with its `wallet_ops` DEBIT row,
//                       the stake debit not confirmed yet. Written BEFORE the
//                       network call so a crash mid-debit leaves a trace that can
//                       be resolved instead of a silently lost stake. Not a bet
//                       the player owns yet.
// PLACED              — stake debited and confirmed; the bet is live in the round.
// CASHED_OUT          — resolved as a win at `cashOutMultiplier`.
// LOST                — the round crashed while the bet was still PLACED.
// CANCELED            — the stake goes back: withdrawn before the round started,
//                       orphaned by a restart, or abandoned because the debit's
//                       outcome was never learned. Still holds its
//                       (round, user, slot) — deliberately, since a retry would
//                       reuse the debit `txRef` and the white-label would replay
//                       it without charging.
// REJECTED            — the operator refused the stake deterministically (e.g.
//                       insufficient balance), so no money moved. Kept as an audit
//                       trace only, and the one status excluded from the unique
//                       slot index, so the player can retry after topping up.
// SETTLEMENT_PENDING  — a won bet whose credit the outbox worker could not deliver
//                       within its retry budget: money is owed. The `wallet_ops`
//                       row is the authority; a later replay (automatic or via
//                       POST /api/admin/wallet-ops/retry) is safe thanks to the
//                       idempotent `txRef`, and clears the flag back to CASHED_OUT.
export type BetStatus =
  | 'PENDING_STAKE'
  | 'PLACED'
  | 'CASHED_OUT'
  | 'LOST'
  | 'CANCELED'
  | 'REJECTED'
  | 'SETTLEMENT_PENDING';

export interface Bet {
  id: string;
  userId: string;
  currency: string;
  roundId: string;
  slotId: BetSlotId;
  amount: number;
  autoCashOut: number | null;
  status: BetStatus;
  cashOutMultiplier: number | null;
  payout: number;
  placedAt: Date;
  cashedOutAt: Date | null;
  resolvedAt: Date | null;
}
