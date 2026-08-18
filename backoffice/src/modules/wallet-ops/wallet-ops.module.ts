import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { WalletOpsController } from './wallet-ops.controller';
import { WalletOpsRepository } from './wallet-ops.repository';

// Reads come straight from the platform's database; the retry action goes back
// out through its admin API. Both halves of the rule, in one controller.
@Module({
  imports: [PlatformModule],
  controllers: [WalletOpsController],
  providers: [WalletOpsRepository],
})
export class WalletOpsModule {}
