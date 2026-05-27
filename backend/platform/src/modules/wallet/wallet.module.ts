import { Module } from '@nestjs/common'
import { MongoWalletRepository } from './wallet.repository.mongo'
import { WALLET_REPOSITORY } from './wallet.repository.interface'
import { WalletService } from './wallet.service'
import { WalletController } from './wallet.controller'

@Module({
  providers: [{ provide: WALLET_REPOSITORY, useClass: MongoWalletRepository }, WalletService],
  controllers: [WalletController],
  exports: [WalletService],
})
export class WalletModule {}
