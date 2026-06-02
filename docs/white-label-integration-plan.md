# White-Label Casino Simulator — Implementation Plan

Status: **DESIGN AGREED** (grilled 2026-05-31). Implementation to proceed step by
step, one phase at a time, on explicit request.

Progress: **Phase 0 ✅ · Phase 1 ✅ · Phase 2 ✅ · Phase 3 ✅ · Phase 4 ✅ · Phase 5 ✅**
(white-label money core + launch & lobby + platform thin client + frontend iframe
player + e2e smoke & docs, all verified). **COMPLETE.**

This document is the single source of truth for the white-label integration. It
captures every design decision and the phased build order. Read the "Design
decisions" section before implementing any phase.

---

## 1. Goal

Build a new NestJS service that **simulates a real white-label casino operator**.
Our crash game embeds in the operator's iframe and receives a launch token for
authentication. The operator (white-label) becomes the **money authority** —
balance and all transactions live there. The game delegates every money move to
the white-label via a seamless-wallet API.

Three areas change:
- **NEW** `backend/white-label/` — NestJS 11 + Prisma + Postgres. Money + identity
  authority, lobby HTML, launch tokens, seamless-wallet API.
- **REWRITE** `backend/platform/` — wallet & auth become thin clients of the
  white-label. Mongo stays for bets/rounds/history; the wallet collection is retired.
- **ADAPT** `frontend/crash-pilot/` — embedded as an iframe; token-driven auth.

---

## 2. Design decisions (locked)

### 2.1 Topology — full delegation (Q1: A)
- White-label is the source of truth for money and identity.
- Platform `WalletService`/auth become thin clients, swapped in behind the existing
  `WALLET_REPOSITORY` injection token and a new launch-based auth path.
- `MongoWalletRepository` is retired; Mongo still backs bets, rounds, history.

### 2.2 Launch & token flow (Q2: A — opaque ticket + authenticate callback)
1. Player logs into the **white-label lobby** (its own session).
2. Lobby mints a **single-use launch token** (~60s TTL), persisted as a
   `GameSession` row in state `PENDING`.
3. Lobby renders `<iframe src="<game-frontend>/?token=XYZ&currency=USD&lang=en">`.
4. Game frontend reads `?token=` → `POST /auth/launch` on the platform.
5. Platform calls white-label `POST /wallet/authenticate { token }` →
   `{ playerId, currency, balance, displayName, sessionId }`; session → `ACTIVE`;
   token consumed (single-use).
6. Platform issues its **own** short-lived JWT `{ sub: playerId, currency, sessionId }`.

### 2.3 Seamless wallet contract (Q3) — game-initiated, four ops
All amounts are **integer minor units**. Every op carries a **game-generated
`txRef`** the white-label dedupes on.

| Op | When | Request | Behavior |
|---|---|---|---|
| `balance` | authenticate + refresh | `{ playerId, currency }` | return balance |
| `debit` (bet) | bet placement | `{ playerId, currency, txRef, roundId, slotId, amount }` | atomic subtract; reject if insufficient; idempotent on `txRef` |
| `credit` (win) | cashout / auto-cashout | `{ playerId, currency, txRef, roundId, slotId, amount }` | add; idempotent on `txRef` |
| `rollback` | round void / engine crash | `{ playerId, currency, refTxRef }` | reverse named debit; idempotent; no-op if never debited |

Crash-game mapping:
- One debit per slot per round: `txRef = {roundId}:{playerId}:{slot}:bet`.
- Loss = no credit (stake already debited).
- Cashout = credit `amount × multiplier`, `txRef = {roundId}:{playerId}:{slot}:win`.

### 2.4 Service-to-service auth (Q4: A — HMAC)
- Shared `OPERATOR_API_KEY` + `OPERATOR_SECRET`.
- Headers: `X-Api-Key`, `X-Timestamp`, `X-Signature = HMAC-SHA256(secret, timestamp + rawBody)`.
- Reject if timestamp skew > 30s (replay protection).
- **Wallet API is server-to-server only — never reachable from the browser/iframe.**

### 2.5 Currency & money representation (Q5)
- **5a:** schema is currency-aware (3-letter code on player/wallet/transaction);
  everyone **seeded `USD`**; no FX.
- **5b:** white-label ledger is integer minor units end-to-end; platform stays
  decimal internally; convert **only at the `HttpWalletRepository` seam**
  (dollars → `Math.round(x*100)` out; minor → `x/100` back). Lossless because
  `calculatePayout` already floors to whole cents.

### 2.6 Persistence (Q6: B — Prisma)
- Prisma + Postgres for white-label.
- Money path needs explicit care: atomic debit = conditional
  `updateMany({ where: { balance: { gte: amount } } })` inside `prisma.$transaction`;
  idempotency = `@unique` on `txRef`.

### 2.7 Postgres schema (Q7) — Prisma models, `BigInt` minor units
- **`Player`**: `id`, `username @unique`, `passwordHash`, `displayName`, `createdAt`.
- **`Wallet`**: `id`, `playerId`, `currency`, `balance BigInt`, `@@unique([playerId, currency])`.
- **`Transaction`** (ledger, append-only): `id`, `walletId`, `type (DEBIT|CREDIT|ROLLBACK)`,
  `amount BigInt`, `txRef @unique`, `refTxRef?`, `roundId?`, `slotId?`, `gameId?`,
  `balanceAfter BigInt`, `createdAt`. **Stores `balanceAfter` (running snapshot).**
- **`GameSession`** (ticket + session in ONE table): `id`, `launchToken @unique`,
  `playerId`, `currency`, `gameId`, `status (PENDING|ACTIVE|ENDED|EXPIRED)`,
  `expiresAt`, `consumedAt?`, `createdAt`.

### 2.8 Lobby UI (Q8: A — minimal server-rendered HTML)
- White-label serves `/lobby` HTML directly (login form → game list → iframe).
- No separate frontend build/container.

### 2.9 Iframe contract (Q9)
- **9a:** token delivered via **URL query param** `?token=` (single-use + short TTL
  mitigates URL-history exposure).
- **9b:** `postMessage` event channel, game → lobby:
  `crashpilot:ready`, `crashpilot:balanceChanged {balance,currency}`,
  `crashpilot:sessionEnded`. Both sides pin explicit `targetOrigin` (never `*`) and
  validate `event.origin`.
- **9c:** framing permission on the **game frontend**: CSP
  `frame-ancestors <lobby-origin>`; drop `X-Frame-Options: DENY`. Lobby iframe uses
  `sandbox="allow-scripts allow-same-origin"`.

### 2.10 Platform wallet client interface (Q10)
Rewrite `IWalletRepository` to context-carrying ops; keep the `WALLET_REPOSITORY`
token + interface for testability; one implementation (`HttpWalletRepository`):
```ts
debit(ctx: { playerId; currency; txRef; roundId; slotId; amount }): Promise<{ balance: number }>
credit(ctx: { playerId; currency; txRef; roundId; slotId; amount }): Promise<{ balance: number }>
rollback(ctx: { playerId; currency; refTxRef }): Promise<{ balance: number }>
getBalance(playerId: string, currency: string): Promise<number>
```
Drop `create`/`setBalance`/`findByUserId`. `BetService` builds `txRef` at each call
site. `currency` rides on the platform session.

### 2.11 Platform auth (Q11)
- Remove `register` and `login`. Add **`POST /auth/launch { token }`** (calls
  white-label `authenticate`, issues platform JWT `{ sub: playerId, currency, sessionId }`).
- `JwtAuthGuard` extended to set `req.userId`, `req.currency`, `req.sessionId`.
- `me` → `{ playerId, displayName, currency, balance }` (balance live from white-label).
- Trust platform JWT until expiry; killed sessions surface on the next money op.
- **Drop the Mongo `users` collection**; `playerId` is the identity key on bets/rounds.

### 2.12 Money ordering, failure & recovery (Q12: B)
- **Debit:** white-label `debit` first → persist bet. Fail debit → reject. Fail
  bet-create after debit → `rollback`.
- **Credit:** mark bet resolved (idempotent `{status:'PLACED'}` guard, capture
  multiplier/payout) → `credit`. Idempotent `txRef` prevents double-pay on retry.
- **Tick decoupling:** the 100ms tick only detects & marks auto-cashouts (fast Mongo
  write at crossing multiplier) + broadcasts; **credit network calls drain after
  `clearInterval`, never inside the tick.**
- **Bounded inline retry:** 3× with backoff per money call. Unrecoverable credit →
  mark bet `SETTLEMENT_PENDING`, log loudly, stop (no auto-sweep; idempotency makes a
  future manual replay safe).
- **Recovery:** on engine restart with an open round, `rollback` all `PLACED` debits
  for that round and void it.

### 2.13 White-label module layout (Q13)
`backend/white-label/`, NestJS 11 + Prisma + Postgres. Reuse platform house style
where it doesn't conflict with Prisma (`AppError`/`GlobalExceptionFilter`,
`ZodValidationPipe`, startup env validation).
- `lobby/` — static HTML (login → game list → iframe). Only browser-facing surface.
- `auth/` — lobby player login: bcrypt + white-label session JWT.
- `sessions/` — mint single-use launch token + `POST /wallet/authenticate`.
- `wallet/` — `balance/debit/credit/rollback`, HMAC-guarded, server-to-server only.
- `players/` — seeding + admin `reset balance`.

Three trust boundaries: **lobby player JWT**, **wallet HMAC**, **single-use launch token**.

### 2.14 Infra / docker-compose (Q14)
- New `postgres:16`: host `5532` → `5432`, var `PG_PORT`, volume `pg_data`,
  healthcheck `pg_isready`.
- New `white-label` (build `./backend/white-label`): host `4200` → `4000`, var
  `WHITELABEL_PORT`, serves API + lobby, `depends_on: postgres (healthy)`.
- Env wiring (container network):
  - white-label: `DATABASE_URL=postgresql://…@postgres:5432/whitelabel`,
    `LOBBY_JWT_SECRET`, `OPERATOR_API_KEY`, `OPERATOR_SECRET`,
    `GAME_FRONTEND_URL=http://localhost:${FRONTEND_PORT:-5274}`, `GAME_ID=crash-pilot`,
    launch-token TTL.
  - platform: `WALLET_API_URL=http://white-label:4000`, `OPERATOR_API_KEY`,
    `OPERATOR_SECRET`. Mongo/Redis/JWT unchanged.
  - game frontend: CSP `frame-ancestors http://localhost:${WHITELABEL_PORT:-4200}`,
    read `?token=` from URL.

Port map after changes:

| Service | Host | Var |
|---|---|---|
| Game frontend | 5274 | `FRONTEND_PORT` |
| Platform (game backend) | 4100 | `BACKEND_PORT` |
| White-label (API+lobby) | 4200 | `WHITELABEL_PORT` |
| Mongo | 27117 | `MONGO_PORT` |
| Redis | 6479 | `REDIS_PORT` |
| Postgres | 5532 | `PG_PORT` |

### 2.15 Seed & reset (Q15)
- Seed 2–3 demo players (idempotent upsert on `username`): `demo1/demo1`, `demo2/demo2`.
- Starting balance **100000 minor units (= 1000.00 USD)** — matches existing
  `INITIAL_DEMO_BALANCE`.
- **No self-registration** in the lobby.
- Admin reset endpoint `POST /admin/players/:id/reset` (HMAC/key-guarded): restore
  seed balance + write an adjustment ledger row.

### 2.16 Frontend auth UX (Q17)
- On load, read `?token=` → `POST /auth/launch` → hold platform JWT in memory.
- Remove the game's own login/register UI.
- No token → existing **guest-spectate** fallback ("Launch from the casino lobby to play").
- Show `currency` in bet UI labels.

### 2.17 Deferred
- **No automated tests for now** (Q16). Money path would warrant integration tests
  against real Postgres later; documented but not built.

---

## 3. Phased implementation plan

Implement one phase at a time, on explicit request. Each phase ends in a working,
verifiable state.

### Phase 0 — Scaffolding & infra ✅ DONE
- Create `backend/white-label/` NestJS project (mirror platform tooling:
  tsconfig path alias `@/`, eslint/prettier — match no-semicolon source style where
  the platform does, rely on typecheck).
- Add Prisma; define schema (§2.7); generate client; create initial migration.
- Add `postgres` + `white-label` services to `docker-compose.yml` (§2.14); add new
  env vars to `.env.example`.
- **Verify:** `docker compose up postgres white-label` boots; Prisma migrates;
  health endpoint responds.

### Phase 1 — White-label core (money authority) ✅ DONE
- Prisma data layer + services for `Player`, `Wallet`, `Transaction`, `GameSession`.
- `wallet/` endpoints: `balance/debit/credit/rollback` with atomic conditional update
  + `txRef` idempotency (§2.3, §2.6).
- HMAC guard (§2.4).
- `players/` seed script (§2.15) + admin reset endpoint.
- **Verify:** curl/script the four wallet ops with valid/invalid HMAC; confirm
  idempotency (same `txRef` twice = one effect) and overdraft rejection.

### Phase 2 — Launch & lobby ✅ DONE
- `auth/` lobby login (bcrypt + lobby JWT).
- `sessions/` mint single-use launch token + `POST /wallet/authenticate` (§2.2).
- `lobby/` HTML: login form → game list → iframe with `?token=` (§2.8, §2.9a).
- postMessage parent-side handling for balance header (§2.9b).
- **Verify:** log into lobby, mint token, confirm single-use + TTL expiry,
  `authenticate` returns identity/balance and flips session `ACTIVE`.

### Phase 3 — Platform rewrite (game → thin client) ✅ DONE
- Replace `MongoWalletRepository` with `HttpWalletRepository` (HMAC client + minor↔decimal
  conversion at the seam, §2.5b, §2.10).
- Rewrite `IWalletRepository` to context-carrying `debit/credit/rollback/getBalance` (§2.10).
- Auth: remove `register`/`login`, add `POST /auth/launch`; extend `JwtAuthGuard`
  with `currency`/`sessionId`; update `me`; drop `users` collection (§2.11).
- `BetService`: build `txRef` at call sites; debit-before-create + rollback;
  credit ordering (§2.12).
- `RoundEngine`: decouple credit from the 100ms tick; restart rollback/void (§2.12).
- Wire new env (`WALLET_API_URL`, `OPERATOR_*`).
- **Verify:** place bet → debit hits white-label; cashout → credit; loss → no credit;
  balances reconcile between platform `me` and white-label ledger.
  **Done 2026-05-31** — scripted end-to-end (`/tmp/phase3-verify.mjs`, 20/20):
  launch→platform JWT (single-use replay→401), `/me` + `/api/wallet` reconcile
  with the operator ledger, two-bet round (slot1 auto-cashout→credit, slot2→LOST,
  no credit), final balance `B0 − 2·stake + win` matches operator ledger,
  replayed win `txRef` is idempotent (no double-pay). `typecheck` + `npm test`
  (28/28) green.
- **Gotchas:** (a) `playerId` is now a white-label **UUID**, not a Mongo ObjectId —
  `MongoBetRepository` stores/queries `userId` as a **plain string** (only `roundId`
  stays an ObjectId). (b) `nest start --watch` in the Docker container doesn't reap
  the previous process on reload → `EADDRINUSE`, leaving stale code serving; a clean
  `docker restart crush-backend-1` / `crush-white-label-1` is needed to pick up changes.

### Phase 4 — Frontend (iframe player) ✅ DONE
- Read `?token=` on load → `POST /auth/launch` → hold JWT in memory (§2.16).
- Remove login/register UI; keep guest-spectate fallback for tokenless access.
- CSP `frame-ancestors` for the game frontend; emit postMessage events to lobby (§2.9).
- Show `currency` in labels.
- **Verify (manual):** open lobby → click Crash Pilot → game loads in iframe,
  authenticates, bet/cashout move balance, lobby header reflects changes.

  **Done — implemented `frontend/crash-pilot/`:**
  - `services/launch.ts` reads `?token=`/`?currency=` once at module load and strips
    the token from the URL (`history.replaceState`); `launchOnce()` memoizes the
    exchange so StrictMode's double-mount can't replay the single-use ticket.
  - `services/token.ts` now holds the JWT **in memory only** (no localStorage) —
    refresh ends the session; re-launch from the lobby. `authApi` is `launch()` only
    (register/login/me + `AuthModal` removed; wallet `reset` removed). `AuthProvider`
    exposes `{ player, status, currency }`; tokenless load → guest spectator.
  - `services/lobbyBridge.ts` posts `crashpilot:ready` / `crashpilot:balanceChanged`
    `{balance,currency}` / `crashpilot:sessionEnded` to `VITE_LOBBY_ORIGIN` (pinned,
    never `*`); App wires them (ready on mount, balanceChanged on every confirmed
    balance, sessionEnded on authenticated→guest).
  - **Gotcha — balance units:** the lobby renders `balance/100` (its ledger is minor
    units), so `notifyBalanceChanged` converts the platform's *decimal* balance back to
    **minor** (`Math.round(balance*100)`). Mismatch here shows a 100× wrong lobby header.
  - `currency` threaded into `Header`/`BettingPanel`/`MyBetsModal` labels
    (`formatCredits(value, currency)`); guest panels read "Launch from the casino lobby
    to play". Header drops login/logout/reset.
  - CSP via `vite.config.ts` `server.headers` (`loadEnv` → `frame-ancestors 'self'
    <VITE_LOBBY_ORIGIN>`); no `X-Frame-Options` is set (Vite sets none). Compose frontend
    gets `VITE_LOBBY_ORIGIN: http://localhost:${WHITELABEL_PORT:-4200}`.
  - **Gotcha — vite.config CSP needs a dev-server restart** to take effect; the bind-mount
    HMR won't re-emit `server.headers`. `docker restart crush-frontend-1`.
  - **Verified:** `npm run typecheck` clean, `npm test` 33/33, `npm run build` ok; CSP
    header served (`frame-ancestors 'self' http://localhost:4200`, no XFO); launch contract
    end-to-end (`/tmp/phase4-contract.mjs`, 9/9 — lobby `gameUrl` → `?token=`/`?currency=` →
    platform `/api/auth/launch` returns accessToken + player, single-use replay → 401).
    DOM/postMessage balance-mirroring left to manual browser playthrough per the plan.

### Phase 5 — End-to-end smoke & docs ✅ DONE
- Scripted happy-path smoke: launch token → authenticate → debit → credit
  (no browser harness).
- Update root `README.md` and `backend/platform/CLAUDE.md`; add
  `backend/white-label/CLAUDE.md`.
- **Verify:** full stack `docker compose up --build`; manual iframe playthrough.

  **Done:**
  - `scripts/whitelabel-smoke.mjs` — durable, rerunnable end-to-end smoke (no browser).
    **29/29**: lobby login → mint launch token (`gameUrl` embeds `?token=`/`?currency=`) →
    platform `/api/auth/launch` (accessToken + player, balance reconciles minor↔decimal) →
    single-use replay → 401 `LAUNCH_TOKEN_ALREADY_USED` → `/api/wallet` reconciles → WL
    `debit`→`credit` over HMAC → **txRef idempotency** (replay returns the original
    `balanceAfter` snapshot, live ledger unmoved) → overdraft → 402 `INSUFFICIENT_BALANCE`
    → unsigned wallet call → 401 → admin reset restores seed (so it's rerunnable).
  - **Idempotency semantics confirmed:** `findByTxRef` returns the original transaction's
    recorded `balanceAfter`, NOT the live balance — a debit replayed after a later credit
    returns the *debit-time* snapshot. Tests must assert the snapshot + a separate live-balance
    check, not the current balance.
  - Docs: rewrote root `README.md` (3-service white-label topology, ports incl. Postgres 5532 +
    lobby 4200, per-service env tables, smoke-test section, architecture); rewrote stale
    `frontend/crash-pilot/CLAUDE.md` (iframe launch model, in-memory JWT, lobbyBridge units
    gotcha, CSP-restart gotcha, removed login/register/AuthModal/reset); updated
    `backend/platform/CLAUDE.md` (thin-client role, launch auth, operator.client HMAC, money
    ordering, no-semicolon lint warning); added `backend/white-label/CLAUDE.md`.
  - **Verified:** `docker compose build` (all 3 images build clean); smoke 29/29 against the
    live stack. Manual iframe playthrough left to a human (needs a browser).

---

## 4. Open risks / notes
- Platform committed source is written **without semicolons** but `.prettierrc`
  requires them — do NOT run `npm run lint --fix` on platform; match no-semicolon
  style, rely on `npm run typecheck`. (Carries to white-label if sharing config.)
- Money path has no transactional guarantee across service boundaries by design;
  safety rests entirely on **idempotent `txRef`** + fail-safe ordering. Treat `txRef`
  determinism as load-bearing.
- `SETTLEMENT_PENDING` bets accumulate silently under sustained white-label outage
  (no auto-sweep by choice) — revisit if this moves beyond a simulator.
