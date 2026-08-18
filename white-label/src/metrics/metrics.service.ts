import { Injectable } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

export type MovementType = 'debit' | 'credit' | 'rollback';
export type MovementResult = 'success' | 'failed' | 'replayed';

// Owns the single prom-client Registry for the white-label process: Node runtime
// metrics (collectDefaultMetrics), HTTP RED (fed by MetricsInterceptor), and the
// operator's business signal — synchronous seamless-wallet money movements.
//
// This service has no outbox/bets/rounds (those live in the platform); the money
// story here is the debit/credit/rollback calls in WalletService.
//
// Every label is a small fixed enum (type/result). Never label by
// playerId/txRef/roundId.
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  private readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds, labelled by method/route/status',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  private readonly walletMovements = new Counter({
    name: 'wallet_movements_total',
    help: 'Seamless-wallet money movements, by type and result',
    labelNames: ['type', 'result'],
    registers: [this.registry],
  });

  private readonly walletMovementDuration = new Histogram({
    name: 'wallet_movement_duration_seconds',
    help: 'Seamless-wallet movement latency in seconds, by type',
    labelNames: ['type'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  startHttpTimer() {
    return this.httpDuration.startTimer();
  }

  // Returns the end-timer closure for one wallet movement; call it once the
  // movement resolves (in a finally, so failures are timed too).
  startWalletTimer(type: MovementType) {
    return this.walletMovementDuration.startTimer({ type });
  }

  walletMovement(type: MovementType, result: MovementResult): void {
    this.walletMovements.inc({ type, result });
  }
}
