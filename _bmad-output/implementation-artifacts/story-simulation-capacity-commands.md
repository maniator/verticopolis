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

## Test record

- `gameplayEmission.test.ts`: the simulation layer reports a changed count or
  span and nothing for a no-op, and the tower's own edits are silent.
- Tests that edited capacity through the raw tower and expected an event
  (`dualRunEdits`, `wasmHost`, `wasmHostAnalyticsBridge` integration) now edit
  through the simulation layer.
- `cargo run --release --bin conformance`: every scenario ok; the TypeScript
  conformance runs match the lock.

## Review record

Filled in by the `/gds-code-review` run.
