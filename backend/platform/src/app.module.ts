import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { GlobalExceptionFilter } from './shared/errors/error.filter'
import { AuthModule } from './modules/auth/auth.module'
import { UsersModule } from './modules/users/users.module'
import { WalletModule } from './modules/wallet/wallet.module'
import { RoundsModule } from './modules/rounds/rounds.module'
import { BetsModule } from './modules/bets/bets.module'
import { HistoryModule } from './modules/history/history.module'
import { SocketModule } from './socket/socket.module'
import { GameModule } from './game/game.module'

@Module({
  imports: [
    AuthModule,
    UsersModule,
    WalletModule,
    RoundsModule,
    BetsModule,
    HistoryModule,
    SocketModule,
    GameModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class AppModule {}
