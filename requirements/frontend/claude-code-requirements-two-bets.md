# Claude Code Requirements: Add Two Bets in One Round

## Context

This feature extends the existing **Crash Pilot** frontend-only crash game.

The current PRD defines a React + TypeScript + Vite + Tailwind crash game with:

- A `WAITING → RUNNING → CRASHED → WAITING` game loop
- One active `playerBet`
- One optional `nextRoundBet`
- Auto-cashout support
- Local-only browser logic
- A backend-ready service layer
- `useCrashGame` as the central game logic hook

## New Feature Goal

Add support for **two independent bets in the same round**, similar to Aviator-style gameplay.

The player should be able to place and manage **Bet 1** and **Bet 2** independently during the same round.

Each bet must support:

- Its own bet amount
- Its own auto-cashout value
- Its own cashout button
- Its own win/loss state
- Its own possible payout
- Its own next-round queued bet state

This must remain a **frontend-only demo** with no backend, no real money, no authentication, and no payments.

---

# Main Requirement

Refactor the current single-bet system into a **two-slot bet system**.

Instead of:

```ts
playerBet: PlayerBet
nextRoundBet: PlayerBet | null
```

Use a slot-based model:

```ts
betSlots: BetSlot[]
```

Each slot should represent one independent bet panel.

There must always be exactly two slots:

```ts
BET_SLOT_COUNT = 2
```

---

# Updated TypeScript Types

Update `src/types/game.ts`.

## Bet Slot ID

```ts
export type BetSlotId = 1 | 2;
```

## PlayerBet

Keep the existing fields, but make sure the type works per slot:

```ts
export interface PlayerBet {
  amount: number;
  placed: boolean;
  cashedOut: boolean;
  cashOutMultiplier: number | null;
  payout: number;
  autoCashOut: number | null;
}
```

## BetSlot

Add a new type:

```ts
export interface BetSlot {
  id: BetSlotId;
  activeBet: PlayerBet | null;
  queuedBet: PlayerBet | null;
  lastResult: BetResult | null;
}
```

## BetResult

Add:

```ts
export type BetResult =
  | {
      type: "WIN";
      amount: number;
      cashOutMultiplier: number;
      payout: number;
    }
  | {
      type: "LOSS";
      amount: number;
      crashMultiplier: number;
    };
```

## GameState

Replace single-bet fields:

```ts
playerBet: PlayerBet;
nextRoundBet: PlayerBet | null;
```

With:

```ts
betSlots: BetSlot[];
```

Final `GameState` should include:

```ts
export interface GameState {
  balance: number;
  phase: GamePhase;
  countdown: number;
  currentMultiplier: number;
  currentRound: Round | null;
  betSlots: BetSlot[];
  roundHistory: Round[];
}
```

---

# Updated Hook API

Update `src/hooks/useCrashGame.ts`.

The hook should expose:

```ts
{
  balance,
  phase,
  countdown,
  currentMultiplier,
  currentRound,
  betSlots,
  roundHistory,
  placeBet,
  queueNextRoundBet,
  cancelNextRoundBet,
  cashOut,
  resetBalance
}
```

## Updated Function Signatures

```ts
placeBet(slotId: BetSlotId, amount: number, autoCashOut?: number | null): void;

queueNextRoundBet(slotId: BetSlotId, amount: number, autoCashOut?: number | null): void;

cancelNextRoundBet(slotId: BetSlotId): void;

cashOut(slotId: BetSlotId): void;

resetBalance(): void;
```

---

# Game Logic Requirements

## Bet Slots

The game must maintain exactly two bet slots:

```ts
[
  {
    id: 1,
    activeBet: null,
    queuedBet: null,
    lastResult: null
  },
  {
    id: 2,
    activeBet: null,
    queuedBet: null,
    lastResult: null
  }
]
```

Each slot must behave independently.

The user can:

- Place Bet 1 only
- Place Bet 2 only
- Place both bets in the same round
- Cash out Bet 1 and let Bet 2 continue
- Cash out Bet 2 and let Bet 1 continue
- Use different auto-cashout values for each bet
- Queue one or both bets for the next round

---

# WAITING Phase Behavior

During `WAITING`:

- The player can place a bet in slot 1.
- The player can place a bet in slot 2.
- Both bets can be active for the upcoming round.
- Each slot validates independently.
- Balance is deducted immediately when a bet is placed.
- A slot cannot place another bet if that slot already has an active bet.
- A slot cannot queue a next-round bet during `WAITING`; it should place directly instead.

At the start of a new `WAITING` phase:

- Clear old active bets from both slots.
- Clear old last results if needed for UX.
- Move each slot’s `queuedBet` into `activeBet`.
- Deduct queued bet amounts from balance at activation time.
- Clear `queuedBet` after activation.

Important:

- If both slots have queued bets, activate both if balance is sufficient.
- If balance is not sufficient for both queued bets, activate them in slot order: slot 1 first, then slot 2.
- If a queued bet cannot be activated due to insufficient balance, clear it and store a visible validation error for that slot.

---

# RUNNING Phase Behavior

During `RUNNING`:

- Active bets cannot be modified.
- Each active uncashed bet can be cashed out independently.
- Each bet’s possible payout is calculated separately.
- The user can queue a bet for the next round in any slot that does not already have a queued bet.
- Queued next-round bets should not deduct balance until they are activated at the next `WAITING` phase.
- A slot may have both:
  - An active bet for the current round
  - A queued bet for the next round

Example:

```text
Slot 1:
- Active bet: 50 credits
- Queued next-round bet: 100 credits

Slot 2:
- Active bet: 25 credits
- No queued bet
```

---

# CRASHED Phase Behavior

During `CRASHED`:

- Any active bet that was not cashed out becomes a loss.
- Each slot records its own result.
- Cashed-out bets remain wins.
- Show crash multiplier globally.
- After 3 seconds, transition back to `WAITING`.

---

# Cashout Requirements

`cashOut(slotId)` must:

- Work only during `RUNNING`
- Work only if the slot has an active bet
- Reject if the bet is already cashed out
- Use the current multiplier for that exact moment
- Calculate payout using:

```ts
calculatePayout(amount, currentMultiplier)
```

- Add payout to balance
- Update only that slot’s active bet
- Store a `WIN` result for that slot

Example result:

```ts
{
  type: "WIN",
  amount: 50,
  cashOutMultiplier: 2.25,
  payout: 112.5
}
```

---

# Auto-Cashout Requirements

Auto-cashout must work independently per slot.

During every animation frame in the `RUNNING` phase:

- Check slot 1 active bet
- Check slot 2 active bet
- If active bet has `autoCashOut`
- If bet is not already cashed out
- If `currentMultiplier >= autoCashOut`
- Trigger cashout for that slot

Important:

- Both bets may auto-cashout on the same frame.
- One bet may auto-cashout while the other continues.
- Auto-cashout must not trigger twice for the same slot.
- Auto-cashout target must be greater than `1.00`.

---

# Queue Next-Round Bet Requirements

`queueNextRoundBet(slotId, amount, autoCashOut?)` must:

- Work only during `RUNNING`
- Store a queued bet in that specific slot
- Not deduct balance immediately
- Reject if the same slot already has a queued bet
- Reject invalid amounts
- Reject if amount exceeds current visible balance
- Allow both slots to have queued bets at the same time

`cancelNextRoundBet(slotId)` must:

- Clear only that slot’s queued bet
- Not affect the other slot
- Not refund anything because queued bets are not deducted yet

---

# Balance Rules

- Placing an active bet during `WAITING` deducts balance immediately.
- Queued bets during `RUNNING` do not deduct balance immediately.
- Queued bets deduct balance only when activated at the next `WAITING`.
- Cashout adds payout to balance.
- Losing bets add nothing.
- Reset balance should:
  - Set balance back to `1000`
  - Clear active bets in both slots
  - Clear queued bets in both slots
  - Clear last results in both slots

---

# Validation Rules

Validation must be per slot.

Each slot should show its own error message.

Validate:

- Bet amount must be positive.
- Bet amount cannot exceed current balance.
- Auto-cashout must be empty/null or greater than `1.00`.
- Slot cannot place active bet if active bet already exists.
- Slot cannot queue bet if queued bet already exists.
- Slot cannot cash out without active bet.
- Slot cannot cash out after already cashed out.
- Slot cannot cash out outside `RUNNING` phase.

Add or update a utility function if useful:

```ts
validateBet(amount: number, balance: number): string | null;
validateAutoCashOut(value: number | null): string | null;
```

---

# UI Requirements

## BettingPanel Refactor

Refactor `src/components/BettingPanel.tsx` to render two independent betting sections.

Recommended structure:

```tsx
<BettingPanel>
  <BetSlotPanel slotId={1} />
  <BetSlotPanel slotId={2} />
</BettingPanel>
```

Create a new component if helpful:

```text
src/components/BetSlotPanel.tsx
```

Each bet slot panel should include:

- Slot title:
  - `Bet 1`
  - `Bet 2`
- Bet amount input
- Auto-cashout input
- Quick amount buttons:
  - `10`
  - `25`
  - `50`
  - `100`
- Place Bet button during `WAITING`
- Cash Out button during `RUNNING` if active uncashed bet exists
- Queue Next Round button during `RUNNING`
- Queued bet badge if a next-round bet exists
- Cancel queued bet button
- Possible payout for that slot
- Slot-specific validation errors
- Slot-specific result status

---

# BettingPanel Behavior by Phase

## WAITING

Each slot should show:

- Amount input
- Auto-cashout input
- Quick amount buttons
- `Place Bet` button

If the slot already has an active bet:

```text
Bet placed: 50 credits @ auto 2.00x
```

The button should be disabled.

## RUNNING

For each slot:

If active bet exists and is not cashed out:

- Show active bet amount
- Show possible payout
- Show `Cash Out X.XX credits` button

If active bet exists and is already cashed out:

```text
Cashed out at 2.25x — Won 112.50 credits
```

If no active bet exists:

```text
No active bet this round
```

Also show next-round queue controls:

- Amount input
- Auto-cashout input
- `Queue for Next Round` button

If queued bet exists:

```text
Queued: 100 credits @ 2.00x
Cancel
```

## CRASHED

Each slot should show:

- Win result if cashed out
- Loss result if active bet was not cashed out
- Queued next-round bet if one exists
- Inputs can be disabled until next `WAITING`

---

# PlayerStatus Update

Update `src/components/PlayerStatus.tsx`.

It should support two bet results.

Possible display:

```text
Bet 1: Cashed out at 2.20x — Won 110 credits
Bet 2: Lost 50 credits at crash
```

If neither slot has an active bet or result:

```text
No bets placed
```

Win/loss states must use both text/icon and color.

---

# GameCanvas Requirements

No major visual change is required.

However:

- The multiplier remains global.
- The crash state remains global.
- The plane animation remains global.
- It should not assume there is only one active bet.

Optional enhancement:

```text
Active bets: 2
```

---

# RoundHistory Requirements

No major change required.

Round history remains global because crash point is shared by both bets.

---

# localStorage Requirements

Persist:

- Balance
- Round history

Optional but recommended:

- Persist queued next-round bets

Do not persist active running bets unless the current app already handles round recovery.

If persisted queued bets are corrupted, ignore them safely.

---

# Service Layer Requirements

Keep the backend-ready architecture.

Do not introduce real HTTP calls.

Current service can remain:

```ts
submitCashOut(multiplier: number, amount: number): Promise<number>
```

The hook should call this separately per slot.

Keep comments:

```ts
// TODO: Replace with backend call
```

Future backend note:

```ts
// TODO: In backend mode, each bet slot should have a server-side betId.
```

---

# Unit Test Requirements

Update or add Vitest tests for pure utility logic.

Required tests:

## `validateBet`

- Rejects zero
- Rejects negative
- Rejects amount greater than balance
- Accepts valid amount

## `validateAutoCashOut`

- Accepts null
- Accepts values greater than 1
- Rejects 1
- Rejects values less than 1
- Rejects invalid numbers if applicable

## `calculatePayout`

- Calculates correctly per amount and multiplier
- Rounds consistently if the existing app rounds payouts

Optional hook tests are not required.

---

# File Structure Updates

Expected updated structure:

```text
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
    BetSlotPanel.tsx
    RoundHistory.tsx
    PlayerStatus.tsx
  styles/
    global.css
```

---

# Acceptance Criteria

## Core Logic

- [ ] The app supports exactly two independent bet slots.
- [ ] User can place Bet 1 and Bet 2 in the same `WAITING` phase.
- [ ] Both bets are active during the same round.
- [ ] Balance is deducted separately for each placed bet.
- [ ] User can cash out Bet 1 without cashing out Bet 2.
- [ ] User can cash out Bet 2 without cashing out Bet 1.
- [ ] If only one bet is cashed out before crash, only that bet wins.
- [ ] Any uncashed active bet loses at crash.
- [ ] Both bets can use different auto-cashout values.
- [ ] Auto-cashout works independently for each slot.
- [ ] Both bets can auto-cashout in the same round.
- [ ] Both slots can queue next-round bets during `RUNNING`.
- [ ] Cancel queued bet works per slot.
- [ ] Reset balance clears both slots.

## UI

- [ ] Betting panel shows two clearly separated bet sections.
- [ ] Each section is labeled `Bet 1` or `Bet 2`.
- [ ] Each section has its own amount input.
- [ ] Each section has its own auto-cashout input.
- [ ] Each section has its own quick amount buttons.
- [ ] Each section has its own Place Bet button.
- [ ] Each section has its own Cash Out button.
- [ ] Each section shows its own possible payout.
- [ ] Each section shows its own queued bet badge.
- [ ] Each section shows its own validation error.
- [ ] Player status shows results for both bets.
- [ ] Mobile layout remains usable with two bet panels.
- [ ] No content is hidden behind the fixed mobile betting panel.

## Technical

- [ ] `playerBet` is replaced with slot-based state.
- [ ] `nextRoundBet` is replaced with slot-based queued bets.
- [ ] `useCrashGame` remains the only place with complex game logic.
- [ ] Components remain presentational where possible.
- [ ] Service layer is preserved.
- [ ] No backend calls are introduced.
- [ ] TypeScript strict mode passes.
- [ ] No `any` types are added.
- [ ] No unused variables or imports.
- [ ] `npm run test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run dev` starts successfully.

---

# Implementation Instructions for Claude Code

Before coding:

1. Inspect the existing codebase.
2. Find all references to:
   - `playerBet`
   - `nextRoundBet`
   - `placeBet`
   - `queueNextRoundBet`
   - `cancelNextRoundBet`
   - `cashOut`
   - `PlayerStatus`
   - `BettingPanel`
3. Plan the refactor from one bet to two bet slots.
4. Keep the existing game loop behavior unchanged.
5. Preserve current features:
   - Auto-cashout
   - Next-round queueing
   - localStorage balance persistence
   - Round history
   - Mobile fixed-bottom panel
   - Service layer
   - Vitest tests

Then implement:

1. Update TypeScript types.
2. Refactor `useCrashGame` to use `betSlots`.
3. Update bet actions to accept `slotId`.
4. Add or refactor `BetSlotPanel`.
5. Update `BettingPanel`.
6. Update `PlayerStatus`.
7. Update any affected formatting/validation utilities.
8. Update tests.
9. Run:
   ```bash
   npm run typecheck
   npm run test
   npm run dev
   ```
10. Fix all errors.

---

# Important Constraints

Do not implement:

- Real money betting
- Payments
- Crypto
- Login/register
- Backend API calls
- Multiplayer
- Chat
- Leaderboard
- Provably fair crash generation
- Sound effects

Do not remove:

- Existing game loop
- Auto-cashout
- Next-round queueing
- localStorage balance persistence
- Round history
- Responsive mobile layout
- Service layer TODO comments

---

# Final Claude Code Prompt

```text
Based on the existing Crash Pilot PRD and codebase, implement a new feature: two independent bets in one round.

The app currently supports one active playerBet and one nextRoundBet. Refactor this into a slot-based betting system with exactly two bet slots: Bet 1 and Bet 2.

Each bet slot must support:
- independent bet amount
- independent auto-cashout value
- independent active bet state
- independent queued next-round bet state
- independent cashout action
- independent possible payout
- independent win/loss result
- independent validation errors

Update the types:
- Add BetSlotId = 1 | 2
- Add BetResult
- Add BetSlot
- Replace GameState.playerBet and GameState.nextRoundBet with betSlots: BetSlot[]

Update useCrashGame:
- Maintain exactly two bet slots
- Expose betSlots instead of playerBet and nextRoundBet
- Update placeBet(slotId, amount, autoCashOut?)
- Update queueNextRoundBet(slotId, amount, autoCashOut?)
- Update cancelNextRoundBet(slotId)
- Update cashOut(slotId)
- resetBalance() should clear both slots
- Auto-cashout should check both slots independently on every animation frame
- At crash, each uncashed active bet loses independently
- At next WAITING phase, queued bets should activate per slot and deduct balance
- If both queued bets exist but balance is insufficient, activate slot 1 first, then slot 2 if balance remains sufficient

Update UI:
- BettingPanel should render two independent bet panels
- Create BetSlotPanel.tsx if useful
- Each slot should have its own amount input, auto-cashout input, quick amount buttons, Place Bet button, Cash Out button, Queue Next Round button, queued badge, cancel button, possible payout, result, and validation error
- PlayerStatus should display results for both bets
- GameCanvas and RoundHistory remain global

Preserve:
- WAITING → RUNNING → CRASHED loop
- multiplier formula
- crash generation
- auto-cashout
- next-round queueing
- localStorage balance and history persistence
- service layer with backend TODO comments
- responsive mobile fixed-bottom betting panel
- strict TypeScript
- Vitest utility tests

Do not add:
- backend calls
- real money
- auth
- payments
- crypto
- multiplayer
- chat
- leaderboard

After implementation:
- Run npm run typecheck
- Run npm run test
- Fix all errors
- Ensure npm run dev starts successfully
```
