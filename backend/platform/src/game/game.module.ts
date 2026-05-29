import { Module, forwardRef } from '@nestjs/common';
import { RoundEngine } from './round.engine';
import { RoundsModule } from '@/modules/rounds/rounds.module';
import { BetsModule } from '@/modules/bets/bets.module';
import { WalletModule } from '@/modules/wallet/wallet.module';
import { SocketModule } from '@/socket/socket.module';

@Module({
  imports: [
    RoundsModule,
    BetsModule,
    WalletModule,
    forwardRef(() => SocketModule),
  ],
  providers: [RoundEngine],
  exports: [RoundEngine],
})
export class GameModule {}
