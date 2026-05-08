# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # start dev server (default port 5173, falls back to 5174)
npm run typecheck    # TypeScript check (tsc -b --noEmit)
npm test             # run Vitest unit tests (16 tests across 3 files)
npm run build        # production build
```

Run a single test file:
```bash
npx vitest run src/utils/__tests__/crash.test.ts
```

## Architecture

This is a frontend-only crash game (Aviator-style) — no backend, all logic runs in the browser.

### Data flow

All game state lives in `src/hooks/useCrashGame.ts`. Components receive only what they render — no game logic in components. The hook exposes state and five actions: `placeBet`, `queueNextRoundBet`, `cancelNextRoundBet`, `cashOut`, `resetBalance`.

### Game loop internals (`useCrashGame`)

The loop uses a `setInterval` for the 5s WAITING countdown and `requestAnimationFrame` for the RUNNING multiplier animation. Both are tracked in `intervalRef` / `rafRef` and cancelled via `stopLoop()` before any new loop starts — this is critical: calling `startWaiting()` without first calling `stopLoop()` causes two parallel loops (a StrictMode pitfall that was fixed).

State that must be readable inside RAF/timeout callbacks (stale closure problem) is mirrored in refs: `phaseRef`, `playerBetRef`, `multiplierRef`, `nextRoundBetRef`. The pattern is: update the ref immediately whenever the value changes, never read state directly inside async callbacks.

### Service layer

`src/services/gameService.ts` wraps all logic that will become backend calls. The hook imports only from services, never directly from `utils/crash.ts`. When adding a backend: replace the three functions in `gameService.ts` without touching the hook.

### Crash point formula

`Math.max(1.01, 0.99 / Math.random())` — isolated in `src/utils/crash.ts`. This is demo-only; a real deployment must replace it with a server-provided value.

### Multiplier formula

`Math.exp(0.06 * elapsedSeconds)` — computed every RAF frame. Reaches ~2x at ~11s, ~5x at ~27s.

### CSS animations

Custom Tailwind v4 keyframes are defined in `src/styles/global.css` under `@theme` and `@keyframes`: `animate-crash-shake`, `animate-crash-flash`, `animate-ping-once`. Tailwind utility classes like `animate-crash-shake` map to these. Adding new animations requires both a `@keyframes` block and a `--animate-*` entry in `@theme`.

### Mobile layout

The betting panel renders twice in `App.tsx` — once inside the scrollable flow (`hidden md:block`) and once as a `fixed bottom-0` overlay (`md:hidden`). This is intentional; the mobile panel is a separate fixed instance, not the same element repositioned.
