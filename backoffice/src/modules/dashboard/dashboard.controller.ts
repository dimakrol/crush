import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { getDrizzle } from '../../config/postgres';
import { bets, walletOps } from '../../drizzle/platform.schema';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors/AppError';
import { logger } from '../../shared/utils/logger';
import { EngineState } from '../engine/engine.controller';
import { PlatformAdminClient } from '../platform/platform-admin.client';

// The screen an operator leaves open. Two independent halves: what the engine is
// doing (only the platform knows) and what is stuck (only the database knows).
// They fail independently on purpose — the counters are exactly what you want to
// see when the platform is the thing that is down.
@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly platform: PlatformAdminClient) {}

  @Get()
  async get() {
    const [engine, counters] = await Promise.all([
      this.readEngine(),
      this.readCounters(),
    ]);

    return {
      data: {
        engine: engine.state,
        engineError: engine.error,
        counters,
        stuckAfterMinutes: env.STUCK_OP_MINUTES,
      },
    };
  }

  private async readEngine(): Promise<{
    state: EngineState | null;
    error: string | null;
  }> {
    try {
      return {
        state: await this.platform.get<EngineState>('/api/admin/engine'),
        error: null,
      };
    } catch (err) {
      // Reported in the payload rather than thrown: a dashboard that returns
      // 502 because the game is down is a dashboard that goes blank exactly
      // when it is needed.
      const message =
        err instanceof AppError ? err.message : (err as Error).message;
      logger.warn('Dashboard could not read engine state', { error: message });
      return { state: null, error: message };
    }
  }

  // One query per table instead of one per counter: these are unindexed
  // predicates (the platform indexes what the game asks for, not what an
  // operator console asks for) and this screen polls every few seconds, so the
  // scan is paid twice rather than four times.
  private async readCounters() {
    const db = getDrizzle();
    const cutoff = new Date(Date.now() - env.STUCK_OP_MINUTES * 60_000);

    const [ops] = await db
      .select({
        failed: sql<string>`count(*) filter (where ${walletOps.state} = 'FAILED')`,
        stuckPending: sql<string>`count(*) filter (where ${walletOps.state} = 'PENDING' and ${walletOps.createdAt} < ${cutoff})`,
      })
      .from(walletOps);

    const [betRows] = await db
      .select({
        settlementPending: sql<string>`count(*) filter (where ${bets.status} = 'SETTLEMENT_PENDING')`,
        stuckPendingStake: sql<string>`count(*) filter (where ${bets.status} = 'PENDING_STAKE' and ${bets.placedAt} < ${cutoff})`,
      })
      .from(bets);

    // count() is bigint, which the driver returns as a string so nothing is
    // silently truncated; these are small enough to be numbers by the time they
    // reach a browser.
    return {
      walletOpsFailed: Number(ops.failed),
      walletOpsStuckPending: Number(ops.stuckPending),
      betsSettlementPending: Number(betRows.settlementPending),
      betsStuckPendingStake: Number(betRows.stuckPendingStake),
    };
  }
}
