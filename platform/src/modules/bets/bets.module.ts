import { Module, forwardRef } from '@nestjs/common';
import { BetRepository } from './bet.repository';
import { BET_REPOSITORY } from './bet.repository.interface';
import { BetService } from './bet.service';
import { BetController } from './bet.controller';
import { WalletOutboxWorker } from './wallet-outbox.worker';
import { WalletModule } from '../wallet/wallet.module';
import { WalletOpsModule } from '../wallet-ops/wallet-ops.module';
import { UnitOfWorkModule } from '@/shared/repositories/unit-of-work.module';
import { SocketModule } from '@/socket/socket.module';

@Module({
  imports: [
    WalletModule,
    WalletOpsModule,
    UnitOfWorkModule,
    // The worker pushes wallet:updated after a catch-up; SocketModule imports
    // this module back for the gateway's bet handlers.
    forwardRef(() => SocketModule),
  ],
  providers: [
    {
      // Postgres is the only store; the token + interface stay so services
      // never see Drizzle and unit tests can inject a mock.
      provide: BET_REPOSITORY,
      useClass: BetRepository,
    },
    BetService,
    WalletOutboxWorker,
  ],
  controllers: [BetController],
  exports: [BetService],
})
export class BetsModule {}
