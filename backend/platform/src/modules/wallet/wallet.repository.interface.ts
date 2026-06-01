export const WALLET_REPOSITORY = 'WALLET_REPOSITORY';

// Context-carrying seamless-wallet operations. Amounts here are in the
// platform's decimal currency (dollars); the implementation converts to/from
// the white-label's integer minor units at the HTTP seam. Every money move
// carries a game-generated, idempotent `txRef` the white-label dedupes on.

export interface DebitContext {
  playerId: string;
  currency: string;
  txRef: string;
  amount: number;
  roundId?: string;
  slotId?: number;
  gameId?: string;
}

export type CreditContext = DebitContext;

export interface RollbackContext {
  playerId: string;
  currency: string;
  refTxRef: string;
}

export interface WalletResult {
  balance: number;
}

export interface IWalletRepository {
  getBalance(playerId: string, currency: string): Promise<number>;
  debit(ctx: DebitContext): Promise<WalletResult>;
  credit(ctx: CreditContext): Promise<WalletResult>;
  rollback(ctx: RollbackContext): Promise<WalletResult>;
}
