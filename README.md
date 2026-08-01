# Crash Pilot

An Aviator-style crash game. A multiplier climbs from 1×; players cash out before it crashes. The crash point is server-determined and unknown to clients.

The game is embedded as an **iframe player inside a white-label casino lobby**. The white-label
is the **money and identity authority** (balance, transactions, players, launch sessions); the
game backend is server-authoritative for *gameplay* but delegates every money move to the
white-label over a seamless-wallet API. Design details live in each service's `CLAUDE.md`.

## Repository layout

```
white-label/           NestJS + Prisma + Postgres — money + identity authority, lobby HTML
platform/              NestJS API + game engine (thin wallet/auth client of the white-label)
frontend/crash-pilot/  React 19 + Vite UI (iframe player)
scripts/               whitelabel-smoke.mjs (end-to-end money-chain smoke)
```

## Prerequisites

- Node.js 20+
- Docker (for Postgres + Redis + the white-label service)

## Getting started

The simplest path is the full Docker stack — see
[Run the full stack with Docker](#run-the-full-stack-with-docker). To run services on the host
instead, start the infra, then each service in order (the white-label is the money authority and
the platform depends on it).

### 1. Infrastructure

```bash
docker compose up -d postgres redis
```

Starts Postgres on `5532` and Redis on `6479` (non-default host ports). Point each service's
local `.env` at those ports, or run them on the standard ports yourself. Both services keep
their own database on that one Postgres server: `whitelabel` and `crash_pilot` (the platform
creates its own on boot if missing).

### 2. White-label (money authority)

```bash
cd white-label
cp .env.example .env
npm install
npm run prisma:migrate      # apply schema to Postgres
npm run seed                # demo1/demo1, demo2/demo2 (1000 USD each)
npm run dev                 # http://localhost:4000  (lobby at /lobby)
```

### 3. Platform (game backend)

```bash
cd platform
cp .env.example .env        # OPERATOR_API_KEY / OPERATOR_SECRET must match the white-label
npm install
npm run dev                 # http://localhost:4000
```

### 4. Frontend

```bash
cd frontend/crash-pilot
npm install
npm run dev                 # http://localhost:5174 (open it via the lobby, not directly)
```

## Run the full stack with Docker

A root `docker-compose.yml` runs everything — Postgres, Redis, the
white-label, the game backend, and the frontend — in containers with hot reload
(source is bind-mounted):

```bash
docker compose up --build
```

Then open the **casino lobby** at **http://localhost:4200/lobby**, log in as
`demo1` / `demo1`, and click Crash Pilot to launch the game in its iframe. (Opening
the frontend at `http://localhost:5274` directly shows a guest spectator view —
there's no balance until you launch from the lobby.)

Host ports are deliberately non-standard so the stack runs **alongside** any
local `npm run dev`, `redis`, or `postgres` without colliding. Override
them via a root `.env` (copy `.env.example`):

| Service | URL / host port (default) | Override var |
|---|---|---|
| Casino lobby (white-label) | http://localhost:4200/lobby | `WHITELABEL_PORT` |
| Frontend (game iframe) | http://localhost:5274 | `FRONTEND_PORT` |
| Game backend (API + Socket.IO) | http://localhost:4100 | `BACKEND_PORT` |
| Redis | `localhost:6479` | `REDIS_PORT` |
| Postgres | `localhost:5532` | `PG_PORT` |

Notes:

- The game backend reads `platform/.env` for app config; Compose overrides
  `POSTGRES_URL`, `REDIS_URL`, `CORS_ORIGIN`, and the white-label wiring
  (`WALLET_API_URL`, `OPERATOR_*`). Make sure `platform/.env` exists.
- `OPERATOR_API_KEY` / `OPERATOR_SECRET` are the shared HMAC credentials between
  the platform and the white-label — they **must match** on both sides (Compose
  defaults them consistently).
- Code changes hot-reload. Changing **dependencies** (`package.json`) requires a
  rebuild: `docker compose up --build`. Some changes need a restart of the affected
  container to take effect (Nest's watcher doesn't always reap its old process;
  Vite's HMR won't re-emit `server.headers`) — `docker restart crush-<service>-1`.
- Postgres data (both databases) persists in `pg_data`; Redis is ephemeral
  (it only holds live round state, which the engine rebuilds).

### Smoke test

With the stack up, verify the full money chain (launch → authenticate → debit →
credit → idempotency → reconciliation) without a browser:

```bash
node scripts/whitelabel-smoke.mjs
```

It plays both browser roles and the platform's server-to-server role, and resets
the demo player at the end so it's rerunnable.

## Environment variables

Each service validates its env at startup and exits if any required var is missing. See each
service's `.env.example` for the full list; the load-bearing ones:

**White-label (`white-label/`)** — money authority:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `LOBBY_JWT_SECRET` / `LOBBY_JWT_EXPIRES_IN` | Lobby player session JWT |
| `OPERATOR_API_KEY` / `OPERATOR_SECRET` | Wallet HMAC — must match the platform |
| `GAME_FRONTEND_URL` | Base URL the lobby frames |
| `LAUNCH_TOKEN_TTL_SECONDS` | Launch-token lifetime (default `60`) |
| `INITIAL_DEMO_BALANCE` | Seed balance in **minor units** (`100000` = 1000 USD) |

**Platform (`platform/`)** — game backend:

| Variable | Description |
|---|---|
| `POSTGRES_URL` / `REDIS_URL` | Postgres (bets/rounds) + Redis (live round state) |
| `JWT_ACCESS_SECRET` / `JWT_ACCESS_EXPIRES_IN` | Platform session JWT |
| `WALLET_API_URL` | White-label base URL (server-to-server) |
| `OPERATOR_API_KEY` / `OPERATOR_SECRET` | Wallet HMAC — must match the white-label |
| `CORS_ORIGIN` | Allowed game-frontend origin |
| `ROUND_WAITING_SECONDS` / `ROUND_CRASHED_SECONDS` / `ROUND_GROWTH_RATE` | Round timing + `e^(rate×t)` growth |

**Frontend (`frontend/crash-pilot/`):** `VITE_API_URL` / `VITE_SOCKET_URL` (platform backend),
`VITE_LOBBY_ORIGIN` (lobby origin authorized to frame the game via CSP + postMessage).

## Architecture

### White-label (`white-label/`)

NestJS 11 + Prisma + Postgres. The **money and identity authority**: players, wallets (integer
minor-unit `BigInt` balances), an append-only transaction ledger, and launch sessions. Exposes a
server-to-server **seamless wallet** (`balance / debit / credit / rollback`, HMAC-guarded,
idempotent on a game-generated `txRef`) and serves the **casino lobby** HTML (`/lobby`) that frames
the game. See `white-label/CLAUDE.md`.

### Platform (`platform/`)

NestJS on Express with Postgres (Drizzle ORM, migrations applied on boot) and ioredis — the
**game backend**, and a **thin client** of the white-label for money/identity. Modules: `auth`
(launch-token exchange → platform JWT), `wallet` (HTTP client of the white-label), `bets`,
`rounds`, `history`. A `GameModule` runs `RoundEngine` (WAITING → RUNNING → CRASHED);
`SocketModule` hosts the Socket.IO gateway. Crash point `Math.max(1.01, 0.99 / Math.random())`;
multiplier `e^(0.06 × t)`. Redis holds ephemeral live round state; Postgres stores rounds and
bets (no wallet, no users — identity is the white-label's UUID).
See `platform/CLAUDE.md`.

### Frontend (`frontend/crash-pilot/`)

React 19 + TypeScript + Vite, Tailwind CSS v4 — the **iframe player**. On load it exchanges the
lobby's single-use `?token=` for a platform JWT (held in memory), renders server-pushed round
state via `requestAnimationFrame`, and mirrors balance/session events to the lobby over
`postMessage`. Opened without a token it's a guest spectator. See `frontend/crash-pilot/CLAUDE.md`.

## Development commands

| Location | Command | Purpose |
|---|---|---|
| `white-label` | `npm run typecheck` | TypeScript check (no unit tests by design) |
| `white-label` | `npm run seed` | Re-seed demo players |
| `platform` | `npm test` | Jest unit tests |
| `platform` | `npm run typecheck` | TypeScript check |
| `frontend/crash-pilot` | `npm test` | Vitest unit tests |
| `frontend/crash-pilot` | `npm run typecheck` | TypeScript check |
| _(repo root)_ | `node scripts/whitelabel-smoke.mjs` | End-to-end money-chain smoke (stack must be up) |
