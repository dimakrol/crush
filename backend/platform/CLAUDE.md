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

Start infrastructure before running the app:
```bash
docker compose up -d   # mongo:7 + redis:7
```

## Architecture

**Stack:** NestJS 11 on Express, native MongoDB driver (no Mongoose), ioredis, Zod validation, Socket.IO via `@WebSocketGateway`, JWT auth.

**Module layout** (`src/modules/`):
- `auth/` — register/login/me, bcrypt + jwt, no refresh tokens
- `users/` — user persistence only, no business logic
- `wallet/` — balance deduct/add with atomic `$gte` condition to prevent overdraft
- `bets/` — place/cashout/history, reads game state from Redis
- `rounds/` — round persistence + phase transitions
- `history/` — public read-only round history endpoint

**Cross-cutting:**
- `src/game/` — `RoundEngine` (`OnModuleInit`) drives the WAITING → RUNNING → CRASHED loop using a `while(true)` async cycle; crash point = `Math.max(1.01, 0.99/Math.random())`; multiplier = `e^(0.06*t)` ticked every 100 ms via `setInterval`
- `src/socket/` — `GameGateway` allows **guest connections** (no token) so spectators receive `round:*` broadcasts; a valid handshake token, or a mid-session `authenticate` message, joins the `userId` room for private events. `bet:place`/`bet:cashout` reject when `socket.userId` is absent. Uses `forwardRef` to break the circular dependency with `BetsModule`
- `src/shared/errors/` — `AppError(statusCode, errorCode, message)` + `GlobalExceptionFilter`
- `src/shared/pipes/` — `ZodValidationPipe` wraps Zod schemas for NestJS `@UsePipes`
- `src/shared/guards/` — `JwtAuthGuard` extends request with `req.userId`

## Key patterns

**Repository injection tokens** — every module exposes a `FOO_REPOSITORY` string token and an `IFooRepository` interface. The concrete Mongo implementation is swapped in via `{ provide: FOO_REPOSITORY, useClass: MongoFooRepository }` in each module's `providers`. Tests inject `jest.Mocked<IFooRepository>` directly.

**Redis game state** — `game:phase` (`WAITING|RUNNING|CRASHED`), `game:currentRound`, `game:currentMultiplier` are the only Redis keys. `BetService` reads these directly; no event bus.

**Atomic wallet deduct** — `findOneAndUpdate` with `$gte` filter prevents balance going negative without transactions. Throws `INSUFFICIENT_BALANCE` if the filter doesn't match.

**Idempotent cashout** — `betRepo.cashOut` uses `findOneAndUpdate` with `{ status: 'PLACED' }` condition so concurrent cashout requests don't double-pay.

**No MongoDB transactions** — the replica set requirement is explicitly avoided. Deduct-then-create and cashout-then-credit are two-step operations; the comment `// LIMITATION:` marks these seams.

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
