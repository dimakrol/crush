# Technical Requirements: Frontend-Only Crash Game

## Project Goal

Create a **frontend-only crash game inspired by Aviator** using **React.js** and **TypeScript**.

The app should be a local playable prototype where the user can place a fake bet, watch a multiplier increase, and cash out before the round crashes.

## Important Notes

- This is only a local playable frontend prototype.
- No backend.
- No real money.
- No authentication.
- No payments.
- No external gambling APIs.
- Game logic should run fully in the browser.
- The app should be structured so a backend can be added later.
- Use clean, maintain, production-style React + TypeScript code.

## Tech Stack

- React
- TypeScript
- Vite
- CSS Modules, SCSS, Tailwind, or plain CSS — choose one and keep it consistent
- No backend
- No external gambling APIs
- Local in-memory state only
- Optional: `localStorage` for saving fake balance and settings

## Main Gameplay

The user starts with a fake balance, for example:

```ts
1000 credits
```

The user can:

1. Enter a bet amount.
2. Place a bet during the waiting phase.
3. Watch the multiplier increase after the round starts.
4. Cash out before the game crashes.
5. Win fake credits if they cash out in time.
6. Lose the bet if the game crashes before they cash out.

### Payout Formula

```ts
payout = betAmount * currentMultiplier
```

After the crash, a new round should start automatically after a short delay.

## Game Phases

Use a clear finite state model.

```ts
type GamePhase = "WAITING" | "RUNNING" | "CRASHED";
```

### WAITING

- Player can place a bet.
- Countdown is shown before the next round starts.
- Example text: `Next round in 5s`

### RUNNING

- Multiplier is increasing.
- Player can cash out if they placed a bet.
- The plane or rocket animation should be active.

### CRASHED

- Show crash multiplier.
- Resolve win/loss.
- Short delay before returning to `WAITING`.
- Example text: `CRASHED @ 2.35x`

## Suggested Timing

- Waiting phase: 5 seconds countdown
- Running phase: until crash
- Crashed phase: 3 seconds

## Multiplier Behavior

The multiplier should:

- Start at `1.00x`
- Increase smoothly over time
- Be displayed with 2 decimals, for example `2.43x`
- Update smoothly using `requestAnimationFrame` or a performant interval

Example formula:

```ts
multiplier = 1 + elapsedSeconds * growthRate + smallExponentialGrowth;
```

The exact formula can be adjusted, but the result should feel smooth and playable.

## Crash Generation

Since there is no backend, generate the crash point in the frontend.

Create a helper function:

```ts
generateCrashPoint(): number
```

Expected behavior:

- Most crashes should happen below `2x`
- Some crashes should happen between `2x` and `5x`
- Rare crashes should happen above `10x`
- Usually crash values should be between `1.01x` and `10.00x`
- Occasional higher values are allowed

Important:

```ts
// This is demo-only frontend logic.
// In production, crash results must come from the backend.
```

Keep this logic isolated so it can later be replaced by backend-provided round data.

## UI Requirements

Create a modern responsive interface similar in spirit to Aviator-style crash games, but do not copy branding or assets.

## Main Screen Sections

### 1. Header

The header should show:

- Game name, for example `Crash Pilot`
- Fake balance display

### 2. Game Area

The game area should include:

- Large animated multiplier display
- Plane or rocket visual moving upward/forward while multiplier grows
- Clear crash state message
- Waiting countdown

Examples:

```text
1.45x
Next round in 5s
CRASHED @ 2.35x
```

### 3. Betting Panel

The betting panel should include:

- Bet amount input
- Quick amount buttons:
  - `10`
  - `25`
  - `50`
  - `100`
- `Place Bet` button
- `Cash Out` button
- Possible payout display during running phase
- Disabled button states depending on game phase and bet state

### 4. Round History

Show recent crash multipliers.

Use different visual styles for:

- Low crash: `< 2x`
- Medium crash: `2x–5x`
- High crash: `> 5x`

### 5. Current Player Round Status

Show one of the following statuses:

```text
No bet placed
Bet placed: 50 credits
Cashed out at 2.20x
Lost at crash
```

## TypeScript Types

Create strong TypeScript types.

Suggested types:

```ts
export type GamePhase = "WAITING" | "RUNNING" | "CRASHED";

export interface Round {
  id: string;
  crashPoint: number;
  startedAt: number | null;
  crashedAt: number | null;
}

export interface PlayerBet {
  amount: number;
  placed: boolean;
  cashedOut: boolean;
  cashOutMultiplier: number | null;
  payout: number;
}
```

## Main State

The game should track:

- `balance`
- `phase`
- `countdown`
- `currentMultiplier`
- `currentRound`
- `playerBet`
- `roundHistory`

## Architecture Requirements

Organize files cleanly.

Suggested structure:

```text
src/
  main.tsx
  App.tsx
  types/
    game.ts
  utils/
    crash.ts
    format.ts
  hooks/
    useCrashGame.ts
  components/
    Header.tsx
    GameCanvas.tsx
    BettingPanel.tsx
    RoundHistory.tsx
    PlayerStatus.tsx
  styles/
    global.css
```

## Main Game Hook

Put the main game logic in a reusable hook:

```ts
useCrashGame()
```

The hook should expose:

```ts
{
  balance,
  phase,
  countdown,
  currentMultiplier,
  currentRound,
  playerBet,
  roundHistory,
  placeBet,
  cashOut,
  resetBalance
}
```

Function signatures:

```ts
placeBet(amount: number): void;
cashOut(): void;
resetBalance(): void;
```

Important:

- UI components should not contain complex game logic.
- Game logic should live mainly inside `useCrashGame`.
- Pure helpers should live inside `utils`.

## Frontend-Only but Backend-Ready Design

Prepare the code so backend integration can be added later.

Add comments or TODOs for future backend work:

```ts
// TODO: Replace generateCrashPoint() with backend round result.
// TODO: Replace local balance with server-side wallet.
// TODO: Replace local cashOut() validation with backend transaction.
// TODO: Add WebSocket connection for real-time round updates.
// TODO: Add server-provided round history.
```

## Animation Requirements

- Multiplier should animate smoothly.
- Plane or rocket should move while the round is running.
- When the game crashes, stop the animation.
- Show an explosion or crash effect.
- Use CSS animations or React state-driven styles.
- Keep animations performant.

## Validation Rules

The app must enforce:

- Bet amount must be positive.
- Bet amount cannot exceed current balance.
- User cannot place multiple bets in the same round.
- User cannot place a bet after the round has started.
- User cannot cash out without an active bet.
- User cannot cash out after crash.
- User cannot cash out twice.

## Balance Behavior

- When the user places a bet, subtract the bet amount immediately.
- If the user cashes out, add payout to balance.
- If the user loses, no payout is added.
- Add a `Reset Demo Balance` button.

## LocalStorage

Use `localStorage` to persist:

- Fake balance
- Recent round history

The app should still work even if `localStorage` is unavailable.

## Design Style

Use a modern dark theme.

The UI should have:

- Large central multiplier
- Smooth rounded cards
- Clear green win state
- Clear red crash/loss state
- Responsive desktop and mobile layout
- Mobile-friendly betting panel

## Accessibility Requirements

- Buttons must have readable labels.
- Inputs must have labels.
- Do not rely only on color to show win/loss.
- Keyboard users should be able to place bets and cash out.

## Testing-Friendly Code

Keep pure functions separate and easy to test later.

Create helpers for:

```ts
generateCrashPoint()
calculatePayout()
formatMultiplier()
validateBet()
```

## Do Not Implement

Do not implement:

- Real money betting
- Login/register
- Payments
- Crypto
- Backend API calls
- Multiplayer
- Chat
- Real gambling mechanics
- Provably fair cryptographic system

## Deliverables

The final project should include:

- Complete React + TypeScript app
- Clean component structure
- Working local gameplay loop
- Responsive UI
- Comments explaining where backend integration would be added later
- No broken TypeScript errors
- No unused variables

The app should run with:

```bash
npm install
npm run dev
```

## Acceptance Criteria

- [ ] User can start the app and see fake balance.
- [ ] User can place a fake bet during waiting phase.
- [ ] Multiplier increases after round starts.
- [ ] User can cash out before crash and receive fake payout.
- [ ] If user does not cash out, they lose the bet.
- [ ] Round crashes at random multiplier.
- [ ] Round history updates after every crash.
- [ ] New rounds start automatically.
- [ ] UI clearly shows current game phase.
- [ ] Code is modular and ready for future backend integration.

---

# Ready-to-Paste Claude Code Prompt

```text
Create a frontend-only crash game inspired by Aviator using React.js and TypeScript.

Important:
- This is only a local playable frontend prototype.
- No backend, no real money, no authentication, no payments.
- Game logic should run fully in the browser.
- The app should be structured so a backend can be added later.
- Use clean, maintainable, production-style React + TypeScript code.

Tech stack:
- React
- TypeScript
- Vite
- CSS Modules, SCSS, Tailwind, or plain CSS — choose one and keep it consistent
- No backend
- No external gambling APIs
- Local in-memory state only
- Optional: localStorage for saving fake balance and settings

Main goal:
Build a playable crash game where the user can place a fake bet, watch the multiplier increase, and cash out before the game crashes.

Core gameplay:
1. The user starts with a fake balance, for example 1000 credits.
2. The user can enter a bet amount.
3. The user clicks “Place Bet” before or during the betting phase.
4. After the betting phase, the round starts.
5. A multiplier starts at 1.00x and increases over time.
6. At a random crash multiplier, the round crashes.
7. If the player cashes out before the crash, they win:
   payout = betAmount * currentMultiplier
8. If the player does not cash out before the crash, they lose the bet.
9. After the crash, a new round starts automatically after a short delay.

Game phases:
Use a clear finite state model:

- WAITING
  - Player can place a bet.
  - Countdown before the next round starts.

- RUNNING
  - Multiplier is increasing.
  - Player can cash out if they placed a bet.

- CRASHED
  - Show crash multiplier.
  - Resolve win/loss.
  - Short delay before returning to WAITING.

Suggested timing:
- Waiting phase: 5 seconds countdown
- Running phase: until crash
- Crashed phase: 3 seconds

Multiplier behavior:
- Start at 1.00
- Increase smoothly over time
- Example formula:
  multiplier = 1 + elapsedSeconds * growthRate + small exponential growth
- Display multiplier with 2 decimals, for example 2.43x
- The UI should update smoothly using requestAnimationFrame or setInterval.

Crash generation:
- Since there is no backend, generate the crash point in the frontend.
- Use a helper function like generateCrashPoint().
- The result should usually be between 1.01x and 10.00x, with occasional higher values.
- Example behavior:
  - Many crashes below 2x
  - Some crashes between 2x and 5x
  - Rare crashes above 10x
- Keep this logic isolated so it can later be replaced by backend-provided round data.
- It does not need to be cryptographically fair.
- Add a comment explaining that this is only for local demo mode and must be replaced by backend logic later.

UI requirements:
Create a modern responsive interface similar in spirit to Aviator-style crash games, but do not copy branding or assets.

Main screen should include:
1. Header
   - Game name, for example “Crash Pilot”
   - Fake balance display

2. Game area
   - Large animated multiplier display
   - Plane or rocket visual moving upward/forward while multiplier grows
   - Crash state should show a clear “CRASHED @ 2.35x” message
   - Waiting state should show countdown: “Next round in 5s”

3. Betting panel
   - Bet amount input
   - Quick amount buttons: 10, 25, 50, 100
   - Place Bet button
   - Cash Out button
   - Disable buttons depending on game phase and bet state
   - Show possible payout during running phase

4. Round history
   - Show recent crash multipliers
   - Use different visual styles:
     - low crash < 2x
     - medium crash 2x–5x
     - high crash > 5x

5. Current player round status
   - No bet placed
   - Bet placed: 50 credits
   - Cashed out at 2.20x
   - Lost at crash

State requirements:
Create strong TypeScript types.

Suggested types:

type GamePhase = "WAITING" | "RUNNING" | "CRASHED";

interface Round {
  id: string;
  crashPoint: number;
  startedAt: number | null;
  crashedAt: number | null;
}

interface PlayerBet {
  amount: number;
  placed: boolean;
  cashedOut: boolean;
  cashOutMultiplier: number | null;
  payout: number;
}

Main state:
- balance
- phase
- countdown
- currentMultiplier
- currentRound
- playerBet
- roundHistory

Architecture:
Organize files cleanly.

Suggested structure:

src/
  main.tsx
  App.tsx
  types/
    game.ts
  utils/
    crash.ts
    format.ts
  hooks/
    useCrashGame.ts
  components/
    Header.tsx
    GameCanvas.tsx
    BettingPanel.tsx
    RoundHistory.tsx
    PlayerStatus.tsx
  styles/
    global.css

Important architecture rule:
Put the main game logic in a reusable hook:

useCrashGame()

The hook should expose:
- balance
- phase
- countdown
- currentMultiplier
- currentRound
- playerBet
- roundHistory
- placeBet(amount: number)
- cashOut()
- resetBalance()

The UI components should not contain complex game logic.

Frontend-only backend-ready design:
Prepare the code so backend integration can be added later.

Add comments or TODOs for future backend:
- Replace generateCrashPoint() with backend round result
- Replace local balance with server-side wallet
- Replace local cashOut() validation with backend transaction
- Add WebSocket connection for real-time round updates
- Add server-provided round history

Animations:
- The multiplier should animate smoothly.
- The plane/rocket should move while the round is running.
- When the game crashes, stop animation and show explosion/crash effect.
- Use CSS animations or React state-driven styles.
- Keep animation performant.

Validation:
- Bet amount must be positive.
- Bet amount cannot exceed current balance.
- User cannot place multiple bets in the same round.
- User cannot place a bet after the round has started unless you intentionally support next-round betting.
- User cannot cash out without an active bet.
- User cannot cash out after crash.
- User cannot cash out twice.

Balance behavior:
- When the user places a bet, subtract bet amount immediately.
- If the user cashes out, add payout to balance.
- If the user loses, no payout is added.
- Add a “Reset Demo Balance” button.

LocalStorage:
Use localStorage to persist:
- fake balance
- recent round history

But keep the app working even if localStorage is unavailable.

Design style:
- Dark theme
- Large central multiplier
- Smooth rounded cards
- Clear green win state
- Clear red crash/loss state
- Responsive for desktop and mobile
- Betting panel should be easy to use on mobile

Accessibility:
- Buttons must have readable labels
- Inputs must have labels
- Do not rely only on color to show win/loss
- Keyboard users should be able to place bets and cash out

Testing expectation:
Code should be easy to test later.
Keep pure functions separate:
- generateCrashPoint()
- calculatePayout()
- formatMultiplier()
- validateBet()

Do not implement:
- Real money betting
- Login/register
- Payments
- Crypto
- Backend API calls
- Multiplayer
- Chat
- Real gambling mechanics
- Provably fair cryptographic system

Deliverables:
- Complete React + TypeScript app
- Clean component structure
- Working local gameplay loop
- Responsive UI
- Comments explaining where backend integration would be added later
- No broken TypeScript errors
- No unused variables
- App should run with:

npm install
npm run dev

Acceptance criteria:
1. User can start the app and see fake balance.
2. User can place a fake bet during waiting phase.
3. Multiplier increases after round starts.
4. User can cash out before crash and receive fake payout.
5. If user does not cash out, they lose the bet.
6. Round crashes at random multiplier.
7. Round history updates after every crash.
8. New rounds start automatically.
9. UI clearly shows current game phase.
10. Code is modular and ready for future backend integration.

Before coding, briefly plan the component architecture. Then implement the full app. After implementation, run TypeScript checks and fix any errors. Keep the code simple but scalable.
```
