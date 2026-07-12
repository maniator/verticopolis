# Investigation: Mobile pinch-zoom sticks and taps stop placing (gold ghost, no build)

## Hand-off Brief

1. **What happened.** Excalibur 0.32 renumbers its public `pointerId`s whenever the set of active touches changes, so when the first-placed finger of a pinch lifts first, the second finger's `up` arrives under a different id than its `down`; `TowerEngine.pointers` keeps a phantom entry forever (Confirmed, `node_modules` source + `TowerEngine.ts` map keying).
2. **Where the case stands.** Root cause Confirmed by direct source reading of both sides of the contract; the phantom entry makes every later one-finger press classify as a two-finger pinch, which explains both reported symptoms (erratic/stuck zoom on drags, taps silently never reaching the placement path while a leftover gold ghost sits on screen).
3. **What's needed next.** Fix in the game: key the gesture map by the stable native `pointerId` (`ev.nativeEvent`), hand the surviving finger of an ended pinch a pan continuation instead of the hover path, and extract the touch state machine into a pure, unit-tested module.

## Case Info

| Field            | Value                                                                       |
| ---------------- | --------------------------------------------------------------------------- |
| Ticket           | N/A (owner report, chat)                                                     |
| Date opened      | 2026-07-12                                                                   |
| Status           | Concluded                                                                    |
| System           | Mobile browsers (Android TWA / iOS Capacitor / mobile web), Excalibur 0.32.0 |
| Evidence sources | Source code (`src/render/excalibur/TowerEngine.ts`, `src/main.ts`, `src/game/gesture.ts`), vendored Excalibur 0.32.0 source |

## Problem Statement

Owner report, verbatim intent: (1) "zoom in and out gets stuck" on mobile; (2) "there are times where I can't place something even if I have money and it just shows a yellow outline and doesn't place."

Both treated as hypotheses; both re-derived from code below.

## Evidence Inventory

| Source                                   | Status    | Notes                                                                    |
| ---------------------------------------- | --------- | ------------------------------------------------------------------------ |
| Game gesture/camera code                 | Available | `src/render/excalibur/TowerEngine.ts:555-673` (pointer state machine)    |
| Controller wiring                        | Available | `src/main.ts:538-694` (`onTap`/`onActionDown`/`onHover`/preview)         |
| Excalibur pointer internals              | Available | `node_modules/excalibur/build/esm/excalibur.development.js` (v0.32.0)    |
| Ghost color semantics                    | Available | `src/render/excalibur/TowerEngine.ts:1221-1233` (gold=valid, red=invalid) |
| Device logs / repro video                | Missing   | Not needed; root cause reproduces deterministically from the code contract |

## Investigation Backlog

| # | Path to Explore                                             | Priority | Status | Notes                                             |
| - | ----------------------------------------------------------- | -------- | ------ | -------------------------------------------------- |
| 1 | Pinch state machine in TowerEngine                           | High     | Done   | Finding 1, 2                                        |
| 2 | Excalibur pointerId contract                                 | High     | Done   | Finding 3, 4 (the root cause)                       |
| 3 | Ghost preview validity + who clears it on touch              | High     | Done   | Finding 5, Deduction 2                              |
| 4 | Native browser pinch stealing the gesture (touch-action)     | Medium   | Done   | Refuted as cause: Hypothesis 2                      |
| 5 | Zoom clamp math wedging at bounds (`clampZoom`/`clampCameraY`) | Medium | Done   | Refuted: Hypothesis 3                               |

## Confirmed Findings

### Finding 1: The gesture tracker keys live touches by Excalibur's public `pointerId`

**Evidence:** `src/render/excalibur/TowerEngine.ts:268` (`private pointers = new Map<number, ...>`), `:556` (`this.pointers.set(ev.pointerId, ...)` on down), `:643` (`this.pointers.delete(ev.pointerId)` on up/cancel).

**Detail:** Pinch mode begins when `pointers.size === 2` (`:557`) and ends when an up drops `pointers.size < 2` (`:644-646`). Correctness of the whole touch state machine therefore rests on one assumption: a given physical finger keeps the same `ev.pointerId` from its `down` through its `up`.

### Finding 2: Every press while `pointers.size` is already 1 becomes a pinch, and pinch mode swallows taps and actions

**Evidence:** `src/render/excalibur/TowerEngine.ts:557-568` (pinch branch sets `gesture = null`, clears previews, returns before `classifyDown`/`onActionDown`), `:663-672` (`onTap`/`onActionUp` only fire from `gesture === "pan" | "action"`).

**Detail:** With a stale entry stuck in `pointers`, a single real finger makes `size === 2`: the press is consumed as a pinch, no gesture is classified, and release fires nothing. Placement dies silently; no toast, no refusal reason, regardless of funds.

### Finding 3: Excalibur 0.32 renumbers public pointer ids whenever the active set changes

**Evidence:** `node_modules/excalibur/build/esm/excalibur.development.js:28735-28742` (`_normalizePointerId`: public id = index of the native id in the **sorted set of currently-active native ids**), `:28775` (called again for **every** event: down, move, up, cancel).

**Detail:** Two fingers: native id 10 -> public 0, native 11 -> public 1. Native ids increase per new contact on real browsers, so the first-placed finger holds the lower id. When finger A (native 10) lifts, `clear()` prunes native 10; the next event from finger B (native 11) renormalizes to public **0**, not the 1 it was born with.

### Finding 4: `clear()` prunes the native-to-public map only on `up`, never on `cancel`

**Evidence:** `node_modules/excalibur/build/esm/excalibur.development.js:28643-28651` (loop over `currentFrameUp` only).

**Detail:** A `pointercancel` (browser takes the gesture: notification shade, app switch, palm rejection) leaves its native id in the sorted set forever, shifting every later contact's public id up by one. Combined with Finding 3 this widens the window in which a finger's id changes mid-gesture.

### Finding 5: The "yellow outline" is the gold **valid** ghost, and on touch it can be painted by a hover path that can never commit

**Evidence:** `src/render/excalibur/TowerEngine.ts:1221-1233` (`#ffd24a` fill + white stroke when `valid`); `:637-639` (`gesture === null` moves fall through to `onHover`); `src/main.ts:649-657` (`onHover` -> `updateBuildPreview` sets `engine.preview`).

**Detail:** When a pinch ends because one finger lifted, `pinch = null` and `gesture = null` (`TowerEngine.ts:644-647`). The surviving finger's subsequent moves hit the `onHover` branch (built for mouse), painting a gold "valid" ghost that tracks the finger. Its release fires nothing (`gesture === null`), and nothing clears `engine.preview` afterward on a touch device (no mouse hover exists to overwrite it). A stranded gold ghost sits on the tower, looking placeable, while taps do nothing (Finding 2 leak state).

## Deduced Conclusions

### Deduction 1: The phantom-pointer leak is the shared root cause of both reported symptoms

**Based on:** Findings 1, 2, 3.

**Reasoning:** Pinch with fingers A (public 0) then B (public 1). A lifts first (about half of all pinches): B's later events arrive as public 0. `pointers.delete(0)` on B's up is a no-op against the stored key 1, so `pointers` retains one phantom entry forever. From then on: every one-finger press reads `size === 2` and runs the pinch branch, so (a) plain drags pan/zoom against a static phantom anchor: the camera zooms erratically or barely responds ("zoom gets stuck"), and real two-finger pinches make `size === 3`, whose move handler measures `pts[0]`/`pts[1]` from insertion order including the static phantom (`TowerEngine.ts:607-618`), so real pinches also misbehave; (b) taps never classify, so nothing ever places again ("can't place even with money"), silently.

**Conclusion:** One state leak explains both bugs, including their intermittency (it only triggers when the first-placed finger lifts first) and their persistence (only a reload clears the map).

### Deduction 2: The stranded gold ghost is a secondary, real defect that manufactures the "yellow outline but won't place" reading

**Based on:** Findings 2, 5.

**Reasoning:** Post-pinch single-finger movement paints a valid-looking gold ghost via the hover path and leaves it on screen with no commit and no cleanup. Even before (or without) the leak, the player sees a gold footprint that a tap then fails to fill (tap places at the tap cell, or, in the leaked state, nowhere).

**Conclusion:** Fix must both stop the touch hover-ghost path and clear/settle previews when a pinch hands off to one finger.

## Hypothesized Paths

### Hypothesis 1 (owner premise): zoom clamp or money check is at fault

**Status:** Refuted.

**Theory:** Zoom limits wedge the camera; placement refuses despite funds.

**Resolution:** `clampZoom` (`TowerEngine.ts:46-47`) and `clampCameraY` (`src/render/cameraBounds.ts:26-51`) are pure, NaN-guarded, and cannot latch. The money path is never consulted in the failing flow: input dies before `placeSimpleBuild` (Finding 2).

### Hypothesis 2: Browser-native pinch steals the gesture (missing `touch-action`)

**Status:** Refuted as the cause.

**Theory:** Page-level pinch zoom fights the game's.

**Resolution:** `src/styles.css:502` sets `touch-action: none` on the canvas, and Excalibur re-asserts it at init (`excalibur.development.js:28663-28667`). Native page zoom is suppressed on the play surface.

### Hypothesis 3: Zoom math dividing by a stale/zero pinch distance

**Status:** Refuted.

**Resolution:** `TowerEngine.ts:615` guards `if (this.pinch.dist > 0)`.

## Missing Evidence

| Gap                            | Impact                                            | How to Obtain                                    |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------ |
| On-device confirmation video   | Would visually confirm the leak sequence          | After fix: manual pinch test lifting first finger first; regression unit tests stand in for CI |

## Source Code Trace

| Element       | Detail                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Error origin  | `src/render/excalibur/TowerEngine.ts:643` (`pointers.delete(ev.pointerId)` misses the reshuffled key) |
| Trigger       | Pinch gesture where the first-placed finger (lower native id) lifts before the second           |
| Condition     | Excalibur 0.32 `_normalizePointerId` renumbers public ids per event from the live sorted set    |
| Related files | `src/main.ts` (onTap/onActionDown/onHover/updateBuildPreview), `src/game/gesture.ts` (classify), `src/render/cameraBounds.ts` |

## Conclusion

**Confidence:** High.

Confirmed root cause: `TowerEngine`'s touch tracker assumes Excalibur's public `pointerId` is stable per contact; Excalibur 0.32 recomputes it per event as an index into the live set of active native ids, so it shifts when a lower-id finger lifts mid-gesture (and drifts further after any `pointercancel`). The resulting phantom map entry converts every later one-finger press into a bogus pinch: zoom misbehaves and placement input is swallowed silently. A secondary confirmed defect leaves a gold "valid" ghost stranded on touch after a pinch hand-off via the mouse hover path.

## Recommended Next Steps

### Fix direction

Mechanism 1 (id instability): key the tracker by the **native** `pointerId` (`ev.nativeEvent instanceof PointerEvent`), falling back to Excalibur's id otherwise; native ids are stable per contact on every PointerEvent browser. Route `cancel` through the same delete (already done) and defensively reset all gesture state when the map empties.

Mechanism 2 (pinch hand-off): when a pinch ends with one finger still down, hand that finger a "pan" continuation (seed `lastSx/lastSy` from its tracked position, poison the tap slop so release cannot tap-place) instead of leaving `gesture = null`; this simultaneously kills the touch hover-ghost path and gives the expected one-finger pan.

Testability: extract the pointer state machine into a pure module (pattern: `src/game/gesture.ts`) with unit tests covering the id-reshuffle leak, cancel leak, pinch begin/end/hand-off, tap slop, and 3+ finger noise.

### Diagnostic

None required; root cause is deterministic from source. Post-fix manual check on device: pinch, lift first finger first, confirm one-finger pan continues, tap still places, repeat 10x.

## Reproduction Plan

1. Open the game on any touch device, select a room tool (e.g. Office), have ample funds.
2. Pinch to zoom with finger A then finger B; lift **A first**, keep B down and drag; a gold ghost trails the finger and nothing places on release.
3. Lift B. From now on every one-finger drag zooms/pans erratically ("stuck" zoom) and every tap does nothing (no toast), until reload.

## Side Findings

- `TowerEngine.ts:607-618`: with 3+ tracked pointers the pinch reads `pts[0]`/`pts[1]` by map insertion order; harmless once ids are stable, but worth pinning to the two live pinch fingers during the fix.
- `src/main.ts:828`: the drag-sized elevator **hover** ghost reports `valid: isUnlocked(kind)` only (ignores dry-run/funds), so a desktop hover shows gold where a drop would refuse. Cosmetic, desktop-only, out of scope here; candidate for backlog.
