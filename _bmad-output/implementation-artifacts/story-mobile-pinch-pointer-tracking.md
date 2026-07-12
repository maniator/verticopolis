# Story: Stable touch-pointer tracking (mobile pinch sticks, taps stop placing)

Status: **done**

<!-- Created 2026-07-12 from the concluded investigation
     _bmad-output/implementation-artifacts/investigations/mobile-zoom-placement-investigation.md.
     Root cause is Confirmed (High confidence); this story is the fix. -->

## Story

As a **mobile player**,
I want **pinch zoom and tap-to-build to keep working no matter which finger I lift first**,
so that **the camera never wedges into a broken zoom state and a valid (gold) placement always lands when I tap**.

## Acceptance Criteria

1. **Stable ids:** the gesture tracker keys live contacts by the native DOM `pointerId` (from `ev.nativeEvent`) with a fallback to Excalibur's id when no native id exists. Excalibur 0.32's per-event id renumbering (index into the live sorted set of active native ids) can no longer strand an entry in the tracker.
2. **Leak-proof lifecycle:** the reshuffle sequence (finger A down, finger B down, A up, B's later events arriving under A's old id in Excalibur's numbering) leaves the tracker EMPTY after both fingers lift. Regression-tested headlessly.
3. **Pinch hand-off:** when a pinch ends because one finger lifted, the surviving finger continues as a PAN gesture seeded from its tracked position; its release cannot tap-place (tap slop poisoned) and its movement never enters the mouse hover path, so no stranded gold ghost is painted on touch.
4. **Third-finger hygiene:** while a pinch is live, adding or removing extra contacts re-baselines the pinch distance/midpoint from the two live contacts, so the camera never jumps from a stale baseline.
5. **No behavior change for mouse/desktop:** classify/tap/action routing, right-click inspect, extend arrows, wheel zoom are untouched.
6. **Pure and tested:** the multi-touch state machine (contact map + pinch lifecycle) lives in a DOM-free module (shipped as `src/render/pinchTracker.ts`, beside its `cameraBounds.ts` precedent; the draft said `src/game/`, see Completion Notes), unit-tested for: id-reshuffle leak, cancel handling, pinch begin/move/end, hand-off pan seed, extra-finger re-baseline.
7. **Player-facing patch bump:** `package.json` version 1.18.1 -> 1.18.2.
8. Quality gates green (`typecheck`, `lint`, `test`, `build`) and `/gds-code-review` run in-session with `patch` findings fixed.

## Tasks / Subtasks

- [x] New pure module `src/render/pinchTracker.ts` (placed beside `cameraBounds.ts`, the existing pure-split precedent, instead of `src/game/`; see Completion Notes): `stablePointerId(exId, nativeEvent)` + `PinchTracker` (contact map, pinch state, hand-off result). No Excalibur/DOM imports; shapes structural so tests stay headless. (AC: 1,2,3,4,6)
- [x] Delegate `TowerEngine.pointerDown/Move/Up` pointer bookkeeping to the tracker; key everything by `stablePointerId`; on pinch end with a survivor, seed `gesture = "pan"`, `lastSx/lastSy` from the survivor, poison `moved` so release cannot tap. (AC: 1,3,5)
- [x] Tests `src/tests/pinchTracker.test.ts` covering the AC 6 matrix, including a literal simulation of Excalibur's `_normalizePointerId` renumbering to prove the old keying leaks and the new one does not. (AC: 2,6)
- [x] Version bump 1.18.2 + gates + `/gds-code-review`. (AC: 7,8)

### Review Findings

`/gds-code-review` 2026-07-12 (Blind Hunter, Edge Case Hunter, Acceptance Auditor), plus Copilot's PR review. Every confirmed finding is fixed on the branch; defers are recorded in `backlog.md`.

- [x] [Review][Patch] Em-dash sweep of new prose/comments (auditor; Copilot x7) [src/tests/pinchTracker.test.ts, src/render/excalibur/TowerEngine.ts]
- [x] [Review][Patch] Fallback pointer ids mapped into a disjoint negative key space so they can never collide with native ids (blind hunter) [src/render/pinchTracker.ts]
- [x] [Review][Patch] Live extend-arrow drag terminates on pinch-start instead of resuming with a jump after the hand-off (blind hunter; Copilot) [src/render/excalibur/TowerEngine.ts]
- [x] [Review][Patch] `setSim` performs a full input reset (tracker, gesture, arrowDrag), wiring the previously-orphaned `reset()` (blind hunter; auditor advisory) [src/render/excalibur/TowerEngine.ts]
- [x] [Review][Patch] Explicit mid-pinch cancel test, pinning the cancel-routes-through-up contract (auditor, AC 6 matrix) [src/tests/pinchTracker.test.ts]
- [x] [Review][Patch] Stale `transportStart` from a pinch-aborted elevator gesture cleared on tool switch, unblocking the update prompt (edge hunter F1) [src/main.ts]
- [x] [Review][Patch] Touch pointers can never drive the mouse hover path, closing the last stranded-ghost window (edge hunter F2) [src/render/excalibur/TowerEngine.ts]
- [x] [Review][Patch] Story artifact synced with shipped code: status, tasks, File List, AC 6 / design-snippet paths and fallback semantics (auditor; Copilot x3) [story file]
- [x] [Review][Defer] Swallowed off-window mouse pointerup leaks a transient contact; self-heals (edge hunter F3), deferred, pre-existing
- [x] [Review][Defer] Pinch-aborted paint run loses its undo step; documented overwrite semantics (edge hunter F4), deferred, pre-existing
- [x] [Review][Defer] Elevator hover ghost validity ignores dry-run/funds on desktop (investigation side finding), deferred, pre-existing
- Dismissed as noise: `pan(0,0)` on unrelated moves during a pinch (exact parity with the replaced code; pan+clamp is a no-op) and pinch-start abandoning an action gesture without `onActionUp` (documented design; the controller resets in-flight state on the next gesture).

## Dev Notes

### Root cause (from the investigation, cited)

- `src/render/excalibur/TowerEngine.ts:268,556,643`: tracker keyed by Excalibur's public `ev.pointerId`.
- Excalibur 0.32 `_normalizePointerId` (`node_modules/excalibur/build/esm/excalibur.development.js:28735`) recomputes the public id per event as the index of the native id in the sorted active set; `clear()` (`:28643`) prunes on `up` only. Lifting the lower-native-id finger of a pinch first renumbers the survivor from 1 to 0; the game's `pointers.delete(0)` misses the entry stored at key 1 and the map keeps a phantom forever.
- Phantom makes every later one-finger press read `pointers.size === 2` -> pinch branch (`TowerEngine.ts:557`) -> `gesture = null` -> `onTap`/`onAction*` never fire (silent no-place), and single-finger drags zoom against a static phantom anchor (stuck/erratic zoom).
- Secondary defect: pinch end leaves `gesture = null`; the survivor's moves fall into `onHover` (`TowerEngine.ts:637-639` -> `main.ts:649`), painting a gold "valid" ghost on touch that nothing commits or clears.

### Current state of files being modified

- `TowerEngine.pointerDown` (`:555-602`): adds to `pointers`, enters pinch at size 2 (clears previews, `gesture=null`), ignores size>2, else classifies via `classifyDown` and fires `onActionDown`.
- `TowerEngine.pointerMove` (`:604-640`): updates tracked pos if present; pinch branch pans by midpoint delta and zooms by distance ratio (guards `dist > 0`); pan branch accumulates `moved` and pans; action branch forwards; null gesture -> hover.
- `TowerEngine.pointerUp` (`:642-673`, also bound to `cancel`): deletes id; pinch branch drops pinch when size<2; pan branch fires `onTap` under slop (14 touch / 5 mouse); action branch fires `onActionUp`.
- `main.ts` wiring must NOT need changes: the hand-off keeps `gesture` non-null on touch so the hover/ghost path is unreachable mid-gesture; `onActionDown`'s existing "fresh gesture" reset (`main.ts:570-574`) still covers the paint anchor.

### Design (keep the TowerEngine diff a thin delegation)

```ts
// src/render/pinchTracker.ts (pure, no imports; shipped path, see Completion Notes)
export function stablePointerId(exId: number, nativeEvent: unknown): number {
  // Real PointerEvents carry a per-contact-stable pointerId; Excalibur's own id
  // is an index into the live active set and reshuffles when a contact lifts.
  if (typeof nativeEvent === "object" && nativeEvent !== null && "pointerId" in nativeEvent) {
    const id = (nativeEvent as { pointerId: unknown }).pointerId;
    if (typeof id === "number" && Number.isFinite(id)) return id;
  }
  // Shipped refinement: the fallback maps into a disjoint negative key space
  // (-1 - exId) so it can never collide with a native id.
  return -1 - exId;
}

export type PinchMove = { panDx: number; panDy: number; zoom: number; cx: number; cy: number };
export type PinchEnd = { survivor: { x: number; y: number } | null };

export class PinchTracker {
  // down(id,x,y): "pinch-start" | "pinch-extra" | "single"
  // move(id,x,y): PinchMove | null   (null when not pinching or <2 live contacts)
  // up(id): PinchEnd | null          (non-null exactly when a live pinch ends; also re-baselines
  //                                   when a pinch continues with 2+ remaining contacts)
  // size, pinching getters for the engine's classify decisions
}
```

- `move` computes pan/zoom deltas and re-baselines internally (mirrors `TowerEngine.ts:606-619`); zoom factor returns 1 when the stored distance is 0.
- Pinch continues while 2+ contacts remain; dropping to 1 returns `{ survivor }`, to 0 returns `{ survivor: null }`.
- Both `down` of a 3rd finger and `up` retaining 2+ re-baseline dist/midpoint from the (insertion-order) first two live contacts.
- TowerEngine on `PinchEnd` with survivor: `gesture = "pan"; lastSx = survivor.x; lastSy = survivor.y; moved = POISON` (any value >= 14 kills the tap; use a named const, e.g. 1e6, not a magic 14 coupling).
- `cancel` keeps routing through `pointerUp` (already bound at `:521`), so tracker `up()` covers it.

### Guardrails

- `src/engine/` stays untouched; this is input plumbing in `src/game/` + `src/render/`.
- Per-frame hot-path rule: tracker ops are O(active contacts), no allocation-heavy work per move beyond the existing array spread; do not add per-frame scans.
- American English, no em-dashes in new prose/comments.
- Do not change `classifyGesture` (`src/game/gesture.ts`) or the pan/tap slop semantics for single-finger gestures.
- Do not "fix" Excalibur in node_modules or fork it; the game-side stable-id keying is the contract-proof fix and survives an engine upgrade that fixes the renumbering.

### Testing standards summary

- Vitest, headless, DOM-free (`src/tests/pinchTracker.test.ts` next to `gesture.test.ts`).
- Include one test that reproduces the Excalibur renumbering literally: drive a fake normalizer (sorted-index over an active set pruned on up only) and assert the tracker keyed by STABLE ids ends empty, while documenting that keying by the normalized ids would leak (the old bug).

### References

- [Source: _bmad-output/implementation-artifacts/investigations/mobile-zoom-placement-investigation.md]
- [Source: src/render/excalibur/TowerEngine.ts:555-673 (pointer state machine)]
- [Source: src/main.ts:538-694 (gesture wiring, hover/ghost path)]
- [Source: src/game/gesture.ts (pure-routing precedent + test style)]
- [Source: node_modules/excalibur/build/esm/excalibur.development.js:28643,28735 (v0.32.0 id renumbering)]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (session 2026-07-12)

### Completion Notes List

- 2026-07-12: Story created dev-ready from the concluded investigation.
- 2026-07-12: Implemented. Two recorded deviations from the Dev Notes, both behavior-preserving:
  the module landed in `src/render/pinchTracker.ts` (beside `cameraBounds.ts`, its named
  precedent and its only consumer's layer) rather than `src/game/`; and a third finger
  LANDING does not re-baseline the pinch (a mathematical no-op since positions only change
  on `move`, and every `move` re-baselines), while lifts that keep 2+ contacts do re-baseline
  as specified. Both covered by tests.
- 2026-07-12: `/gds-code-review` findings applied on the branch: em-dash sweep of new
  prose/comments, explicit mid-pinch cancel test, fallback ids mapped to a disjoint
  negative key space, a live extend-arrow drag now terminates on pinch-start, and
  `setSim` performs a full input reset (`tracker.reset()`, gesture, arrowDrag).

### File List

- `src/render/pinchTracker.ts` (new)
- `src/tests/pinchTracker.test.ts` (new)
- `e2e/mobileGestures.spec.ts` (new: browser-level regression, real PointerEvents through Excalibur's receiver with realistic increasing native ids; runs in CI's `npm run e2e` on every PR)
- `src/render/excalibur/TowerEngine.ts` (pointer handlers delegate to the tracker; touch never drives hover; setSim input reset)
- `src/main.ts` (tool switch clears a pinch-abandoned `transportStart`)
- `package.json` (1.18.1 to 1.18.2)
- `_bmad-output/implementation-artifacts/investigations/mobile-zoom-placement-investigation.md` (case file)
