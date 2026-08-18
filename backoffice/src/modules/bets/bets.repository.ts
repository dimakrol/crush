import { Inject, Injectable } from '@nestjs/common';
import { Drizzle } from '../../config/postgres';
import { DRIZZLE_PG } from '../../database/tokens';
import { bets } from '../../drizzle/platform.schema';
import { PgListRepository } from '../../shared/db/pg-list.repository';

export type BetRow = typeof bets.$inferSelect;

@Injectable()
export class BetsRepository extends PgListRepository<BetRow> {
  constructor(@Inject(DRIZZLE_PG) db: Drizzle) {
    super(db, bets, bets.id);
  }
}
