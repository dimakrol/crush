// Load-test player provisioner for the white-label (money + identity authority).
//
// The white-label has no player-registration HTTP endpoint (only /auth/login),
// so a load-test pool has to be created straight through Prisma — exactly the way
// prisma/seed.ts seeds the demo players. This mirrors that script but creates an
// arbitrary N of them (load0..load{N-1}) with a shared password and a very large
// balance so bets never fail on insufficient funds and concurrency is never
// capped by a player running dry.
//
// Run it from the white-label directory so @prisma/client and bcrypt resolve
// (run.sh does this for you); DATABASE_URL must point at the running Postgres:
//
//   cd white-label \
//     && DATABASE_URL=postgresql://whitelabel:whitelabel@localhost:5532/whitelabel \
//        LOAD_PLAYERS=500 npx ts-node ../scripts/loadtest/seed-load.ts
//
// Idempotent: re-running upserts the players and resets each wallet back to the
// target balance, so it doubles as a "top everyone back up" reset between runs.
import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'

const prisma = new PrismaClient()

const COUNT = Number(process.env.LOAD_PLAYERS ?? '500')
const PREFIX = process.env.LOAD_PREFIX ?? 'load'
const PASSWORD = process.env.LOAD_PASSWORD ?? 'loadtest'
const CURRENCY = process.env.LOAD_CURRENCY ?? 'USD'
// Default 1_000_000_000 minor = 10,000,000.00 USD — effectively bottomless for a
// test that bets a unit or two at a time.
const BALANCE = BigInt(process.env.LOAD_BALANCE_MINOR ?? '1000000000')
const BATCH = Number(process.env.LOAD_SEED_BATCH ?? '50')

async function main(): Promise<void> {
  if (!Number.isInteger(COUNT) || COUNT <= 0) throw new Error(`LOAD_PLAYERS must be a positive integer (got ${process.env.LOAD_PLAYERS})`)

  // One hash for the whole pool: bcrypt.compare only cares that the password
  // matches, not that each row has its own salt, and hashing once keeps seeding
  // hundreds of players fast.
  const passwordHash = await bcrypt.hash(PASSWORD, 10)

  console.log(`Seeding ${COUNT} load players ${PREFIX}0..${PREFIX}${COUNT - 1}`)
  console.log(`  currency=${CURRENCY} balance=${BALANCE} minor password="${PASSWORD}"`)

  for (let start = 0; start < COUNT; start += BATCH) {
    const end = Math.min(start + BATCH, COUNT)
    await Promise.all(
      Array.from({ length: end - start }, (_, k) => {
        const i = start + k
        const username = `${PREFIX}${i}`
        return prisma.$transaction(async (tx) => {
          const player = await tx.player.upsert({
            where: { username },
            update: { displayName: `Load ${i}` },
            create: { username, passwordHash, displayName: `Load ${i}` },
          })
          await tx.wallet.upsert({
            where: { playerId_currency: { playerId: player.id, currency: CURRENCY } },
            update: { balance: BALANCE },
            create: { playerId: player.id, currency: CURRENCY, balance: BALANCE },
          })
        })
      }),
    )
    process.stdout.write(`\r  ${end}/${COUNT}`)
  }
  console.log(`\nDone. ${COUNT} players ready (password "${PASSWORD}").`)
}

main()
  .catch((err) => {
    console.error('\nseed-load failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
