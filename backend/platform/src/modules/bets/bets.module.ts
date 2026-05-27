import { Module } from '@nestjs/common'
import { MongoBetRepository } from './bet.repository.mongo'
import { BET_REPOSITORY } from './bet.repository.interface'
import { BetService } from './bet.service'
import { BetController } from './bet.controller'
import { WalletModule } from '../wallet/wallet.module'

@Module({
  imports: [WalletModule],
  providers: [{ provide: BET_REPOSITORY, useClass: MongoBetRepository }, BetService],
  controllers: [BetController],
  exports: [BetService],
})
export class BetsModule {}
