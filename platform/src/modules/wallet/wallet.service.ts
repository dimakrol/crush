import { Inject, Injectable } from '@nestjs/common';
import {
  CreditContext,
  DebitContext,
  IWalletRepository,
  RollbackContext,
  WALLET_REPOSITORY,
  WalletResult,
} from './wallet.repository.interface';

// Thin facade over the white-label seamless wallet. The platform owns no money
// state of its own; every call delegates to the operator over HTTP/HMAC.
@Injectable()
export class WalletService {
  constructor(
    @Inject(WALLET_REPOSITORY) private readonly walletRepo: IWalletRepository,
  ) {}

  getBalance(playerId: string, currency: string): Promise<number> {
    return this.walletRepo.getBalance(playerId, currency);
  }

  debit(ctx: DebitContext): Promise<WalletResult> {
    return this.walletRepo.debit(ctx);
  }

  credit(ctx: CreditContext): Promise<WalletResult> {
    return this.walletRepo.credit(ctx);
  }

  rollback(ctx: RollbackContext): Promise<WalletResult> {
    return this.walletRepo.rollback(ctx);
  }
}
