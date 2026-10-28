---
story: engine-retire-typescript
status: planned
depends_on: engine-wasm-switch, engine-tdt-port
---

# Story: retire the TypeScript engine

## Why

Once the web game runs on the Rust engine through WASM and the Godot client
links the same crate natively, the TypeScript engine is a second copy of the
simulation that no host runs. Keeping it means every simulation change lands
twice. This story removes it, and names what has to be true first, because
the removal also deletes the 360 tests under `src/engine/` that pin the
simulation's behavior today.

## Gates, all of them, before the branch opens

1. The web game has shipped on WASM as the default for at least two releases
   and the fallback flag has not been used.
2. The dual-run phase and the nightly fuzzer report no divergence over that
   window.
3. The test-mapping table is complete: every one of the 360 TypeScript engine
   tests maps to a conformance scenario, a Rust unit test, or a recorded
   drop with a reason, and a CI test fails if an engine test file has no row.
4. TDT import and export run in the crate (`story-engine-tdt-port`).
5. The copy catalog holds every engine-emitted sentence
   (`story-engine-copy-catalog`), so no prose dies with `src/engine/`.
6. The coverage floor on the Rust job is at or above the TypeScript floors
   for the engine layer (lines 94, functions 94, branches 86 in
   `vite.config.ts`), measured over the tests plus the referee.

## Acceptance criteria

1. **AC1 `src/engine/` is gone**, and so are the TypeScript runner and the
   lock generator; the lock becomes the Rust engine's own regression
   baseline, regenerated only on purpose by the Rust referee.
2. **AC2 Nothing in the web game imports engine internals.** The seam from the
   WASM switch is the only path, verified by the wrapper-seam build check.
3. **AC3 Every claim survives.** The test-mapping table shows no unmapped
   test, and the suite the table points at is green.
4. **AC4 Saves, TDT, screenshots and golden masters unchanged**, byte for
   byte where they are bytes, hash for hash where they are hashes.
5. **AC5 Version bump: major.** Players see no change, but the engine
   substrate is a headline milestone and the update flow should say so.

## What it removes

The inventory (what goes, what moves out of `src/engine/` first, what stays
in the browser, what to close before the removal, and which open and planned
work adds code this story removes) is the "Retiring the TypeScript engine:
the inventory" section of the roadmap,
`_bmad-output/planning-artifacts/architecture/architecture-engine-rust-port-2026-10-08.md`.
It is a snapshot of `main` at `e34dfdf` (2026-10-20). AC5 disagrees with the
roadmap's row 7 and the spine on the version bump; #1107 settles it.

Temporary code this story also removes that the roadmap's section does not
list, such as anything merged or opened after its snapshot (each PR adds its
own line: the PR, the files, and why the fallback needs them):

- **Benchmark parity tooling that runs the TypeScript engine** (#1124, the cost-split, churn and calibration PR, with #1108's A/A mode): `perf:compare --aa ts` and the TypeScript slot of every `perf:compare` run (`src/tests/perfCompare/{runner,validate,metrics,limitations}.ts`), the TypeScript side of the Node check (`nodeCheck.ts`), `perf:calibrate`'s `ts` passes and cold-start cap, and the `perf:worker` `ts` mode and its gate column (`src/tests/perfWorker/`). The WASM-only parts (the export cost split, hourly churn, the working-tree record, calibration of WASM A/A passes) stay as permanent benchmark infrastructure. Removing the TypeScript engine retires the comparison, so these go with it or collapse to WASM-only runs.
- **#985 slice 2a (the verified engine load, PR linked on #985).** The switchable build's branch that leaves the game on the TypeScript engine after a refused engine package: `loadBootEngine`'s `!wasmOnly` path in `src/wasmhost/engineBoot.ts` (the `engine: "ts"` result for a refused package, with its tests in `engineBoot.test.ts` and `bootstrapEngine.test.ts`) and the `chromium-wasm` assertions in `e2e/engineIntegrity.spec.ts` that expect the game on TypeScript (`expectRefused`'s non-wasm-only branch), plus the `!__WASM_ONLY__` worker-host branch in `src/bootstrap.ts` that gives a refused first tower its catalog verdict with its `workerCatalogs` cases in `src/bootstrapEngine.test.ts` (`catalogVerdict` itself stays: the main-thread host uses it too). Nothing else in the slice depends on the TypeScript engine: the loader (`loadEngineModule.ts`), the failure detail, the shell id check and the loading line stay.
- PR #831 (room occupant seats): `roomOccupants` in `src/render/pixelSprites/common.ts` imports `visibleOccupants` from the TypeScript engine (through `engine/Crowd`), and `residential.ts`, `food.ts`, `clinic.ts` and `sprites/facilities/venue.ts` import it directly. After the removal, each reads the engine read model's visible-occupant count instead (backlog row `room-painters-read-ts-engine`, #1106). The PR cuts the render importers of `visibleOccupants` from 11 files on main to these five.
- **Slice 5a (#1212, PR #1294): the host's save text for undo copies.**
  `setSaveText` and `saveText` in `src/wasmhost/stepGate.ts`, and the
  registration in `attachWasmHost` (`src/wasmhost/wasmHost.ts`). They let
  `TsSim`'s `saveNow({ memory: true })` hand over a hosted tower's engine
  text instead of printing the TypeScript instance again (#1158 A31, its
  undo half). A port with no TypeScript instance hands its engine's text
  out directly, so they go with the TypeScript engine.

- **#1101 (#874, the runtime fallback).** They exist to re-adopt a faulted
  tower on a fresh TypeScript `Simulation`, so they go with it:
  - `src/wasmhost/hostFault.ts`: `RestorePoints` (all but `newestSave` and
    `newestText`, see below), `carryLiveState` and `signatureOfSave`.
  - `src/wasmhost/wasmHost.ts`: the restore-point bookkeeping
    (`readPoint`, `pullTicks`, `restore`, the frozen tower's own tick), and
    `src/wasmhost/hostEvents.ts` (`HostEvents`: the held command events and
    `lostEdits`); a Rust-only host hands its events out as it reads them.
  - `src/wasmhost/startWasmHost.ts`: `recover`, `playerState`,
    `keptHistory`, `tidyHistory`, `holdRedo` and the player lines
    (`REPLACED`, `LOST`, `RESTORED`, `UNDONE`, `STUCK`).
  - The undo trail's tidy after a recovery and its redo hold:
    `UndoHistory.dropUnchanged`, `UndoHistory.holdClearedRedo` with the
    `cleared` field on its steps, and the fingerprint the tidy takes
    (`sigOf`, `src/engine/UndoHistory.ts`),
    `GameApp.dropEmptyUndo` and `GameApp.holdClearedRedo` (`src/main.ts`),
    and `WasmHostApp.dropEmptyUndo` and `WasmHostApp.holdClearedRedo`.
  - The analytics bridge's `release` option on `drainGameplayEvents`
    (`src/analyticsEngineBridge.ts`), which lets held events go at the
    session's flush.
  - The restore-point benchmark, `npm run perf:restore`
    (`scripts/perf-restore-points.ts`, `src/tests/perfRestore/`).
  - The fallback-only tests:
    - `src/tests/integration/wasmHostRollback.integration.test.ts`,
      `wasmHostRollbackHistory.integration.test.ts` and their helper
      `wasmRollback.ts`;
    - in `wasmHostFallback.integration.test.ts`, the cases "falls back from
      a command that traps...", "falls back from a tick that traps with a
      live crowd...", "delivers every event once...", "falls back from a
      trap in the coalesced host's flush" and "skips the recovery when a
      load replaced the faulted tower first";
    - `src/wasmhost/startWasmHostRecovery.test.ts`, the restore and carry
      parts of `hostFault.test.ts`, and `wasmHostPoints.test.ts`;
    - the `drainGameplayEvents({ release })` case in
      `analyticsEngineBridge.test.ts`;
    - the `dropUnchanged` and redo-hold cases in
      `undoHistory.integration.test.ts`;
    - `e2e/wasmFallback.spec.ts`.
  - The assertions of temporary behavior in tests #1101 changed (the full
    list is in the spec's Tests section):
    - `wasmHostAnalyticsBridge.integration.test.ts`: the fallback case
      ("loses and repeats nothing when the engine fails a drain and the host
      falls back") and the "before a point" assertions with `drainCovered`;
    - `capacityEventMatrix.integration.test.ts`'s `covered` helper (a plain
      drain again);
    - `wasmHost.integration.test.ts`'s `host.restore()` assertions and its
      held-event counts;
    - `startWasmHost.test.ts`'s `REPLACED` line in "latches hosting off
      when %s traps while a load lets the tower go";
    - `bootstrapEngine.test.ts`'s switchable fault path ("records a
      switchable build's running engine fault on the boot state...").

  What stays, because a Rust-only build still freezes and stops cleanly on a
  trap: the fault latch, the guards, the strict stop (`onFatal`) and
  `RestorePoints.newestSave` and `newestText` without their TypeScript load
  check (the strict build's save after a fault is the newest engine-written
  save). Their tests
  stay too: the trap helper `src/tests/integration/wasmTraps.ts`, and
  `wasmHostFallback.integration.test.ts`'s latch case ("records one fallback
  and one recovery however many paths fault after it", without its adopt
  assertions), strict-stop case and trap-coding case (without its adopt
  assertion).

- **#1092 (#902, a pending exterminator booking survives saves and
  attach).** The Rust writer and loader of `exterminationRoomIds`
  (`engine-rs/src/sim.rs`, `load.rs`, `extermination_tests.rs`), its
  conformance cases and the `hotel-exterminator-reload-modern` scenario are
  Rust-authoritative and stay. Its TypeScript side goes, since only the
  TypeScript engine and its read model use it:
  - the TypeScript writer and loader of the field
    (`src/engine/sim/serialization.ts`, `coerceExterminationRoomIds` in
    `src/engine/sim/coerce.ts`, the field in `src/engine/serializedGame.ts`)
    and the TypeScript treatment's use of it (`src/engine/sim/services.ts`,
    `src/engine/Simulation.ts`), with `exterminationPersistence.test.ts`;
  - the read model's copy of the billed rooms in `mergeSimulation`
    (`src/wasmhost/merge.ts`), which goes when the read model stops being a
    TypeScript `Simulation`;
  - the parity setup's re-host mid-booking (`src/tests/parity/wasmHostSetup.ts`
    and its test);
  - in `wasmHostExtermination.integration.test.ts`, the cases that run the
    TypeScript loop after a host lets go ("keeps the treatment to the billed
    rooms when the host lets go mid-booking" and the worker host's "puts the
    list back on the hour's merge, and keeps the treatment to it when the
    worker host lets go") and S4's booking case ("after a trap in a tick"
    and "in a command", which the fallback needs). The attach cases stay,
    without their read-model assertions (they go with the merge's copy) and
    their TypeScript steps after the detach.

- **The recovery correctness set (#1113, #1126, #1149;
  `spec-1113-1126-1149-recovery-correctness.md`).** Temporary, with the
  re-adoption:
  - `RestorePoints.restore`'s `skipped` count, the `RestoredPoint` shape
    `WasmHost.restore` answers with, `WasmHost.answered` (with
    `RestorePoints.answered`), and `WasmHostStatus.restorePoint`;
  - the player lines `OLDER`, `CLEARED` and `SWAP_FAILED` in
    `startWasmHost.ts`, and the undo trail cleared after an older point (`WasmHostApp.clearUndo`,
    `GameApp.clearUndo` in `main.ts`);
  - the frozen tower's closed event buffer in `wasmHost.ts`'s faulted detach,
    with the frozen tower's own tick;
  - the tests: the `skipped` case and the four `answered` cases ("names the
    point a save or the recovery chose...", "goes back to the point a save
    already answered with...", "walks on from the point a save answered
    with..." and "walks on to an older point...") in `hostFault.test.ts`;
    the older-point and failed-swap cases and the snapshot cases ("records which point a
    save of the faulted tower answered with...") in
    `startWasmHostRecovery.test.ts` (with its `clearUndo` stub); "clears
    the undo trail when an undo's own snapshot goes back past the newest
    point", its redo twin and "goes back to the point an undo capture's save
    answered with..." in `wasmHostRollbackHistory.integration.test.ts`; in
    `wasmHostFallback.integration.test.ts`, "goes back to the merge when the
    newest point does not load..." and "says the swap failed when the
    recovery's adopt throws..."; the `OLDER`, `CLEARED` and `SWAP_FAILED` exports in
    `wasmRollback.ts`.

  What stays, because a Rust-only build latches on the same signal:
  `isEngineTrap`, `letEngineGo`, `runEach`, `ShadowEngine.abandon`, the latch in
  `startWasmHost`'s `follow` (an attach, the catalog check, a release) with
  `WasmHostStatus.latched` and `onFallback`'s `latched` argument, the boot's
  writer off on `latched`, the engine freed on a refused attach and let go
  after a fault, the attach's single frame read, and their
  tests (the trap and teardown cases in `hostFault.test.ts` and
  `startWasmHostFallback.test.ts`, the attach-trap cases in
  `bootstrapEngine.test.ts`, the single-read, overrun-frame and
  healthy-detach buffer cases in `wasmHostFrame.test.ts`, and the real-engine
  `wasmHostAttachTrap.integration.test.ts`).

## Sequence it sits in

See the roadmap's "Order and gates" section:
scenario library, then WASM build and binding, then dual run, then the
switch, then TDT in the crate, then this story.
