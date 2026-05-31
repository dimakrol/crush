import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Seeds demo players idempotently (upsert on username). Re-running never
// clobbers existing wallet balances — use the admin reset endpoint for that.
const prisma = new PrismaClient();

const INITIAL_BALANCE = BigInt(process.env.INITIAL_DEMO_BALANCE ?? '100000');
const CURRENCY = 'USD';

const DEMOS = [
  { username: 'demo1', password: 'demo1', displayName: 'Demo One' },
  { username: 'demo2', password: 'demo2', displayName: 'Demo Two' },
];

async function main(): Promise<void> {
  for (const demo of DEMOS) {
    const passwordHash = await bcrypt.hash(demo.password, 10);
    const player = await prisma.player.upsert({
      where: { username: demo.username },
      update: { displayName: demo.displayName },
      create: {
        username: demo.username,
        passwordHash,
        displayName: demo.displayName,
      },
    });

    await prisma.wallet.upsert({
      where: {
        playerId_currency: { playerId: player.id, currency: CURRENCY },
      },
      update: {},
      create: {
        playerId: player.id,
        currency: CURRENCY,
        balance: INITIAL_BALANCE,
      },
    });

    console.log(`seeded ${demo.username} (${player.id})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
