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
cd backend/platform
docker compose up -d
```

Starts MongoDB 7 on `27017` and Redis 7 on `6379`.

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
