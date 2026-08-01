import { Module } from '@nestjs/common';
import { DrizzleUnitOfWork } from './unit-of-work.drizzle';
import { UNIT_OF_WORK } from './unit-of-work';

// Stateless provider, imported by every module that writes across two
// repositories in one commit.
@Module({
  providers: [{ provide: UNIT_OF_WORK, useClass: DrizzleUnitOfWork }],
  exports: [UNIT_OF_WORK],
})
export class UnitOfWorkModule {}
