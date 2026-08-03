# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # start dev server (pinned to container port 5174 / host 5274)
npm run typecheck    # TypeScript check (tsc -b --noEmit)
npm test             # run Vitest unit tests
npm run build        # production build
```

Run a single test file:
```bash
npx vitest run src/services/__tests__/api.test.ts
```

## Architecture

Aviator-style crash game **embedded as an iframe player inside the `white-label` casino
lobby**. The game backend (`platform`) is fully server-authoritative — it generates crash
points, drives the WAITING→RUNNING→CRASHED loop, ticks the multiplier every 100ms, and runs
auto-cashout — and pushes everything over Socket.IO. **This frontend is a passive renderer of that
server state.** The white-label (not this app) owns money and identity; see
`docs/white-label-integration-plan.md` at the repo root.

Config (`.env`): `VITE_API_URL` / `VITE_SOCKET_URL` point at the **platform** game backend
(host `http://localhost:4100`); `VITE_LOBBY_ORIGIN` is the white-label lobby origin authorized to
frame the game (`http://localhost:4200`). The dev server runs on container port **5174** (vite
`strictPort`), published on host **5274**. The white-label's `CORS_ORIGIN` / CSP authorize that
origin.

### Launch & framing

The game does **not** have its own login. The lobby opens it as
`<iframe src="<game>/?token=<launchToken>&currency=USD&lang=en">`; the game exchanges that
single-use token for a platform JWT.

- `services/launch.ts` reads `?token=`/`?currency=` once at module load and **strips the token
  from the URL** (`history.replaceState`) so it can't be replayed from history. `launchOnce()`
  memoizes the exchange so React StrictMode's double-mount can't burn the single-use ticket.
- `services/lobbyBridge.ts` posts game→lobby events, all pinned to `VITE_LOBBY_ORIGIN` (never
  `*`): `crashpilot:ready` (on mount), `crashpilot:balanceChanged { balance, currency }` (on every
  confirmed balance), `crashpilot:sessionEnded` (authenticated→guest). **Units gotcha:** the lobby
  ledger is integer minor units and renders `balance/100`, so `notifyBalanceChanged` converts the
  platform's *decimal* balance back to minor via `Math.round(balance * 100)`.
- **CSP `frame-ancestors 'self' <VITE_LOBBY_ORIGIN>`** is set in `vite.config.ts` `server.headers`
  (via `loadEnv`); no `X-Frame-Options` is emitted. Changing it needs a **dev-server restart**
  (`docker restart crush-frontend-1`) — HMR won't re-emit `server.headers`.

### Networking layer (`src/services/`)

- `api.ts` — `fetch` wrapper: injects `Authorization: Bearer <token>`, unwraps the `{ data, meta }`
  success envelope, throws a typed `ApiError` from `{ error: { code, message } }`, and clears the
  token on 401.
- `socket.ts` — singleton `socket.io-client`. Connects once at app start. Guests (no token) receive
  `round:*` broadcasts only; a token joins the `userId` room for private `bet:*` / `wallet:*` events.
  On authenticate mid-session it emits `authenticate { token }` (no reconnect).
- `token.ts` — the platform JWT, held **in memory only** (no `localStorage`); a refresh ends the
  session and you re-launch from the lobby. Keeps the change-subscription used by `socket.ts`.
- `launch.ts` — one-shot launch handshake (see "Launch & framing" above).
- `lobbyBridge.ts` — game→lobby postMessage channel (see above).
- `authApi` (`launch()` only) / `betApi` / `walletApi` (`getBalance()` only) / `historyApi` — thin per-domain callers.
- `errorMessages.ts` — maps backend error codes (incl. launch codes like `LAUNCH_TOKEN_ALREADY_USED`, `WALLET_UNAVAILABLE`) to friendly copy.

### Data flow (`src/hooks/useCrashGame.ts`)

All game state lives in the hook; components render only what they're given. The hook subscribes to
socket events and drives `phase`, `countdown`, `currentMultiplier`, `crashPoint`, `roundHistory`,
per-slot bet state, and `balance`. Actions: `placeBet`, `cashOut`, `clearError`.

- **Multiplier** is interpolated locally for smoothness: each `round:multiplier` tick re-anchors
  `{ multiplier, at: performance.now() }` and a RAF loop grows it via `e^(0.06·Δt)` from that anchor.
  Anchoring on client receipt time avoids clock skew; the client never learns the crash point early.
- **`phaseRef`** mirrors `phase` for reads inside RAF/socket callbacks. It is written *inside the event
  handlers* (never during render — the `react-hooks/set-state-in-effect` / ref-during-render rules are
  enforced) so the animation loop sees the new phase before passive effects run.
- **Mid-round join**: if the first event seen is `round:multiplier`, the handler transitions to
  RUNNING and the anchor seeds the animation.
- **Guest vs authed**: private state (`balance`, `slots`) is fetched only when authenticated and is
  *derived as null/empty at the return* when not — no setState-on-logout. Reconnect re-pulls
  `/api/wallet` + `/api/bets/active`.
- **Operator pause** (`paused`): an operator can stop the round loop from the backoffice console.
  The engine finishes and settles whatever is in flight and simply does not start the next round, so
  without a signal the client would show a WAITING phase with a countdown of 0 that never advances —
  indistinguishable from a dead socket. So the pause is **announced, not inferred**:
  `round:paused` / `round:resumed` set the flag and nothing else (the last crash stays on screen
  under the overlay). Three details worth keeping:
  - The engine broadcasts each event **once, on the transition**; a client that connects mid-pause is
    told by the platform's `GameGateway.handleConnection` instead.
  - `round:waiting` / `round:started` / a mid-round `round:multiplier` all clear the flag, because a
    round starting is proof the engine is not paused. This is a real race, not defensiveness: a
    socket connecting in the instant between the operator resuming and the gateway's late-join check
    receives `round:paused` and never sees the `round:resumed` broadcast just before it arrived,
    leaving the overlay up over a visibly running game.
  - `GameCanvas` suppresses "Next round in 0s" while paused and draws a translucent *Rounds paused*
    overlay; `BettingPanel` disables **both** new-money actions (place and queue-for-next-round) but
    keeps cancel and cash-out live — queueing is harmless money-wise, since the stake is debited only
    when `runWaiting()` actually places the bet, but naming a "next round" nobody has scheduled is a
    promise the UI cannot keep.

### Auth (`src/auth/`)

`AuthProvider` exchanges the launch token (`launchOnce`) for a platform JWT + `Player`, exposing
`{ player, status, currency }` through `useAuth` (`status: 'loading' | 'authenticated' | 'guest'`).
A tokenless load (opened directly, not from the lobby) stays a **guest spectator** — the game
renders but betting panels read *"Launch from the casino lobby to play."* There is no login,
register, or logout UI (all removed; `AuthModal` deleted). JWT lifetime is set server-side.

### Betting model

Two independent slots per round (`slotId: 1 | 2`), matching the backend. Bets place during the
WAITING window via `POST /api/bets`; cash-out is latency-sensitive and goes over the socket
(`bet:cashout` → `bet:cashedOut` + `wallet:updated`). The UI waits for server-confirmed balances
and the locked-in cash-out multiplier (no optimistic updates). There is no "queue for next round".

### CSS animations

Custom Tailwind v4 keyframes live in `src/styles/global.css` under `@theme` and `@keyframes`
(`animate-crash-shake`, `animate-crash-flash`, `animate-ping-once`). Adding one requires both a
`@keyframes` block and a `--animate-*` entry in `@theme`.
