# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # start dev server (pinned to port 5174 to match backend CORS_ORIGIN)
npm run typecheck    # TypeScript check (tsc -b --noEmit)
npm test             # run Vitest unit tests
npm run build        # production build
```

Run a single test file:
```bash
npx vitest run src/services/__tests__/api.test.ts
```

## Architecture

Aviator-style crash game **client for the `backend/platform` NestJS service**. The backend is
fully server-authoritative — it generates crash points, drives the WAITING→RUNNING→CRASHED loop,
ticks the multiplier every 100ms, and runs auto-cashout — and pushes everything over Socket.IO.
**This frontend is a passive renderer of that server state.** (It was originally a standalone
browser-only simulation; that loop has been replaced. See `prd-backend-integration.md` at the repo root.)

Config: `.env` holds `VITE_API_URL` / `VITE_SOCKET_URL` (both `http://localhost:4000` in dev).
Dev server is pinned to port **5174** (`vite.config.ts`, `strictPort`) because the backend's
`CORS_ORIGIN` is `http://localhost:5174`.

### Networking layer (`src/services/`)

- `api.ts` — `fetch` wrapper: injects `Authorization: Bearer <token>`, unwraps the `{ data, meta }`
  success envelope, throws a typed `ApiError` from `{ error: { code, message } }`, and clears the
  token on 401.
- `socket.ts` — singleton `socket.io-client`. Connects once at app start. Guests (no token) receive
  `round:*` broadcasts only; a token joins the `userId` room for private `bet:*` / `wallet:*` events.
  On login mid-session it emits `authenticate { token }` (no reconnect); on logout it reconnects fresh.
- `token.ts` — the JWT, persisted to `localStorage`, with a change-subscription used by `socket.ts`.
- `authApi` / `betApi` / `walletApi` / `historyApi` — thin per-domain callers.
- `errorMessages.ts` — maps backend error codes to friendly copy.

### Data flow (`src/hooks/useCrashGame.ts`)

All game state lives in the hook; components render only what they're given. The hook subscribes to
socket events and drives `phase`, `countdown`, `currentMultiplier`, `crashPoint`, `roundHistory`,
per-slot bet state, and `balance`. Actions: `placeBet`, `cashOut`, `resetBalance`, `clearError`.

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

### Auth (`src/auth/`)

`AuthProvider` hydrates the session from a persisted token via `GET /api/auth/me`, exposing
`{ user, status, login, register, logout }` through `useAuth`. The game is visible to guests;
betting controls prompt login (`AuthModal`). JWT lifetime is set server-side (7d).

### Betting model

Two independent slots per round (`slotId: 1 | 2`), matching the backend. Bets place during the
WAITING window via `POST /api/bets`; cash-out is latency-sensitive and goes over the socket
(`bet:cashout` → `bet:cashedOut` + `wallet:updated`). The UI waits for server-confirmed balances
and the locked-in cash-out multiplier (no optimistic updates). There is no "queue for next round".

### CSS animations

Custom Tailwind v4 keyframes live in `src/styles/global.css` under `@theme` and `@keyframes`
(`animate-crash-shake`, `animate-crash-flash`, `animate-ping-once`). Adding one requires both a
`@keyframes` block and a `--animate-*` entry in `@theme`.
