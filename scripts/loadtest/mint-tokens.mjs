#!/usr/bin/env node
// Mints a platform session JWT for every load player and writes them to
// results/tokens.json for the k6 script to consume.
//
// It replays the exact browser launch chain the real game uses (and that
// scripts/whitelabel-smoke.mjs verifies), once per player:
//   WL  POST /auth/login            → lobby JWT
//   WL  POST /sessions/launch       → reusable launch token (4h TTL)
//   API POST /api/auth/launch       → platform accessToken (JWT, 4h/7d TTL)
//
// The tokens comfortably outlive a ramp run (minutes), so we mint once up front
// and hand k6 a static list — no auth cost inside the measured load.
//
// Run AFTER seed-load.ts, with the stack up:
//   LOAD_PLAYERS=500 node scripts/loadtest/mint-tokens.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WL = process.env.WL_URL ?? 'http://localhost:4200'
const PLATFORM = process.env.PLATFORM_URL ?? 'http://localhost:4100'
const COUNT = Number(process.env.LOAD_PLAYERS ?? '500')
const PREFIX = process.env.LOAD_PREFIX ?? 'load'
const PASSWORD = process.env.LOAD_PASSWORD ?? 'loadtest'
const GAME_ID = process.env.GAME_ID ?? 'crash-pilot'
const CONCURRENCY = Number(process.env.MINT_CONCURRENCY ?? '20')

const __dir = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dir, 'results', 'tokens.json')

async function json(res) {
  const t = await res.text()
  try {
    return t ? JSON.parse(t) : {}
  } catch {
    return { _raw: t }
  }
}

async function mintOne(i) {
  const username = `${PREFIX}${i}`

  const login = await fetch(`${WL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  })
  if (!login.ok) throw new Error(`${username}: /auth/login → ${login.status}`)
  const lb = await json(login)
  const lobbyToken = lb.token
  const playerId = lb.player?.id
  if (!lobbyToken) throw new Error(`${username}: no lobby token`)

  const launch = await fetch(`${WL}/sessions/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lobbyToken}` },
    body: JSON.stringify({ gameId: GAME_ID }),
  })
  if (!launch.ok) throw new Error(`${username}: /sessions/launch → ${launch.status}`)
  const launchToken = (await json(launch)).launchToken
  if (!launchToken) throw new Error(`${username}: no launch token`)

  const ex = await fetch(`${PLATFORM}/api/auth/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: launchToken }),
  })
  if (!ex.ok) throw new Error(`${username}: /api/auth/launch → ${ex.status}`)
  const token = (await json(ex)).data?.accessToken
  if (!token) throw new Error(`${username}: no accessToken`)

  return { username, playerId, token }
}

async function main() {
  mkdirSync(dirname(OUT), { recursive: true })
  console.log(`Minting JWTs for ${COUNT} players (${PREFIX}0..${PREFIX}${COUNT - 1}), concurrency=${CONCURRENCY}`)
  console.log(`  WL=${WL}  PLATFORM=${PLATFORM}`)

  const tokens = new Array(COUNT).fill(null)
  let done = 0
  let failed = 0
  let cursor = 0

  async function worker() {
    for (;;) {
      const i = cursor++
      if (i >= COUNT) return
      try {
        tokens[i] = await mintOne(i)
      } catch (err) {
        failed++
        if (failed <= 10) console.error(`\n  ${err.message}`)
      }
      done++
      if (done % 50 === 0 || done === COUNT) process.stdout.write(`\r  ${done}/${COUNT} (failed ${failed})`)
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, COUNT) }, worker))

  const good = tokens.filter(Boolean)
  writeFileSync(
    OUT,
    JSON.stringify({ mintedAt: new Date().toISOString(), platform: PLATFORM, count: good.length, tokens: good }, null, 2),
  )
  console.log(`\nWrote ${good.length} tokens → ${OUT}${failed ? ` (failed ${failed})` : ''}`)
  if (good.length === 0) {
    console.error('No tokens minted — is the stack up and seeded? (docker compose up, then seed-load.ts)')
    process.exitCode = 1
  }
}

main()
