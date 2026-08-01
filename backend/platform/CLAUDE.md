# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # NestJS watch mode
npm run build        # tsc + nest build → dist/
npm start            # node dist/main
npm test             # jest (all tests under src/ and tests/)
npm test -- --testPathPattern=bets  # run a single suite
npm run typecheck    # tsc --noEmit
npm run lint         # eslint with --fix
```

> Committed source is written **without semicolons** even though `.prettierrc` requires them.
> Do **not** run `npm run lint --fix` on existing files — it rewrites the whole tree. Match the
> no-semicolon style and rely on `npm run typecheck`.

Start infrastructure before running the app:
```bash
docker compose up -d   # postgres + redis + white-label
```

## Role

This is the **game backend** — round engine, bets, history, real-time socket. It is **no longer
the money or identity authority**. Balance, transactions, and player identity live in
`backend/white-label/`; this service is a **thin client** of the white-label's seamless-wallet
and launch-token APIs. Bets/rounds/history are backed by Postgres (see *Persistence*); the
wallet and users collections are retired. This file is the design source of truth for the
platform side; the operator side is `backend/white-label/CLAUDE.md`.

## Architecture

**Stack:** NestJS 11 on Express, **Postgres via Drizzle ORM** (the only long-lived store), ioredis, Zod validation, Socket.IO via `@WebSocketGateway`, JWT auth.

**Persistence** — Postgres holds the persisted domains (`bets`, `rounds`, `wallet_ops`); `POSTGRES_URL` is required and the process refuses to boot without it. Bootstrap in `main.ts` is strictly ordered: `ensureDatabase()` → `connectPostgres()` → `migratePostgres()`, mirrored by `closePostgres()` in shutdown. `ensureDatabase()` connects to the `postgres` maintenance DB on the same server and `CREATE DATABASE`s `crash_pilot` if absent — the stack no longer depends on a Compose initdb script, which only ever ran on a *fresh* `pg_data` volume. Schema is `src/drizzle/schema.ts`; migrations are committed under `drizzle/migrations` (`npm run db:generate`) and applied on boot, so no repository creates indexes in `onModuleInit`. Specifics: ids are DB-generated `uuid` (domain stays `id: string`); money is `numeric(20,4)` cast back to `number` in the mapper; multipliers/crash point are `double precision` (not money); `userId` is `text` (a white-label UUID, no FK). Every write is a **single statement** — `cashOut`/`cancelPlaced` are `UPDATE ... WHERE status='PLACED' RETURNING`, so concurrent callers can't both win. A unique `(round,user,slot)` violation (SQLSTATE `23505`) is translated to a storage-agnostic `DuplicateKeyError` (`shared/errors/`) that `BetService` catches by `instanceof`. `findByUser` uses a composite keyset cursor `${placedAt ISO}|${id}`. Repos have a real-DB smoke test (`tests/bets/postgres.smoke.spec.ts`, opt-in via `RUN_PG_SMOKE=1` — note it writes into the dev `crash_pilot` DB).

**Module layout** (`src/modules/`):
- `auth/` — **launch-token exchange**, not register/login. `POST /api/auth/launch { token }`
  calls the white-label `authenticate` (over HMAC) and issues this platform's own JWT
  `{ sub: playerId, currency, sessionId, displayName }`. `GET /api/auth/me` returns identity +
  live balance. No register/login, no `users` collection (identity is the white-label's UUID).
- `wallet/` — **thin client.** `HttpWalletRepository` calls the white-label over HMAC and
  converts minor↔decimal at the seam. `GET /api/wallet` returns the live balance for the
  session's currency. No reset (dropped).
- `bets/` — place/cashout/history, reads game state from Redis; drives debit/credit (below).
  Also hosts `WalletOutboxWorker`, since interpreting a stuck money op is bet logic.
- `wallet-ops/` — the money **outbox** (`wallet_ops` table) + `POST /api/admin/wallet-ops/retry`.
  Deliberately knows nothing about bets, so the dependency runs one way (bets → wallet-ops)
  and no module pair needs `forwardRef`.
- `rounds/` — round persistence + phase transitions
- `history/` — public read-only round history endpoint

**Seamless-wallet client** (`src/shared/whitelabel/operator.client.ts`): signs every
server-to-server call `X-Signature = HMAC-SHA256(OPERATOR_SECRET, `${timestamp}${rawBody}`)`,
serializing the body once so the signed bytes equal the sent bytes. `HttpWalletRepository`
(behind the `WALLET_REPOSITORY` token) exposes context-carrying
`debit/credit/rollback/getBalance` and converts dollars→`Math.round(x*100)` out, minor→`x/100`
back. `OPERATOR_API_KEY`/`OPERATOR_SECRET` **must match the white-label's**.

**Cross-cutting:**
- `src/game/` — `RoundEngine` (`OnModuleInit`) drives the WAITING → RUNNING → CRASHED loop using a `while(true)` async cycle; crash point = `Math.max(1.01, 0.99/Math.random())`; multiplier = `e^(0.06*t)` ticked every 100 ms via `setInterval`
- `src/socket/` — `GameGateway` allows **guest connections** (no token) so spectators receive `round:*` broadcasts; a valid handshake token, or a mid-session `authenticate` message, joins the `userId` room for private events. `bet:place`/`bet:cashout` reject when `socket.userId` is absent. Uses `forwardRef` to break the circular dependency with `BetsModule`
- `src/shared/errors/` — `AppError(statusCode, errorCode, message)` + `GlobalExceptionFilter`
- `src/shared/pipes/` — `ZodValidationPipe` wraps Zod schemas for NestJS `@UsePipes`
- `src/shared/guards/` — `JwtAuthGuard` extends request with `req.userId`, `req.currency`, `req.sessionId`, `req.displayName`; `AdminKeyGuard` checks `X-Admin-Key` against `ADMIN_API_KEY`
- `src/shared/repositories/` — `IUnitOfWork` + the opaque `TxContext` (see *Transactional outbox*)
- `src/shared/whitelabel/` — `operator.client.ts`, the HMAC server-to-server caller for the white-label wallet/auth API

## Key patterns

**Repository injection tokens** — every module exposes a `FOO_REPOSITORY` string token and an `IFooRepository` interface, all wired with `useClass`. The seam is kept even with a single store: it confines Drizzle to `*.repository.ts` and lets tests inject `jest.Mocked<IFooRepository>` directly. The wallet's implementation is `HttpWalletRepository` (calls the white-label), not a DB one.

**Redis game state** — `game:phase` (`WAITING|RUNNING|CRASHED`), `game:currentRound`, `game:currentMultiplier` are the only Redis keys. `BetService` reads these directly; no event bus.

**Money moves are delegated, with idempotent `txRef`** — `BetService` builds a deterministic
`txRef` at each call site: `{roundId}:{playerId}:{slot}:bet` for the stake debit,
`{roundId}:{playerId}:{slot}:win` for the cashout credit, `…:bet:rollback` for a reversal (the
same derivation the white-label uses). The white-label dedupes on `txRef`, so a retry never
double-spends or double-pays. `playerId` is a white-label **UUID**, stored in `bets.user_id` as
`text`.

**Transactional outbox — the one invariant to preserve: the intent is written before the
network call, in the same commit as the bet-state change that justifies it.** Every delegated
move gets a `wallet_ops` row (`kind` DEBIT|CREDIT|ROLLBACK, `state` PENDING|CONFIRMED|FAILED,
`tx_ref` UNIQUE, retry bookkeeping). Consequences worth knowing:
- `UNIQUE(tx_ref)` makes *enqueueing* idempotent, so two callers reversing the same debit
  (`cancelBet` and `recoverOpenBets`) cannot create two reversals. `enqueue` revives a **FAILED**
  row and returns `null` for a PENDING/CONFIRMED one — never re-arms a live money move.
- `IUnitOfWork` (`shared/repositories/unit-of-work.ts`) is the **only** explicit transaction in
  the project. Repository writes take an optional opaque `TxContext`, so Drizzle still never
  appears in a service.
- Inline attempts are still the fast path; the outbox is the guarantee. `WalletOutboxWorker`
  (in `bets/`, `setInterval` 3 s) claims due rows with `FOR UPDATE SKIP LOCKED` + a 30 s lease,
  backs off 1s→30s for at most **10** attempts, and fails a deterministic 4xx immediately.
- After a catch-up the worker reads the **live** balance before emitting `wallet:updated`: a
  replayed movement returns the operator's balance *as of the original movement*, not now.

**Money ordering & failure handling:**
- **Bet:** commit `PENDING_STAKE` + `wallet_ops(DEBIT, PENDING)` → inline `debit` → commit
  `PLACED` + `CONFIRMED`. The slot race is decided by the unique index **before** any money
  moves, which is why the old "skip the rollback on `DuplicateKeyError`" special case is gone.
  Deterministic refusal → `REJECTED` + op `FAILED` (nothing moved, and `REJECTED` is the one
  status the partial unique index ignores, so a top-up can retry). Unknown outcome (5xx,
  timeout) → **`CANCELED`** + op `FAILED` + a queued `ROLLBACK`. `CANCELED`, not `REJECTED`, on
  purpose: it keeps the slot occupied, because a retry would reuse the debit `txRef`, which the
  white-label would replay *without charging* — a free bet.
- **Credit:** commit `CASHED_OUT` + `wallet_ops(CREDIT, PENDING)`, then credit inline. Failure
  leaves the op PENDING and returns the live balance — it does **not** flag the bet.
- **Tick decoupling:** the 100ms tick only *marks* auto-cashouts and records their CREDIT ops
  (one short local transaction, no network); **credits drain after `clearInterval`.**
- **Recovery:** on engine init, `recoverOpenBets` queues reversals for both `PLACED` orphans and
  `PENDING_STAKE` stakes of unknown outcome — queued, never called, so boot doesn't block on a
  dead operator.
- **`SETTLEMENT_PENDING` now means the worker gave up on a win** (money owed), not "one attempt
  missed". A delivered replay clears it back to `CASHED_OUT`. A failed reversal leaves the bet
  `CANCELED` (still true) and the FAILED op is the record of what is owed.
- **Manual recovery:** `POST /api/admin/wallet-ops/retry` under `X-Admin-Key` (`ADMIN_API_KEY`,
  compared with `timingSafeEqual` over SHA-256 digests). Body `{ txRef }` revives one op, an
  empty body revives every FAILED op; 404 for an unknown ref, 409 for one that is not FAILED.

**Idempotent cashout** — `betRepo.cashOut` is `UPDATE ... WHERE id=$1 AND status='PLACED' RETURNING *`, so concurrent cashout requests can't double-credit: the loser gets zero rows back.

**No cross-service transaction** — there is no transactional guarantee across the platform↔white-label boundary by design; safety rests on **idempotent `txRef`** + the outbox + the fail-safe ordering above. Treat `txRef` determinism as load-bearing.

## Testing

Tests live in `tests/` (not `src/`). Jest roots: `["src", "tests"]`.

`tests/jest.setup.ts` sets all required `process.env` vars so `src/config/env.ts` doesn't call `process.exit(1)`.

Redis mocking pattern — hoist the shared mock **outside** the factory to make `mockResolvedValueOnce` queuing work across multiple `getRedis()` calls:
```ts
const redisMock = { get: jest.fn(), set: jest.fn() }
jest.mock('../../src/config/redis', () => ({
  getRedis: () => redisMock,
}))
```
