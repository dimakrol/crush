# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **white-label casino operator simulator** — the **money and identity authority** for the
crash game. The game (`backend/platform` + `frontend/crash-pilot`) embeds in this operator's
lobby iframe and delegates every money move here over a seamless-wallet API. Balances,
transactions, players, and launch sessions all live in this service's Postgres.

Full design + rationale: `docs/white-label-integration-plan.md` (repo root).

## Commands

```bash
npm run dev          # NestJS watch mode (nest start --watch)
npm run build        # nest build → dist/
npm start            # node dist/main
npm run typecheck    # tsc --noEmit
npm run seed         # ts-node prisma/seed.ts (idempotent upsert of demo players)
npm run prisma:migrate   # prisma migrate dev (create/apply a migration locally)
npm run prisma:deploy    # prisma migrate deploy (apply committed migrations)
npm run prisma:generate  # regenerate the Prisma client
```

Postgres must be up first (`docker compose up -d postgres`, host port `5532`). There are **no
automated tests** here by design (`docs/...-plan.md` §2.17); verify via the repo-root smoke
script `node scripts/whitelabel-smoke.mjs`.

> Source is written **without semicolons** even though `.prettierrc` requires them (inherited
> from the platform). Do **not** run `npm run lint --fix` — it will rewrite the whole tree.
> Match the no-semicolon style and rely on `npm run typecheck`.

## Architecture

**Stack:** NestJS 11 on Express, Prisma 6 + Postgres 16, Zod validation, bcrypt + JWT (lobby
sessions), HMAC (server-to-server wallet), server-rendered lobby HTML. Mirrors the platform's
house style (`AppError`/`GlobalExceptionFilter`, `ZodValidationPipe`, startup env validation in
`src/config/env.ts`).

**Module layout** (`src/`):
- `lobby/` — the **only browser-facing** surface. Server-rendered HTML: login form → game list
  → `<iframe>` with `?token=`. Holds the parent side of the postMessage channel (validates
  `event.origin`, renders the balance header as `minor/100`). `sandbox="allow-scripts
  allow-same-origin"`.
- `auth/` — lobby player login (`POST /auth/login`, bcrypt + lobby JWT `{ sub, displayName }`).
- `sessions/` — `POST /sessions/launch` (lobby JWT) mints a single-use launch token as a
  `GameSession` row; `POST /wallet/authenticate` (HMAC) consumes it single-use and returns
  identity + balance, flipping the session `PENDING → ACTIVE`.
- `wallet/` — the seamless wallet: `balance / debit / credit / rollback`. **HMAC-guarded,
  server-to-server only — never reachable from the browser.**
- `players/` — seeding + admin `POST /admin/players/:id/reset` (HMAC).
- `prisma/` — `PrismaService` + module.

**Three trust boundaries:** lobby player JWT · wallet HMAC · single-use launch token.

## Key patterns

**Integer minor units end-to-end.** The Postgres ledger stores money as `BigInt` minor units
(cents). `100000` = `1000.00 USD`. Conversion to/from decimal happens only on the platform side,
at its `HttpWalletRepository` seam — this service never sees decimals.

**HMAC scheme** (`src/shared/utils/hmac.ts`): `X-Signature = HMAC-SHA256(OPERATOR_SECRET,
`${timestamp}${rawBody}`)`, hex; headers `X-Api-Key` / `X-Timestamp` / `X-Signature`; reject
skew > 30s. The platform's `operator.client.ts` signs identically. Requires the app created with
`{ rawBody: true }` so the guard can verify the exact bytes.

**Atomic debit, no overdraft** (`wallet.service.ts`): a conditional
`updateMany({ where: { balance: { gte: amount } } })` inside `prisma.$transaction` — decrements
only if funds cover it, else throws `INSUFFICIENT_BALANCE` (402). No row-locking needed.

**`txRef` idempotency is load-bearing.** Every movement carries a game-generated `txRef`
(`@unique` on `Transaction`). A replay returns the **original transaction's recorded
`balanceAfter` snapshot** without moving money again — so the replay's returned balance is the
balance *at that movement's time*, not the live balance. A concurrent duplicate that races to
`transaction.create` throws Prisma `P2002`, which rolls back the wallet change in the same
`$transaction` and is re-read via `resolveDuplicate` — never double-spent, never double-paid.
`rollback` uses its own derived `txRef = `${refTxRef}:rollback``and no-ops if the referenced
debit never happened.

**`Transaction` is an append-only ledger** with a running `balanceAfter` snapshot per row;
balance is also denormalized on `Wallet.balance` for fast reads.

## Schema (`prisma/schema.prisma`)

- `Player` — `id`, `username @unique`, `passwordHash`, `displayName`.
- `Wallet` — `playerId`, `currency`, `balance BigInt`, `@@unique([playerId, currency])`.
- `Transaction` — `walletId`, `type (DEBIT|CREDIT|ROLLBACK)`, `amount BigInt`, `txRef @unique`,
  `refTxRef?`, `roundId?`, `slotId?`, `gameId?`, `balanceAfter BigInt`.
- `GameSession` — `launchToken @unique`, `playerId`, `currency`, `gameId`,
  `status (PENDING|ACTIVE|ENDED|EXPIRED)`, `expiresAt`, `consumedAt?`. Ticket + session in one row.

## Environment

Validated at startup (`src/config/env.ts`); the server exits if any is missing. See `.env.example`.

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (`4000` in-container) |
| `DATABASE_URL` | Postgres connection (Compose overrides to `postgres:5432`) |
| `LOBBY_JWT_SECRET` / `LOBBY_JWT_EXPIRES_IN` | Lobby player session JWT |
| `OPERATOR_API_KEY` / `OPERATOR_SECRET` | Wallet HMAC — **must match the platform's** |
| `GAME_FRONTEND_URL` | Base URL the lobby frames (`?token=` appended) |
| `GAME_ID` | Default game id stamped on sessions/movements |
| `LAUNCH_TOKEN_TTL_SECONDS` | Launch-token lifetime (default 60) |
| `INITIAL_DEMO_BALANCE` | Seed balance in minor units (`100000` = 1000 USD) |
| `CORS_ORIGIN` | Allowed game-frontend origin |

## Gotchas

- **`nest start --watch` in Docker doesn't reap the old process on reload** → `EADDRINUSE`, and
  stale code keeps serving. After editing, `docker restart crush-white-label-1` to pick up changes.
- `playerId` is a Postgres **UUID**; the platform's Mongo bets store it as a plain string.
- Demo players: `demo1/demo1`, `demo2/demo2` (seeded, no self-registration in the lobby).
