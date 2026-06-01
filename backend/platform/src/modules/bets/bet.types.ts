export type BetSlotId = 1 | 2;
// SETTLEMENT_PENDING: bet was cashed out but the win credit to the white-label
// could not be confirmed (operator outage). The idempotent win `txRef` makes a
// later manual replay safe.
export type BetStatus =
  | 'PLACED'
  | 'CASHED_OUT'
  | 'LOST'
  | 'CANCELED'
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
