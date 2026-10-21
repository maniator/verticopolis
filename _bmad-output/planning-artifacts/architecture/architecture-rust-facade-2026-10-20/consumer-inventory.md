# Consumers of the TypeScript `Simulation` in production code

> **Snapshot, written 2026-10-20 against `main` at `9cd44d1` (app 2.40.0,
> engine crate 0.2.0, after #1139).** It does not refresh. The method is a
> TypeScript compiler pass (below), so a later run on a newer `main` gives the
> live list. It feeds the A vs B review in
> [`ARCHITECTURE-REVIEW.md`](./ARCHITECTURE-REVIEW.md).

## Method

A compiler-API scan over the project's `tsconfig.json` program: every
property access whose object's type is declared under `src/engine/`, in every
production file outside `src/engine/` and `src/tests/` (test files,
fixtures, `testing/` helpers and declarations excluded), plus every runtime
import from `src/engine/`. Each access is recorded with its file, line, the
engine type, the member and whether it reads, writes or calls. The scan found
2,045 accesses and 300 engine imports in 102 files; 44 files import the
`Simulation` module, 9 of them at run time.

The scanner is `audit/scan.cjs` in the project's shared folder
(`release-3.0/rust-facade/`), with its raw output (`rows.json`,
`imports.json`, `perfile.txt`).

## The buckets

The owner's five classes, with the letter each row below uses:

| Bucket | Meaning | Where it lives under B |
| --- | --- | --- |
| **1C** | Engine command | `SimPort` command: Rust runs it first and its result is the answer |
| **1Q** | Authoritative query: a value the engine decides (a price, a refusal, a reachability, a rating) | `SimPort` query: a Rust getter, read on demand or carried in a batched slice |
| **2S** | Renderer structure: what the tower is made of, changes on a revision | The structural snapshot, rebuilt when `tower.revision` moves |
| **2F** | Renderer frame data: what moves every step | The dynamic frame (typed arrays), read once per rendered frame |
| **3** | UI-local state and derived presentation | Stays in the browser, computed from the view or from engine data, never deciding gameplay |
| **4** | Save, undo, redo, lifecycle, recovery | `SimPort` lifecycle: engine-written bytes in and out |
| **5** | Temporary compatibility that disappears | Deleted from the healthy WASM path by B; kept only where the TypeScript fallback needs it |

## Needs, grouped

### Commands (1C), 31 entry points in 9 files

Every one runs on the TypeScript instance today and is relayed to the engine
(`relayCommands` in `src/dualrun/mirror.ts`), so the caller gets
TypeScript's answer (#954's gap).

| Consumer | Commands it issues | Result it reads today |
| --- | --- | --- |
| `game/buildActions.ts` | `build`, `buildTransport`, `removeFacility` | `{ ok, reason }` |
| `game/keyboardPlay.ts` | `buildTransport` | `{ ok, reason }` |
| `game/editorActions.ts` | `beginExtend`, `extendTransport`, `endExtend`, `addCar`, `removeCar`, `tower.setStop`, `tower.setExpressStops`, `tower.clearStops`, `tower.setSchedule`, `tower.setLabel`, `adjustRent`, `setNoRate`, `priceUnit`, `applyRentBatch`, `setFilmPolicy`, `rerollSubtype` | `ExtendResult`, `ChargeResult`, `BatchRentResult`, new rent, new subtype, booleans |
| `game/appModals.ts` | `callExterminator`, `view =` (camera), `emit` | `ExterminatorResult` (`{ ok, cost, rooms }`) |
| `game/frameLoop.ts` | `resolveChoice`, `emit` (meal rush bulletins) | none |
| `game/uiCallbacks.ts` | `toggleAutoBridge` | the new preference |
| `main.ts` | `tower.towerName =`, `autoBridge =` | none |
| `game/saveLoad.ts`, `game/legacyImportAdopt.ts`, `game/appBoot.ts`, `wasmhost/startWasmHost.ts` | `emit`, `view =` | none |

Gaps on the binding (#868): `callExterminator` returns `{ ok, reason? }`
without `cost` and `rooms`; `previewRentBatch` has no export; `extendTransport`
and the charges already return `{ ok, reason?, delta, ... }`.

### Authoritative queries (1Q)

| Consumer | Query | Cadence today | Binding today |
| --- | --- | --- | --- |
| `game/buildPreview.ts` | `canBuild(kind, floor, x)` with its quote | every hover change | `canBuild` exists |
| `game/buildPreview.ts`, `game/engineWiring.ts`, `game/keyboardPlay.ts` | `tower.placeTransportDryRun` | every transport drag move | none |
| `game/buildActions.ts` | `tower.validateTransport`, `tower.structureKindAt` | on a build | none (`structureKindAt` is structure, 2S) |
| `ui/uiStatus.ts`, `game/buildActions.ts`, `game/keyboardPlay.ts`, `game/buildPreview.ts`, `game/engineWiring.ts` | `isUnlocked(kind)` | every UI tick (160 ms) for the palette | none; derivable from the catalog's star gates and the star |
| `ui/uiStatus.ts` | `stats()` for the tower-stats strip | every UI tick | none |
| `ui/templates/stats.ts` | `stats`, `incomeBreakdown`, `elevatorStats`, `nextStarRequirements`, `milestoneProgress`, `nextStarThreshold`, `ratingPopulation`, `parkingDemand`, `recyclingCapacity`, `recyclingDemandMet`, `strandedFloors`, `housekeepingCoverage`, `economy.housekeepingReport`, `tower.functionalParkingSet`, `vipVisits`, `vipFavorable`, `exterminationDueDay` | while the stats screen is open | `housekeepingReport` only |
| `ui/templates/inspector.ts`, `ui/templates/editor.ts` | unit fields the frame lacks (`satisfaction`, `vacateReason`, `label`, `subtype`, `filmPolicy`, `residents`, `everOccupied`, `noRate`, rent), plus `floorReachable`, `isShowingBlockbuster`, `transportCapacity`, `tower.isFloorServed`, `tower.floorHasLobby` | while a panel is open, refreshed each UI tick | `unitAt` / `transportAt` return the saved record; the derived flags have no export |
| `game/facilityDiagnostics.ts`, `game/gripeCopy.ts`, `game/housekeepingDiagnostics.ts` | the "why is this unhappy" readout: `buildSatisfactionContext`, `wouldEvictFreshTenant`, `dominantGripe`, `unmetCoverage`, `servingTransportKindsAt`, `bindingTransportClassAt`, `nearNightclub`, `reachesLobby`, `demandMap`, `positionReachable`, `floorReachable`, `noiseAfflicted`, `elevatorUtilization`, `hotelsCountTowardRating`, `parkingDemand`, `recyclingFill`, `recyclingCapacity`, nearest-distance helpers, `housekeepingCoverage` | while the inspector shows a facility | none. **The largest Rust gap:** this is TypeScript gameplay logic run on the mirror |
| `game/trafficHud.ts` | `peakCongestionHotspot` | every UI tick | none |
| `game/editorActions.ts` | `elevatorHourlyLoad`, `elevatorOriginLoad`, `tower.lobbyFloors`, `tower.stopsAt` | while the elevator editor is open | `elevatorTelemetry` (whole) |
| `ui/Onboarding.ts` | `tower.isFloorServed` and unit scans for the checklist | every UI tick while active | none |
| `game/frameLoop.ts` | `tower.totalPopulation`, `evaluatedTower`, `pendingChoice` | every frame / UI tick | `pendingChoice` exists |
| `game/appModals.ts` | `housekeepingCoverage` | opening the exterminator modal | none |

### Renderer structure (2S)

| Consumer | Reads |
| --- | --- |
| `render/excalibur/towerReconcile.ts` (the scene reconcile) | `tower.units`, `tower.transports`, `unitAt`, `highestFloor`, unit `kind/x/floor/width/id/state`, transport `kind/x/width/bottom/top/cars/skipFloors`; also `functionalParkingSet`, `parkingUsage`, `recyclingFill` (1Q, hourly) |
| `render/excalibur/towerRegions.ts`, `towerShaftNumbers.ts`, `towerWalkerBuild.ts`, `towerCrowdLayout.ts`, `render/facadeGeometry.ts`, `render/sceneryLayout.ts`, `render/sprites/**`, `render/pixelSprites/**` | unit and transport geometry and kind, `subtype`, `hasStructure` |
| `render/excalibur/towerInputCamera.ts` | `getTransport`, `unitAt`, `highestFloor`, `lowestFloor` for hit tests and camera bounds |
| `render/excalibur/towerScenery.ts` | `rng.initialSeed` (the scenery seed), `units` |
| `render/excalibur/towerSyncSchedule.ts`, `TowerEngine.ts` | `tower.revision`, `tower.mealOverlayRevision` (the triggers B keeps) |
| `game/inspector.ts`, `game/panelAnchoring.ts`, `game/buildPreview.ts`, `main.ts`, `game/crashReport.ts`, `game/installAffordance.ts` | `getUnit`, `getTransport`, unit and transport geometry, counts |

The renderer already rebuilds structure only when `tower.revision` moves
(`towerSyncSchedule.ts`), which is the shape B's snapshot needs.

### Renderer frame data (2F)

| Consumer | Reads | Per frame today |
| --- | --- | --- |
| `render/excalibur/towerCrowd.ts` | `crowd.people` (`id, staff, seed, state, x, fy, wait`), car `carPositions/carLoad/carDir`, unit `occupants`, clock, `population`; `positionReachable` on a spawn probe | yes |
| `render/excalibur/TowerEngine.ts` | `congestion()` (crowd stress), `crowd.queueView(tower)` | **yes: TypeScript computations on the mirror every frame** |
| `render/excalibur/towerOverlay.ts` | fx sequences, weather, clock; `floorHeatmap(mode)` and `peakCongestion` while an overlay is on | yes |
| `render/excalibur/towerScene.ts` | weather, clock, fx, `view` | yes |
| `render/excalibur/roomSignature.ts`, `render/pixelSprites.ts` | unit `state`, `occupants`, `outForMeal`, `subtype` | on a repaint |
| `ui/uiStatus.ts`, `game/frameLoop.ts` | `money`, `star`, `population`, clock, `log`/`logSeq` | every UI tick |

### UI-local state and derived presentation (3)

| Consumer | What | Note |
| --- | --- | --- |
| `ui/uiElevatorSchedule.ts` | schedule presets, auto-tune and advice (`scheduleAuthoring`, `scheduleOrigins`) over the elevator telemetry | Authoring helpers whose output is a `setSchedule` command the engine validates; they read telemetry, they decide no outcome |
| `ui/catalogPricing.ts`, `ui/placement.ts`, `ui/uiPalette.ts`, `ui/templates/toolInfo.ts`, `game/gesture.ts` | catalog lookups (`catalogFacility`) | The catalog is already the engine's while hosted (`useTowerCatalogSource`) |
| `game/trafficHud.ts` (`trafficTier`, labels), `ui/templates/stats.ts` (`LEDGER_LABELS`), formatters | labels and tiers for display | |
| `render/**` atlas and sprite helpers (`isElevatorKind`, `hasBusinessHours`, `isOpenAt`, `visibleOccupants`, `FACILITIES` in tooling) | display rules read from static tables | `isOpenAt` and the tables are S7's (#921, #926): static rule tables, no instance. Not a B blocker, tracked there |
| `render/excalibur/TowerEngine.ts` | the camera (`view`), selection, tool state, hover | `view` is saved, so writing it is a preference command (1C) |

### Save, undo, redo, lifecycle, recovery (4)

| Consumer | What |
| --- | --- |
| `main.ts`, `game/saveLoad.ts`, `game/appBoot.ts` | `Simulation.newGame`, `Simulation.deserialize`, `adoptSim`, `serialize`, founder and mode reads at boot |
| `game/appHistory.ts` | undo snapshot = `JSON.stringify(sim.serialize())`; restore = `Simulation.deserialize` then `adoptSim`; signature = `towerStateSig(sim.tower, sim.money)` |
| `storage/SaveGame.ts` | `serialize`, `deserialize`, `population`, `towerName`, `markFounderFromLoadedFile` |
| `game/exportFlow.ts`, `storage/tdt*` | `.TDT` export reads the engine's save; the static tables (`FACILITIES`, `GRID`) feed the codec |
| `game/crashReport.ts` | a save and a few header fields |
| `wasmhost/startWasmHost.ts` | follows every `adoptSim` onto a fresh engine; `playerState` for the recovery line |
| `wasmhost/hostFault.ts` | restore points (engine saves), recovery onto a fresh TypeScript `Simulation` |

### Temporary compatibility (5)

| Consumer | What it does that B removes from the healthy path |
| --- | --- |
| `wasmhost/wasmHost.ts` | owns the relay, the per-step `frameView` decode and sync, the hourly `serialize` / `JSON.parse` / `Simulation.deserialize` / `mergeSimulation`, the overrides of `serialize`, `drainGameplayEvents`, `gameplayEventsDropped` on the instance |
| `wasmhost/merge.ts`, `frameSync.ts`, `frameApply.ts`, `telemetry.ts` | write the engine's state into TypeScript objects |
| `wasmhost/workerApply.ts`, `workerHost.ts` | the same for the worker host (`parseMerge`) |
| `dualrun/mirror.ts` (`relayCommands` in host mode, `loadCommand`) | command relay and the instance re-serialization at attach (AD-8's gap) |
| `engine/towerCatalog.ts` (`useTowerCatalogSource`) | points the instance's catalog at the engine's |
| `wasmhost/stepGate.ts`, `stepLoopAbsent.ts` | coalesced-mode plumbing on the instance |
| `game/appHistory.ts` (`signatureOf`), `startWasmHost.ts` (`playerState`) | marked "temporary, with the fallback" already |
| `wasmhost/hostFault.ts` (`carryLiveState`, `RestorePoints.restore`) | stays for the fallback (#874), but reads the view, never a mirror |

## Counts by bucket

Files, counting a file once per bucket it serves (a file can serve several):

| Bucket | Files | Notes |
| --- | --- | --- |
| 1C | 9 | 31 command entry points |
| 1Q | 17 | of which 3 (`facilityDiagnostics`, `gripeCopy`, `housekeepingDiagnostics`) run TypeScript gameplay logic on the mirror |
| 2S | 33 | mostly field reads on units and transports; 2 read derived structure (`functionalParkingSet`, `hasStructure`) |
| 2F | 9 | 2 run TypeScript computations per frame (`congestion`, `queueView`), 1 per overlay frame (`floorHeatmap`) |
| 3 | 27 | static tables and catalog lookups; no instance |
| 4 | 12 | |
| 5 | 13 | all in `src/wasmhost/`, `src/dualrun/`, plus `useTowerCatalogSource` |

## What this means for the design

1. **Commands are few and already shaped.** 31 entry points in 9 files; the
   binding already answers most of them as JSON. A command port with one
   result shape (#954 AC2) covers them.
2. **The renderer needs data, not a simulation.** Its reads are fields of
   units, transports, people and cars, plus four computations (crowd stress,
   the elevator queue view, the floor heatmap, peak congestion) that the
   engine should hand it in the frame or an overlay slice.
3. **The panels are where the TypeScript simulation is really used.** The
   stats screen, the inspector and editor, and above all the facility
   diagnostics call TypeScript gameplay functions on the mirrored state.
   Under B each becomes one Rust getter returning the panel's data. The
   diagnostics getter is the largest single piece of new Rust.
4. **Lifecycle is centered on `Simulation` objects** (`newGame`,
   `deserialize`, `adoptSim`, the undo snapshot). B replaces the object with
   save bytes and a port that the host fills.
5. **Nothing in bucket 3 needs a live instance.** The static rule tables are
   S7's (#921, #926) and stay on their own track.
