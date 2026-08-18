import { Module } from '@nestjs/common';
import { RoundsController } from './rounds.controller';
import { RoundsRepository } from './rounds.repository';

@Module({
  controllers: [RoundsController],
  providers: [RoundsRepository],
})
export class RoundsModule {}
