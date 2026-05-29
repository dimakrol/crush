import { Module } from '@nestjs/common';
import { MongoRoundRepository } from './round.repository.mongo';
import { ROUND_REPOSITORY } from './round.repository.interface';

@Module({
  providers: [{ provide: ROUND_REPOSITORY, useClass: MongoRoundRepository }],
  exports: [ROUND_REPOSITORY],
})
export class RoundsModule {}
