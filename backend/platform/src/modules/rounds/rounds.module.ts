import { Module } from '@nestjs/common';
import { env } from '@/config/env';
import { MongoRoundRepository } from './round.repository.mongo';
import { PostgresRoundRepository } from './round.repository.postgres';
import { ROUND_REPOSITORY } from './round.repository.interface';

@Module({
  providers: [
    {
      // The active driver (env.DB_DRIVER) picks the implementation; both
      // satisfy IRoundRepository so everything downstream is driver-agnostic.
      provide: ROUND_REPOSITORY,
      useFactory: () =>
        env.DB_DRIVER === 'postgres'
          ? new PostgresRoundRepository()
          : new MongoRoundRepository(),
    },
  ],
  exports: [ROUND_REPOSITORY],
})
export class RoundsModule {}
