import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { GlobalExceptionFilter } from './shared/errors/error.filter';
import { MetricsModule } from './metrics/metrics.module';
import { MetricsInterceptor } from './metrics/metrics.interceptor';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { WalletModule } from './wallet/wallet.module';
import { PlayersModule } from './players/players.module';
import { AuthModule } from './auth/auth.module';
import { CashierModule } from './cashier/cashier.module';
import { SessionsModule } from './sessions/sessions.module';
import { LobbyModule } from './lobby/lobby.module';

@Module({
  imports: [
    MetricsModule,
    PrismaModule,
    WalletModule,
    PlayersModule,
    AuthModule,
    CashierModule,
    SessionsModule,
    LobbyModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
})
export class AppModule {}
