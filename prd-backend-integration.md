# PRD — Connect crash-pilot frontend to platform backend

**Status:** Approved design (grilled 2026-05-27). Ready to implement.
**Frontend:** `frontend/crash-pilot` (React 19 + Vite + Tailwind v4)
**Backend:** `backend/platform` (NestJS 11, MongoDB, Redis, Socket.IO, JWT)

---

## 1. Goal & framing

Replace the frontend's fully client-side crash simulation with the real, server-authoritative
backend: sign-up/login, server-driven rounds, real two-slot betting, wallet, and history.

**Core reality (the decision everything hangs on):** the frontend is *client-authoritative* today
— `useCrashGame.ts` generates the crash point, runs the WAITING countdown, animates the multiplier,
computes payouts, and persists balance to `localStorage`. The backend `RoundEngine` is *fully
authoritative* and pushes the entire round lifecycle over Socket.IO. **Connecting them is an
inversion of the frontend game loop, not a `gameService.ts` swap** (the frontend CLAUDE.md's claim
that you can "replace three functions without touching the hook" is wrong). `useCrashGame` is
rewritten into a passive renderer of server state.

## 2. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope | **Rewrite `useCrashGame`** into a socket-subscription state machine. No local RNG/countdown/localStorage balance. |
| 2 | Bet model | **Expose both slots** (`slotId: 1 \| 2`). Two independent bet panels, each with amount, auto-cashout, place/cashout. |
| 3 | Queue UX | **WAITING-only, no queue.** Place buttons enabled only during the 5s WAITING window. Remove `queueNextRoundBet`/`cancelNextRoundBet`. |
| 4 | Multiplier | **Local interpolation, server-corrected.** 60fps `e^(rate*elapsed)`, snap to each 100ms `round:multiplier` tick, stop on `round:crashed`. Client never learns crash point early. |
| 5 | Bootstrap | **Event-based, frontend-only.** Sync from first round event; derive elapsed via `ln(multiplier)/rate`; restore bets from `/api/bets/active`, balance from `/api/wallet`. |
| 6 | Auth gate | **Guest spectating allowed.** Logged-out users watch rounds; login required to bet. *(Requires backend change — see §5.)* |
| 7 | Login transition | **Socket `authenticate` message.** Keep the same socket; add `SubscribeMessage('authenticate')` that verifies the token and joins the `userId` room live. |
| 8 | Session | **Bump `JWT_ACCESS_EXPIRES_IN=7d`** in backend `.env`. On 401/socket-auth failure, clear token and drop to guest mode with a re-login prompt. |
| 9 | History | **Both.** Crash-point strip from `/api/history/rounds` (seed + append on `round:crashed`); "My bets" view from `/api/bets/history` (cursor pagination). |
| 10 | HTTP client | **Native `fetch` wrapper** (injects `Authorization`, parses `{data, meta}`) + **`socket.io-client`**. No axios/TanStack. |
| 11 | Dev origin | **Pin Vite to port 5174** (`strictPort`) to match backend `CORS_ORIGIN`. No backend change. |
| 12 | Action transport | **Place = REST** (`POST /api/bets`); **Cashout = socket** (`bet:cashout` → `bet:cashedOut` + `wallet:updated`). |
| 13 | UI update | **Wait for server-confirmed** balances/multipliers. Pending/disabled state during the round-trip; displayed cash-out multiplier is the server's locked-in value. |
| 14 | Testing | **Prune dead tests, test new service layer.** Delete crash/payout tests, keep format tests, add tests for the fetch wrapper + socket-event→state reducer (mock `socket.io-client`). |

## 3. Backend contract (as-built, do not re-derive)

**Base URL:** `http://localhost:4000`  ·  **Success envelope:** `{ data, meta? }`  ·  **Error envelope:** `{ error: { code, message } }` (HTTP status carries the category)
**Auth header:** `Authorization: Bearer <token>`  ·  **Auth rate limit:** register/login 10 req / 15 min.

### REST
| Method & path | Auth | Body / query | Returns (`data`) |
|---|---|---|---|
| `POST /api/auth/register` | – | `{ email, password }` | `{ user: {id,email}, accessToken }` |
| `POST /api/auth/login` | – | `{ email, password }` | `{ user: {id,email}, accessToken }` |
| `GET /api/auth/me` | ✓ | – | `{ user: {id,email}, balance }` |
| `GET /api/wallet` | ✓ | – | `{ balance }` |
| `POST /api/wallet/reset` | ✓ | – | `{ balance }` |
| `POST /api/bets` | ✓ | `{ slotId:1\|2, amount>0, autoCashOut?>1\|null }` | `{ bet, balance }` |
| `POST /api/bets/:betId/cashout` | ✓ | – | `{ bet, balance }` |
| `GET /api/bets/active` | ✓ | – | `Bet[]` (current round) |
| `GET /api/bets/history` | ✓ | `?limit≤100&cursor?` | `Bet[]` + `meta:{limit,nextCursor}` |
| `GET /api/history/rounds` | – | `?limit≤100` | `Round[]` (recent crash points) |

### Socket.IO (handshake: `auth: { token }` optional after §5)
**Broadcast:** `round:waiting {roundId,phase,countdown}` · `round:countdown {roundId,countdown}` · `round:started {roundId,phase,startedAt}` · `round:multiplier {roundId,multiplier}` (every 100ms) · `round:crashed {roundId,phase,crashPoint,crashedAt}`
**Per-user (room = userId):** `bet:cashedOut {bet}` · `bet:lost {bet}` · `wallet:updated {balance}`
**Client→server:** `bet:place {slotId,amount,autoCashOut?}` → `bet:placed` · `bet:cashout {betId}` → `bet:cashedOut` · *(new)* `authenticate {token}`
**Errors:** `error {code,message}`

**`Bet` shape:** `{ id, userId, roundId, slotId, amount, autoCashOut, status: PLACED|CASHED_OUT|LOST|CANCELED, cashOutMultiplier, payout, placedAt, cashedOutAt, resolvedAt }`
**Backend tunables:** `ROUND_WAITING_SECONDS=5`, `ROUND_CRASHED_SECONDS=3`, `ROUND_GROWTH_RATE=0.06`, `INITIAL_DEMO_BALANCE=1000`.
**Error codes to surface:** `EMAIL_ALREADY_EXISTS`, `INVALID_CREDENTIALS`, `ROUND_NOT_WAITING`, `ROUND_NOT_RUNNING`, `INSUFFICIENT_BALANCE`, `BET_ALREADY_EXISTS`, `BET_NOT_FOUND`, `BET_ALREADY_RESOLVED`, `INVALID_AUTO_CASHOUT`, `UNAUTHORIZED`, `VALIDATION_ERROR`.

## 4. Frontend plan

### Phase 0 — Setup
- Add deps: `socket.io-client`. Add `.env` with `VITE_API_URL=http://localhost:4000`, `VITE_SOCKET_URL=http://localhost:4000`.
- `vite.config.ts`: `server: { port: 5174, strictPort: true }`.

### Phase 1 — Networking layer (`src/services/`)
- `api.ts` — `fetch` wrapper: base URL, inject `Authorization` from token store, unwrap `{data}`, throw a typed `ApiError {code,message,status}` on `{error}`.
- `socket.ts` — singleton `socket.io-client` connection; connect on app start (guest), emit `authenticate` after login; typed event emitters/listeners.
- `authApi.ts`, `betApi.ts`, `walletApi.ts`, `historyApi.ts` — thin per-domain callers.
- Replace the three stubs in `gameService.ts` (or delete it — superseded by the above).

### Phase 2 — Auth
- Token store (`localStorage` key, e.g. `crashPilot_token`) + `AuthContext`/hook (`user`, `token`, `login`, `register`, `logout`).
- `Login` + `SignUp` screens. App renders game for everyone (guest); betting controls gated on `user`.
- On 401 / socket auth error → clear token, revert to guest, prompt re-login.

### Phase 3 — Rewrite `useCrashGame` (server-driven)
- Subscribe to `round:*` events → drive `phase`, `countdown`, `currentMultiplier`, `currentRound`, `roundHistory`.
- Multiplier: on `round:started` capture `startedAt`; 60fps RAF computes `e^(0.06*elapsed)`, reconciled to each `round:multiplier` tick; freeze on `round:crashed` showing `crashPoint`.
- Mid-round bootstrap: if first event is `round:multiplier`, derive `elapsed = ln(m)/0.06` to seed the animation.
- Remove: local RNG, `setInterval` countdown, localStorage balance, `queueNextRoundBet`, `cancelNextRoundBet`, local payout math.
- Per-slot bet state from: `POST /api/bets` response, `bet:cashedOut`, `bet:lost`, `/api/bets/active` (on load/reconnect).
- Balance from `/api/wallet` (initial) + `wallet:updated` events.

### Phase 4 — UI
- `BettingPanel` → two slots (1 & 2): amount, optional auto-cashout, Place (WAITING only), Cash Out (RUNNING, socket). Disabled/pending per decisions 12–13. Map error codes to friendly messages.
- `RoundHistory` strip ← `/api/history/rounds` + live `round:crashed`.
- New "My Bets" view ← `/api/bets/history` with "load more" via `nextCursor`.
- `PlayerStatus`/`Header`: real balance + email; "Reset balance" button → `POST /api/wallet/reset`; logout.

### Phase 5 — Tests / cleanup
- Delete `utils/__tests__/crash.test.ts` and payout-related cases in `game.test.ts`; keep `format.test.ts`.
- Delete `utils/crash.ts` (server owns RNG). Keep `validateBet` only as optional client-side pre-check (server is source of truth).
- Add tests: `api.ts` wrapper (envelope/error parsing) and the socket-event→state reducer (mock `socket.io-client`).
- Update both `CLAUDE.md` files (frontend is no longer "frontend-only, no backend").

## 5. Backend changes (required — small)
1. **`.env`**: `JWT_ACCESS_EXPIRES_IN=7d`.
2. **`GameGateway.handleConnection`**: allow tokenless connections — if no/invalid token, stay connected as a guest (receive broadcasts only), **do not** disconnect; only `join(userId)` when a valid token is present.
3. **`GameGateway`**: add `@SubscribeMessage('authenticate')` — verify token, set `socket.userId`, `join(userId)`; emit ack/`error`.
4. **`bet:place` / `bet:cashout` handlers**: reject with `UNAUTHORIZED` when `socket.userId` is absent (guests can't bet over socket).
   *(REST bet/cashout already enforce auth via `JwtAuthGuard`.)*

## 6. Open edge cases to handle during build
- **Slot double-bet:** backend rejects a 2nd bet on the same slot/round (`BET_ALREADY_EXISTS`) — disable a slot's Place once placed.
- **Cashout race vs auto-cashout:** server is idempotent (`BET_ALREADY_RESOLVED`); treat that code as "already cashed out," not an error toast.
- **Place arriving after WAITING closes:** `ROUND_NOT_WAITING` — surface as "round already started," re-enable for next round.
- **Reconnect mid-round:** re-fetch `/api/bets/active` + `/api/wallet` on socket reconnect.
- **Two-step backend ops** (deduct-then-create, cashout-then-credit) are non-transactional by design — trust `wallet:updated`/response balance as the reconciled truth.

## 7. Out of scope
Refresh tokens, guest→user bet migration, multi-currency, real money, admin/analytics, deploy/prod CORS.
