# Story: engine-held extend gesture mark (#990)

Status: review

## Story

As the owner of a second frontend, I want the engine to hold the extend
gesture's high-water mark, so that no frontend can bill a shaft extension
against a mark it supplies and get floors for free.

## Acceptance criteria (from #990)

1. The engine holds the mark in both engines: `beginExtend(id)` opens a
   gesture at the shaft's span, `extendTransport` bills against it, and
   `endExtend()` closes it. A tower swap, a load or a new gesture drops it.
2. The new commands relay through the dual-run mirror and the WASM binding.
3. `EditorActions` moves onto them and drops its caller-held mark.
4. A conformance scenario op pins a wiggling drag billed once.
5. The mark stays out of the save and the hashed views.

## What landed

- **TypeScript:** `src/engine/sim/charges.ts` keeps the open gesture in a
  `WeakMap` keyed by the simulation, so it is never serialized, never in
  the hashed views, and gone with a swapped-in simulation (a load or an
  undo deserializes a new one). `beginExtend(id)` drops any open gesture,
  then opens one on a whole id naming an elevator and answers true;
  otherwise false. `extendTransport(id, end, targetFloor)` bills past the
  open gesture's mark when it is on that shaft, past the shaft's span
  otherwise, and widens the mark with what it paid. `endExtend()` closes it.
- **Rust:** `Simulation::extend_gesture` (never saved or hashed), with
  `begin_extend`, `end_extend` and the three-argument `extend_transport`.
- **Binding:** `beginExtend(id)` reads its id raw like the other charge
  commands (#923), and a malformed id drops the open gesture as
  TypeScript's does; `endExtend()`; `extendTransport` takes three
  arguments. The mark parsing (`parse_mark`, `RawMark`) is gone.
- **Mirror and shadow:** `beginExtend` and `endExtend` relay as commands;
  `extendTransport` relays three fields. The read-once `prepare` hook (#923
  round 5) existed only for the caller's mark and is gone.
- **Editor:** `EditorActions` tracks only which shaft and simulation the
  drag is on, opens the gesture on the first step (after the undo capture)
  and closes it in `endExtend`, which a cleared selection (and so a tower
  swap) and a one-floor button press also call, so a press always bills
  from the span.
- **Attach:** `loadCommand` closes any open gesture, since the save the
  shadow or the WASM host starts from carries none.
- **Conformance:** `beginExtend` and `endExtend` ops replace `hwmBottom` and
  `hwmTop`, in both runners and the scenario
  `engine-charges-classic`, whose drags are bracketed by them. Every
  explicit mark the scenario carried equalled what the engine now holds, so
  the lock is unchanged.
- **No version bump:** the editor bills a drag exactly as before.

## Tests

- TypeScript unit tests: a wiggle billed once inside a gesture and again
  after it closes; a gesture only on an elevator, only on its own shaft,
  never inherited by a new gesture, dropped by a failed begin; the gesture
  out of the save and absent from a deserialized simulation; an inflated
  caller mark buying nothing; raw `beginExtend` ids refused.
- Rust tests in `charges_tests.rs` cover the same billing, scope and
  out-of-the-save cases; the binding's native test covers
  `begin_extend_checked`.
- `dualRunEdits`: a gesture through the mirror stays in step (removing the
  mirror's `beginExtend` relay splits the engines' money, checked by hand
  during development), and a shadow started mid-drag starts in step.
- `chargeBindingRaw`: raw `beginExtend` ids refused in both engines, and a
  gesture, a press after it closes and an inflated fourth argument land with
  equal answers, states and events.
- The editor coverage test bills a shrink and regrow after `endExtend`.

## Review Findings

### Round 1 (`/gds-code-review`: Blind Hunter, Edge Case Hunter, Acceptance Auditor)

- [x] [Review][Patch] A shadow or WASM host started from a live tower with
  an open gesture split the engines: the next step was free in TypeScript
  and billed in the fresh Rust engine (Edge Case Hunter with a repro,
  Blind Hunter, Acceptance Auditor) [src/dualrun/mirror.ts]: `loadCommand`
  closes the gesture; a dual-run test starts a shadow mid-drag and fails
  without it.
- [x] [Review][Patch] A one-floor button press billed against a gesture a
  lost pointer-up left open (Edge Case Hunter, Blind Hunter, Acceptance
  Auditor) [src/game/editorActions.ts]: the press closes it first; the
  editor test fails without it.
- [x] [Review][Patch] A tower swap mid-drag kept the old simulation in the
  editor's drag (Edge Case Hunter) [src/main.ts]: `clearSelection`, which
  `adoptSim` calls, ends the drag.
- [x] [Review][Patch] The gesture opened before the undo capture (Blind
  Hunter): the capture comes first.
- [x] [Review][Patch] Test gaps (Blind Hunter, Acceptance Auditor): Rust
  tests for the gesture out of the save, the hashed view and a loaded
  simulation; the TypeScript test checks the hashed view; the raw-binding
  test checks both digests with a gesture open; another shaft's wiggle is
  billed every time in both engines; `endExtend` joins the glue check.
- [x] [Review][Patch] Docs: `engine-rs/API.md` and the cutover spine's
  tier 1 list name the new commands; the story's test claims match the
  tests.
- Dismissed (7): a selection change mid-drag re-billing (it predates #990
  and the drag ends with its selection now); `beginExtend`'s result
  unchecked in the editor (it refuses only what `isElevatorKind` already
  rules out); `endExtend` on the replaced simulation (it has no gesture and
  no relay); the public Rust field (every `Simulation` field is public to
  native code, which can set `money` too); a refused `beginExtend` op in
  the scenario and `endExtend` in the lock (both pinned across engines by
  `chargeBindingRaw`, which fails if either engine drops or keeps a gesture
  the other does not); the backlog row marked done before merge (house
  style, as in #923); the scenario's mark equivalence (the unchanged lock
  shows it).
