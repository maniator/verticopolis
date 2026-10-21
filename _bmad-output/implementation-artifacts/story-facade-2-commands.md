# Story facade.2: Player commands go through the port

Status: in-progress

Slice 2 of the Rust-backed facade
(`_bmad-output/planning-artifacts/architecture/architecture-rust-facade-2026-10-20/slice-plan.md`),
under spine AD-9 (owner direction 2026-10-20 20:45 UTC, signed off 21:40 UTC).
Issue #1209, under the facade tracker #1207. Stacked on slice 1 (#1245).
Carries part of S9 (#954) by reference only: no closing keyword.

## Story

As the developer moving the web game onto Rust authority,
I want every player command the game issues to go through `app.port.command()`
and to read only the answer the port returns,
so that slice 7 can put the Rust engine behind the same port and every command
is then accepted or refused by Rust alone, with no call site that applies a
command to a TypeScript instance or decides a refusal itself.

## Planning, risk and testing review (before any code)

**Scope check.** The consumer inventory lists 31 command entry points in 9
files. This slice moves the ones in the game's command paths:
`buildActions.ts`, `editorActions.ts`, `keyboardPlay.ts`, `appModals.ts`
(the exterminator and its bulletins), `uiCallbacks.ts` (auto-bridge),
`frameLoop.ts` (the emergency answer and the meal-rush bulletins) and
`main.ts` (`renameTower`). The command paths reach two more files through
`BuildActions`: `placeSimpleBuild` in `buildPreview.ts` and the gesture
handlers in `engineWiring.ts`. The lifecycle writes in the same inventory row
(the camera stamped before a save in `saveLoad.ts` and `appModals.ts`
`saveToSlot`; the bulletins in `appBoot.ts` (an unreadable save at boot),
`legacyImportAdopt.ts` (an imported 1994 tower) and `saveLoad.ts` (a
recovered graphics reset); the bridging preference `main.ts` `adoptSim`
keeps on an undo or redo restore; and the host's own in `startWasmHost.ts`)
belong to slice 5 (#1212), agreed with the Runtime thread on 2026-10-21.

**Ownership agreed before editing (2026-10-21, 01:59 to 02:00 UTC).**
- Facade lane: `paintBrush` as one port command; the drift check's exclusion
  line in `view.types.test.ts`; a separate `commandContract.fixture.ts` with
  `describePortContract`'s options; a follow-up PR (2b) after #1244 with the
  engine's answer conversion (`src/simport/engineCommands.ts`) and a
  differential against the WASM `Engine`; `GameApp.port` as the one creation
  point. In `tsSim.ts` the `COMMANDS` table and `command` are this slice's.
- Slice 4 (#1211): every query moves in slice 4, including the latest-wins
  build-preview quotes (#1209 lists them; they live in `updateBuildPreview`'s
  query path, which #1211 also names). This slice leaves the query reads in
  its files as they are (Dev Notes list them) and uses only the two queries
  slice 1 defined.
- Runtime (slice 5): this slice edits `main.ts`, `frameLoop.ts` and
  `appBoot.ts`'s `wireControllers` only as listed in the tasks.

**Risks and how the slice meets them.**

| Risk | Where | Mitigation |
| --- | --- | --- |
| An awaited command reorders feedback or undo | every call site | `TsSim` applies a command at once and resolves in a microtask of the same task, so sound, toast and undo land in the same task as today. Each handler that brackets its own command with undo awaits the command before `commitUndo`. Tests await every controller method |
| A drag issues commands faster than an async adapter answers | `onActionMove` paint and bulldoze steps | Drag steps are fire-and-forget (`void`); the port runs them in issue order (port contract). The paint anchor is set before the command is issued, so the next step never reads a stale anchor |
| A command's result is read before it settles | after-command reads | Audit (Dev Notes): every read of the command's effect comes after `await`, and reads of the effect use `port.view` |
| The brush changes order or charges | `paintBrush` | One port command over the brush's tile list, run by one shared loop (`src/simport/brush.ts`) that `TsSim` calls with `sim.build` per tile: the builds of today's loop, pass by pass in the same order, so the relay forwards the same calls and parity is unchanged. No tick can fall between its tiles |
| A TypeScript pre-check decides a refusal the engine owns | the stops dialog | The endpoint and express-lobby pre-checks go; the engine's answer decides, and an unchanged tower leaves no undo step (`UndoHistory.commit` compares signatures) |
| A thrown command becomes a rejection | engine faults | The port rejects with the error; floating promises reach `analyticsErrors.ts`'s `unhandledrejection` listener, which reports them as it reports `error`. The fault-in-a-command path is #1218 (slice 8) |
| Test churn hides a lost assertion | 230 test call sites | Each test awaits the controller method or flushes the queue; no assertion is removed or weakened. The coverage ratchet holds |

**Hot path.** Commands run per user action, never per frame, except
`emitMealRushes` (per frame, issuing a command only on the frame a bulletin
fires) and drag steps (per pointer move). Each command costs the port's shape
check (constant work, one check per tile for a brush of at most 32), one
result object and one promise; the kind check is one closure per port over
the per-catalog index. The brush is one command per stamp instead of one
build call per tile at the call site (same engine work). No query moves here,
so build-preview cost is unchanged (slice 4 owns it). The review's Hot-Path
Auditor patched two inherited costs on the touched paths: the meal-rush
census now runs only on a frame where a rush is due, and a placed transport
is no longer diagnosed. The rest are deferred with issues (Completion Notes).

## Acceptance Criteria

1. **One port.** `GameApp.port` is `createTsSim(() => this.sim)`, created
   once; `GameAppPorts` carries it. `BuildActions`, `EditorActions` and
   `KeyboardPlay` take `port: SimPort` in their deps (wired in
   `appBoot.ts` `wireControllers`).
2. **Every command through the port.** In the files above, no call site
   applies a player command to the instance: `build`, `buildTransport`,
   `removeFacility`, `beginExtend`, `extendTransport`, `endExtend`, `addCar`,
   `removeCar`, `setStop`, `setExpressStops`, `clearStops`, `setSchedule`,
   `setLabel`, `adjustRent`, `setNoRate`, `priceUnit`, `applyRentBatch`,
   `setFilmPolicy`, `rerollSubtype`, `callExterminator`, `resolveChoice`,
   `toggleAutoBridge`, `setTowerName` and `emit` go through
   `port.command()`, and the caller reads only the result. A source guard
   (`src/tests/commandSites.guard.test.ts`) fails if a frontend file calls a
   command method on a simulation or tower, or writes a setting a command
   owns, again; slice 5's lifecycle writes are pinned there and only shrink.
3. **The paint brush is one command.** `{ op: "paintBrush"; kind; floor;
   tiles }` answers `{ ok, reason?, delta, placed }`: `placed` tiles laid,
   `ok` when at least one was, `reason` the last refusal the engine gave, and
   `delta` the balance's change over the whole brush. `kind` is `"floor"` or
   `"lobby"` (`BrushKind`). The loop is `runBrush` in `src/simport/brush.ts`,
   today's loop moved (skip a tile already of this kind, let a lobby brush
   upgrade plain floor, repeat while a pass laid something), so the brush
   lays what its passes' builds, issued one by one, lay.
   `view.types.test.ts` lists it as a port-level composite of `build` in the
   drift check.
4. **Results replace re-reads.** `placeSimpleBuild` reports a room's `ok`
   from the build's answer (it compared `units.length` before and after); the
   brush's "already built here" check reads `port.view` after the command
   settles. Every read of a command's effect follows its `await` (Dev Notes,
   "After-command reads").
5. **Refusals come from the engine.** The stops dialog drops its endpoint and
   express-lobby pre-checks and lets the engine refuse; the extend, car, rent,
   reroll, film policy and exterminator paths read the result's `ok`,
   `reason` and named fields as before.
6. **Async contract held at the UI seams.** `onToggleAutoBridge` resolves to
   the preference in force (the settings checkbox sets itself when it
   settles, and falls back to the live preference if the command fails); the
   batch pricing dialog's `apply` is awaited before its summary, runs once
   per open and closes without a summary on a refusal; the schedule dialog
   closes once `setSchedule` has answered, takes one OK, says so when the
   engine refuses, and a stop toggle that answers after the dialog closed
   repaints nothing; the emergency dialog clears `shownChoice` once
   `resolveChoice` settles, whether it answered or failed.
7. **The command contract.** `src/simport/commandContract.fixture.ts` exports
   `describeCommandContract(name, makePort, opts)`, with
   `describePortContract`'s `restarts` option. Per command: the accepted path
   (result shape, `delta` equals the balance's change, the effect on `view`);
   each refusal path (no state change, `delta` 0, the engine's `reason`, no
   gameplay event and no log line); malformed input (a non-integer or NaN
   number, a number outside the 32-bit range the Rust binding takes, an
   unknown op or kind (`constructor` and `__proto__` included), a bad
   direction, end, method, policy or flag, a brush with a hole or more than
   32 tiles, a non-string label, name or bulletin) refused without a throw,
   with the engine's own "That request is not valid.", by the port's shape
   check (`src/simport/request.ts`) before the engine sees it; a schedule
   stays the engine's to harden, whatever it is (a non-object clears it); a
   tower name or bulletin with half a surrogate pair kept with U+FFFD, as the
   Rust engine reads it (`engine/wellFormed.ts`); a stop on an endpoint
   answered and changing nothing; a camera kept as a copy of its own fields;
   issue order across back-to-back commands; the brush atomic against steps,
   equal to its passes' builds issued one by one (a lobby brush with bridging
   off takes three passes), and a repeated column laid once.
   `src/simport/tsSimCommands.test.ts` runs it over `TsSim`, with the paths a
   founded tower cannot reach (Classic, a cinema, an express shaft's stops)
   ticked so the parity host sees them;
   `npm run test:wasm:parity` runs it on the WASM mirror host, where a
   divergence between the two engines fails the case. Slice 7 runs it over
   `RustSim`.
8. **No behavior change for a player.** Under both of today's hosts every
   flow behaves as before (sounds, toasts, announcements, undo steps). No
   version bump (internal only). `npm run typecheck`, `npm run lint`,
   `npm test`, `npm run build` and `npm run test:wasm:parity` are green; the
   coverage ratchet holds; every file stays under 500 lines.
9. **Forward requirements recorded.** On #1217 and #1224: the brush is one
   synchronous engine call sequence on `RustSim` and one message on the
   worker, with no step between its tiles; `RustSim` runs the port's shape
   check before the binding; and the UI hazards of a port that answers later
   (#1273) are settled before either ships.
10. **Review.** `/gds-code-review` with the Hot-Path Auditor layer, every
    `patch` fixed, every `defer` in the backlog with an issue; the HP record
    in the PR body; the independent review through the coordinator. No
    auto-merge before the GO.

## Tasks / Subtasks

- [x] Port wiring (AC 1): `GameApp.port`, `GameAppPorts.port`, controller deps
- [x] `paintBrush` (AC 3): `commands.ts` member, `brush.ts`, `TsSim` handler,
      drift-check exclusion
- [x] Port shape check (AC 7): `src/simport/request.ts`, run by `TsSim`
- [x] Call sites (AC 2, 4, 5, 6)
  - [x] `buildActions.ts`, `buildPreview.ts` `placeSimpleBuild`
  - [x] `engineWiring.ts` command handlers
  - [x] `keyboardPlay.ts`, `inputKeys.ts`
  - [x] `editorActions.ts`, `uiBatchPricing.ts` `apply`, `uiElevatorSchedule.ts`
  - [x] `appModals.ts` exterminator
  - [x] `uiCallbacks.ts`, `UI.ts`, `uiSettings.ts` auto-bridge
  - [x] `frameLoop.ts` emergency answer and meal rush
  - [x] `main.ts` `renameTower`
- [x] Guard (AC 2): `src/tests/commandSites.guard.test.ts`
- [x] Command contract (AC 7) and its `TsSim` test; `contract.fixture.ts`
      exports its helpers
- [x] Existing tests and e2e specs await the controllers
- [x] Gates, parity, file sizes (AC 8)
- [ ] Forward requirements on #1217 and #1224 (AC 9)
- [ ] `/gds-code-review`, fixes, HP record (AC 10)

## Dev Notes

### After-command reads (the audit)

| Call site | Reads after the command | Under the port |
| --- | --- | --- |
| `BuildActions.tryBuild` | `res.ok`, `res.reason` | after `await` |
| `BuildActions.tryBuildTransport` | `res.ok`, `res.reason`; `transportReason` asks `isUnlocked` and `validateTransport` on a refusal | after `await`; the queries stay direct reads until slice 4 |
| `BuildActions.paintBrush` | `structureKindAt` per tile in the loop; `structureKindAt` over the brush for "already built here" | the loop runs inside the command; the final check reads `port.view` after `await` |
| `placeSimpleBuild` (room) | `tower.units.length` before and after | the build's `ok` |
| `BuildActions.tryRemoveUnit`, `removeTransportWithRefund`, `bulldozePicked` | `res.ok`, `res.reason`; then `selectedId()` | after `await` |
| `KeyboardPlay.commitCursor` | the placement outcome, the shaft build's result; `refreshCursorPreview` reads the tower | after `await`, then `commitUndo` |
| `EditorActions.extendSelectedTo` | `res.ok`, `res.bottom`, `res.top`, `res.added`; `refreshEditor` | after `await` |
| `EditorActions.handleEditAction` | each result; `refreshEditor` re-renders from the tower | after `await`, then `commitUndo` |
| Schedule dialog stops and `apply` | `refreshEditor`, the dialog's `read` | after `await` |
| Batch pricing `apply` | the batch tally for the summary | the dialog awaits it |
| `confirmExterminate` | `res.ok`, `res.reason`, `res.cost`; `showStats` re-renders | after `await` |
| Emergency dialog | `pendingChoice` on the next frame (`shownChoice` latch) | `shownChoice` clears after `await` |
| `onToggleAutoBridge` | the preference | the result's `value` |

Not reads of a command's effect, so unchanged: catalog lookups
(`towerCatalog`), the selection, DOM input values read before the command.

### Queries left in this slice's files (slice 4 moves them)

`transportReason`'s `isUnlocked` (moved to `port.query`, which slice 1
defines) and `validateTransport`; `refreshCursorPreview`'s
`placeTransportDryRun` and `isUnlocked`; `openBatchPricing`'s
`previewRentBatch`; `openSchedule`'s `elevatorHourlyLoad`,
`elevatorOriginLoad`, `lobbyFloors`, `stopsAt`; `confirmExterminate`'s
`housekeepingCoverage` and its quote (the confirm prompt prices the call
from the catalog's fees; the engine's quote is a slice 4 query).

### Lifecycle writes left for slice 5

`view =` in `saveLoad.ts` and `appModals.ts` `saveToSlot`; `emit` after a
load in `saveLoad.ts`, `legacyImportAdopt.ts`, `appBoot.ts`,
`startWasmHost.ts`; `adoptSim`'s auto-bridge carry; undo's capture and
commit across a drag (down, move, up), which slice 5 queues on the port.

### Constraints

- American English, no em-dashes, plain prose in comments, no "X, not Y".
- 500-line ceiling (`main.ts` sits at 499 after the port field).
- Engine values in `src/simport/` only where the adapter needs them: `TsSim`
  reads the catalog handle (`towerCatalog`, `findCatalogFacility`) for the
  shape check's kind test and `engine/wellFormed.ts` to repair text as the
  Rust engine reads it; `request.ts` and `brush.ts` import types only.
- No closing keyword on #868 or #954.

### What it removes (temporary TypeScript)

The direct command calls on `Simulation` and `Tower` in the command paths,
the stops dialog's TypeScript refusal pre-checks, and `placeSimpleBuild`'s
unit-count comparison.

### References

- [Source: architecture-rust-facade-2026-10-20/ARCHITECTURE-REVIEW.md#5.3 Commands], #6, #7
- [Source: architecture-rust-facade-2026-10-20/slice-plan.md, slice 2 row]
- [Source: architecture-rust-facade-2026-10-20/consumer-inventory.md, 1C]
- [Source: architecture-rust-facade-2026-10-20/plan-updates.md#4 (#954)]
- [Source: story-facade-1-port.md], issue #1209 and its forward requirements
- [Source: docs/performance/hot-path-review.md]

## Dev Agent Record

### Agent Model Used

Claude Code (the "Facade commands" thread), 2026-10-21.

### Debug Log References

### Completion Notes List

- Malformed commands are refused at the port (`wellFormed` in
  `request.ts`), because the two engines read them differently: the Rust
  binding's glue turns NaN into 0 for a whole-number parameter and throws on a
  kind it does not know, where the TypeScript engine built at a NaN floor.
- `/gds-code-review` round 1 (Blind Hunter, Edge Case Hunter, Acceptance
  Auditor, Hot-Path Auditor) on 007703e. Patched: the batch and schedule
  dialogs' refusals, double applies and close order; the emergency latch on a
  failed command; transport diagnosis only on a refusal; the shape check's
  32-bit range, holes, tile cap and exhaustive value lists; `BrushKind`; text
  repaired as the Rust engine reads it; the camera copied; the settings
  switch on a failed toggle; `paintFloorRun` settling on its steps; the guard
  on the syntax tree; contract cases for multi-pass and repeated-column
  brushes, endpoint stops, unreadable schedules and the camera; the adapter
  tests ticked on the parity host; the meal-rush census only when a rush is
  due; one kind-check closure per port.
- Deferred, each with an issue: the UI hazards of a port that answers later
  (#1273, row `facade-async-command-hazards`); the keyboard bulldoze
  announcement after a refusal (#1274, pre-existing); the TypeScript
  `removeUnit` scan (#1170 item, Rust half #1158 A17, callers added there);
  `bridgeFillPlan` three times per build (#347, notes updated); the cap
  checks' unit walks (#1239, #1158 A24); the undo capture's JSON round trip on
  the WASM host (#1212). F2 is a defer rather than an always-patch rewrite
  because `runBrush` keeps the per-tile builds of the loop it replaced and
  adds no walk of its own.

### File List

- `src/simport/request.ts` (new), `brush.ts` (new), `commands.ts`, `tsSim.ts`
- `src/simport/commandContract.fixture.ts` (new), `tsSimCommands.test.ts`
  (new), `contract.fixture.ts`, `view.types.test.ts`
- `src/tests/commandSites.guard.test.ts` (new)
- `src/main.ts`, `src/game/appBoot.ts`, `appModals.ts`, `buildActions.ts`,
  `buildPreview.ts`, `editorActions.ts`, `engineWiring.ts`, `frameLoop.ts`,
  `inputKeys.ts`, `keyboardPlay.ts`, `uiCallbacks.ts`
- `src/ui/UI.ts`, `uiBatchPricing.ts`, `uiElevatorSchedule.ts`,
  `uiSettings.ts`
- Tests: `src/game/appModals.test.ts`, `buildPreview.test.ts`,
  `engineWiring.test.ts`, `frameLoop.test.ts`, `uiCallbacks.test.ts`;
  `src/tests/uiFixture.ts`; `src/tests/integration/gameControllers`,
  `gameControllersCoverage`, `towerCongratsDialogs` and `uiDialogs`
  integration tests
- e2e: `auto-floor.spec.ts`, `offlineHelpers.ts`, `wasmEngine.spec.ts`
- `_bmad-output/implementation-artifacts/backlog.md` (rows
  `facade-async-command-hazards`, `keyboard-bulldoze-refusal-announce`; notes
  on `auto-floor-bridge-distance` and `ts-render-ui-hotpath-sweep`)
