import { Module } from '@nestjs/common';
import { WalletOpsController } from './wallet-ops.controller';
import { WalletOpsRepository } from './wallet-ops.repository';
import { WALLET_OPS_REPOSITORY } from './wallet-ops.repository.interface';

// Storage + admin surface for the money outbox. Deliberately knows nothing about
// bets: the component that interprets a failed op in game terms is the
// WalletOutboxWorker, which lives with the rest of the money flow in bets/.
// Keeping the direction one-way avoids a circular module dependency.
@Module({
  providers: [
    { provide: WALLET_OPS_REPOSITORY, useClass: WalletOpsRepository },
  ],
  controllers: [WalletOpsController],
  exports: [WALLET_OPS_REPOSITORY],
})
export class WalletOpsModule {}
