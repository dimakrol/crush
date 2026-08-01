import { Module } from '@nestjs/common';
import { HttpWalletRepository } from './wallet.repository.http';
import { WALLET_REPOSITORY } from './wallet.repository.interface';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';

@Module({
  providers: [
    { provide: WALLET_REPOSITORY, useClass: HttpWalletRepository },
    WalletService,
  ],
  controllers: [WalletController],
  exports: [WalletService],
})
export class WalletModule {}
