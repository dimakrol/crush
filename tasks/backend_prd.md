ye# PRD: Crash Pilot Backend — `backend/platform`

## Introduction

Build a NestJS backend for the existing Crash Pilot frontend crash game. The backend takes ownership of the game loop, crash point generation, bet management, wallet balance, and real-time event broadcasting via Socket.IO. The frontend's existing `gameService.ts` service layer is the intended integration point — replacing its local stubs with real HTTP/socket calls.

All decisions resolved in the grilling session are embedded in this PRD. Do not re-litigate them.

---

## Goals

- Give the game a server-authoritative round loop (WAITING → RUNNING → CRASHED)
- Persist user accounts, wallets, rounds, and bets in MongoDB
- Broadcast real-time game state to connected clients via Socket.IO
- Support two bet slots per user per round with server-side auto-cashout
- Keep the codebase clean enough that MongoDB can be swapped for another database without touching services

---

## Resolved Architecture Decisions

| Decision | Choice |
|---|---|
| Location | `backend/platform/` |
| Framework | NestJS on Express |
| MongoDB access | Native MongoDB driver (no Mongoose) |
| Validation | Zod + custom `ZodValidationPipe` |
| Tests | Jest |
| Refresh tokens | Not implemented |
| Atomicity | Atomic conditional updates + documented limitation |
| Socket client actions | Implemented (`bet:place`, `bet:cashout`) |
| Socket auth | Authenticated only (JWT required) |
| Rate limiting | `express-rate-limit` on auth endpoints only |
| Multiplier broadcast | 10/s (every 100ms) |
| Active bets lookup | MongoDB query directly (no Redis bet cache) |
| Round history | Public endpoint (no auth required) |
| Bet decimals | 2 decimal places allowed |
| NestJS modules | One per domain |
| Socket.IO | NestJS `@WebSocketGateway` |
| RoundEngine → socket | Direct `GameGateway` injection |
| Repository binding | Custom providers with injection tokens |
| RoundEngine home | Dedicated `GameModule` |

---

## Module Dependency Graph

```
AppModule
├── AuthModule        imports: UsersModule, WalletModule
├── UsersModule
├── WalletModule
├── RoundsModule
├── BetsModule        imports: RoundsModule, WalletModule
├── HistoryModule     imports: RoundsModule, BetsModule
├── SocketModule      imports: GameModule (forwardRef)
└── GameModule        imports: RoundsModule, BetsModule, WalletModule, SocketModule
```

---

## User Stories

### US-001: Project scaffold
**Description:** As a developer, I need a working NestJS + TypeScript project at `backend/platform/` so I have a clean base to build on.

**Acceptance Criteria:**
- [ ] `nest new platform` scaffold at `backend/platform/`
- [ ] TypeScript strict mode enabled in `tsconfig.json`
- [ ] Dependencies installed: `@nestjs/platform-express`, `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`, `mongodb`, `ioredis`, `zod`, `jsonwebtoken`, `bcrypt`, `express-rate-limit`, `helmet`, `@types/*` for all
- [ ] Dev dependencies: `jest`, `ts-jest`, `@types/jest`, `supertest`
- [ ] `package.json` scripts: `dev` (`nest start --watch`), `build`, `start`, `typecheck` (`tsc --noEmit`), `test` (`jest`), `lint`
- [ ] `npm run typecheck` passes
- [ ] `npm run dev` starts without errors

---

### US-002: Configuration and environment
**Description:** As a developer, I need typed environment variable loading so misconfiguration fails fast at startup.

**Acceptance Criteria:**
- [ ] `.env.example` exists with all keys from the requirements doc
- [ ] `src/config/env.ts` validates env vars using Zod on startup; throws with a clear message if any required var is missing
- [ ] `NODE_ENV`, `PORT`, `MONGODB_URI`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `CORS_ORIGIN`, `ROUND_WAITING_SECONDS`, `ROUND_CRASHED_SECONDS`, `ROUND_GROWTH_RATE`, `INITIAL_DEMO_BALANCE` are all validated
- [ ] `docker-compose.yml` provides MongoDB 7 and Redis 7 on default ports with a named volume for Mongo data
- [ ] `npm run typecheck` passes

---

### US-003: MongoDB and Redis connections
**Description:** As a developer, I need database connections established at startup so all modules can use them.

**Acceptance Criteria:**
- [ ] `src/config/database.ts` exports a function that connects to MongoDB using the native driver; logs success or throws on failure
- [ ] `src/config/redis.ts` exports a function that connects to Redis via `ioredis`; throws on failure (fail-fast as per requirements)
- [ ] Both connections are established in `server.ts` before `RoundEngine` starts
- [ ] Connection errors are logged with context (not swallowed)
- [ ] `npm run typecheck` passes

---

### US-004: Shared infrastructure — AppError, error filter, ZodValidationPipe
**Description:** As a developer, I need centralized error handling so all modules throw and respond consistently.

**Acceptance Criteria:**
- [ ] `src/shared/errors/AppError.ts` exports `AppError extends Error` with `statusCode`, `code`, `message`
- [ ] `src/shared/errors/error.filter.ts` is a NestJS `ExceptionFilter` that catches `AppError` and returns `{ error: { code, message } }`; catches all other errors and returns `INTERNAL_SERVER_ERROR` without leaking internals
- [ ] `src/shared/pipes/zod-validation.pipe.ts` exports `ZodValidationPipe` that accepts a Zod schema, validates `@Body()` / `@Query()`, throws `AppError(400, 'VALIDATION_ERROR', ...)` on failure
- [ ] Error filter registered globally in `AppModule`
- [ ] All error codes from requirements doc are defined as constants
- [ ] `npm run typecheck` passes

---

### US-005: Base repository interface
**Description:** As a developer, I need a base repository pattern so all domain repositories follow the same structure.

**Acceptance Criteria:**
- [ ] `src/shared/repositories/base.repository.ts` defines a generic `IBaseRepository<T>` interface with at minimum `findById(id: string): Promise<T | null>`
- [ ] Injection token pattern documented: each domain defines its own token constant (e.g. `USER_REPOSITORY = 'USER_REPOSITORY'`)
- [ ] `npm run typecheck` passes

---

### US-006: Users module
**Description:** As a developer, I need a User model and repository so auth and other modules can persist and retrieve users.

**Acceptance Criteria:**
- [ ] `User` TypeScript interface: `id`, `email`, `passwordHash`, `createdAt`, `updatedAt`
- [ ] `IUserRepository` interface: `findById`, `findByEmail`, `create`
- [ ] `MongoUserRepository` implements `IUserRepository` using native MongoDB driver; collection name `users`; unique index on `email`
- [ ] `UsersModule` provides `MongoUserRepository` bound to `USER_REPOSITORY` injection token; exports the token
- [ ] Repository returns plain `User` objects, never MongoDB `Document` types
- [ ] `npm run typecheck` passes

---

### US-007: Wallet module
**Description:** As a developer, I need a Wallet model and service so balance changes are atomic and centralised.

**Acceptance Criteria:**
- [ ] `Wallet` TypeScript interface: `id`, `userId`, `balance`, `createdAt`, `updatedAt`
- [ ] `IWalletRepository` interface: `findByUserId`, `create`, `deductBalance(userId, amount, minBalance)`, `addBalance(userId, amount)`
- [ ] `MongoWalletRepository` implements `IWalletRepository`; unique index on `userId`; `deductBalance` uses `findOneAndUpdate` with `{ balance: { $gte: amount } }` condition — rejects atomically if balance insufficient
- [ ] `WalletService` methods: `getBalance(userId)`, `createWallet(userId)`, `deductBalance(userId, amount)`, `addBalance(userId, amount)`, `reset(userId)` — all throw `AppError('INSUFFICIENT_BALANCE')` or `NOT_FOUND` as appropriate
- [ ] `WalletModule` exports `WalletService`
- [ ] `npm run typecheck` passes

---

### US-008: Auth module — register and login
**Description:** As a player, I want to register and log in so I can place bets with a persistent balance.

**Acceptance Criteria:**
- [ ] `POST /api/auth/register` accepts `{ email, password }`; validates email format and password min 8 chars via Zod schema
- [ ] Registration: hashes password with bcrypt (rounds ≥ 10), creates user, creates wallet with `INITIAL_DEMO_BALANCE`, returns `{ data: { user: { id, email }, accessToken } }`
- [ ] Returns `AppError(409, 'EMAIL_ALREADY_EXISTS')` if email taken
- [ ] `POST /api/auth/login` accepts `{ email, password }`; returns same shape as register
- [ ] Login returns `AppError(401, 'INVALID_CREDENTIALS')` for wrong email or password — same error for both (no email enumeration)
- [ ] JWT access token signed with `JWT_ACCESS_SECRET`, expires in `JWT_ACCESS_EXPIRES_IN`
- [ ] Password hash never returned in any response
- [ ] Rate limiter applied: max 10 requests per 15 minutes per IP on both endpoints
- [ ] `npm run typecheck` passes
- [ ] Jest tests: register creates user + wallet; duplicate email rejected; login wrong password rejected

---

### US-009: Auth module — me endpoint and auth middleware
**Description:** As a player, I want to fetch my current user and balance so the frontend can display my account state.

**Acceptance Criteria:**
- [ ] `GET /api/auth/me` requires `Authorization: Bearer <token>` header
- [ ] Returns `{ data: { user: { id, email }, balance } }`
- [ ] Returns `AppError(401, 'UNAUTHORIZED')` for missing/invalid/expired token
- [ ] `JwtAuthGuard` is a NestJS guard that verifies the JWT and attaches `userId` to the request
- [ ] `JwtAuthGuard` can be applied to any controller method via `@UseGuards(JwtAuthGuard)`
- [ ] `npm run typecheck` passes

---

### US-010: Wallet endpoints
**Description:** As a player, I want to check and reset my balance so I can manage my demo credits.

**Acceptance Criteria:**
- [ ] `GET /api/wallet` (protected) returns `{ data: { balance } }`
- [ ] `POST /api/wallet/reset` (protected) resets balance to `INITIAL_DEMO_BALANCE`; returns `{ data: { balance } }`
- [ ] Reset cancels any `PLACED` bets for the current round by marking them `CANCELED` (does not refund — demo only)
- [ ] `npm run typecheck` passes

---

### US-011: Rounds module
**Description:** As a developer, I need a Round model and repository so the game engine can persist and query round state.

**Acceptance Criteria:**
- [ ] `Round` TypeScript interface: `id`, `phase` (`WAITING | RUNNING | CRASHED`), `crashPoint`, `startedAt`, `crashedAt`, `createdAt`
- [ ] `IRoundRepository` interface: `create`, `findById`, `updatePhase`, `findRecent(limit)`
- [ ] `MongoRoundRepository` implements `IRoundRepository`; index on `{ createdAt: -1 }`
- [ ] `crashPoint` is stored but never returned to clients until `CRASHED` phase
- [ ] `RoundsModule` exports repository token and `RoundRepository` service wrapper if needed
- [ ] `npm run typecheck` passes

---

### US-012: Bets module — model and repository
**Description:** As a developer, I need a Bet model and repository so bets can be persisted and queried efficiently.

**Acceptance Criteria:**
- [ ] `Bet` TypeScript interface matches requirements doc exactly: `id`, `userId`, `roundId`, `slotId (1|2)`, `amount`, `autoCashOut`, `status (PLACED|CASHED_OUT|LOST|CANCELED)`, `cashOutMultiplier`, `payout`, `placedAt`, `cashedOutAt`, `resolvedAt`
- [ ] `IBetRepository` interface: `create`, `findById`, `findActiveByRound(roundId)`, `findActiveByUser(userId)`, `findByUser(userId, limit, cursor)`, `cashOut(betId, multiplier, payout)` (conditional update: only if `status === PLACED`), `resolveLosses(roundId)`
- [ ] Indexes as per requirements doc: `userId+placedAt`, `roundId`, `roundId+userId`, `roundId+userId+slotId` unique
- [ ] `cashOut` uses `findOneAndUpdate` with `{ status: 'PLACED' }` condition — idempotent by design
- [ ] `npm run typecheck` passes

---

### US-013: BetService — place bet
**Description:** As a player, I want to place a bet during the waiting phase so I can participate in a round.

**Acceptance Criteria:**
- [ ] `BetService.placeBet(userId, roundId, slotId, amount, autoCashOut)` validates: round is `WAITING`, no existing bet for `roundId+userId+slotId`, amount > 0, amount ≤ 2 decimal places, autoCashOut null or > 1.00
- [ ] Deducts wallet balance atomically via `WalletService.deductBalance`
- [ ] Creates bet with status `PLACED`
- [ ] Throws `AppError(400, 'ROUND_NOT_WAITING')`, `AppError(409, 'BET_ALREADY_EXISTS')`, `AppError(400, 'INSUFFICIENT_BALANCE')` as appropriate
- [ ] Returns `{ bet, balance }`
- [ ] `npm run typecheck` passes
- [ ] Jest tests: rejects when not WAITING; rejects duplicate slot; rejects insufficient balance; creates bet and deducts balance

---

### US-014: BetService — cashout
**Description:** As a player, I want to cash out my bet during the running phase so I can lock in a payout.

**Acceptance Criteria:**
- [ ] `BetService.cashOut(userId, betId, currentMultiplier)` validates: round is `RUNNING`, bet belongs to userId, bet status is `PLACED`
- [ ] Payout calculated as `Math.floor(amount * multiplier * 100) / 100`
- [ ] `IBetRepository.cashOut` updates bet with `findOneAndUpdate({ _id: betId, status: 'PLACED' })` — no double-cashout possible
- [ ] Adds payout to wallet via `WalletService.addBalance`
- [ ] Returns `{ bet, balance }`
- [ ] Throws `AppError(400, 'ROUND_NOT_RUNNING')`, `AppError(404, 'BET_NOT_FOUND')`, `AppError(409, 'BET_ALREADY_RESOLVED')` as appropriate
- [ ] `npm run typecheck` passes
- [ ] Jest tests: rejects when not RUNNING; rejects already resolved; calculates payout using server multiplier; updates bet and wallet

---

### US-015: Bet HTTP endpoints
**Description:** As a player, I want HTTP endpoints for bet placement and cashout so the frontend can interact with the backend over REST.

**Acceptance Criteria:**
- [ ] `POST /api/bets` (protected) accepts `{ slotId, amount, autoCashOut? }`; validates with Zod schema; calls `BetService.placeBet`; returns `{ data: { bet, balance } }`
- [ ] `POST /api/bets/:betId/cashout` (protected) calls `BetService.cashOut` with server's current multiplier from Redis; returns `{ data: { bet, balance } }`
- [ ] `GET /api/bets/active` (protected) returns `{ data: [ ...bets ] }` for current round
- [ ] `GET /api/bets/history` (protected) accepts `?limit=20&cursor=` query params; returns `{ data: [...], meta: { nextCursor } }`; limit capped at 100
- [ ] `npm run typecheck` passes

---

### US-016: Round history endpoint
**Description:** As a player, I want to see recent round results so I can view the crash history.

**Acceptance Criteria:**
- [ ] `GET /api/history/rounds?limit=20` is **public** (no auth required)
- [ ] Returns `{ data: [ { id, crashPoint, startedAt, crashedAt } ] }` newest first
- [ ] `limit` capped at 100; defaults to 20
- [ ] Only returns `CRASHED` rounds (not current round)
- [ ] `npm run typecheck` passes

---

### US-017: GameGateway — Socket.IO setup and auth
**Description:** As a developer, I need an authenticated Socket.IO gateway so real-time events can be sent to connected clients.

**Acceptance Criteria:**
- [ ] `GameGateway` decorated with `@WebSocketGateway({ cors: { origin: CORS_ORIGIN } })`
- [ ] Socket connection middleware validates JWT from `socket.handshake.auth.token`; rejects unauthenticated connections with `UNAUTHORIZED`
- [ ] On connect, authenticated user's `userId` is stored on `socket.data.userId`
- [ ] `GameGateway` exposes methods: `emitToAll(event, payload)` and `emitToUser(userId, event, payload)`
- [ ] `emitToUser` uses `socket.to(userId)` room — users join a room named after their `userId` on connect
- [ ] `SocketModule` exports `GameGateway`
- [ ] `npm run typecheck` passes

---

### US-018: GameGateway — socket client actions
**Description:** As a player, I want to place bets and cash out via Socket.IO so I have a low-latency alternative to HTTP.

**Acceptance Criteria:**
- [ ] `@SubscribeMessage('bet:place')` handler calls `BetService.placeBet` with same logic as HTTP endpoint; emits `bet:placed` back to the user on success; emits error event on failure
- [ ] `@SubscribeMessage('bet:cashout')` handler calls `BetService.cashOut`; emits `bet:cashedOut` back to the user on success
- [ ] Both handlers use the same `BetService` methods as HTTP controllers — no duplicated business logic
- [ ] `npm run typecheck` passes

---

### US-019: RoundEngine — game loop
**Description:** As a developer, I need a server-side game loop so the backend owns round lifecycle independently of any client.

**Acceptance Criteria:**
- [ ] `RoundEngine` is a NestJS provider in `GameModule`; started via `onModuleInit`
- [ ] Loop: creates round in MongoDB → WAITING phase (countdown `ROUND_WAITING_SECONDS`) → RUNNING phase (RAF-equivalent via `setInterval` at 100ms) → CRASHED phase (delay `ROUND_CRASHED_SECONDS`) → repeat
- [ ] Current round state (`roundId`, `phase`, `multiplier`, `startedAt`) stored in Redis keys: `game:currentRound`, `game:phase`, `game:currentMultiplier`
- [ ] Crash point generated via `generateCrashPoint()` in `src/shared/utils/crash.ts` before round starts; stored in MongoDB but not emitted to clients until crash
- [ ] Multiplier computed as `Math.exp(ROUND_GROWTH_RATE * elapsedSeconds)` on each 100ms tick
- [ ] Emits `round:waiting` and `round:countdown` during WAITING
- [ ] Emits `round:started` when RUNNING begins
- [ ] Emits `round:multiplier` every 100ms during RUNNING
- [ ] Emits `round:crashed` (including `crashPoint`) when crash detected
- [ ] `npm run typecheck` passes

---

### US-020: RoundEngine — auto-cashout and loss resolution
**Description:** As a player, I want auto-cashout to work server-side so I don't have to watch the screen constantly.

**Acceptance Criteria:**
- [ ] On each 100ms tick during RUNNING, query MongoDB for `PLACED` bets in current round where `autoCashOut <= currentMultiplier`
- [ ] For each matching bet, call `BetService.cashOut` — idempotent via `findOneAndUpdate({ status: 'PLACED' })` condition
- [ ] On cashout: emit `bet:cashedOut` to the bet owner; emit `wallet:updated` to the bet owner
- [ ] At crash: call `IBetRepository.resolveLosses(roundId)` to bulk-update all remaining `PLACED` bets to `LOST`
- [ ] For each lost bet, emit `bet:lost` to the bet owner
- [ ] All loss resolution completes before emitting `round:crashed`
- [ ] `npm run typecheck` passes

---

### US-021: Security hardening
**Description:** As a developer, I need baseline security so the demo backend is not trivially exploitable.

**Acceptance Criteria:**
- [ ] `helmet()` middleware applied globally
- [ ] CORS restricted to `CORS_ORIGIN` env var only
- [ ] `express-rate-limit` applied to `POST /api/auth/register` and `POST /api/auth/login`: max 10 requests per 15 minutes per IP
- [ ] Server multiplier used for cashout — `POST /api/bets/:betId/cashout` reads multiplier from Redis, ignores any client-provided value
- [ ] `crashPoint` not included in `round:started` or `round:multiplier` socket events
- [ ] `npm run typecheck` passes

---

### US-022: Logging
**Description:** As a developer, I need structured startup and game event logs so I can observe the running system.

**Acceptance Criteria:**
- [ ] NestJS logger (or `pino`/`winston`) logs: server start, MongoDB connected, Redis connected, round phase changes, crash events, bet placement failures, cashout failures
- [ ] Passwords, JWT tokens, and full auth headers are never logged
- [ ] `npm run typecheck` passes

---

### US-023: Jest test suite
**Description:** As a developer, I need tests for core business logic so regressions are caught without running the full server.

**Acceptance Criteria:**
- [ ] `src/shared/utils/crash.test.ts`: `generateCrashPoint()` always ≥ 1.01; median < 3.0 across 1000 samples
- [ ] `src/shared/utils/game.test.ts`: `calculatePayout()` floors to 2 decimals; validates correctly
- [ ] `src/modules/bets/bet.service.spec.ts` with mocked repositories: `placeBet` rejects non-WAITING phase; rejects duplicate slot; rejects insufficient balance; creates bet and calls deductBalance
- [ ] `src/modules/bets/bet.service.spec.ts`: `cashOut` rejects non-RUNNING phase; rejects already-resolved bet; calculates payout using provided multiplier; calls addBalance
- [ ] `npm run test` passes with no failures
- [ ] `npm run typecheck` passes

---

## Functional Requirements

- FR-1: Backend generates crash point server-side before each round; never sent to clients before crash
- FR-2: Round loop cycles WAITING (`ROUND_WAITING_SECONDS`) → RUNNING → CRASHED (`ROUND_CRASHED_SECONDS`) automatically without client involvement
- FR-3: Multiplier computed as `Math.exp(ROUND_GROWTH_RATE * elapsedSeconds)`; broadcast every 100ms
- FR-4: Maximum two bets per user per round (slot 1 and slot 2); enforced by unique index `roundId+userId+slotId`
- FR-5: Bet placement only during WAITING; cashout only during RUNNING; enforced on backend
- FR-6: Wallet deduction is atomic: `findOneAndUpdate({ balance: { $gte: amount } })` — balance cannot go negative
- FR-7: Cashout is idempotent: `findOneAndUpdate({ status: 'PLACED' })` — a bet cannot be cashed out twice
- FR-8: Auto-cashout checked on every 100ms engine tick against MongoDB; processed server-side
- FR-9: All uncashed `PLACED` bets become `LOST` at crash before `round:crashed` is emitted
- FR-10: Socket connections require a valid JWT; rejected otherwise
- FR-11: Socket client actions (`bet:place`, `bet:cashout`) call the same service methods as HTTP endpoints
- FR-12: Redis holds current round state (`game:currentRound`, `game:phase`, `game:currentMultiplier`); MongoDB is source of truth for all persistent data
- FR-13: Rate limiting: max 10 auth requests per 15 minutes per IP on register and login
- FR-14: Round history endpoint is public; all other endpoints require JWT
- FR-15: Atomic operations use conditional updates; limitation (no multi-document transactions) documented in code with TODO

---

## Non-Goals

- No refresh tokens
- No real money, payments, crypto, deposits, or withdrawals
- No admin panel, KYC, or compliance features
- No Redis cache for active bets (MongoDB queried directly)
- No multi-document MongoDB transactions (single-node Docker setup)
- No unauthenticated socket access (authenticated only)
- No production provably-fair cryptography
- No microservices, event sourcing, CQRS, or Kafka
- No frontend changes in this PRD (frontend integration is a separate task)

---

## Technical Considerations

- **NestJS module binding**: Each domain module binds its repository implementation to an injection token (e.g. `USER_REPOSITORY`). Services inject via `@Inject(USER_REPOSITORY)`. Swapping MongoDB for another database means replacing the `MongoXxxRepository` class and updating the `provide` binding in the module — no service changes.
- **RoundEngine circular dependency**: `GameModule` imports `SocketModule`; `SocketModule` imports `GameModule` via `forwardRef(() => GameModule)` to allow `GameGateway` injection into `RoundEngine`.
- **Atomicity limitation**: Bet placement (deduct balance + create bet) and cashout (update bet + add balance) involve two MongoDB operations. Without a replica set, these are not wrapped in a transaction. Each operation uses conditional `findOneAndUpdate` to minimise the inconsistency window. Document this with `// LIMITATION: not transactional — requires replica set for production`.
- **Current multiplier for cashout**: `POST /api/bets/:betId/cashout` reads `game:currentMultiplier` from Redis. If Redis is unavailable, the cashout endpoint should fail with `503` rather than trust a client-provided value.
- **`generateCrashPoint` isolation**: Lives in `src/shared/utils/crash.ts`. Add comment: `// Demo-only. TODO: Replace with provably fair or regulated backend logic before any real-money use.`
- **Jest config**: `ts-jest` transformer with `tsconfig` pointing to `tsconfig.json`. Module name mapper for `@/` path alias if used.

---

## File Structure

```
backend/platform/
  src/
    main.ts
    app.module.ts

    config/
      env.ts
      database.ts
      redis.ts

    modules/
      auth/
        auth.controller.ts
        auth.service.ts
        auth.module.ts
        auth.routes.ts
        dto/
          register.dto.ts
          login.dto.ts

      users/
        user.types.ts
        user.repository.interface.ts
        user.repository.mongo.ts
        users.module.ts

      wallet/
        wallet.types.ts
        wallet.repository.interface.ts
        wallet.repository.mongo.ts
        wallet.service.ts
        wallet.controller.ts
        wallet.module.ts

      rounds/
        round.types.ts
        round.repository.interface.ts
        round.repository.mongo.ts
        rounds.module.ts

      bets/
        bet.types.ts
        bet.repository.interface.ts
        bet.repository.mongo.ts
        bet.service.ts
        bet.controller.ts
        bet.module.ts
        dto/
          place-bet.dto.ts

      history/
        history.controller.ts
        history.service.ts
        history.module.ts

    game/
      game.module.ts
      round.engine.ts

    socket/
      game.gateway.ts
      socket.module.ts

    shared/
      errors/
        AppError.ts
        error.filter.ts
        error-codes.ts
      pipes/
        zod-validation.pipe.ts
      guards/
        jwt-auth.guard.ts
      middleware/
        rate-limit.middleware.ts
      repositories/
        base.repository.ts
      utils/
        crash.ts
        money.ts
        logger.ts

  tests/
    bets/
      bet.service.spec.ts
    utils/
      crash.test.ts
      money.test.ts

  .env.example
  docker-compose.yml
  package.json
  tsconfig.json
  jest.config.ts
```

---

## Success Metrics

- `npm run dev` starts and game loop runs automatically
- `npm run test` passes all Jest tests
- `npm run typecheck` passes with zero errors
- A client can register, connect via Socket.IO, receive `round:waiting` → `round:started` → `round:multiplier` events, place a bet, cash out, and receive `bet:cashedOut` + `wallet:updated`
- Swapping `MongoUserRepository` for a hypothetical `PostgresUserRepository` requires changes only in `users.module.ts`

---

## Open Questions

- Should the `POST /api/wallet/reset` endpoint cancel active bets or wait until the round ends? (Current decision: cancel immediately, mark `CANCELED`, no refund — demo only.)
- Should `GET /api/bets/history` cursor be time-based (`placedAt`) or ID-based? (Recommendation: `placedAt`-based for simplicity.)
- Should the `RoundEngine` use Node.js `setInterval` at 100ms or `setTimeout` chaining? (`setInterval` is simpler; `setTimeout` chaining avoids drift — for a demo, `setInterval` is fine.)
