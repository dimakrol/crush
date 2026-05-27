import { Module, forwardRef } from '@nestjs/common'
import { GameGateway } from './game.gateway'
import { BetsModule } from '../modules/bets/bets.module'

@Module({
  imports: [forwardRef(() => BetsModule)],
  providers: [GameGateway],
  exports: [GameGateway],
})
export class SocketModule {}
