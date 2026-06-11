// PG smoke test — exercises the Postgres repositories against a REAL database
// to verify the atomic semantics that unit tests (which mock the repo) can't:
// the compare-and-set cashOut, the unique-slot dup-key translation, and the
// composite-cursor pagination. Opt-in only, so `npm test` stays infra-free:
//
//   docker compose up -d postgres
//   RUN_PG_SMOKE=1 PG_SMOKE_URL=postgresql://whitelabel:whitelabel@localhost:5532/crash_pilot \
//     npm test -- --testPathPattern=postgres.smoke
//
// The env vars are set BEFORE importing the app modules so env.ts validates on
// the postgres branch; modules are loaded via dynamic import inside beforeAll.

const RUN = process.env.RUN_PG_SMOKE
const describePg = RUN ? describe : describe.skip

describePg('PostgresBetRepository / PostgresRoundRepository (smoke)', () => {
  let betRepo: any
  let roundRepo: any
  let connectPostgres: () => Promise<unknown>
  let migratePostgres: () => Promise<void>
  let closePostgres: () => Promise<void>
  let DuplicateKeyError: any
  let getDrizzle: () => any
  let bets: any
  let rounds: any

  beforeAll(async () => {
    process.env.DB_DRIVER = 'postgres'
    process.env.POSTGRES_URL =
      process.env.PG_SMOKE_URL ?? 'postgresql://whitelabel:whitelabel@localhost:5532/crash_pilot'

    const pg = await import('@/config/postgres')
    connectPostgres = pg.connectPostgres
    migratePostgres = pg.migratePostgres
    closePostgres = pg.closePostgres
    getDrizzle = pg.getDrizzle
    ;({ DuplicateKeyError } = await import('@/shared/errors/duplicate-key.error'))
    ;({ bets, rounds } = await import('@/drizzle/schema'))
    const { PostgresBetRepository } = await import('@/modules/bets/bet.repository.postgres')
    const { PostgresRoundRepository } = await import('@/modules/rounds/round.repository.postgres')

    await connectPostgres()
    await migratePostgres()
    betRepo = new PostgresBetRepository()
    roundRepo = new PostgresRoundRepository()
  })

  afterAll(async () => {
    await closePostgres?.()
  })

  beforeEach(async () => {
    // FK order: bets reference rounds.
    await getDrizzle().delete(bets)
    await getDrizzle().delete(rounds)
  })

  const makeBet = (roundId: string, slotId: 1 | 2, overrides: Record<string, unknown> = {}) => ({
    userId: 'player-uuid-1',
    currency: 'USD',
    roundId,
    slotId,
    amount: 50,
    autoCashOut: null,
    status: 'PLACED' as const,
    cashOutMultiplier: null,
    payout: 0,
    placedAt: new Date(),
    cashedOutAt: null,
    resolvedAt: null,
    ...overrides,
  })

  it('round-trips a round through create/findById', async () => {
    const created = await roundRepo.create(2.5)
    expect(created.id).toBeTruthy()
    expect(created.phase).toBe('WAITING')
    const found = await roundRepo.findById(created.id)
    expect(found?.crashPoint).toBe(2.5)
  })

  it('persists money precisely and maps numeric back to number', async () => {
    const round = await roundRepo.create(2)
    const bet = await betRepo.create(makeBet(round.id, 1, { amount: 12.34 }))
    expect(typeof bet.amount).toBe('number')
    expect(bet.amount).toBe(12.34)
  })

  it('translates a unique (round,user,slot) violation into DuplicateKeyError', async () => {
    const round = await roundRepo.create(2)
    await betRepo.create(makeBet(round.id, 1))
    await expect(betRepo.create(makeBet(round.id, 1))).rejects.toBeInstanceOf(DuplicateKeyError)
  })

  it('cashOut is an idempotent compare-and-set (second call returns null)', async () => {
    const round = await roundRepo.create(2)
    const bet = await betRepo.create(makeBet(round.id, 1))
    const first = await betRepo.cashOut(bet.id, 2.0, 100)
    expect(first?.status).toBe('CASHED_OUT')
    expect(first?.payout).toBe(100)
    const second = await betRepo.cashOut(bet.id, 2.0, 100)
    expect(second).toBeNull()
  })

  it('paginates by composite cursor with no skips when placedAt ties', async () => {
    const round = await roundRepo.create(2)
    const sharedTime = new Date('2026-01-01T00:00:00.000Z')
    // Three bets across distinct slots/users sharing the same placedAt.
    await betRepo.create(makeBet(round.id, 1, { placedAt: sharedTime }))
    await betRepo.create(makeBet(round.id, 2, { placedAt: sharedTime }))
    await betRepo.create(makeBet(round.id, 1, { userId: 'player-uuid-2', placedAt: sharedTime }))

    const page1 = await betRepo.findByUser('player-uuid-1', 1)
    expect(page1.bets).toHaveLength(1)
    expect(page1.nextCursor).toBeTruthy()
    const page2 = await betRepo.findByUser('player-uuid-1', 1, page1.nextCursor)
    expect(page2.bets).toHaveLength(1)
    // No overlap between pages despite identical placedAt.
    expect(page2.bets[0].id).not.toBe(page1.bets[0].id)
    expect(page2.nextCursor).toBeNull()
  })
})
