import { Inject, Injectable } from '@nestjs/common';
import { Drizzle } from '../../config/postgres';
import { DRIZZLE_PG } from '../../database/tokens';
import { rounds } from '../../drizzle/platform.schema';
import { PgListRepository } from '../../shared/db/pg-list.repository';

export type RoundRow = typeof rounds.$inferSelect;

@Injectable()
export class RoundsRepository extends PgListRepository<RoundRow> {
  constructor(@Inject(DRIZZLE_PG) db: Drizzle) {
    super(db, rounds, rounds.id);
  }
}
