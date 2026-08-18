import { Injectable } from '@nestjs/common'
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client'

// Owns the single prom-client Registry for this process: Node runtime metrics
// (event loop lag, heap/RSS, GC, CPU — via collectDefaultMetrics), HTTP RED
// (fed by MetricsInterceptor), and the platform's business counters. Injected
// into the game/bet/wallet services so a domain event is one method call away.
//
// Cardinality is deliberate: every label here is a small fixed enum
// (kind/outcome/result). Never label by roundId/userId/txRef.
@Injectable()
export class MetricsService {
  private readonly registry = new Registry()

  // ── HTTP RED (rate / errors / duration) ────────────────────────────────────
  private readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds, labelled by method/route/status',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  })

  // ── Business ───────────────────────────────────────────────────────────────
  private readonly betsPlaced = new Counter({
    name: 'bets_placed_total',
    help: 'Bets successfully placed (stake confirmed)',
    registers: [this.registry],
  })

  private readonly betsCashedOut = new Counter({
    name: 'bets_cashed_out_total',
    help: 'Bets cashed out, by trigger',
    labelNames: ['kind'],
    registers: [this.registry],
  })

  private readonly roundsEnded = new Counter({
    name: 'rounds_total',
    help: 'Rounds ended, by outcome',
    labelNames: ['outcome'],
    registers: [this.registry],
  })

  private readonly crashMultiplier = new Histogram({
    name: 'round_crash_multiplier',
    help: 'Crash multiplier at round end',
    buckets: [1.1, 1.5, 2, 3, 5, 10, 20, 50, 100],
    registers: [this.registry],
  })

  private readonly walletOpsEnqueued = new Counter({
    name: 'wallet_ops_enqueued_total',
    help: 'Wallet outbox ops enqueued, by kind',
    labelNames: ['kind'],
    registers: [this.registry],
  })

  private readonly walletOpsProcessed = new Counter({
    name: 'wallet_ops_processed_total',
    help: 'Wallet outbox ops processed by the worker, by result',
    labelNames: ['result'],
    registers: [this.registry],
  })

  private readonly walletOutboxBacklog = new Gauge({
    name: 'wallet_outbox_backlog',
    help: 'Wallet ops claimed in the most recent outbox drain batch',
    registers: [this.registry],
  })

  constructor() {
    collectDefaultMetrics({ register: this.registry })
  }

  get contentType(): string {
    return this.registry.contentType
  }

  metrics(): Promise<string> {
    return this.registry.metrics()
  }

  // Returns prom-client's end-timer closure; the interceptor calls it with the
  // resolved labels once the request completes.
  startHttpTimer() {
    return this.httpDuration.startTimer()
  }

  betPlaced(): void {
    this.betsPlaced.inc()
  }

  betCashedOut(kind: 'manual' | 'auto', count = 1): void {
    if (count > 0) this.betsCashedOut.inc({ kind }, count)
  }

  roundEnded(outcome: 'crashed' | 'forced', crashPoint: number): void {
    this.roundsEnded.inc({ outcome })
    this.crashMultiplier.observe(crashPoint)
  }

  walletOpEnqueued(kind: string, count = 1): void {
    if (count > 0) this.walletOpsEnqueued.inc({ kind }, count)
  }

  walletOpProcessed(result: 'confirmed' | 'failed' | 'retried' | 'abandoned'): void {
    this.walletOpsProcessed.inc({ result })
  }

  setWalletOutboxBacklog(size: number): void {
    this.walletOutboxBacklog.set(size)
  }
}
