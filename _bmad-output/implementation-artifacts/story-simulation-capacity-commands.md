---
story: simulation-capacity-commands
status: review
issue: 906
---

# Story: capacity events from the simulation layer in both engines (#906)

## Why

The phase 1 party review of #873 found that the two engines emit
`capacity_changed` from different layers. The TypeScript engine emitted from
the tower's own `setCars` and `resizeTransport`; the Rust engine emits from
`Simulation::set_cars` and `Simulation::resize_transport`, and its bare tower
methods emit nothing. The streams agreed because every host command edits
through each engine's emitting layer, but a native client or a test reaching
the TypeScript tower directly would report what the same call in Rust does
not. This is the TypeScript tie-in the owner asked for after #938.

## Acceptance criteria

1. **AC1** `Simulation.setCars` and `Simulation.resizeTransport` exist in
   TypeScript and report `capacity_changed` exactly when the Rust wrappers do:
   on a car count that changed, and on a span that moved; nothing on a refusal
   or a no-op.
2. **AC2** The tower's own `setCars` and `resizeTransport` are silent, as the
   Rust tower's are, and the tower holds no gameplay event buffer.
3. **AC3** The engine-owned charges (`addCar`, `removeCar`,
   `extendTransport`) edit through the simulation layer, so paid edits still
   report.
4. **AC4** The TypeScript conformance referee edits through the simulation
   layer, so the lock's `events` hashes stay unchanged.
5. **AC5** The catalog's `capacity_changed` wording names the simulation
   layer for both engines, with a history note; payload and version unchanged.

## What landed

- `src/engine/sim/capacity.ts` (moved from `tower/capacityEdits.ts`): the
  emitting edits, taking the simulation.
- `Simulation.setCars` / `Simulation.resizeTransport` delegations;
  `Tower.setCars` / `Tower.resizeTransport` call the transport module
  directly; the tower's `gameplayEvents` field and its assignments (the
  constructor and the WASM host's merge restore) are gone.
- `sim/charges.ts` and `src/tests/conformance/scenario.ts` call the
  simulation layer.
- Catalog wording and history note; digest pin moved; the Rust doc comment
  on `Simulation::set_cars` updated (no behavior change; `BUILD.json`'s source
  hash refreshed).
- The relay keeps the two layers apart: the mirror wraps `Simulation.setCars`
  and `Simulation.resizeTransport` as the `setCars` and `resizeTransport`
  commands (the reporting binding ops), and the bare tower edits as
  `towerSetCars` and `towerResizeTransport`, new silent binding ops that call
  the Rust tower directly. A bare tower edit is silent in both engines whether
  or not a host or shadow is attached.

## Test record

- `gameplayEmission.test.ts`: the simulation layer reports a changed count or
  span and nothing for a no-op, and the tower's own edits are silent.
- Tests that edited capacity through the raw tower and expected an event
  (`dualRunEdits`, `wasmHost`, `wasmHostAnalyticsBridge` integration) now edit
  through the simulation layer.
- `mirror.test.ts`: the bare tower edits relay as the tower ops; a
  simulation-layer edit relays once, as the reporting op.
- `dualRunEdits` integration: bare tower car and span edits on the hosted
  tower keep both the state and the event streams in step.
- `cargo run --release --bin conformance`: every scenario ok; the TypeScript
  conformance runs match the lock.

## Review record

`/gds-code-review`, round 1 (Blind Hunter, Edge Case Hunter, Acceptance
Auditor on commit 4e5e10a):

- **patch** (all three layers) A bare TypeScript tower edit was relayed to
  the Rust binding's emitting `setCars`/`resizeTransport`, so under the WASM
  host or the dual-run shadow it reported `capacity_changed` on the Rust side
  only. Fixed with the silent `towerSetCars`/`towerResizeTransport` binding
  ops and sim-layer wraps in the mirror (see What landed), with tests.
- **patch** (Blind Hunter) The resize result type was spelled out in three
  places; the simulation layer now uses `ReturnType<Tower["resizeTransport"]>`.
- **patch** (Blind Hunter) The drain doc lost its `{ name, payload }` shape and
  the per-tick contract when it was condensed; restored on one line.
- **dismissed** `BUILD.json` missing: it is in the commit (the review diff
  left it out). No other non-test caller of the bare tower edits exists
  (`src/`; the screenshot builders in `scripts/` use them and are now silent
  in both engines alike). The Rust `resize_transport` doc already named the
  simulation layer.
- **dismissed** Catalog freeze: the freeze gate on #873 applies to the release
  that ships the bridge's default flip (3.0.0). This edit changes wording
  only, so no payload, version, or dashboard moves; the history note records
  it.

Confirming pass: see below.
