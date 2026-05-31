import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { GlobalExceptionFilter } from './shared/errors/error.filter';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { WalletModule } from './wallet/wallet.module';
import { PlayersModule } from './players/players.module';
import { AuthModule } from './auth/auth.module';
import { SessionsModule } from './sessions/sessions.module';
import { LobbyModule } from './lobby/lobby.module';

@Module({
  imports: [
    PrismaModule,
    WalletModule,
    PlayersModule,
    AuthModule,
    SessionsModule,
    LobbyModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class AppModule {}
