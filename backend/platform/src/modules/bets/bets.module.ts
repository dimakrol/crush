import { Module } from '@nestjs/common';
import { env } from '@/config/env';
import { MongoBetRepository } from './bet.repository.mongo';
import { PostgresBetRepository } from './bet.repository.postgres';
import { BET_REPOSITORY } from './bet.repository.interface';
import { BetService } from './bet.service';
import { BetController } from './bet.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  providers: [
    {
      // The active driver (env.DB_DRIVER) picks the implementation; both
      // satisfy IBetRepository so everything downstream is driver-agnostic.
      provide: BET_REPOSITORY,
      useFactory: () =>
        env.DB_DRIVER === 'postgres'
          ? new PostgresBetRepository()
          : new MongoBetRepository(),
    },
    BetService,
  ],
  controllers: [BetController],
  exports: [BetService],
})
export class BetsModule {}
