import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Drizzle } from '../../config/postgres';
import { env } from '../../config/env';
import { DRIZZLE_PG } from '../../database/tokens';
import { bets, walletOps } from '../../drizzle/platform.schema';

export interface WalletOpsCounts {
  failed: number;
  stuckPending: number;
}

export interface BetsCounts {
  settlementPending: number;
  stuckPendingStake: number;
}

// The "what is stuck" half of the dashboard, and the only SQL behind it. One
// query per table rather than one per counter: these are unindexed predicates
// (the platform indexes what the game asks for, not what an operator console
// asks for) and the dashboard polls every few seconds, so the scan is paid once
// per table instead of once per counter.
//
// count(*) is a bigint the driver returns as a string; these are small enough to
// be numbers by the time they leave here.
@Injectable()
export class DashboardRepository {
  constructor(@Inject(DRIZZLE_PG) private readonly db: Drizzle) {}

  private cutoff(): Date {
    return new Date(Date.now() - env.STUCK_OP_MINUTES * 60_000);
  }

  async walletOpsCounts(): Promise<WalletOpsCounts> {
    const cutoff = this.cutoff();
    const [ops] = await this.db
      .select({
        failed: sql<string>`count(*) filter (where ${walletOps.state} = 'FAILED')`,
        stuckPending: sql<string>`count(*) filter (where ${walletOps.state} = 'PENDING' and ${walletOps.createdAt} < ${cutoff})`,
      })
      .from(walletOps);
    return {
      failed: Number(ops.failed),
      stuckPending: Number(ops.stuckPending),
    };
  }

  async betsCounts(): Promise<BetsCounts> {
    const cutoff = this.cutoff();
    const [betRows] = await this.db
      .select({
        settlementPending: sql<string>`count(*) filter (where ${bets.status} = 'SETTLEMENT_PENDING')`,
        stuckPendingStake: sql<string>`count(*) filter (where ${bets.status} = 'PENDING_STAKE' and ${bets.placedAt} < ${cutoff})`,
      })
      .from(bets);
    return {
      settlementPending: Number(betRows.settlementPending),
      stuckPendingStake: Number(betRows.stuckPendingStake),
    };
  }
}
