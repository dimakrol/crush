# Crash Pilot — write-path load test

Load-tests the **platform's HTTP write path** — `POST /api/bets` (place) →
`POST /api/bets/:betId/cashout` — against the local Docker stack, ramps virtual
players until the server buckles, and reports the knee.

It deliberately does **not** touch the Socket.IO realtime path; it exercises the
same money chain the real game does (place → debit at the white-label, cashout →
credit), just from many players at once.

## What's here

| File | Role |
|---|---|
| `seed-load.ts` | Prisma seed — creates `load0..load{N-1}` in the white-label with a shared password and a bottomless balance. Idempotent (also resets balances). |
| `mint-tokens.mjs` | Logs every load player in through the real launch chain and writes `results/tokens.json` (one platform JWT per player). |
| `k6-bets.js` | The k6 scenario — ramping VUs, phase-aware place/cashout, thresholds, summary. |
| `snapshot-metrics.mjs` | Dumps platform + white-label `/metrics` to `results/` before and after. |
| `run.sh` | Orchestrates all of the above. |
| `results/` | Output (git-ignored). |

## Prerequisites

```bash
# 1. Stack up (Postgres, Redis, white-label, platform, …)
docker compose up --build

# 2. k6
brew install k6            # macOS

# 3. white-label deps present (for the Prisma seed)
(cd white-label && npm install)
```

## Run it (the easy way)

```bash
# 500 players, realistic mode (default)
./scripts/loadtest/run.sh

# 1000 players, throughput mode
LOAD_PLAYERS=1000 MODE=B ./scripts/loadtest/run.sh
```

`run.sh` seeds → mints tokens → snapshots metrics → runs the k6 ramp → snapshots
metrics again. Re-running with `SKIP_SEED=1` reuses the existing pool and
`tokens.json`.

## Run it (step by step)

```bash
# from repo root, stack up
(cd white-label && DATABASE_URL=postgresql://whitelabel:whitelabel@localhost:5532/whitelabel \
   LOAD_PLAYERS=500 npx ts-node --transpile-only ../scripts/loadtest/seed-load.ts)

LOAD_PLAYERS=500 node scripts/loadtest/mint-tokens.mjs
node scripts/loadtest/snapshot-metrics.mjs before
k6 run -e MODE=A scripts/loadtest/k6-bets.js
node scripts/loadtest/snapshot-metrics.mjs after
```

> Run `k6` **from the repo root** — the script reads `./results/tokens.json`
> (relative to itself) and writes `scripts/loadtest/results/summary.json`
> (relative to the working directory).

## The two modes

Bets are phase-gated: `place` only succeeds in the ~5s `WAITING` window,
`cashout` only while the round is `RUNNING`. Each VU therefore *polls* the
endpoint it wants until its phase opens — those `400`s are expected and counted
apart from real errors.

- **MODE=A — realistic.** One bet per round, cashout immediately once running,
  1–4s human think-time between rounds. Run against **default** round timings.

- **MODE=B — throughput.** Both slots every round, cashout immediately, no
  think-time. Run against **shortened** round timings so rounds cycle faster.
  Restart the platform with, e.g.:

  ```bash
  # in docker-compose.yml under the platform service env, or an override:
  ROUND_WAITING_SECONDS=2
  ROUND_CRASHED_SECONDS=1
  # then: docker compose up -d --force-recreate platform
  ```

### The throughput ceiling (read this before interpreting numbers)

A player may hold at most **2 bets (slots 1 & 2) per round**, and everyone shares
one round. So:

```
max successful place/s  ≈  activePlayers × 2 / roundCycleSeconds
```

Adding more VUs than seeded players does **not** raise place throughput — extra
VUs just collide on the slot (counted as `dup_bets`, a `409`). To push the server
harder you **seed more players** and/or **shorten the rounds** (MODE=B). This is
why MODE=B pairs a bigger pool with faster rounds rather than a longer window.

> Seed at least as many players as your peak VUs (`LOAD_PLAYERS` ≥ top ramp
> `target`) so each VU owns a distinct player.

## The knee (thresholds)

The ramp **aborts** the moment any of these breaks — that abort *is* the knee:

| Signal | Threshold |
|---|---|
| `place_duration` p95 | `< 500 ms` |
| `cashout_duration` p95 | `< 500 ms` |
| `errors` (real 5xx / timeout / conn-refused / 401 only) | `< 5 %` |

Set `ABORT=false` to ride the full ramp and read degradation across every stage
instead of stopping at the first breach.

Expected, **not** counted as errors: `phase_rejects` (400 while waiting for the
window), `dup_bets` (409, slot taken), `bet_lost` (round crashed before cashout).

## Tunables (env)

| Var | Default | Meaning |
|---|---|---|
| `LOAD_PLAYERS` | `500` | pool size (seed + mint + VU assignment) |
| `MODE` | `A` | `A` realistic / `B` throughput |
| `STAGES` | 50→200→500→1000→2000 | JSON k6 ramp stages |
| `ABORT` | `true` | abort ramp on first threshold breach |
| `BET_AMOUNT` | `1` | stake per bet (major units) |
| `THINK_MIN`/`THINK_MAX` | `1`/`4` | MODE A between-round think-time (s) |
| `POLL_MS` | `250` | phase-poll backoff |
| `LOAD_BALANCE_MINOR` | `1000000000` | seeded balance per player (minor units) |
| `PLATFORM_URL`/`WL_URL` | `:4100`/`:4200` | targets |
| `DATABASE_URL` | `…@localhost:5532/whitelabel` | seed target |
| `SKIP_SEED` | `0` | `1` = reuse pool + tokens.json |

## Output

- `results/summary.json` — full k6 metrics (percentiles, RPS, per-endpoint).
- `results/summary` text — printed to stdout at the end (p50/p95/p99, error
  rate, knee).
- `results/metrics-before-*.txt`, `results/metrics-after-*.txt` — server-side
  RED snapshots (also visible live in the existing Grafana under `monitoring/`).

## Cleanup

Load players persist in the white-label DB (`load*`). Re-running the seed resets
their balances. To remove them entirely, delete the `load%` players (and their
wallets/transactions) directly in Postgres.
