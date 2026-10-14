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
  drag is on, opens the gesture on the first step (with the undo capture)
  and closes it in `endExtend`.
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
- Rust tests in `charges_tests.rs` mirror them; the binding's native test
  covers `begin_extend_checked`.
- `dualRunEdits`: a gesture through the mirror stays in step, and fails on
  a mirror that does not relay `beginExtend` (checked).
- `chargeBindingRaw`: raw `beginExtend` ids refused in both engines, and a
  gesture, a press after it closes and an inflated fourth argument land with
  equal answers, states and events.
- The editor coverage test bills a shrink and regrow after `endExtend`.

## Review Findings
