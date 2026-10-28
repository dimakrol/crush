// Crash Pilot — write-path load test (k6).
//
// Drives the platform's HTTP write path only:  POST /api/bets (place) →
// POST /api/bets/:betId/cashout. Every VU is one pre-authenticated load player
// (tokens minted by mint-tokens.mjs into results/tokens.json).
//
// Why it retries instead of hammering: bets are phase-gated. place is a 400
// ROUND_NOT_WAITING outside the ~5s waiting window; cashout is a 400
// ROUND_NOT_RUNNING until the round is flying. So each VU polls the endpoint it
// wants until its phase opens. Those 400s are EXPECTED and counted separately —
// they are not server errors. Only 5xx / timeouts / connection failures / 401 /
// unexpected 4xx count toward the error rate that defines the knee.
//
// Domain ceiling worth remembering when reading throughput: a player may hold at
// most 2 bets (slots 1 & 2) per round, so max successful place/s ≈
// activePlayers × 2 / roundCycleSeconds. To push higher you seed MORE players
// and/or run the platform with SHORTER rounds — not more VUs per player.
//
// Modes (env MODE):
//   A (default, realistic) — 1 bet/round, immediate cashout, human think-time
//                            between rounds. Run against DEFAULT round timings.
//   B (throughput)         — both slots every round, immediate cashout, no
//                            think-time. Run against SHORTENED round timings
//                            (see README) to maximise rounds/min.
//
// Run from repo root:
//   k6 run -e MODE=A scripts/loadtest/k6-bets.js
import http from 'k6/http'
import { sleep } from 'k6'
import { Trend, Rate, Counter } from 'k6/metrics'
import { SharedArray } from 'k6/data'

const PLATFORM = __ENV.PLATFORM_URL || 'http://localhost:4100'
const MODE = (__ENV.MODE || 'A').toUpperCase()
const BET_AMOUNT = Number(__ENV.BET_AMOUNT || '1')
const POLL_MS = Number(__ENV.POLL_MS || '250')
const MAX_WAIT_PLACE = Number(__ENV.MAX_WAIT_PLACE || '80') // poll attempts before giving up on a window
const MAX_WAIT_CASHOUT = Number(__ENV.MAX_WAIT_CASHOUT || '80')
const THINK_MIN = Number(__ENV.THINK_MIN || '1') // MODE A only, seconds
const THINK_MAX = Number(__ENV.THINK_MAX || '4')
const REQ_TIMEOUT = __ENV.REQ_TIMEOUT || '10s'
// abortOnFail: stop the ramp the moment a threshold breaks — that IS the knee.
// Set ABORT=false to ride the whole ramp and read degradation across all stages.
const ABORT = (__ENV.ABORT || 'true') === 'true'

const tokens = new SharedArray('tokens', function () {
  const raw = JSON.parse(open(__ENV.TOKENS_FILE || './results/tokens.json'))
  if (!raw.tokens || raw.tokens.length === 0) throw new Error('tokens.json has no tokens — run mint-tokens.mjs first')
  return raw.tokens
})

// Successful-request latencies (ms). Trend(true) => rendered as time.
const placeDur = new Trend('place_duration', true)
const cashoutDur = new Trend('cashout_duration', true)
// The knee signals.
const errors = new Rate('errors') // real failures only
// Expected / bookkeeping, kept out of `errors`.
const phaseRejects = new Counter('phase_rejects') // 400 ROUND_NOT_WAITING while polling
const placeOk = new Counter('place_success')
const cashoutOk = new Counter('cashout_success')
const dupBets = new Counter('dup_bets') // 409 — slot already taken this round
const betLost = new Counter('bet_lost') // round crashed before we cashed out

// Default ramp scales with the player pool: peak VUs = number of minted tokens
// (one VU per player — more VUs than players just collide on the same bet slots
// and measure lock contention, not capacity). Override the peak with PEAK_VUS,
// or the whole ramp with STAGES.
const PEAK_VUS = Math.max(1, Number(__ENV.PEAK_VUS || tokens.length))
const RAMP_FRACTIONS = [0.025, 0.1, 0.25, 0.5, 1]
const stages = __ENV.STAGES
  ? JSON.parse(__ENV.STAGES)
  : [
      ...RAMP_FRACTIONS.map((f) => ({ duration: '30s', target: Math.max(1, Math.round(PEAK_VUS * f)) })),
      { duration: '20s', target: 0 },
    ]

// Fixed-participation mode: ROUND_PLAYERS=N holds exactly N VUs (one per player)
// for ROUND_DURATION instead of ramping. Every VU bets once per round window and
// goes straight back to polling for the next one (no think-time), so N players
// play in every round. N must not exceed the minted pool.
const ROUND_PLAYERS = Number(__ENV.ROUND_PLAYERS || '0')
if (ROUND_PLAYERS > tokens.length) {
  throw new Error(`ROUND_PLAYERS=${ROUND_PLAYERS} > ${tokens.length} minted tokens — raise LOAD_PLAYERS`)
}
const ROUND_DURATION = __ENV.ROUND_DURATION || '2m'

const betsScenario =
  ROUND_PLAYERS > 0
    ? { executor: 'constant-vus', vus: ROUND_PLAYERS, duration: ROUND_DURATION, gracefulStop: '15s' }
    : { executor: 'ramping-vus', startVUs: 0, stages, gracefulRampDown: '10s', gracefulStop: '15s' }

export const options = {
  scenarios: { bets: betsScenario },
  thresholds: {
    place_duration: [{ threshold: 'p(95)<500', abortOnFail: ABORT, delayAbortEval: '10s' }],
    cashout_duration: [{ threshold: 'p(95)<500', abortOnFail: ABORT, delayAbortEval: '10s' }],
    errors: [{ threshold: 'rate<0.05', abortOnFail: ABORT, delayAbortEval: '10s' }],
  },
}

function authFor(vu) {
  const cred = tokens[(vu - 1) % tokens.length]
  return {
    headers: { Authorization: `Bearer ${cred.token}`, 'Content-Type': 'application/json' },
    timeout: REQ_TIMEOUT,
  }
}

// Platform error bodies are { error: { code, message } }.
function codeOf(res) {
  try {
    return res.json('error.code')
  } catch (e) {
    return null
  }
}

function place(auth, slot) {
  const params = Object.assign({}, auth, { tags: { name: 'place' } })
  const body = JSON.stringify({ slotId: slot, amount: BET_AMOUNT })
  for (let i = 0; i < MAX_WAIT_PLACE; i++) {
    const res = http.post(`${PLATFORM}/api/bets`, body, params)
    if (res.status === 201 || res.status === 200) {
      placeDur.add(res.timings.duration)
      placeOk.add(1)
      errors.add(false)
      try {
        return res.json('data.bet.id')
      } catch (e) {
        return null
      }
    }
    if (res.status === 400 && codeOf(res) === 'ROUND_NOT_WAITING') {
      phaseRejects.add(1)
      sleep(POLL_MS / 1000)
      continue
    }
    if (res.status === 409) {
      dupBets.add(1) // slot already used this round — nothing more to do
      return null
    }
    errors.add(true) // 5xx / 0 (network) / 401 / unexpected 4xx
    return null
  }
  return null // window never opened within budget — not a server error
}

function cashout(auth, betId) {
  const params = Object.assign({}, auth, { tags: { name: 'cashout' } })
  for (let i = 0; i < MAX_WAIT_CASHOUT; i++) {
    const res = http.post(`${PLATFORM}/api/bets/${betId}/cashout`, null, params)
    if (res.status === 200 || res.status === 201) {
      cashoutDur.add(res.timings.duration)
      cashoutOk.add(1)
      errors.add(false)
      return
    }
    if (res.status === 400 && codeOf(res) === 'ROUND_NOT_RUNNING') {
      sleep(POLL_MS / 1000)
      continue
    }
    if (res.status === 409) {
      betLost.add(1) // crashed before we cashed — the stake is a loss, not an error
      return
    }
    errors.add(true)
    return
  }
}

export default function () {
  const auth = authFor(__VU)
  const slots = MODE === 'B' ? [1, 2] : [1]

  const betIds = []
  for (const slot of slots) {
    const id = place(auth, slot)
    if (id) betIds.push(id)
  }
  for (const id of betIds) cashout(auth, id)

  if (MODE === 'A' && ROUND_PLAYERS === 0) sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN))
}

// ── summary ────────────────────────────────────────────────────────────────
function val(data, name, field) {
  const m = data.metrics[name]
  return m && m.values ? m.values[field] : undefined
}

function textSummary(data) {
  const f = (v, d = 2) => (v === undefined ? 'n/a' : Number(v).toFixed(d))
  const c = (name) => val(data, name, 'count') || 0
  const L = []
  L.push('')
  L.push('══════ Crash Pilot — write-path load test ══════')
  L.push(`mode:              ${MODE}`)
  L.push(`place   p50/p95/p99 (ms): ${f(val(data, 'place_duration', 'p(50)'))} / ${f(val(data, 'place_duration', 'p(95)'))} / ${f(val(data, 'place_duration', 'p(99)'))}`)
  L.push(`cashout p50/p95/p99 (ms): ${f(val(data, 'cashout_duration', 'p(50)'))} / ${f(val(data, 'cashout_duration', 'p(95)'))} / ${f(val(data, 'cashout_duration', 'p(99)'))}`)
  L.push('')
  L.push(`place success:     ${c('place_success')}`)
  L.push(`cashout success:   ${c('cashout_success')}`)
  L.push(`ERROR RATE:        ${f((val(data, 'errors', 'rate') || 0) * 100)} %   (real 5xx/timeout/conn only — knee if >5%)`)
  L.push(`http_req_duration p95 (ms): ${f(val(data, 'http_req_duration', 'p(95)'))}`)
  L.push('')
  L.push('— expected, not errors —')
  L.push(`phase rejects:     ${c('phase_rejects')}   (400 while waiting for the round window)`)
  L.push(`dup bets (409):    ${c('dup_bets')}   (slot already taken this round)`)
  L.push(`bet lost (crash):  ${c('bet_lost')}   (round crashed before cashout)`)
  L.push('')
  L.push(`iterations:        ${c('iterations')}`)
  L.push(`max VUs:           ${f(val(data, 'vus_max', 'value'), 0)}`)
  L.push('')
  L.push('Full detail → scripts/loadtest/results/summary.json')
  L.push('')
  return L.join('\n')
}

export function handleSummary(data) {
  return {
    'scripts/loadtest/results/summary.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  }
}
