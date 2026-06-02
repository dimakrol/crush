#!/usr/bin/env node
// White-label integration smoke test — no browser harness.
//
// Exercises the full money chain end-to-end against the running stack:
//   lobby login → mint launch token → platform launch (authenticate) →
//   debit (bet) → credit (win) → idempotency + single-use + reconciliation.
//
// The white-label is the money authority; the platform is a thin HMAC client.
// This script plays BOTH browser roles (lobby + game) and the platform's
// server-to-server role, so it depends only on the two HTTP surfaces.
//
// Run the stack first:  docker compose up --build
// Then:                 node scripts/whitelabel-smoke.mjs
//
// Env overrides (defaults match docker-compose):
//   WL_URL, PLATFORM_URL, OPERATOR_API_KEY, OPERATOR_SECRET, DEMO_USER, DEMO_PASS
import { createHmac } from 'node:crypto'

const WL = process.env.WL_URL ?? 'http://localhost:4200'
const PLATFORM = process.env.PLATFORM_URL ?? 'http://localhost:4100'
const API_KEY = process.env.OPERATOR_API_KEY ?? 'dev-operator-key'
const SECRET = process.env.OPERATOR_SECRET ?? 'dev-operator-secret-change-me'
const USER = process.env.DEMO_USER ?? 'demo1'
const PASS = process.env.DEMO_PASS ?? 'demo1'

let pass = 0
let fail = 0
const ok = (cond, msg) => {
  if (cond) {
    pass++
    console.log(`  \x1b[32m✓\x1b[0m ${msg}`)
  } else {
    fail++
    console.log(`  \x1b[31m✗ ${msg}\x1b[0m`)
  }
}

// --- transports -----------------------------------------------------------
async function json(res) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { _raw: text }
  }
}

// Server-to-server wallet/admin call, signed exactly like the platform's
// operator.client.ts: X-Signature = HMAC-SHA256(secret, `${ts}${rawBody}`).
async function operatorPost(path, body) {
  const rawBody = JSON.stringify(body ?? {})
  const ts = Date.now().toString()
  const signature = createHmac('sha256', SECRET).update(`${ts}${rawBody}`).digest('hex')
  const res = await fetch(`${WL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': API_KEY,
      'X-Timestamp': ts,
      'X-Signature': signature,
    },
    body: rawBody,
  })
  return { status: res.status, body: await json(res) }
}

async function post(base, path, body, token) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  })
  return { status: res.status, body: await json(res) }
}

async function get(base, path, token) {
  const res = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  return { status: res.status, body: await json(res) }
}

// WL balance is authoritative integer minor units; platform balance is decimal.
const wlBalance = async (playerId, currency) =>
  (await operatorPost('/wallet/balance', { playerId, currency })).body.balance

// --- the run --------------------------------------------------------------
async function main() {
  console.log('\nWhite-label integration smoke\n' + '─'.repeat(48))

  // 1) Lobby login (the casino's own session).
  console.log('\n[1] Lobby login')
  const login = await post(WL, '/auth/login', { username: USER, password: PASS })
  ok(login.status === 200, `POST /auth/login → 200 (got ${login.status})`)
  const lobbyToken = login.body.token
  const player = login.body.player ?? {}
  ok(!!lobbyToken, 'lobby JWT returned')
  ok(!!player.id, `player.id present (${player.id})`)
  const currency = player.currency ?? 'USD'
  ok(currency === 'USD', `currency = USD (got ${currency})`)
  const pid = player.id

  // Capture the authoritative starting balance straight from the ledger.
  const startMinor = await wlBalance(pid, currency)
  ok(Number.isInteger(startMinor) && startMinor > 0, `seed balance = ${startMinor} minor`)

  // 2) Mint a single-use launch token for the iframe.
  console.log('\n[2] Mint launch token')
  const launch = await post(WL, '/sessions/launch', { gameId: 'crash-pilot' }, lobbyToken)
  ok(launch.status === 200, `POST /sessions/launch → 200 (got ${launch.status})`)
  const launchToken = launch.body.launchToken
  ok(!!launchToken, 'launchToken returned')
  ok(
    typeof launch.body.gameUrl === 'string' && launch.body.gameUrl.includes(`token=${launchToken}`),
    'gameUrl embeds the token + currency',
  )

  // 3) Platform exchanges the launch token for its own session JWT.
  //    (Internally the platform calls WL /wallet/authenticate over HMAC.)
  console.log('\n[3] Platform launch (authenticate)')
  const ex = await post(PLATFORM, '/api/auth/launch', { token: launchToken })
  ok(ex.status === 200 || ex.status === 201, `POST /api/auth/launch → 2xx (got ${ex.status})`)
  const pl = ex.body.data ?? {}
  const accessToken = pl.accessToken
  ok(!!accessToken, 'platform accessToken returned')
  ok(pl.player?.id === pid, 'platform player.id matches the lobby player')
  ok(pl.player?.currency === currency, `platform player.currency = ${currency}`)
  // Platform balance is decimal; reconcile against the minor-unit ledger.
  ok(
    Math.round((pl.player?.balance ?? -1) * 100) === startMinor,
    `platform balance ${pl.player?.balance} ↔ ${startMinor} minor`,
  )

  // 4) Single-use: replaying the same launch token must be rejected.
  console.log('\n[4] Launch token is single-use')
  const replay = await post(PLATFORM, '/api/auth/launch', { token: launchToken })
  ok(replay.status === 401, `replayed launch → 401 (got ${replay.status})`)
  ok(
    replay.body.error?.code === 'LAUNCH_TOKEN_ALREADY_USED',
    `error code LAUNCH_TOKEN_ALREADY_USED (got ${replay.body.error?.code})`,
  )

  // 5) Platform live balance reconciles with the ledger.
  console.log('\n[5] Platform /api/wallet reconciles')
  const w = await get(PLATFORM, '/api/wallet', accessToken)
  ok(w.status === 200, `GET /api/wallet → 200 (got ${w.status})`)
  ok(
    Math.round((w.body.data?.balance ?? -1) * 100) === startMinor,
    `live balance ${w.body.data?.balance} ↔ ${startMinor} minor`,
  )

  // 6) Money path: debit a stake, then credit a win — exactly what BetService
  //    does per round, with deterministic game-generated txRefs.
  console.log('\n[6] Debit (bet) → credit (win)')
  const runId = `smoke-${Date.now()}`
  const STAKE = 500 // minor units
  const WIN = 1250 // minor units (== stake × 2.5)
  const betRef = `${runId}:${pid}:1:bet`
  const winRef = `${runId}:${pid}:1:win`

  const debit = await operatorPost('/wallet/debit', {
    playerId: pid,
    currency,
    txRef: betRef,
    amount: STAKE,
    roundId: runId,
    slotId: 1,
    gameId: 'crash-pilot',
  })
  ok(debit.status === 200, `debit → 200 (got ${debit.status})`)
  ok(debit.body.balance === startMinor - STAKE, `balance after debit = ${startMinor - STAKE}`)

  const credit = await operatorPost('/wallet/credit', {
    playerId: pid,
    currency,
    txRef: winRef,
    amount: WIN,
    roundId: runId,
    slotId: 1,
    gameId: 'crash-pilot',
  })
  ok(credit.status === 200, `credit → 200 (got ${credit.status})`)
  ok(credit.body.balance === startMinor - STAKE + WIN, `balance after credit = ${startMinor - STAKE + WIN}`)

  // 7) Idempotency: replaying a txRef returns the ORIGINAL recorded snapshot
  //    (balanceAfter at the time) and never moves money again.
  console.log('\n[7] txRef idempotency (no double spend / double pay)')
  const liveAfterRound = await wlBalance(pid, currency)
  const debit2 = await operatorPost('/wallet/debit', {
    playerId: pid,
    currency,
    txRef: betRef,
    amount: STAKE,
    roundId: runId,
    slotId: 1,
  })
  ok(debit2.body.balance === startMinor - STAKE, 'replayed debit returns its original snapshot')
  const credit2 = await operatorPost('/wallet/credit', {
    playerId: pid,
    currency,
    txRef: winRef,
    amount: WIN,
    roundId: runId,
    slotId: 1,
  })
  ok(credit2.body.balance === startMinor - STAKE + WIN, 'replayed credit returns its original snapshot')
  ok((await wlBalance(pid, currency)) === liveAfterRound, 'live ledger unchanged after replays')

  // 8) Overdraft is rejected atomically.
  console.log('\n[8] Overdraft rejected')
  const over = await operatorPost('/wallet/debit', {
    playerId: pid,
    currency,
    txRef: `${runId}:${pid}:over:bet`,
    amount: startMinor * 100,
  })
  ok(over.status === 402 || over.status === 400 || over.status === 422, `overdraft → 4xx (got ${over.status})`)
  ok(
    over.body.error?.code === 'INSUFFICIENT_BALANCE',
    `error code INSUFFICIENT_BALANCE (got ${over.body.error?.code})`,
  )

  // 9) HMAC enforcement: an unsigned wallet call is refused.
  console.log('\n[9] Wallet API rejects unsigned calls')
  const unsigned = await fetch(`${WL}/wallet/balance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: pid, currency }),
  })
  ok(unsigned.status === 401, `unsigned /wallet/balance → 401 (got ${unsigned.status})`)

  // 10) Reset the demo player so the script is rerunnable from a clean ledger.
  console.log('\n[10] Admin reset (restore seed balance)')
  const reset = await operatorPost(`/admin/players/${pid}/reset`, {})
  ok(reset.status === 200, `admin reset → 200 (got ${reset.status})`)
  const finalMinor = await wlBalance(pid, currency)
  ok(finalMinor === startMinor, `balance restored to seed (${finalMinor} == ${startMinor})`)

  // --- summary --------------------------------------------------------------
  console.log('\n' + '─'.repeat(48))
  console.log(`${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass}/${pass + fail} checks passed\x1b[0m\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\n\x1b[31mSmoke run crashed:\x1b[0m', err)
  process.exit(1)
})
