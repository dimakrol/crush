import { Module } from '@nestjs/common';
import { BetsController } from './bets.controller';
import { BetsRepository } from './bets.repository';

@Module({
  controllers: [BetsController],
  providers: [BetsRepository],
})
export class BetsModule {}
