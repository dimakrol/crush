# Crash Pilot

An Aviator-style crash game. A multiplier climbs from 1×; players cash out before it crashes. The crash point is server-determined and unknown to clients.

## Repository layout

```
backend/platform/   NestJS API + game engine
frontend/crash-pilot/  React 19 + Vite UI
```

## Prerequisites

- Node.js 20+
- Docker (for MongoDB + Redis)

## Getting started

### 1. Infrastructure

```bash
docker compose up -d mongo redis
```

Starts MongoDB 7 on `27117` and Redis 7 on `6479` (non-default host ports — see
[Run the full stack with Docker](#run-the-full-stack-with-docker)). Point your
local `.env` at those ports, or run them on the standard ports yourself.

### 2. Backend

```bash
cd backend/platform
cp .env.example .env        # edit JWT_ACCESS_SECRET
npm install
npm run dev                 # http://localhost:4000
```

### 3. Frontend

```bash
cd frontend/crash-pilot
npm install
npm run dev                 # http://localhost:5174
```

## Run the full stack with Docker

A root `docker-compose.yml` runs everything — Mongo, Redis, the backend, and the
frontend — in containers with hot reload (source is bind-mounted):

```bash
docker compose up --build
```

Then open **http://localhost:5274**.

Host ports are deliberately non-standard so the stack runs **alongside** any
local `npm run dev`, `mongod`, or `redis` without colliding. Override them via a
root `.env` (copy `.env.example`):

| Service | URL / host port (default) | Override var |
|---|---|---|
| Frontend | http://localhost:5274 | `FRONTEND_PORT` |
| Backend (API + Socket.IO) | http://localhost:4100 | `BACKEND_PORT` |
| MongoDB | `localhost:27117` | `MONGO_PORT` |
| Redis | `localhost:6479` | `REDIS_PORT` |

Notes:

- The backend reads `backend/platform/.env` for app config (JWT secret, round
  params); Compose overrides only `MONGODB_URI`, `REDIS_URL`, and `CORS_ORIGIN`
  to wire the container network. Make sure `backend/platform/.env` exists.
- Code changes hot-reload. Changing **dependencies** (`package.json`) requires a
  rebuild: `docker compose up --build`.
- Mongo data persists in the `mongo_data` volume; Redis is ephemeral (it only
  holds live round state, which the engine rebuilds).

## Environment variables

All variables are validated at startup — the server exits if any are missing.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `MONGODB_URI` | — | MongoDB connection string |
| `REDIS_URL` | — | Redis connection string |
| `JWT_ACCESS_SECRET` | — | Secret for signing JWTs |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | JWT lifetime |
| `CORS_ORIGIN` | — | Allowed frontend origin |
| `ROUND_WAITING_SECONDS` | `5` | Betting window duration |
| `ROUND_CRASHED_SECONDS` | `3` | Pause between rounds |
| `ROUND_GROWTH_RATE` | `0.06` | Exponent in `e^(rate×t)` |
| `INITIAL_DEMO_BALANCE` | `1000` | Starting wallet balance |

## Architecture

### Backend (`backend/platform/`)

NestJS on Express with native MongoDB (no Mongoose) and ioredis. One NestJS module per domain: `auth`, `users`, `wallet`, `bets`, `rounds`, `history`. A `GameModule` contains `RoundEngine`, which drives the WAITING → RUNNING → CRASHED loop. `SocketModule` hosts the Socket.IO gateway for real-time events.

The crash point is computed server-side: `Math.max(1.01, 0.99 / Math.random())`. The multiplier follows `e^(0.06 × t)`. Redis holds live game state (`game:phase`, `game:currentRound`, `game:currentMultiplier`); MongoDB stores rounds, bets, and users.

### Frontend (`frontend/crash-pilot/`)

React 19 + TypeScript + Vite. Tailwind CSS v4. The game loop runs via `requestAnimationFrame` with refs mirroring state to avoid stale closures. A service layer (`src/services/`) abstracts backend calls and will be wired to the real API.

## Development commands

| Location | Command | Purpose |
|---|---|---|
| `backend/platform` | `npm test` | Jest unit tests |
| `backend/platform` | `npm run typecheck` | TypeScript check |
| `frontend/crash-pilot` | `npm test` | Vitest unit tests |
| `frontend/crash-pilot` | `npm run typecheck` | TypeScript check |
