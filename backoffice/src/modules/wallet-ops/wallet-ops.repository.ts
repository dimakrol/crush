import { Inject, Injectable } from '@nestjs/common';
import { Drizzle } from '../../config/postgres';
import { DRIZZLE_PG } from '../../database/tokens';
import { walletOps } from '../../drizzle/platform.schema';
import { PgListRepository } from '../../shared/db/pg-list.repository';

export type WalletOpRow = typeof walletOps.$inferSelect;

@Injectable()
export class WalletOpsRepository extends PgListRepository<WalletOpRow> {
  constructor(@Inject(DRIZZLE_PG) db: Drizzle) {
    super(db, walletOps, walletOps.id);
  }
}
