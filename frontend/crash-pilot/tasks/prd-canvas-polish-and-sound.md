# PRD: Canvas Polish & Game Sound

## 1. Introduction

The crash-pilot game canvas currently shows a small inline-SVG plane on a flat gray background, a thin yellow trail curve, and a 💥 emoji on crash. There is no audio. Compared with reference crash-style games (Aviator, JetX, etc.), the experience reads as a prototype.

This PRD describes a polish pass that overhauls `GameCanvas` visually (richer plane art, scrolling grid backdrop, glowing trail, particle debris burst, fireball-style crash) and adds a Web-Audio-synthesized soundtrack (climbing engine loop + crash boom) with a Header mute toggle.

Scope is deliberately bounded — the underlying state machine (`useCrashGame.ts`) and the backend contract are **not** changed. This is a presentation-layer polish pass plus a new self-contained `src/audio/` module.

## 2. Goals

- Make the game canvas feel like a finished product, not a prototype, while staying within the codebase's existing SVG/DOM rendering pattern.
- Add tactile feedback for the two moments that matter most: the plane climbing (engine loop) and the crash (boom).
- Tie audio dynamically to the live multiplier (engine pitch climbs with risk).
- Default-muted with a persistent user-controlled toggle — never surprise users with sound.
- Zero new external dependencies. No new asset files. No backend changes.

## 3. User Stories

### US-001: Scrolling grid backdrop
**Description:** As a player, I want the background to convey motion when the plane is flying so the game feels alive.

**Acceptance Criteria:**
- [ ] During `RUNNING` phase, faint grid lines scroll right→left at a constant speed
- [ ] Grid is implemented as a tiled SVG pattern with a CSS keyframe animation (no JS per-frame work)
- [ ] Grid animation pauses on `CRASHED` (last position frozen) and is hidden/reset on `WAITING`
- [ ] Grid contrast is readable against the existing `bg-gray-800` base
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-002: Richer plane SVG
**Description:** As a player, I want the plane to look like an actual aircraft so the game has visual identity.

**Acceptance Criteria:**
- [ ] Replace the existing 4-path inline SVG in `GameCanvas.tsx` with an Aviator-style biplane: shaded fuselage (gradients via `<linearGradient>` defs), wing struts, cockpit window, exhaust nozzle
- [ ] Propeller animates with a CSS `rotate` infinite spin while `phase === 'RUNNING'`; static otherwise
- [ ] Plane retains current positioning (`xPct`/`yPct` from log-scaled progress) and rotation
- [ ] Plane reads clearly at the rendered size (~48px) — no muddy details
- [ ] Plane is hidden on `CRASHED` (replaced by fireball + debris)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-003: Gradient + glowing trail
**Description:** As a player, I want the flight trail to feel "hot" and lit up so the climb has visible energy.

**Acceptance Criteria:**
- [ ] Trail curve uses a `<linearGradient>` stroke: yellow at the origin → hot orange at the plane tip
- [ ] Trail stroke is thicker than current (~1.5x) and uses an SVG `<filter>` drop-shadow for a soft glow
- [ ] On `CRASHED`, the gradient shifts to red→dark-red
- [ ] No regression in trail geometry (still anchored at bottom-left, curves to plane position)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-004: Radial multiplier glow
**Description:** As a player, I want the central multiplier to glow brighter as the bet grows so the stakes feel visceral.

**Acceptance Criteria:**
- [ ] A radial-gradient glow sits behind the centerpiece multiplier text
- [ ] Glow intensity (size + opacity) increases with the multiplier
- [ ] Intensity is driven by a CSS custom property updated at **10Hz** (from a throttled multiplier — same cadence as the existing `panelMultiplier` from `useThrottledValue`), not the 60Hz raw value
- [ ] Glow color is yellow during `RUNNING`, dimmed gray during `WAITING`, red during `CRASHED`
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-005: Crash debris burst
**Description:** As a player, I want the crash to feel like an actual explosion so the moment lands emotionally.

**Acceptance Criteria:**
- [ ] On phase transition into `CRASHED`, generate a fixed array of ~16 randomized debris particles (initial velocity vectors, color from a small yellow/orange/red palette, sizes between 3px and 8px) **once**
- [ ] Each particle animates outward with gravity-like falloff over ~800ms via `performance.now() - crashTime`, computed during the parent's existing RAF re-renders (no separate animation loop)
- [ ] Particles fade to opacity 0 by their lifetime end
- [ ] Particles are removed/inert once expired (no lingering DOM/SVG cost)
- [ ] Debris is replayed when a new crash occurs (debris array is keyed on `currentRoundId` or crash timestamp)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-006: Fireball replaces 💥 emoji
**Description:** As a player, I want a proper explosion at the crash point — not an emoji.

**Acceptance Criteria:**
- [ ] On phase → `CRASHED`, a white radial flash expands and fades over ~150ms at the crash position
- [ ] A yellow→orange→red translucent fireball grows to ~80px diameter and fades over ~500ms, layered behind the debris
- [ ] The 💥 emoji is removed from `GameCanvas.tsx`
- [ ] Existing screen shake (`animate-crash-shake`) and red bg flash (`animate-crash-flash`) are preserved
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-007: Audio engine module
**Description:** As a developer, I need a single audio singleton so phase-triggered sounds are isolated, testable, and decoupled from React state.

**Acceptance Criteria:**
- [ ] New file `src/audio/audioEngine.ts` exports:
  - `getMuted(): boolean`
  - `setMuted(muted: boolean): void`
  - `subscribeMuted(listener: (muted: boolean) => void): () => void`
  - `startEngine(getMultiplier: () => number): void`
  - `stopEngine(): void` — fades out over ~100ms
  - `playCrash(): void`
- [ ] `AudioContext` is created lazily on the first `setMuted(false)` call (satisfies the browser autoplay policy via user gesture)
- [ ] Mute state is read from `localStorage` key `crashpilot.muted` on module init; defaults to **muted** if absent
- [ ] `setMuted` persists to `localStorage` and notifies subscribers
- [ ] When muted, `startEngine` / `playCrash` are no-ops (no AudioContext work happens)
- [ ] No imports from React, `src/services/`, or `src/hooks/` — module is framework-agnostic
- [ ] Typecheck passes

### US-008: Engine loop synth
**Description:** As a player, I want a climbing engine sound while the plane flies so the rising multiplier feels physical.

**Acceptance Criteria:**
- [ ] Engine is built from two slightly detuned sawtooth oscillators → low-pass filter → gain → master bus
- [ ] Engine fades in over ~50ms when `startEngine` is called
- [ ] Engine fades out over ~100ms when `stopEngine` is called
- [ ] Oscillator frequency is computed from the multiplier passed via the `getMultiplier` getter: base 80–120 Hz, log-scaled, soft-capped at ~2.5× base
- [ ] Frequency is updated via `AudioParam.setTargetAtTime` (smoothing time constant ~50ms) — no zipper noise
- [ ] Master gain respects mute state
- [ ] Typecheck passes

### US-009: Crash boom synth
**Description:** As a player, I want the crash to have low-end punch and a sharp transient so it sounds like an explosion.

**Acceptance Criteria:**
- [ ] `playCrash()` plays a white-noise buffer through a band-pass filter that sweeps downward in frequency, with an exponential gain envelope (sharp attack, ~600ms decay)
- [ ] A short sine "thump" at ~60Hz layers underneath for low-end body
- [ ] One-shot — no looping, no overlap if called twice in rapid succession (second call cancels/restarts is acceptable)
- [ ] No-op when muted
- [ ] Typecheck passes

### US-010: Phase-driven sound triggers
**Description:** As a player, I want sound timing to track the game lifecycle automatically.

**Acceptance Criteria:**
- [ ] New file `src/audio/useGameSounds.ts` exports `useGameSounds(phase, getMultiplier)` hook
- [ ] Mounted once in `App.tsx`, given the live `phase` and a stable getter that returns the latest `currentMultiplier`
- [ ] On phase transition `WAITING|CRASHED → RUNNING`: calls `audioEngine.startEngine(getMultiplier)`
- [ ] On phase transition `RUNNING → CRASHED`: calls `audioEngine.stopEngine()`, then `audioEngine.playCrash()` **after a ~100ms delay** (so the engine fade-out completes first — sequential, not overlapping)
- [ ] No-op on `RUNNING → WAITING` or any other transition
- [ ] On unmount, cancels any pending crash-boom timer and calls `stopEngine`
- [ ] Typecheck passes

### US-011: Header mute toggle
**Description:** As a player, I want a single obvious place to turn sound on and off.

**Acceptance Criteria:**
- [ ] Add a 🔇/🔊 icon button to `Header.tsx`, placed alongside existing controls
- [ ] Button displays muted icon (🔇) when muted, unmuted icon (🔊) otherwise
- [ ] Clicking toggles via `audioEngine.setMuted`
- [ ] Button has an accessible `aria-label` reflecting current state ("Unmute" / "Mute")
- [ ] Button state is sourced from a tiny hook `src/audio/useMuteToggle.ts` that subscribes to `audioEngine.subscribeMuted`
- [ ] State persists across page reloads (via `localStorage` in `audioEngine`)
- [ ] First click that unmutes also resumes the `AudioContext` (handled inside `setMuted`/lazy init)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-012: Audio logic tests
**Description:** As a developer, I need confidence that mute persistence and phase-driven triggers are correct.

**Acceptance Criteria:**
- [ ] `src/audio/__tests__/audioEngine.test.ts` covers:
  - default state is muted when `localStorage` is empty
  - `setMuted(true|false)` persists to `localStorage`
  - subscribers are notified on change
  - reload-equivalent: a fresh import sees the persisted value
- [ ] `src/audio/__tests__/useGameSounds.test.ts` covers (with `audioEngine` mocked via `vi.mock`):
  - mounting with phase=`WAITING` triggers nothing
  - transition `WAITING → RUNNING` calls `startEngine` exactly once
  - transition `RUNNING → CRASHED` calls `stopEngine` immediately and schedules `playCrash` after ~100ms (use `vi.useFakeTimers` + `vi.advanceTimersByTime`)
  - transition `CRASHED → WAITING` calls nothing
  - unmount cancels any pending `playCrash` timer
- [ ] `npm test` passes (existing 20 tests + new tests)
- [ ] Typecheck passes

## 4. Functional Requirements

- **FR-1** `GameCanvas.tsx` must render a scrolling grid backdrop during `RUNNING`, frozen during `CRASHED`, hidden during `WAITING`.
- **FR-2** The plane SVG must be redrawn as a richer Aviator-style biplane with shading, struts, cockpit, and an animated propeller (CSS keyframe `rotate`, infinite while `RUNNING`).
- **FR-3** The flight trail must use a gradient stroke (yellow→orange, → red on crash) with an SVG drop-shadow filter for glow.
- **FR-4** A radial glow behind the centerpiece multiplier must scale with the multiplier, driven by a CSS custom property updated at 10Hz from a throttled value.
- **FR-5** On phase → `CRASHED`, the system must spawn exactly one debris burst of ~16 randomized particles, animate them with gravity-like falloff over ~800ms, then remove them. The 💥 emoji must be removed.
- **FR-6** On phase → `CRASHED`, the system must also render a white radial flash (~150ms) and a yellow→orange→red fireball (~500ms) at the crash position, behind the debris.
- **FR-7** Existing `animate-crash-shake` and `animate-crash-flash` effects must be preserved.
- **FR-8** A new `src/audio/audioEngine.ts` singleton must own: lazy `AudioContext`, master gain, mute state with `localStorage` persistence under key `crashpilot.muted`, and a subscription API.
- **FR-9** Mute state must default to **muted** when no persisted value exists. The audio context must only be created/resumed inside a user gesture (the unmute click).
- **FR-10** When muted, all audio APIs (`startEngine`, `stopEngine`, `playCrash`) must be no-ops.
- **FR-11** The engine sound must be synthesized from two slightly detuned sawtooth oscillators through a low-pass filter, with frequency soft-capped at ~2.5× base (80–120Hz), driven by a multiplier getter and smoothed via `setTargetAtTime`.
- **FR-12** The crash boom must be synthesized from a white-noise band-pass-swept buffer plus a ~60Hz sine thump, with exponential envelopes.
- **FR-13** `useGameSounds(phase, getMultiplier)` mounted once in `App.tsx` must drive `startEngine` / `stopEngine` / `playCrash` from phase transitions. The crash boom must fire after a ~100ms delay so the engine fade-out completes first.
- **FR-14** A 🔇/🔊 mute toggle button must be added to `Header.tsx`, sourcing state from `audioEngine.subscribeMuted` via a `useMuteToggle` hook.
- **FR-15** Vitest tests must cover (a) `audioEngine` mute persistence + subscription and (b) `useGameSounds` phase-driven triggers with `audioEngine` mocked. The existing test suite must continue to pass.

## 5. Non-Goals (Out of Scope)

- **No** gradient sky backdrop, no star/dust parallax field (explicitly rejected during grilling).
- **No** flight-time exhaust particles (only crash debris).
- **No** lingering smoke after the explosion.
- **No** countdown ticks, round-start whoosh, cashout ding, bet-placed click. Only engine + crash.
- **No** volume slider. Mute toggle is the sole audio control.
- **No** real audio asset files (MP3/OGG). All sound is synthesized at runtime via Web Audio.
- **No** changes to `useCrashGame.ts` socket handling, state shape, or RAF loop.
- **No** changes to the backend, the socket contract, or the `services/` layer.
- **No** switch to `<canvas>` rendering — the implementation stays in SVG/DOM.
- **No** new external dependencies.
- **No** visual snapshot tests or e2e tests. Visual work is verified manually via the dev-browser skill.

## 6. Design Considerations

- **Plane**: Aviator-style red biplane is the genre cliché and reads instantly at small sizes. Color via `currentColor` so the existing `text-yellow-400` / `text-gray-500` switching for `isRunning` continues to work, with internal `<linearGradient>` defs handling shading.
- **Color palette**: stick to existing Tailwind palette (`yellow-400`, `orange-500`, `red-500`, `red-950`, `gray-800`). The radial glow uses `from-yellow-400/20` to `transparent`.
- **Animations**: new CSS keyframes (grid scroll, propeller spin, fireball expand, flash expand) live in `src/styles/global.css` under `@keyframes` with matching `--animate-*` entries in `@theme`, following the existing pattern (`animate-crash-shake`, `animate-crash-flash`, `animate-ping-once`).
- **Particle system**: kept in a `useRef<Particle[]>` inside `GameCanvas`, generated once on phase entry into `CRASHED` via `useEffect`, and rendered each parent re-render by computing each particle's `(x, y, opacity)` from `performance.now() - crashTime`. No separate RAF loop — piggybacks on the existing RAF-triggered re-renders from `currentMultiplier`.
- **Audio module shape**: mirrors the existing `src/services/socket.ts` / `src/services/token.ts` singleton + subscription pattern. The audio module has no React imports.
- **Mute toggle placement**: alongside the existing Header controls; exact slot determined during US-011, but the visual weight should match the existing icon buttons.

## 7. Technical Considerations

- **Browser autoplay policy**: `AudioContext` creation/resume is gated behind the unmute click. Until first unmute, no audio nodes exist.
- **Performance**:
  - Grid scroll, propeller spin, and fireball expansion use CSS keyframes — zero JS per frame.
  - Radial glow updates a CSS custom property at 10Hz (via the existing `useThrottledValue` hook pattern from `src/hooks/useThrottledValue.ts`), avoiding 60Hz filter re-renders.
  - Debris particles re-render with the existing RAF-driven `GameCanvas` re-renders; ~16 SVG elements for ~800ms is negligible.
  - Engine `frequency` is updated at 10Hz from the throttled multiplier; Web Audio's own `setTargetAtTime` smooths the ramp.
- **Test infrastructure**: vitest + `@testing-library/react` are already in use (`useThrottledValue.test.ts` is the template). `vi.useFakeTimers()` is already proven for time-based assertions.
- **Web Audio in JSDOM**: `AudioContext` is not available in JSDOM. Tests must mock `audioEngine` rather than exercise real Web Audio. The `audioEngine.test.ts` tests cover only mute/persistence/subscription paths — not actual oscillator behavior — to stay JSDOM-safe.
- **localStorage key**: `crashpilot.muted` (stringified boolean). Namespaced to avoid colliding with the JWT token key under the same origin.
- **Strict-mode safety**: `useGameSounds` must be StrictMode-correct — phase transition detection should use a ref-based previous-phase comparison so the double-invoked effect in dev doesn't double-trigger `startEngine` or `playCrash`.

## 8. Success Metrics

- Side-by-side, the canvas reads as a finished crash game rather than a prototype (subjective, verified via dev-browser).
- Engine pitch audibly climbs from a base hum into a tense whine as the multiplier grows from 1.0x to ~10x.
- Mute toggle persists across reloads and silences all audio immediately.
- No frame-rate regression on the canvas during `RUNNING` (subjective; the centerpiece still feels smooth).
- `npm run typecheck` and `npm test` both pass with the new tests included.

## 9. Open Questions

- Exact propeller rotation speed — single fixed RPM, or does it also scale with the multiplier? Default: single fixed fast spin (e.g., 0.15s per rotation) for simplicity; revisit only if it looks off.
- Whether the Header mute button should also flash/animate on first page load to advertise its existence. Default: no — keep it static.
- Whether the engine sound should resume mid-round if the user unmutes during `RUNNING`. Default: yes — `useGameSounds` should call `startEngine` on unmute if `phase === 'RUNNING'`. To be confirmed during implementation.
