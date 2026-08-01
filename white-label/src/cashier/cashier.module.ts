import { Module } from '@nestjs/common';
import { WalletModule } from '@/wallet/wallet.module';
import { CashierController } from './cashier.controller';
import { CashierService } from './cashier.service';

@Module({
  imports: [WalletModule],
  controllers: [CashierController],
  providers: [CashierService],
})
export class CashierModule {}
