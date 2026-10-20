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

- PR #831 (room occupant seats): `roomOccupants` in `src/render/pixelSprites/common.ts` imports `visibleOccupants` from the TypeScript engine (through `engine/Crowd`), and `residential.ts`, `food.ts`, `clinic.ts` and `sprites/facilities/venue.ts` import it directly. After the removal, each reads the engine read model's visible-occupant count instead (backlog row `room-painters-read-ts-engine`, #1106). The PR cuts the render importers of `visibleOccupants` from 11 files on main to these five.

- **#1101 (#874, the runtime fallback).** They exist to re-adopt a faulted
  tower on a fresh TypeScript `Simulation`, so they go with it:
  - `src/wasmhost/hostFault.ts`: `RestorePoints` (all but `newestSave`, see
    below) and `carryLiveState`.
  - `src/wasmhost/wasmHost.ts`: the restore-point bookkeeping
    (`readPoint`, `pullTicks`, `restore`, the frozen tower's own tick), and
    `src/wasmhost/hostEvents.ts` (`HostEvents`: the held command events and
    `lostEdits`); a Rust-only host hands its events out as it reads them.
  - `src/wasmhost/startWasmHost.ts`: `recover`, `playerState`,
    `tidyHistory` and the player lines.
  - The undo trail's tidy after a recovery: `UndoHistory.dropUnchanged` and
    the `signatureOf` port (`src/engine/UndoHistory.ts`,
    `src/game/appHistory.ts`), `GameApp.dropEmptyUndo` (`src/main.ts`) and
    `WasmHostApp.dropEmptyUndo`.
  - The analytics bridge's `release` option on `drainGameplayEvents`
    (`src/analyticsEngineBridge.ts`), which lets held events go at the
    session's flush.
  - The restore-point benchmark, `npm run perf:restore`
    (`scripts/perf-restore-points.ts`, `src/tests/perfRestore/`).
  - The fallback-only tests: `src/tests/integration/wasmHostRollback.integration.test.ts`,
    `wasmHostRollbackHistory.integration.test.ts`, their helper
    `wasmRollback.ts`, `wasmHostFallback.integration.test.ts`,
    `src/wasmhost/startWasmHostRecovery.test.ts`, the restore and carry parts
    of `hostFault.test.ts` and `wasmHostPoints.test.ts`, the
    `drainGameplayEvents({ release })` case in `analyticsEngineBridge.test.ts`,
    the redo-drop case in `undoHistory.integration.test.ts`, and
    `e2e/wasmFallback.spec.ts`.

  What stays, because a Rust-only build still freezes and stops cleanly on a
  trap: the fault latch, the guards, the strict stop (`onFatal`) and
  `RestorePoints.newestSave` without its TypeScript load check (the strict
  build's save after a fault is the newest engine-written save).

## Sequence it sits in

See the roadmap's "Order and gates" section:
scenario library, then WASM build and binding, then dual run, then the
switch, then TDT in the crate, then this story.
