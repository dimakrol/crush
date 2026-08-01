import { Module } from '@nestjs/common';
import { WalletModule } from '@/wallet/wallet.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

@Module({
  imports: [WalletModule],
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsModule {}
