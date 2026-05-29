import { Inject, Injectable } from '@nestjs/common';
import { env } from '@/config/env';
import { AppError } from '@/shared/errors/AppError';
import { ErrorCode } from '@/shared/errors/error-codes';
import {
  WALLET_REPOSITORY,
  IWalletRepository,
} from './wallet.repository.interface';
import { Wallet } from './wallet.types';

@Injectable()
export class WalletService {
  constructor(
    @Inject(WALLET_REPOSITORY) private readonly walletRepo: IWalletRepository,
  ) {}

  async getBalance(userId: string): Promise<number> {
    const wallet = await this.walletRepo.findByUserId(userId);
    if (!wallet)
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Wallet not found');
    return wallet.balance;
  }

  async createWallet(userId: string): Promise<Wallet> {
    return this.walletRepo.create(userId, env.INITIAL_DEMO_BALANCE);
  }

  async deductBalance(userId: string, amount: number): Promise<Wallet> {
    const wallet = await this.walletRepo.deductBalance(userId, amount);
    if (!wallet)
      throw new AppError(
        400,
        ErrorCode.INSUFFICIENT_BALANCE,
        'Insufficient balance',
      );
    return wallet;
  }

  async addBalance(userId: string, amount: number): Promise<Wallet> {
    return this.walletRepo.addBalance(userId, amount);
  }

  async reset(userId: string): Promise<Wallet> {
    return this.walletRepo.setBalance(userId, env.INITIAL_DEMO_BALANCE);
  }
}
