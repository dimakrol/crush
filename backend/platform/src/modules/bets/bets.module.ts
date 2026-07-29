import { Module } from '@nestjs/common';
import { BetRepository } from './bet.repository';
import { BET_REPOSITORY } from './bet.repository.interface';
import { BetService } from './bet.service';
import { BetController } from './bet.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  providers: [
    {
      // Postgres is the only store; the token + interface stay so services
      // never see Drizzle and unit tests can inject a mock.
      provide: BET_REPOSITORY,
      useClass: BetRepository,
    },
    BetService,
  ],
  controllers: [BetController],
  exports: [BetService],
})
export class BetsModule {}
