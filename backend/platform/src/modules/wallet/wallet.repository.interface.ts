import { IBaseRepository } from '@/shared/repositories/base.repository';
import { Wallet } from './wallet.types';

export const WALLET_REPOSITORY = 'WALLET_REPOSITORY';

export interface IWalletRepository extends IBaseRepository<Wallet> {
  findByUserId(userId: string): Promise<Wallet | null>;
  create(userId: string, balance: number): Promise<Wallet>;
  deductBalance(userId: string, amount: number): Promise<Wallet | null>;
  addBalance(userId: string, amount: number): Promise<Wallet>;
  setBalance(userId: string, balance: number): Promise<Wallet>;
}
