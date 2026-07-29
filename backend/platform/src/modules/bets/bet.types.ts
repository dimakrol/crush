export type BetSlotId = 1 | 2;

// Bet lifecycle. Mirrored one-to-one by the `bet_status` pg enum, so an
// impossible value can't reach the table.
//
// PENDING_STAKE       — intent recorded, the stake debit has not been confirmed
//                       yet. Written BEFORE the network call so a crash mid-debit
//                       leaves a trace that can be replayed instead of a silently
//                       lost stake. Not a bet the player owns yet.
// PLACED              — stake debited and confirmed; the bet is live in the round.
// CASHED_OUT          — resolved as a win at `cashOutMultiplier`.
// LOST                — the round crashed while the bet was still PLACED.
// CANCELED            — withdrawn before the round started; the stake was rolled
//                       back. Still holds its (round, user, slot) — the slot is
//                       not reusable this round.
// REJECTED            — the operator refused the stake (e.g. insufficient
//                       balance). Kept as an audit trace only, and deliberately
//                       excluded from the unique slot index so the player can
//                       retry the same slot after topping up.
// SETTLEMENT_PENDING  — resolved locally, but the money move to the white-label
//                       could not be confirmed (operator outage). The idempotent
//                       `txRef` makes a later replay safe.
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
