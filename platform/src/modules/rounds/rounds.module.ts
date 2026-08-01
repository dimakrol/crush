import { Module } from '@nestjs/common';
import { RoundRepository } from './round.repository';
import { ROUND_REPOSITORY } from './round.repository.interface';

@Module({
  providers: [
    {
      // Postgres is the only store; the token + interface stay so services
      // never see Drizzle and unit tests can inject a mock.
      provide: ROUND_REPOSITORY,
      useClass: RoundRepository,
    },
  ],
  exports: [ROUND_REPOSITORY],
})
export class RoundsModule {}
