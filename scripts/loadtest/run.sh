#!/usr/bin/env bash
# Orchestrates one write-path load run end to end:
#   seed load players → mint JWTs → snapshot /metrics → k6 ramp → snapshot /metrics
#
# Prerequisites (see README.md):
#   - stack up:            docker compose up --build
#   - k6 installed:        brew install k6
#   - white-label deps:    (cd white-label && npm install)
#
# Everything is tunable via env, e.g.:
#   LOAD_PLAYERS=1000 MODE=B ./scripts/loadtest/run.sh
set -euo pipefail

# Resolve repo root from this script's location so k6's relative output paths
# (scripts/loadtest/results/...) line up.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

# ── config (override via env) ────────────────────────────────────────────────
export PLATFORM_URL="${PLATFORM_URL:-http://localhost:4100}"
export WL_URL="${WL_URL:-http://localhost:4200}"
export LOAD_PLAYERS="${LOAD_PLAYERS:-500}"
export LOAD_PASSWORD="${LOAD_PASSWORD:-loadtest}"
export LOAD_PREFIX="${LOAD_PREFIX:-load}"
export MODE="${MODE:-A}"
export DATABASE_URL="${DATABASE_URL:-postgresql://whitelabel:whitelabel@localhost:5532/whitelabel}"

SKIP_SEED="${SKIP_SEED:-0}"   # set 1 to reuse an existing pool + tokens.json

echo "▶ Crash Pilot load run  mode=$MODE  players=$LOAD_PLAYERS"
echo "  PLATFORM=$PLATFORM_URL  WL=$WL_URL"

if [ "$SKIP_SEED" != "1" ]; then
  echo
  echo "▶ [1/5] Seeding $LOAD_PLAYERS players via Prisma (white-label)…"
  # Run from white-label so @prisma/client + bcrypt resolve; NODE_PATH lets the
  # entry file (outside white-label) find them too. transpile-only skips the
  # rootDir/type-check friction of running a TS file from another directory.
  ( cd "$ROOT/white-label" \
    && NODE_PATH="$ROOT/white-label/node_modules" TS_NODE_TRANSPILE_ONLY=1 \
       npx ts-node --transpile-only "$ROOT/scripts/loadtest/seed-load.ts" )

  echo
  echo "▶ [2/5] Minting JWTs…"
  node "$SCRIPT_DIR/mint-tokens.mjs"
else
  echo "▶ [1-2/5] SKIP_SEED=1 — reusing existing pool + results/tokens.json"
fi

echo
echo "▶ [3/5] Metrics snapshot (before)…"
node "$SCRIPT_DIR/snapshot-metrics.mjs" before

echo
echo "▶ [4/5] k6 ramp-to-failure…"
# k6 reads MODE/PLATFORM_URL/etc from the environment (already exported above).
k6 run "$SCRIPT_DIR/k6-bets.js" || echo "  (k6 exited non-zero — a breached threshold is the expected 'knee' signal)"

echo
echo "▶ [5/5] Metrics snapshot (after)…"
node "$SCRIPT_DIR/snapshot-metrics.mjs" after

echo
echo "✔ Done. Results in scripts/loadtest/results/ :"
echo "    summary.json                     k6 client-side metrics"
echo "    metrics-before-*.txt / after-*   server-side /metrics snapshots"
