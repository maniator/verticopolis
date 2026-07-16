# Architecture: Elevator per-day-type scheduling (#305)

Status: draft for review. Spec-first; companion to
`gdd-elevator-scheduling-2026-07-16.md`. This commits to *where* the scheduling
state lives, *how* it flows into dispatch and the TDT codec, and *what* stays
invariant, not to tuned magnitudes (stepper ranges and preset shapes are
calibration, settled during the phase PRs). Every phase lands as its own
`/gds-code-review` PR.

## 1. One-sentence shape

A per-shaft optional `schedule` object (per-day-type hourly active-car counts,
two response tunables, per-car home floors) is authored in a DOM dialog, stored on
the `Transport`, read each tick by `ElevatorDispatch` to decide how many cars are
on shift and where idle cars wait, and round-tripped through our save and the TDT
56-byte block; SCAN still routes the on-shift cars, so scheduling changes supply
and positioning, never routing or reachability.

## 2. Module boundaries

- **`src/engine/types.ts`**: the `Transport` interface gains one optional
  `schedule?: ElevatorSchedule` field (and the `ElevatorSchedule`/`DayType` types).
  This is the single new piece of persisted state. No new parallel per-car array is
  added for the schedule itself; `homeFloors` lives inside `schedule`, not as a
  fourth loose array, to avoid widening the fragile `carPositions`/`carDir`/
  `carLoad` lockstep.
- **`src/engine/elevatorSchedule.ts` (new leaf)**: pure helpers: `activeCarCount`
  (schedule, dayType, hour) -> clamped count; `homeFloorFor(schedule, carIndex,
  fallback)`; `dwellSecondsFor(schedule, globalDefault)`; `waitingResponseFor`;
  `coerceSchedule(raw)` for the load trust boundary; `defaultSchedule()` and an
  `isDefault`/absent check. No DOM, no RNG, no Simulation import. Both the engine
  and the TDT codec depend on this leaf so the semantics live in one place.
- **`src/engine/ElevatorDispatch.ts`**: reads the leaf to gate on-shift cars, set
  idle rest floors, and override dwell/response. The SCAN core is unchanged; the
  schedule only filters which cars participate and where they idle.
- **`src/engine/gameRules.ts`**: one new accessor for the authoring/advice split
  (§5). The dispatch effect is mode-agnostic; only the UI affordances diverge.
- **`src/ui/` (Phase 3)**: a new `uiElevatorSchedule.ts` controller + a
  `templates/elevatorSchedule.ts` body, following the `uiBatchPricing` stateful
  re-rendering pattern; wired from `editorActions.ts` behind a new editor action.
- **`src/storage/tdt*` (Phase 4)**: `tdtTypes.ts` `TdtElevator` gains a schedule
  field; `tdtTail.ts` decodes the 56-byte block and home floors instead of
  skipping; `tdtTransports.ts` carries it onto the `Transport`; `tdtEncoder.ts`
  encodes it; `tdtImportReport.ts`/`tdtExportReport.ts` gain a fidelity line.

## 3. Data flow

Authoring: dialog (Phase 3) mutates a working copy of the shaft's `schedule`, the
Simulate preview derives a read-only projection, OK writes the `schedule` onto the
`Transport` through a `Tower` method (so `revision` bumps and caches invalidate).

Runtime, once per outer sim step in `sim/loop.ts` before `moveCars`:

1. The loop already advances the clock; pass `clock.isWeekend` (the `dayType`) and
   `clock.hour` into `ElevatorDispatch.moveCars` (a new parameter, the dispatcher
   currently receives no clock).
2. Per shaft, `activeCarCount(schedule, dayType, hour)` decides how many of `cars`
   are on shift; on-shift cars are the lowest indices (deterministic). Off-shift
   cars are parked at their home floor and skipped by the SCAN loop entirely (they
   answer no calls and accrue no statistical load).
3. On-shift idle cars rest at `homeFloorFor(...)` instead of the derived lowest
   lobby; `waitingResponseFor`/`dwellSecondsFor` replace the two global constants
   for this shaft.
4. SCAN runs unchanged over the on-shift cars and the merged real+statistical
   calls.

Absent `schedule` short-circuits every helper to the current behavior (all cars on
shift, lowest-lobby idle, global dwell/response), so the flow is a no-op until a
schedule exists.

## 4. Caching and cadence

- The active-car count and home floors are cheap lookups; compute them per shaft
  per step inside `moveCars`, no cache needed. The day type and hour are resolved
  once per step and passed down, not recomputed per shaft.
- Editing a schedule bumps `tower.revision` (via the `Tower` setter), which already
  invalidates the routing adjacency and stop caches; no schedule-specific cache is
  introduced.
- The dialog's Simulate preview is a pure projection computed on demand in the UI
  layer (like `uiBatchPricing.recompute`), never on the sim hot path.

## 5. GameRules seam

The Classic/Modern divergence is only in authoring and advice, so one accessor
carries it, mirroring `expressTransferNeedsLobby`:

```
elevatorScheduleUX(): {
  presets: boolean;      // Modern shows Rush/Balanced/Feeder
  autoTune: boolean;     // Modern offers per-shaft auto-tune from measured load
  rawGridDefault: boolean; // Classic shows the grid outright; Modern hides it behind Advanced
  advice: boolean;       // Modern surfaces "idle 9-11, understaffed at 17" hints
}
```

Classic returns all-false except `rawGridDefault: true`; Modern returns presets/
autoTune/advice true with `rawGridDefault: false`. The dispatch code never reads
this accessor; it is UI-only. Crucially, the *schedule object and its dispatch
effect are identical in both modes*, so a schedule authored or imported under one
mode behaves the same under the other. The sim never branches on the mode string.

## 6. Determinism and RNG

- The schedule adds no RNG draw anywhere. On-shift car selection is index-ordered;
  home-floor idling and the two tunables are lookups. Both golden-master fixtures
  have no authored schedule, so `activeCarCount` returns "all cars", home floors
  fall back to the derived lobby, and the tunables fall back to the globals: the
  serialized state is byte-identical and both pinned hashes are unchanged.
- Auto-tune (Modern) reads the shaft's own measured hourly load, which is derived
  from existing statistical state, and writes authored `activeCars` rows at author
  time (a UI action), not on the sim tick, so it never perturbs the seeded stream.
- The load trust boundary (`coerceSchedule`) clamps `activeCars[*][*]` to
  `[0, cars]`, `homeFloors` into the served span, and the tunables into their
  stepper ranges, so a forged save cannot drive dispatch out of bounds.

## 7. Dispatch integration detail (the hard part)

The engine map flagged five bolt-on hazards; the design neutralizes each:

1. **Stateless car slots.** The schedule does not add a fourth parallel per-car
   array. `homeFloors` is a fixed-length array inside the `schedule` object, coerced
   once on load and read by index; the volatile `carPositions`/`carDir`/`carLoad`
   lockstep is untouched.
2. **No per-shaft config object.** `schedule` is that object, optional, on the
   `Transport`, serialized like `skipFloors`.
3. **Derived idle floor.** `idleFloor` becomes `homeFloorFor(schedule, i, lowest
   lobby)`: the current derivation is the fallback, so unscheduled shafts and tests
   that pin lobby-idling are unaffected; only an authored home floor changes it.
4. **Global timing constants.** `DWELL_MINUTES` and the response threshold become
   per-shaft overridable via the leaf, defaulting to today's constants. The rider
   patience budget keeps reading the global `CAR_FLOORS_PER_MINUTE` (unchanged);
   only dwell/response are per-shaft, and dwell only lengthens or shortens a stop,
   which the patience budget already tolerates.
5. **No clock in dispatch.** Phase 2 threads `dayType` + `hour` from `sim/loop.ts`
   into `moveCars`. This is the one signature change to the dispatcher.

The two demand channels (statistical `waiting`, real `hall`/`cab`) are both simply
gated to on-shift cars; a starved shaft still counts as serving its floors for
routing, so no floor drops out of the reachability graph (GDD invariant 6.3).

## 8. UI and inspector (Phase 3)

- New `uiElevatorSchedule.ts` friend controller over the `UI` modal primitives,
  body in `templates/elevatorSchedule.ts`, opened from a new `data-edit="schedule"`
  action in `editor.ts`/`editorActions.ts`. Stateful re-render pattern
  (`state` -> `recompute` -> `rerender`) so the WD/WE strip, steppers, floor list,
  and Simulate preview patch in place.
- The serviced-floors list reuses the existing stops model (`stops.ts`), extended
  with the per-floor Show toggle and the base-floor setter.
- Mobile reuses the editor's mobile fold-in and the shared `titleBarClose`.
- The transport diagnostics line (`facilityDiagnostics.ts`) gains a schedule-aware
  note in Modern (advice); Classic keeps the true measured-load readout without
  advice.

## 9. Test surface

- **Leaf unit tests** (`elevatorSchedule.test.ts`): clamping, day-type selection,
  fallbacks for an absent schedule, `coerceSchedule` hardening of forged values.
- **Dispatch integration** (`elevatorScheduling.integration.test.ts`): a scheduled
  bank homes cars up-tower and has them waiting there at the rush hour; a 0-active
  hour parks a shaft's cars without stranding its floors (routing still finds them);
  a WD/WE split runs different counts on a weekday vs a weekend day; the two
  tunables change dwell/assignment as specified.
- **Determinism**: golden master unchanged; a determinism test that a tower with an
  authored schedule is reproducible run-to-run.
- **Serialization** (Phase 1): round-trip a schedule through our save; a
  `SAVE_VERSION` migration test that a pre-schedule save loads with the default
  (absent) schedule and byte-identical behavior.
- **TDT** (Phase 4): decode a fixture block into a schedule and re-encode
  byte-identical; the export safety property (no dead-shaft block); the import
  report fidelity line; the fixed-point second-round-trip guarantee.

## 10. Files touched, by phase

- **Phase 0 (spike):** `docs/canon/tdt-format.md` (byte-layout note). No `src/`.
- **Phase 1:** `src/engine/types.ts`, new `src/engine/elevatorSchedule.ts`,
  `src/engine/sim/serialization.ts` (serialize spread + deserialize hardening),
  `src/engine/saveMigration.ts` (`SAVE_VERSION` 6->7, `upgradeV6toV7` backfill),
  `src/engine/Tower.ts` (a `setSchedule` mutator that bumps `revision`).
- **Phase 2:** `src/engine/ElevatorDispatch.ts` (day-type/hour param, on-shift
  gating, home-floor idle, dwell/response overrides), `src/engine/sim/loop.ts`
  (pass the clock signal), `elevatorSchedule.ts` (dispatch helpers).
- **Phase 3:** `src/ui/uiElevatorSchedule.ts` (new), `src/ui/templates/
  elevatorSchedule.ts` (new), `src/ui/templates/editor.ts`,
  `src/game/editorActions.ts`, `src/game/facilityDiagnostics.ts`,
  `src/engine/gameRules.ts` (the UX accessor), CSS for the strip/list.
- **Phase 4:** `src/storage/tdtTypes.ts`, `src/storage/tdtTail.ts`,
  `src/storage/tdtTransports.ts`, `src/storage/tdtEncoder.ts`,
  `src/storage/tdtConstants.ts`, `src/storage/tdtImportReport.ts`,
  `src/storage/tdtExportReport.ts`, `src/tests/fixtures/tdtBuilder.ts`.

## 11. Open architectural questions

- **A1 (blocks Phase 4):** the 56-byte block's internal WD/WE per-hour layout is
  undocumented (GDD O1). The `ElevatorSchedule` shape here is our engine model; the
  Phase 0 spike must produce the byte mapping (or an honest partial), and the
  encoder must retain the observed-default safety floor for any part it cannot yet
  express. Our own-save serialization (Phases 1-3) does not depend on this.
- **A2:** whether the 8 per-car home floors (TDT @186, already read into
  `carPositions` on import today) should migrate to live inside `schedule.homeFloors`
  on import, so the one home-floor concept has one home. Recommended yes; confirm no
  existing import test depends on them landing in `carPositions`.
- **A3:** `dayType` granularity. Canon is weekday/weekend (two rows). Modern's
  real-world calendar could in principle support per-weekday rows, but the canon
  model and the TDT block are WD/WE; keep two rows in both modes to preserve the
  byte mapping and avoid a Modern-only schedule shape.
- **A4:** whether Simulate runs a real short headless dispatch projection or a
  cheap analytic estimate. Prefer the analytic estimate on the UI thread to avoid a
  second sim instance; revisit if players want a true preview.
