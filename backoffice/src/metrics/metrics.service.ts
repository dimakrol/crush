import { Injectable } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

export type CallResult = 'ok' | 'error';

// Owns the single prom-client Registry for the backoffice process: Node runtime
// metrics (collectDefaultMetrics), HTTP RED (fed by MetricsInterceptor), and the
// console's business signal — operator actions and calls to the platform admin
// API. The stuck-work gauges are registered separately by StuckWorkCollector,
// which owns the read-only DB query; this service just exposes its registry.
//
// Every label is a small fixed enum (action/result). Never label by
// userId/txRef/roundId.
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

  private readonly operatorActions = new Counter({
    name: 'operator_actions_total',
    help: 'State-changing operator actions, by derived action name and result',
    labelNames: ['action', 'result'],
    registers: [this.registry],
  });

  private readonly platformAdminCalls = new Counter({
    name: 'platform_admin_calls_total',
    help: 'Server-to-server calls to the platform admin API, by result',
    labelNames: ['result'],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  // Exposed so StuckWorkCollector can register its own gauges on this same
  // registry without this service depending on the read-only Postgres pool.
  get register(): Registry {
    return this.registry;
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

  // Called from AuditGuard, which already derives the stable action name (the
  // same one written to the audit log) and knows the final HTTP status.
  operatorAction(action: string, result: CallResult): void {
    this.operatorActions.inc({ action, result });
  }

  platformAdminCall(result: CallResult): void {
    this.platformAdminCalls.inc({ result });
  }
}
