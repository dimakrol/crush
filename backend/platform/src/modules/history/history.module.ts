import { Module } from '@nestjs/common'
import { HistoryController } from './history.controller'
import { HistoryService } from './history.service'
import { RoundsModule } from '../rounds/rounds.module'

@Module({
  imports: [RoundsModule],
  providers: [HistoryService],
  controllers: [HistoryController],
})
export class HistoryModule {}
