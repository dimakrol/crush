import { Module } from '@nestjs/common'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { UsersModule } from '../users/users.module'
import { WalletModule } from '../wallet/wallet.module'

@Module({
  imports: [UsersModule, WalletModule],
  providers: [AuthService],
  controllers: [AuthController],
})
export class AuthModule {}
