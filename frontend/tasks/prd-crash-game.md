# PRD: Crash Pilot — Frontend Crash Game

## Introduction

Build a frontend-only crash game prototype inspired by Aviator. The player starts with a fake balance, places bets during a waiting phase, watches a multiplier climb, and cashes out before the round crashes. All game logic runs in the browser with no backend. The codebase is structured so a real backend can be plugged in later with minimal refactoring.

---

## Goals

- Deliver a fully playable local crash game loop (WAITING → RUNNING → CRASHED → repeat)
- Implement auto-cashout and next-round bet queueing for a smooth UX
- Keep game logic isolated behind a service layer to make backend integration straightforward
- Ship a responsive dark-theme UI that works on desktop and mobile
- Cover core pure utility functions with Vitest unit tests

---

## User Stories

### US-001: Project scaffold
**Description:** As a developer, I need a working Vite + React + TypeScript project with Tailwind CSS so that I have a clean base to build on.

**Acceptance Criteria:**
- [ ] `npm create vite` scaffold with React + TypeScript template
- [ ] Tailwind CSS installed and configured (`tailwind.config.ts`, `postcss.config.js`)
- [ ] Vitest installed and configured (`vitest.config.ts`)
- [ ] `src/` folder structure matches spec: `types/`, `utils/`, `hooks/`, `components/`, `services/`, `styles/`
- [ ] `npm run dev` starts without errors
- [ ] `npm run test` runs (zero tests pass is fine at this stage)
- [ ] `npm run typecheck` passes

---

### US-002: TypeScript types
**Description:** As a developer, I need shared TypeScript types so that all modules share the same language.

**Acceptance Criteria:**
- [ ] `src/types/game.ts` exports `GamePhase`, `Round`, `PlayerBet`, `GameState`
- [ ] `GamePhase = "WAITING" | "RUNNING" | "CRASHED"`
- [ ] `PlayerBet` includes: `amount`, `placed`, `cashedOut`, `cashOutMultiplier`, `payout`, `autoCashOut: number | null`
- [ ] `Round` includes: `id`, `crashPoint`, `startedAt`, `crashedAt`
- [ ] `GameState` includes: `balance`, `phase`, `countdown`, `currentMultiplier`, `currentRound`, `playerBet`, `nextRoundBet: PlayerBet | null`, `roundHistory`
- [ ] Typecheck passes

---

### US-003: Utility functions + unit tests
**Description:** As a developer, I need pure utility functions with tests so that core game logic is verified independently of the UI.

**Acceptance Criteria:**
- [ ] `src/utils/crash.ts` exports `generateCrashPoint(): number` using formula `Math.max(1.01, 0.99 / Math.random())`, with comment explaining it is demo-only and must be replaced by backend
- [ ] `src/utils/game.ts` exports `calculatePayout(amount: number, multiplier: number): number`
- [ ] `src/utils/game.ts` exports `validateBet(amount: number, balance: number): string | null` — returns error string or null
- [ ] `src/utils/format.ts` exports `formatMultiplier(value: number): string` — returns e.g. `"2.43x"`
- [ ] `src/utils/__tests__/crash.test.ts` — 100 samples: all ≥ 1.01, median < 3.0
- [ ] `src/utils/__tests__/game.test.ts` — covers `calculatePayout` and `validateBet` edge cases (zero bet, negative, exceeds balance)
- [ ] `src/utils/__tests__/format.test.ts` — covers `formatMultiplier` for values like 1, 1.5, 10.123
- [ ] `npm run test` passes

---

### US-004: Service layer
**Description:** As a developer, I need a service layer so that swapping local logic for backend calls requires changing one file, not the hook.

**Acceptance Criteria:**
- [ ] `src/services/gameService.ts` exports: `fetchRoundResult(): Promise<number>` (returns crash point), `submitCashOut(multiplier: number, amount: number): Promise<number>` (returns payout), `fetchRoundHistory(): Promise<Round[]>`
- [ ] All three functions currently wrap local utils (no real HTTP calls)
- [ ] Each function has a `// TODO: Replace with backend call` comment
- [ ] Typecheck passes

---

### US-005: `useCrashGame` hook — game loop
**Description:** As a developer, I need the core game loop in a single hook so that UI components stay free of game logic.

**Acceptance Criteria:**
- [ ] `src/hooks/useCrashGame.ts` manages the full WAITING → RUNNING → CRASHED → WAITING cycle
- [ ] WAITING phase lasts 5 seconds with a countdown tick each second
- [ ] RUNNING phase drives multiplier via `e^(0.06 * elapsedSeconds)` using `requestAnimationFrame`
- [ ] Multiplier is checked against `autoCashOut` on every frame; auto-cashout triggers if multiplier ≥ target
- [ ] CRASHED phase lasts 3 seconds then loops back to WAITING
- [ ] At WAITING start, `nextRoundBet` (if set) is moved into `playerBet` and deducted from balance
- [ ] Hook exposes: `balance`, `phase`, `countdown`, `currentMultiplier`, `currentRound`, `playerBet`, `nextRoundBet`, `roundHistory`, `placeBet`, `queueNextRoundBet`, `cancelNextRoundBet`, `cashOut`, `resetBalance`
- [ ] Typecheck passes

---

### US-006: `useCrashGame` hook — bet actions
**Description:** As a player, I want to place bets, queue next-round bets, and cash out so that I can participate in each round.

**Acceptance Criteria:**
- [ ] `placeBet(amount, autoCashOut?)` works only in WAITING phase; deducts from balance immediately; rejects if amount ≤ 0 or exceeds balance or bet already placed
- [ ] `queueNextRoundBet(amount, autoCashOut?)` works only in RUNNING phase; stores in `nextRoundBet`; rejects same edge cases
- [ ] `cancelNextRoundBet()` clears `nextRoundBet` and refunds nothing (bet not yet deducted)
- [ ] `cashOut()` works only in RUNNING phase with an active uncashed bet; records `cashOutMultiplier` and adds payout to balance
- [ ] `resetBalance()` sets balance back to 1000 and clears any active bet
- [ ] Typecheck passes

---

### US-007: localStorage persistence
**Description:** As a player, I want my balance and round history to survive page refresh so that I don't lose progress.

**Acceptance Criteria:**
- [ ] Balance is read from `localStorage` on init; falls back to 1000 if unavailable or corrupted
- [ ] Balance is written to `localStorage` on every change
- [ ] Last 20 round crash points are persisted to `localStorage`
- [ ] App works normally if `localStorage` throws (e.g. private browsing quota exceeded) — errors are caught and silently ignored
- [ ] Typecheck passes

---

### US-008: Header component
**Description:** As a player, I want to see the game name and my current balance so that I always know my financial state.

**Acceptance Criteria:**
- [ ] `src/components/Header.tsx` renders game name "Crash Pilot" and current balance formatted as e.g. `1,000 credits`
- [ ] Balance updates reactively as it changes
- [ ] Responsive: no overflow on screens ≥ 320px wide
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-009: Game area component
**Description:** As a player, I want a central game area that clearly shows the current phase and multiplier so that I can make cashout decisions at a glance.

**Acceptance Criteria:**
- [ ] `src/components/GameCanvas.tsx` renders the central game area
- [ ] WAITING: shows "Next round in Xs" countdown, plane SVG is stationary
- [ ] RUNNING: shows live multiplier (e.g. `2.43x`) in large text, plane SVG moves upward/forward via CSS transform driven by multiplier value
- [ ] CRASHED: multiplier display and game area flash red, plane SVG shakes via CSS keyframe animation, then shows "CRASHED @ X.XXx" message
- [ ] Plane is an inline SVG silhouette (not emoji)
- [ ] All transitions are smooth and use CSS animations or `requestAnimationFrame`-driven state, not `setTimeout` chains
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-010: Betting panel — desktop layout
**Description:** As a player on desktop, I want a betting panel below the game area so that I can place and manage bets easily.

**Acceptance Criteria:**
- [ ] `src/components/BettingPanel.tsx` renders bet amount input, auto-cashout input, quick-amount buttons (10, 25, 50, 100), Place Bet button, Cash Out button
- [ ] Inputs have accessible `<label>` elements
- [ ] Place Bet is enabled only in WAITING phase with no active bet and no queued bet
- [ ] Cash Out is enabled only in RUNNING phase with an active uncashed bet
- [ ] Possible payout (`amount × currentMultiplier`) shown during RUNNING phase
- [ ] Validation errors (e.g. "Amount exceeds balance") shown inline below the input
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-011: Next-round bet queued state
**Description:** As a player, I want clear feedback when my bet is queued for the next round so that I don't accidentally place two bets.

**Acceptance Criteria:**
- [ ] During RUNNING phase, Place Bet button is replaced by a "Queued: X credits" badge
- [ ] Badge includes a Cancel button that calls `cancelNextRoundBet()`
- [ ] If `autoCashOut` was set on the queued bet, it is shown in the badge (e.g. "Queued: 50 credits @ 2.00x")
- [ ] After cancel, Place Bet flow returns to normal
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-012: Mobile fixed-bottom betting panel
**Description:** As a player on mobile, I want the betting panel pinned to the bottom of the screen so that I never need to scroll to place a bet.

**Acceptance Criteria:**
- [ ] On screens < 768px, BettingPanel is `position: fixed; bottom: 0`
- [ ] Scrollable content above has enough bottom padding to avoid being obscured by the panel
- [ ] Panel is full-width on mobile
- [ ] No layout overlap or content hidden behind panel
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-013: Player status component
**Description:** As a player, I want a status line showing the outcome of my current round so that I always know whether I won, lost, or have no bet.

**Acceptance Criteria:**
- [ ] `src/components/PlayerStatus.tsx` shows one of four states:
  - "No bet placed"
  - "Bet placed: X credits" (during RUNNING with active bet)
  - "Cashed out at X.XXx — Won Y credits" (green)
  - "Lost X credits at crash" (red)
- [ ] Win/loss states use both color AND text/icon (not color alone) for accessibility
- [ ] Resets to "No bet placed" at the start of each new WAITING phase
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-014: Round history component
**Description:** As a player, I want to see recent crash multipliers so that I can spot patterns and inform my strategy.

**Acceptance Criteria:**
- [ ] `src/components/RoundHistory.tsx` renders a horizontal scrollable pill row showing the 10 most recent crash multipliers
- [ ] Pills are color-coded: red for < 2x, yellow for 2x–5x, green for > 5x
- [ ] Color alone is NOT the only differentiator — pill label also shows the value (e.g. "1.43x", "3.20x")
- [ ] New pill appears at the left on each new crash
- [ ] Up to 20 rounds stored in state; only 10 shown at once
- [ ] Positioned as a horizontal row above the betting panel
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-015: App assembly + responsive layout
**Description:** As a player, I want all components assembled into a working app with a correct responsive layout.

**Acceptance Criteria:**
- [ ] `App.tsx` composes Header, GameCanvas, RoundHistory, BettingPanel, PlayerStatus using state/actions from `useCrashGame`
- [ ] Desktop layout: header → game area → round history pill row → betting panel → player status (vertical stack, centered, max-width ~900px)
- [ ] Mobile layout: same order, BettingPanel fixed to bottom
- [ ] Dark background theme applied globally
- [ ] No TypeScript errors
- [ ] No unused variables or imports
- [ ] `npm run dev` starts and full gameplay loop works
- [ ] Verify in browser using dev-browser skill

---

## Functional Requirements

- FR-1: Game loop cycles WAITING (5s) → RUNNING (until crash) → CRASHED (3s) → WAITING automatically
- FR-2: Crash point generated as `Math.max(1.01, 0.99 / Math.random())` — isolated in `generateCrashPoint()`
- FR-3: Multiplier computed as `Math.exp(0.06 * elapsedSeconds)` on each animation frame during RUNNING
- FR-4: Auto-cashout triggers when `currentMultiplier >= playerBet.autoCashOut` during RUNNING
- FR-5: Next-round bet is stored in `nextRoundBet` and activated at the start of WAITING (balance deducted then)
- FR-6: `placeBet` rejects if: amount ≤ 0, amount > balance, bet already active, phase is not WAITING
- FR-7: `cashOut` rejects if: no active bet, bet already cashed out, phase is not RUNNING
- FR-8: Balance and round history (last 20) are persisted to and restored from `localStorage`
- FR-9: Betting panel is `position: fixed; bottom: 0` on viewports < 768px wide
- FR-10: Round history pills use color + text label (not color alone) to indicate crash tier
- FR-11: Crash animation is a CSS `shake` keyframe + red background flash on the game area
- FR-12: All service functions in `gameService.ts` have `// TODO: Replace with backend call` comments

---

## Non-Goals

- No real money, payments, or crypto
- No authentication or user accounts
- No multiplayer, chat, or leaderboard
- No sound effects
- No provably fair / cryptographic crash generation
- No backend API calls of any kind
- No server-side wallet or transaction validation
- No animated flight path graph (canvas trajectory line)

---

## Technical Considerations

- **Styling:** Tailwind CSS exclusively — no separate CSS files except `src/styles/global.css` for base resets
- **Animation:** DOM + CSS (`requestAnimationFrame` for multiplier; CSS keyframes for crash shake/flash; CSS `transform` for plane movement)
- **Plane:** Inline SVG in `GameCanvas.tsx` — no external image assets
- **State:** All game state lives in `useCrashGame` hook; components receive only what they render
- **Service layer:** `src/services/gameService.ts` wraps all logic that will later become backend calls; hook imports from services, not from utils directly
- **Testing:** Vitest + `@testing-library` for unit tests on pure utils only; no component tests required
- **TypeScript:** Strict mode; no `any` types; all exports explicitly typed

---

## File Structure

```
src/
  main.tsx
  App.tsx
  types/
    game.ts
  utils/
    crash.ts
    game.ts
    format.ts
    __tests__/
      crash.test.ts
      game.test.ts
      format.test.ts
  hooks/
    useCrashGame.ts
  services/
    gameService.ts
  components/
    Header.tsx
    GameCanvas.tsx
    BettingPanel.tsx
    RoundHistory.tsx
    PlayerStatus.tsx
  styles/
    global.css
```

---

## Success Metrics

- Full gameplay loop completes without errors or freezes
- Auto-cashout fires correctly at the configured multiplier
- Next-round queued bet activates at the start of the following WAITING phase
- Balance persists across page refresh
- All Vitest tests pass
- Zero TypeScript errors (`npm run typecheck` clean)
- Mobile layout has no scroll-to-bet requirement

---

## Open Questions

- Should the plane SVG rotate to follow the "trajectory" angle, or always face right?
- Should quick-amount buttons set absolute values (10, 25, 50, 100) or relative ones (½ balance, all-in)?
- Should round history pills animate in from the left, or snap immediately?
