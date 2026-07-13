# Split plan: per-file module boundaries

Companion to `SPEC.md`. Load-bearing detail: the target module layout for each oversized file, the shared-state hazard that makes it hard, and the tests that guard it. Every listed barrel keeps its path and exported names (SPEC CAP-3). Line counts are the pre-split baseline.

## Stage order (risk-ascending)

- **Stage 0 - Nets.** Golden-master `Simulation` determinism snapshot; file-size guard (`src/**`, `scripts/**` code files, shrinking allowlist); barrel-surface tripwires; `ByteWriter` unit tests. All green before Stage 1.
- **Stage 1 - Pure leaves** (no shared mutable state): `facilities.ts`, `saveMigration.ts`, `tdtFormat.ts`, `SaveGame.ts`, `audio/scenes` split of `ToneAudioEngine`, `render/sprites/structure.ts`, `render/pixelSprites.ts`, `scripts/screenshot-builders.ts`, `scripts/screenshot-scenes.ts`.
- **Stage 2 - Storage/TDT**: `tdtTables.ts` leaf first, then `tdtImport.ts`, then `tdtExport.ts` (`ByteWriter` + gather/encode/report).
- **Stage 3 - Engine friend-modules**: `EconomySystem.ts`, `Crowd.ts`, `Tower.ts`, `Simulation.ts`.
- **Stage 4 - Shell**: `ToneAudioEngine.ts` graph/sequencer, `ui/UI.ts`, `main.ts`, `render/excalibur/TowerEngine.ts`.
- **Stage 5 - Test splits + empty the size-guard allowlist**: whole `describe` blocks moved verbatim, vitest count parity asserted each split.

---

## Stage 1 - pure leaves

### `src/engine/facilities.ts` (598) - barrel
Cleanest file; no mutable state. Extract, keep `facilities.ts` re-exporting all:
- `facilitiesData.ts` - `FACILITIES` record + `LOT_WIDTH` (~305 lines).
- `facilityPredicates.ts` - `is*`/`*Kind`/`isOpenAt`/`hasBusinessHours`/`openHoursPerDay` and transport-kind predicates.
- `facilityCaps.ts` - `BUILD_CAPS`, `POOLED_CAPS`, `MAX_CARS`, `maxSpanFor`, `maxCarsFor`, `TRANSPORT_CAPACITY`, `transportCarCapacity`, `isFixedSpanTransport` (canon single source of truth - keep grouped).
- `census.ts` - `residentCount`, `censusCount`, `STAR_THRESHOLDS`, `TOWER_POPULATION`, `GRID`, and remaining canon constants.
- **Guard:** `canon.test.ts`, `gameRules`, `placement`, `renderScale`.

### `src/engine/saveMigration.ts` (555) - dispatcher stays
- `migrations/v1tov2.ts` - `upgradeV1toV2` + `reflowV1toV2` + `floatingStructureCount` (the ~226-line bulk).
- `migrations/v4tov5.ts` - `upgradeV4toV5` + `widenLegacyElevatorShafts`.
- Keep `saveMigration.ts`: `migrateSave`, `SAVE_VERSION`, `migrationLooksValid`, legacy price consts.
- **Guard:** `reflowMigration.test.ts`, `elevatorWidthMigration.test.ts`.

### `src/storage/tdtFormat.ts` (690) - barrel; lowest risk
- `tdtConstants.ts` - all size/offset consts + `TDT_ELEVATOR_SCHEDULE_DEFAULT` + world metrics + `LegacyImportError`.
- `tdtViewMapping.ts` - `viewWordsFromView` / `viewFromViewWords`.
- `tdtTypes.ts` - the six interfaces + `TdtTail`.
- `tdtByteReader.ts` - `ByteReader`.
- `tdtTail.ts` - `locateStairs` + `walkTolerantTail`.
- Keep `tdtFormat.ts`: `parseTdtBinary` + re-exports. `TDT_FLOOR_OFFSET` lives in `tdtConstants.ts` (re-exported through import).

### `src/storage/SaveGame.ts` (546) - only 46 over
- `saveCompression.ts` - `toBase64`/`fromBase64`, `inflateCapped`, `deflate`/`inflate`/`pipe`, support probes, `TowerTooLargeError`/`SaveTooLargeError`, caps (pure codec, ~130 lines).
- Keep `SaveGame.ts`: object literal + `writeSlot` + `stamp` + module `latestAsyncSave` token (must NOT move - shared async write-order state).
- **Guard:** `storage.test.ts`.

### `src/render/sprites/structure.ts` (902) - barrel; free functions
- `structure/lobby.ts` - `lobbyVariant`, entrance sentinels, `drawLobby`/`drawLobbyTile`.
- `structure/entrance.ts` - grand facade + doorman + service-entrance internals (199-581).
- `structure/rooftop.ts` - crane (`CRANE_W/H`, `craneAnchorTile`, `drawCrane`) + `drawEscapeStairs`/`drawAwning` + `ESCAPE_W`/`AWNING_W`.
- `structure/shell.ts` - `drawFloor`, `drawConstruction`, `drawBurntShell`, `drawFlames`.
- Keep `structure.ts` thin barrel so `sprites.ts` imports unchanged.
- **Guard:** `craneAnchor.test.ts`, `sprites.test.ts`, visual baselines (pixel-identical).

### `src/render/pixelSprites.ts` (1269) - barrel; free functions + look tables
- Shared primitives (`PAL`, `SHIRTS`, `SKIN`, `shade`, `hash`, `geoVariant`, `maybeMirrored`, `shell`, `wallItem`, `RoomCtx`, `person`, `vacancy`, `noticeBadge`, `closedShutter`) into `pixelSprites/common.ts`. `person`/`SHIRTS`/`SKIN` are the widely-imported hub - keep importable at a stable path.
- `pixelSprites/residential.ts` - `office`, `condo`, `hotel` + wall/`POPULATED` tables.
- `pixelSprites/retail-food.ts` - `fastFood`, `restaurant`, `cinema` + their look tables.
- `pixelSprites/retail-shop.ts` - `shop` (~265 lines) + `SHOP_LOOKS`.
- Keep `pixelSprites.ts` barrel: `drawRoom`, `person`, `PAL`, `SHIRTS`, `SKIN`, `sampleState`, `RoomCtx`, `FASTFOOD_LOOKS`/`RESTAURANT_LOOKS`/`SHOP_LOOKS`.
- **Guard:** `sprites.test.ts`, `subtypeVisuals.test.ts`, `paintPersistence.test.ts`, visual baselines.

### `scripts/screenshot-builders.ts` (860) - split by whole functions ONLY
Every export is serialized to a string and injected; **no shared module-scope helpers, no cross-function calls, duplication required.**
- `screenshot-page-ops.ts` - the `pg*` in-page primitives.
- `screenshot-tower-builders.ts` - `build*Tower`/`buildBasement`/`pgGrowToStar`.
- Update importers `screenshots.ts` and `screenshot-scenes.ts` (they import by identity; barrel-free - a small re-export index or direct path update, no behavior change). File must stay erasable (no enums/namespaces/param-properties).

### `scripts/screenshot-scenes.ts` (856) - merged SCENES export is a hard contract
- `screenshot-scenes-drivers.ts` - `migrationSave`, `loadMigration`, `growToStar`.
- Split `SCENES` into grouped partial arrays (`scenes/*.ts`) concatenated into one merged `SCENES` export; `screenshot-shards.ts` validates its partition against the full id set, so the merged list must stay complete and id-stable.

### `src/audio/ToneAudioEngine.ts` (Stage 1 slice) - barrel
Pure, Tone-free extractions (rest of file is Stage 4):
- `audio/scenes.ts` - `SCENES` manifest + `Scene`/`SceneDef`/`BasicWave`/`Accent` types + `sceneFor`/`detailFor` (~230 lines).
- `audio/audioMath.ts` - `midiToFreq`, `clamp`, `lerp`, `sameNotes`, `pseudo`.
- Keep `SfxName` and pure helpers re-exported from `ToneAudioEngine.ts` (tests + `Audio.ts` import by path).

---

## Stage 2 - storage/TDT

### `src/storage/tdtImport.ts` (1258) - barrel; `tdtTables.ts` FIRST
- `tdtTables.ts` (leaf) - `TENANT_KIND`, `PART_FAMILY`, `FAMILY_STORIES`, `SCREEN_PARTS`, `ELEVATOR_KINDS`, TDT floor/lobby/burned/metro consts, hotel flag masks, `TDT_FLOOR_OFFSET`. **Both import and export depend on this leaf** (breaks the export->import coupling; reader+writer cannot drift).
- `tdtPartMerge.ts` - `PartRecord`, `MergedPart`, `mergeParts`.
- `tdtTransports.ts` - `DecodedTransports`, `overlapsPlaced`, `transportsFromDecoded`, `synthesizeTransports`.
- `tdtImportReport.ts` - `ImportReport`, `buildReport`, `formatClock` + shared exported `ImportCounts` interface (promote the twice-spelled counts shape).
- Keep `tdtImport.ts`: `parseTDT` (its inline closures over `paved`/`roomClaimed`/`nextId` stay - true closures), `rentFromClass`, `looksLikeLegacyTower`, re-exports of `LegacyImportError` + `TDT_FLOOR_OFFSET`.
- **Guard:** `tdtImport.test.ts` (1086 - hostile-file hardening, golden mappings, part-merge, transport decode/synthesis, end-to-end deserialize).

### `src/storage/tdtExport.ts` (1018) - barrel; ByteWriter decomposition
- `tdtExportTables.ts` - `KIND_TENANT`, `PART_STACKS`, `classFromRent`, `DOS_RESERVED`, `legacyFilename`, `OutTenant`.
- `tdtByteWriter.ts` - a `ByteWriter` class mirroring `ByteReader`, exposing positional back-patch for `setHdrU16`. **Own unit tests (Stage 0).**
- `tdtExportGather.ts` - room->OutTenant/paving gather pass producing named intermediate (`tenantsByTdt`, `extents`, `retailRows`, `header`, `peoplePop`, `ExportCounts`).
- `tdtEncoder.ts` - header/floor-map/people/retail/elevator/finance/parking/stairs/tail emission over `ByteWriter`.
- `tdtExportReport.ts` - `ExportReport`, report assembly, `fmtMoney`.
- Keep `tdtExport.ts`: `buildTDT` as thin gather->encode->report orchestrator; `BuiltLegacyTower`, `LegacyExportError` re-exports.
- **Guard:** `tdtExport.test.ts` (1028 - round-trip fidelity, ZERO-warning invariant, byte-identical re-export idempotence, header aggregate counts, shared-table tripwire).

---

## Stage 3 - engine friend-modules

Pattern: free functions in sibling files taking the instance; touched private fields relax to `internal` with `@internal`; barrel re-exports keep names; `deserialize` not churned.

### `src/engine/EconomySystem.ts` (527) - lightest; talks only via SimContext
- `economy/housekeeping.ts` - assignment map + `dispatchHousekeepers`/`onHousekeeperResult`/`spreadCockroaches`/`assignRoom`/`releaseAssignment`/`hkInFlight` (~130 lines, owns its own state).
- Keep `EconomySystem.ts`: rent/traffic/hotel/maintenance + re-export `HK_SHIFT_START/END`, `COMMERCIAL_LOBBY_FLOORS`, `TRAFFIC_FACTOR_MEAN`.
- **Guard:** `subsystems.test.ts`, `calendar`, `mealCadence`, `reviewFixes`.

### `src/engine/Crowd.ts` (1253) - barrel
- `crowd/person.ts` - `Person`/`PersonState`/`Route`/`SpawnFloors`/`ElevatorCalls` types + `visibleOccupants` + `CROWD_SECONDS_PER_MINUTE`/`EAT_SECONDS_*` consts.
- `crowd/meals.ts` - `MEAL_WINDOWS`, `mealWindowFor`, `staffOnShift`, `MEAL_MIX`, `matchesMealOriginKind`, `outboundWeight` (exported + tested).
- `crowd/routing.ts` - adjacency/BFS friend functions taking the `Crowd`.
- `crowd/motion.ts` - `step`/`advance`/`walkTo` physics friend functions (operate on shared `people[]`/`carRiders`).
- Keep `Crowd.ts`: class shell + spawn + re-exports.
- **Guard:** `crowd.test.ts`, `personRoundTrip`, `mealCadence`, `subsystems`.

### `src/engine/Tower.ts` (1419) - barrel; index maps stay on the class
- `towerTopology.ts` - free helpers `isStructural`, `isLobbyFloor`, `isSkyLobbyFloor`, `coversGroundFloor`, `NO_BASEMENT_KINDS`, message consts.
- `towerPlacement.ts` - validation + bridging friend functions (`capReason`, `roomPlacementReason`, `canPlace*`, `placeStructureRun`, `bridgeFillPlan`, `fillBridge`, `isSupported`).
- `towerTransport.ts` - transport CRUD + stops + resize friend functions.
- `towerRouting.ts` - `servedFloors`/`staffComponents`/`functionalParking*` friend functions (memoize per `revision`, keep sub-quadratic).
- Keep `Tower.ts`: class + eight index maps + `register`/`unregister`/`reindex` (the index cannot be severed) + re-exports.
- **Guard:** `tower.test.ts`, `subsystems`, `crowd`, `weatherEvents`, `calendar`, `mealCadence`, `reviewFixes`, `gameEvents`.

### `src/engine/Simulation.ts` (2891) - barrel; largest, last of engine
- `simConstants.ts` - noise/vacate/log/congestion constants + heatmap types (`HeatmapMode`, `HeatCell`, `congestionSeverity`, `CONGESTION_*`).
- `simSerialization.ts` - `serialize`/`deserialize`/`newGame` friend functions + `serializeUnit`/`coerceLog`/`coerceView` (~450 lines; reaches most private fields - friend module taking the sim; **do not reshape saved data**).
- `simRent.ts` - batch-rent types + `computeBatch`/`priceUnit`/`clampRent`/`storeRent`/`demandFactor`/`adjustRent`.
- `simSatisfaction.ts` - presence/satisfaction/noise/vacate churn cluster.
- `simCongestion.ts` - congestion/heatmap/elevator-util methods.
- Keep `Simulation.ts`: class shell, tick loop, build/place/sell, star/VIP, events facade, stats + re-export `Simulation`, `SAVE_VERSION`, `ECON`, `VACATE_RESCIND`, `TRANSPORT_FAR_TILES`, `HeatmapMode`, `HeatCell`, `LogEntry`, `BatchTarget`/`BatchRentOptions`/`BatchRentResult`, `congestionSeverity`, `CONGESTION_CHURN`, `CONGESTION_GRIDLOCK`, `LOG_SAVE_CAP`, `serializeUnit`.
- **Guard:** golden-master snapshot (CAP-1) + the ~40-file behavioral net (`simulation`, `parity`, `traffic`, `economyDepth`, `ledger`, `milestones`, `heatmap`, `personCensus`, `playthrough`, `storage`, ...).

---

## Stage 4 - shell

### `src/audio/ToneAudioEngine.ts` (831) - graph/sequencer slice
After Stage 1 pulled `scenes.ts`/`audioMath.ts`:
- `audio/graph.ts` - `start()` node-graph construction returning a node bundle.
- `audio/sequencer.ts` - `onStep`/`scheduleStep`/`maybeAccent`/`accentHit` friend functions over the node bundle.
- Keep `ToneAudioEngine.ts`: class holding the ~35 Tone node refs + `update`/`sfx`/`dispose`.

### `src/ui/UI.ts` (1331) - barrel; shared `el`/`cb`/`openModal` stay on class
- `ui/palette.ts` - `buildPalette`/`makeActivatable`/`toolButton`/`facilityButton` + `GROUPS`.
- `ui/panels.ts` - editor/inspector anchoring math + `anchorBeside`.
- `ui/log.ts` - `renderLog`/`logLine`/`resetLog`/`toast` + caps.
- `ui/modals/*.ts` - modal family as free functions taking a context (`{ el, cb, openModal, wireActions, closeModal, titleBarClose }`): `savesModal`, `newTowerModal`, `importExportModals`, `helpModal`, `settingsModal`, `eventChoiceModal`, `updateModals`, `stopsDialog`, `batchPricingDialog`. `openModal`/`closeModal`/`wireActions`/`titleBarClose`/`isModalOpen` stay on `UI` (shared `<dialog>` host).
- Keep `UI.ts`: class shell + `UICallbacks` interface + **re-export `patchVolatile` and `anchorBeside`** (tests import by name from `../ui/UI`). Preserve `renderEditor(key,build,volatile)` protocol exactly.
- **Guard:** `uiDialogs.test.ts`, `editorPatch.test.ts`, `anchor.test.ts`.

### `src/main.ts` (1471) - entrypoint; GameApp spine + game/ collaborators
Match the existing `src/game/` controller convention (collaborators get `() => this.sim` closures, never capture `sim` by value; preserve `adoptSim` swap invariant and `window.game` surface):
- `game/engineWiring.ts` - `wireEngine()` body (pointer/gesture routing, frame guard).
- `game/inputKeys.ts` - `bindKeys()` + audio-kick/pagehide.
- `game/frameLoop.ts` - `update()` + `emitMealRushes()` + catch-up.
- `game/buildPreview.ts` - `updateBuildPreview`/`updateBuildRefusal`/`clearBuildRefusal` + `placeSimpleBuild`/`isTransportTool`/`isPaintTool` (keep the `gameControllers.test.ts` mirror in sync).
- `game/panelAnchoring.ts` - `positionPanels`/`selectedScreenRect`.
- `game/updateFlow.ts` - PWA update quartet + resume-flag consts.
- `bootstrap.ts` - module-level `hasWebGL`/`showBootMessage`/`boot()`.
- Keep `main.ts`: `GameApp` class shell (fields, constructor wiring, `adoptSim`, selection helpers) + `export { GameApp }`.
- **Guard:** `gameControllers.test.ts`, `gameControllersCoverage.test.ts`, `bootScreen.test.ts`, `onboarding.test.ts`, e2e.

### `src/render/excalibur/TowerEngine.ts` (2429) - barrel; hardest
Pure extractions first, then `this`-coupled friend modules:
- `TowerEngine/heat.ts` - `HEATMAP_LABELS/MODES`, `HEAT_STOPS`, `heatColor` (pure, independently tested).
- `TowerEngine/skyDraw.ts` - `drawClouds/Cloud/Rain/Sun`, `skyColor`, event-fx renders as free functions taking `(ctx, params)`.
- `TowerEngine/util.ts` - `fakeStruct`, `mergeRuns`, `ScreenRect`, `buttonNum`.
- `TowerEngine/overlayDraw.ts` - `drawStatsMap`/`drawHeatLegend`/`drawGhostRect`/`strokeSelection`/`drawPreview`/`drawSelection`/`drawTransportSelection`/`drawRuler` as free functions taking `(ctx, d, ctxState)`.
- `TowerEngine/reconcile.ts` - retained-scene reconcile (friend module taking the engine; shares the Maps).
- `TowerEngine/motion.ts` - engine-driven motion (friend module; shares car/walker Maps).
- Keep `TowerEngine.ts`: class shell + `d: DrawCtx` + the shared Maps + baked gfx + `constructor`/`tick`/`start`/`setSim`/`dispose` + re-export `TowerEngine`, `ViewFocus`, `Picked`, `FLOOR`, `TILE`, `heatColor`, `HEAT_STOPS`, `HEATMAP_MODES`.
- **Guard:** `viewStateParity.test.ts`, `towerEngineMealOverlay.test.ts`, `heatColor.test.ts`, `gameControllers*`, visual baselines (pixel-identical - mechanical moves only, no local host capture is authoritative).

---

## Stage 5 - test-file splits

Move whole `describe` blocks verbatim into sibling spec files sharing the original's imports/fixtures. Assert vitest total test count is identical to the digit before and after each split. Empty the size-guard allowlist last.

Targets: `simulation.test.ts` (1651), `uiDialogs.test.ts` (1543), `gameControllersCoverage.test.ts` (1157), `tdtImport.test.ts` (1086), `tdtExport.test.ts` (1028), `storage.test.ts` (765), `faqComplete.test.ts` (587), `gameControllers.test.ts` (515), `tower.test.ts` (510), `calendar.test.ts` (503).
