import { Injectable, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Gauge } from 'prom-client';
import { env } from '@/config/env';
import { getDrizzle } from '@/config/postgres';
import { bets, walletOps } from '@/drizzle/platform.schema';
import { logger } from '@/shared/utils/logger';
import { MetricsService } from './metrics.service';

// Registers the two stuck-work gauges on the MetricsService registry with a
// pull-model `collect` callback: on every scrape they run the same read-only
// query the dashboard screen uses (see dashboard.controller.ts). A DB error
// leaves the gauges at their previous value rather than blanking the whole
// /metrics response — the same "fail independently" stance the dashboard takes,
// so these counters are still there to read when the platform DB is the problem.
@Injectable()
export class StuckWorkCollector implements OnModuleInit {
  constructor(private readonly metrics: MetricsService) {}

  onModuleInit(): void {
    // Arrow closures keep the collector's `this` while the `collect` method
    // below rebinds `this` to the gauge (that is how it reaches `.set`).
    const readWalletOps = () => this.readWalletOps();
    const readBets = () => this.readBets();

    new Gauge({
      name: 'backoffice_stuck_wallet_ops',
      help: 'Wallet ops that may need operator attention, by state',
      labelNames: ['state'],
      registers: [this.metrics.register],
      async collect() {
        try {
          const counts = await readWalletOps();
          this.set({ state: 'failed' }, counts.failed);
          this.set({ state: 'stuck_pending' }, counts.stuckPending);
        } catch (err) {
          logger.warn('Stuck wallet-ops gauge scrape failed', {
            error: (err as Error).message,
          });
        }
      },
    });

    new Gauge({
      name: 'backoffice_stuck_bets',
      help: 'Bets stuck mid-settlement, by state',
      labelNames: ['state'],
      registers: [this.metrics.register],
      async collect() {
        try {
          const counts = await readBets();
          this.set({ state: 'settlement_pending' }, counts.settlementPending);
          this.set({ state: 'stuck_pending_stake' }, counts.stuckPendingStake);
        } catch (err) {
          logger.warn('Stuck bets gauge scrape failed', {
            error: (err as Error).message,
          });
        }
      },
    });
  }

  private cutoff(): Date {
    return new Date(Date.now() - env.STUCK_OP_MINUTES * 60_000);
  }

  private async readWalletOps(): Promise<{
    failed: number;
    stuckPending: number;
  }> {
    const cutoff = this.cutoff();
    const [row] = await getDrizzle()
      .select({
        failed: sql<string>`count(*) filter (where ${walletOps.state} = 'FAILED')`,
        stuckPending: sql<string>`count(*) filter (where ${walletOps.state} = 'PENDING' and ${walletOps.createdAt} < ${cutoff})`,
      })
      .from(walletOps);
    return {
      failed: Number(row.failed),
      stuckPending: Number(row.stuckPending),
    };
  }

  private async readBets(): Promise<{
    settlementPending: number;
    stuckPendingStake: number;
  }> {
    const cutoff = this.cutoff();
    const [row] = await getDrizzle()
      .select({
        settlementPending: sql<string>`count(*) filter (where ${bets.status} = 'SETTLEMENT_PENDING')`,
        stuckPendingStake: sql<string>`count(*) filter (where ${bets.status} = 'PENDING_STAKE' and ${bets.placedAt} < ${cutoff})`,
      })
      .from(bets);
    return {
      settlementPending: Number(row.settlementPending),
      stuckPendingStake: Number(row.stuckPendingStake),
    };
  }
}
