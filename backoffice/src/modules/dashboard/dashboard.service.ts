import { Injectable } from '@nestjs/common';
import { env } from '../../config/env';
import { AppError } from '../../shared/errors/AppError';
import { logger } from '../../shared/utils/logger';
import { EngineState } from '../engine/engine.controller';
import { PlatformAdminClient } from '../platform/platform-admin.client';
import { DashboardRepository } from './dashboard.repository';

// The screen an operator leaves open. Two independent halves: what the engine is
// doing (only the platform knows) and what is stuck (only the database knows).
// They fail independently on purpose — the counters are exactly what you want to
// see when the platform is the thing that is down.
@Injectable()
export class DashboardService {
  constructor(
    private readonly repo: DashboardRepository,
    private readonly platform: PlatformAdminClient,
  ) {}

  async snapshot() {
    const [engine, counters] = await Promise.all([
      this.readEngine(),
      this.readCounters(),
    ]);

    return {
      engine: engine.state,
      engineError: engine.error,
      counters,
      stuckAfterMinutes: env.STUCK_OP_MINUTES,
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

  private async readCounters() {
    const [ops, betRows] = await Promise.all([
      this.repo.walletOpsCounts(),
      this.repo.betsCounts(),
    ]);
    return {
      walletOpsFailed: ops.failed,
      walletOpsStuckPending: ops.stuckPending,
      betsSettlementPending: betRows.settlementPending,
      betsStuckPendingStake: betRows.stuckPendingStake,
    };
  }
}
