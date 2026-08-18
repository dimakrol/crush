import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { GlobalExceptionFilter } from './shared/errors/error.filter';
import { MetricsModule } from './metrics/metrics.module';
import { MetricsInterceptor } from './metrics/metrics.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { WalletOpsModule } from './modules/wallet-ops/wallet-ops.module';
import { RoundsModule } from './modules/rounds/rounds.module';
import { BetsModule } from './modules/bets/bets.module';
import { HistoryModule } from './modules/history/history.module';
import { SocketModule } from './socket/socket.module';
import { GameModule } from './game/game.module';

@Module({
  imports: [
    MetricsModule,
    AuthModule,
    WalletModule,
    WalletOpsModule,
    RoundsModule,
    BetsModule,
    HistoryModule,
    SocketModule,
    GameModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
})
export class AppModule {}
