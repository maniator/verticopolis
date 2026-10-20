# Architecture: the Rust engine, from port to host

Date: 2026-10-08. Status: planning, owner-directed. Companion to the native
client brief and its engine architecture draft in the private distribution
repository (`brief-native-client-2026-10-07/`), whose work list this document
updates now that the port exists.

## Where things stand

| Item from the engine architecture draft | State |
| --- | --- |
| 1. Conformance suite | Done (#854, widened by #861 and the scenario library's second slice). Nineteen scenarios, 518 checkpoints, pinned in `conformance/expected.json`, run in `npm test`; a loader table and a nightly differential fuzzer beside it. |
| 5. Rust core | Ported in full, Classic and Modern together (#857). `engine-rs/` replays every scenario and matches every checkpoint. CI runs the referee on every change to the crate, the scenarios or the fixtures. |
| 2. Saves keep what they do not understand | Not started. Applies to both engines now (see "Two engines, one simulation"). |
| 3. Core, Classic, Modern split | Deferred. The owner moved the port ahead of the split; the Rust crate keeps the TypeScript shape (one engine, a rule set chosen by mode). A split can still happen later, in both engines at once, behind the referee. |
| 4. Per-step cost (#846) | Open. Any fix lands in both engines in one PR. |

## Two engines, one simulation

Until the web game runs on the Rust engine, there are two implementations of
one simulation, and the only thing that keeps them one is the referee. The
binding rules live in CONTRIBUTING.md ("Two engines, one simulation"); the
summary here is for the reader of this plan:

- A simulation change lands in both engines in the same pull request, with
  the regenerated lock. CI fails either engine that disagrees with the lock.
- A pull request that changes `src/engine/` and not `engine-rs/` must state
  why (a UI readout, prose, a transient the hash never sees).
- The TypeScript engine stays the reference until the web game ships on
  WASM; after that it is frozen and retired on its own story.
- An engine pull request that adds a branch adds a scenario that reaches
  it. The referee's coverage map (the Rust job's `cargo llvm-cov` step, with a
  line floor that only ratchets up) is how review checks it.

## What the TypeScript tests pin, and where it goes

The TypeScript engine carries 360 tests in 32 files. Each one pins a claim
about the simulation, and every claim has to survive the retirement of
`src/engine/`. The mechanism is the lock, never a mirrored suite: two
hand-maintained suites drift apart silently, a hash cannot. Each test maps to
exactly one home, recorded in a checked-in table that a CI test keeps
complete:

- A conformance scenario, when the claim shows up in hashed state. This is
  most of them (housekeeping, churn, milestones, dispatch, economy), and it is
  the stronger form because it pins the numbers rather than a relation.
- A Rust unit test, when the claim is about a constant, a cap or a pure
  function (build caps, the 24-shaft pool, the rent ladder, the JavaScript
  number helpers).
- Dropped, with the reason recorded, when the test exercises TypeScript
  plumbing with no Rust counterpart.

The table is a gate for phase 3 and a precondition for phase 7.

## Phases ahead, each its own story

1. **WASM build and a JavaScript binding.** Compile `engine-rs` to
   `wasm32-unknown-unknown` with a narrow surface: new game, load, serialize,
   tick, the build and edit commands, and the read views the renderer needs.
   The binding is generated, never hand-written twice. Gate: the referee runs
   through the binding from Node and matches every checkpoint.
2. **Dual run in the browser.** The web game runs the TypeScript engine and,
   behind a developer flag, the WASM engine in a worker, hashing both at every
   hour boundary and reporting the first divergence in the console. Gate: a
   full day on each fixture save with no divergence, at the game's own step
   cadence and speeds.
3. **Switch the web game to WASM.** The renderer reads the WASM engine's views;
   the TypeScript engine stays as the reference behind the referee. Gate:
   every golden master, the e2e suite and the conformance suite pass, and
   the Modern speed profile is no slower than the TypeScript engine on the
   late-game fixture.
4. **Saves keep what they do not understand** (draft item 2), implemented in
   the Rust engine with the TypeScript writer matched for the hash.
5. **Threading evaluation.** See below. Gate: the referee still matches with
   threads on, on every scenario, across repeated runs.
6. **Godot spike** on the shared engine, per the brief's go/no-go gate, in its
   own private repository. The Godot client links the crate natively through
   GDExtension (the `gdext` Rust bindings for Godot 4); no WASM and no browser
   on Steam, Steam Deck or the desktop builds. Once that client exists, the
   Electron wrapper planned in the distribution repository has no job left.
7. **TDT in the crate.** The `.TDT` import and export (24 files under
   `src/storage/tdt*`, 20 tests) are engine-data work: bytes to the serialized
   game and back, with hashed seeds and table layouts that must be bit-exact.
   They move to a `tdt` crate beside the engine crate in one Cargo workspace
   (`tdt` depends on the engine crate, and the engine crate has no dependency
   on `tdt`), so the
   Godot client reads and writes 1994 towers natively and the web gets them
   through the same WASM binding. Same referee
   method: every TDT fixture round-trips to the TypeScript's serialized JSON,
   hashed into a lock the Rust must match.
8. **Retire the TypeScript engine**, one or two releases after the switch, once
   the test-mapping table above is complete and the fallback flag has gone
   unused. After that the lock is the Rust engine's own regression baseline.

Two consumers, one crate: the web PWA through WASM (phases 1 to 3) and the
Godot client through GDExtension (phase 6). Neither gates the other.

## Order and gates

The stories, in the order they run, each gated on the one before:

| # | Story | Gate to start | Gate to finish |
| --- | --- | --- | --- |
| 1 | `story-engine-scenario-library` | #857 merged | Done: floor at 87%, no engine module under 75%, fuzzer nightly, canon tests, #860 closed, CONTRIBUTING rule |
| 2 | `story-engine-wasm-binding` (phase 1) | 1 | Done: every scenario matches through the binding from Node, in CI |
| 3 | `story-engine-dual-run` (phase 2) | 2 | Done: a day on every fixture at each speed with no divergence, in CI; the browser run behind `?dualrun=1` |
| 4 | `story-engine-wasm-switch` (phase 3) | 3, plus the test-mapping table started | In progress: the game runs on the engine behind `?engine=wasm` with the read-model gate (every fixture, every hour) in CI; the e2e suite runs on both engines (specs that script the tower through test helpers still drive the instance; #878 moves them); left: golden masters, Modern profile no slower, the default flip. The flip is the headline milestone and ships as 3.0.0 (owner decision 2026-10-09); the flag alone bumps nothing. Order before the flip (party 2026-10-09): 4b, then the engine analytics events (#873) with the lock's events hash, then one release on the TypeScript default with the new instrument, then the flip, so the flip is the only thing that moves when the dashboards are read |
| 4b | `story-engine-test-parity` (#878) | 4 | The unit and integration suites run on the WASM engine in CI, the helper-scripted e2e specs move onto relayed commands, and the screenshot gallery and visual baselines render on the WASM engine with the drift gate as the pixel parity check; every test that stays TypeScript-only is named in the test-mapping table. Owner direction 2026-10-09: before 5 merges and before the flip in 7 |
| 5 | `story-engine-tdt-port` (phase 7) | 1 (can overlap 2 to 4; merges after 4b) | TDT lock matched both ways |
| 6 | `story-engine-copy-catalog` | any time after 1 | Engines emit ids, one catalog, save version bump |
| 7 | `story-engine-retire-typescript` (phase 8) | 4, 4b, #873, 5, 6, two releases on WASM, table complete | `src/engine/` gone, lock Rust-owned; internal (the major bump lands with the default flip in 4) |
| 8 | Godot spike (phase 6, private) | 1 | Brief's go/no-go gate |

Saves-keep-unknown-fields (phase 4) and the threading evaluation (phase 5)
are independent of this order and land where they are needed.

## Retiring the TypeScript engine: the inventory

> **Snapshot, counted 2026-10-20 on `main` at `e34dfdf`, with the open PRs
> read at their heads that day.** The figures and the PR list do not
> refresh. Each PR's live state is in the release matrix, #1104. Code that
> retirement has to remove and that this section does not list (anything
> merged or opened after this snapshot) goes in the retirement story's list
> (`story-engine-retire-typescript.md`, "What it removes"). Counts come
> from the TypeScript parser over the paths named (an import is type-only
> when it says `import type` or marks every name `type`); the commands at
> the end reproduce the import table.

Owner direction (2026-10-20): one authoritative Rust engine that any
frontend can build on, with no permanent copy of the gameplay rules in
TypeScript. #945 gates the 3.0.0 flip, which ships WASM as the default with
the TypeScript engine as a temporary fallback. Removing the fallback is row 7
of "Order and gates" above: its gates, then the owner's approval. Until then:

- While the fallback is supported, a simulation fix lands in both engines
  with the regenerated lock. The spine's inherited invariant runs this rule
  to row 7, while CONTRIBUTING (and "Two engines, one simulation" above) end
  it at the flip; #1112 settles the wording before the flip.
- A new gameplay feature lands in the TypeScript engine only with a stated
  compatibility reason, and its PR adds the TypeScript half to the story's
  list.
- New frontend code reads the catalog, the frame view or an engine query,
  and adds no runtime import of `src/engine/`.
- Host code that copies engine state into a `Simulation` is named as a
  transitional adapter in its PR and in the story's list.

### What retirement removes

| Area | Paths (non-test unless stated) | Why it exists today |
| --- | --- | --- |
| The TypeScript simulation | `src/engine/`: 92 source files (19,569 lines, the files under "What moves out first" included) and 40 test files (6,872 lines; 32 on 2026-10-08) | The fallback engine |
| Tests that drive it | 182 test files outside `src/engine/` import from it, 121 of them the `Simulation` class at runtime; 20 helpers in `src/tests/` import from it (17 at runtime), and the host fixtures `src/wasmhost/fakeEngine.fixture.ts` and `workerRig.fixture.ts`; `e2e/helpers.ts` and the specs that script the tower through `window.game`; the `ts` default of `VC_SHOT_ENGINE` in the screenshot builders | Each test maps first to a conformance scenario, a Rust test, an engine-hosted or data fixture, or a recorded drop. The table described above covers `src/engine/`; AC4 of `story-engine-test-parity.md` lists only the files that stay TypeScript-only, so most of the rest have no row yet. The WASM-leg conformance helpers and `viewWorldSetup.ts` (the `unit` and `integration` setup file) stay, repointed at the engine's catalog |
| The two-engine harness | the `unitWasm` and `integrationWasm` projects and their `typescriptSide` list (`vite.config.ts`), `test:wasm:parity`, `test.yml`'s project matrix and the `dualRun` filter in `test:wasm`; `src/tests/parity/` (its ratchet names 17 test files); the dual run (`dualRun.ts`, `dualRunAbsent.ts`, `worker.ts`, `ShadowEngine`'s checkpoint op and `compare`, `Divergence`, `src/tests/dualrun/`, `dualRunDay`, `dualRunEdits`); the conformance runner's TypeScript adapters (`scenario.ts`'s `startTsEngine` default and its `facilitiesData` import, `tsCharges`, `tsCheckpointDetail`, the `econConfig` and `catalog` imports in `wasmEngine.ts` and the WASM conformance test); `scripts/fuzz-compare.ts` and its nightly, `engine-fuzz.yml`; the TypeScript conformance step in `test.yml` and its guard, `conformanceCi.guard.test.ts` (#1102); the TypeScript legs of `perf:compare` and `perf:worker`; `hourCost.bench` with `engine-bench.yml` and `scripts/loader-case-dump.ts`, which are TypeScript only; the `chromium-wasm` e2e project and its `PW_WASM_VISUAL` baseline workaround (`chromium` runs the default engine and keeps minting the visual baselines) | They prove the two engines agree, or measure one against the other |
| The read-model merge | `src/wasmhost/merge.ts`, `frameApply.ts`, `personFields.ts`, `telemetry.ts`, `workerApply.ts`, the merge half of `wasmHost.ts` and `workerHost.ts`, and `refuseForeignCatalog` in `wasmHost.ts`, which checks the binding's catalog against the TypeScript tables | The UI, renderer, audio and analytics read `app.sim`, a TypeScript `Simulation` the host refreshes from the engine (AD-4) |
| The instance-first relay | `src/dualrun/mirror.ts` (`relayCommands`, `attachMirror`, `loadCommand`) | Each command runs on the instance first and is relayed; #954 (S9, AD-1) has the engine answer first, and the instance mirrors accepted commands until S6 (#868) |
| The engine switch and the fallback | `ts` in `engineChoice.ts` (`wasm`, `wasm-frame` and `wasm-worker` stay); `typescriptBoot` in `engineBoot.ts` and `bootstrap.ts`; `engineLabel.ts`'s `ts`; the switchable mode in `src/build/engineBundle.ts` and the `engineAliases` in `vite.config.ts`; `stepLoopAbsent.ts`; `scripts/engine-bundle.allow.txt` (86 modules), its guard and `test.yml`'s step-loop canary; `VC_ALLOW_NO_ENGINE` (a TypeScript-only build) in CI, the setup steps and the docs | 3.0.0's fallback (AD-7) |
| Relay and seed exports | AD-3's tier 3 in `src/dualrun/exportTiers.ts` (`setMoney`, `setCars`, `resizeTransport`, the `tower*` pair, `removeUnit`, `removeTransport`, `advanceClock`, `startFire`, `bombThreat`, `evaluateStar`, the two seeds) | They replay the instance's state into the engine; AD-3 takes them out of the production binding (or behind a cargo feature) by retirement |
| TypeScript codecs of engine data | `src/storage/tdt*` (21 files; `src/game/saveLoad.ts` calls `parseTDT` and `buildTDT`); `Simulation.deserialize`, `saveMigration.ts` and `migrations/` on the load path (`src/storage/SaveGame.ts`, `saveLoad.ts`) and the undo path (`src/main.ts`) | The crate has `engine-rs/src/tdt/` and the migrations and founder mark in `load.rs`; the web still calls the TypeScript copies (AD-8, #1066, `story-engine-tdt-port`) |

### What moves out of `src/engine/` first

These are not simulation, and code that stays imports them:

- **Types** from `types.ts`, `catalogTypes.ts`, `serializedGame.ts`,
  `gameplayEvents.d.ts` and the parts of `calendar.ts` and
  `elevatorSchedule.ts` they import, plus the types other modules hand the
  UI (`PriceRung`, `HeatmapMode`, the batch-pricing types, `SchedulePreset`,
  `Person`, the TDT import and export reports). 31 non-test files import the
  `Simulation` class only as a type; the 25 of them that stay need a
  read-model type in its place (AD-4). The rules in `types.ts`
  (`isOperational`, `isPresent`, `isTenanted`, `VACATE_REASON_TEXT`) become
  engine queries under #868 instead of moving.
- **The event catalog code:** `gameplayCatalog.ts` (the catalog's shape and
  checks) and the files generated from `conformance/events/catalog.json`,
  `gameplayEvents.d.ts` and `gameplayEventRules.ts` (the analytics event
  schema, with no simulation logic). Their writers (`scripts/wasm-build.ts`,
  `npm run gen:events`), their reader (`src/analyticsEngineBridge.ts`) and
  the CI paths that name them (the cache key in
  `.github/actions/engine-wasm/action.yml`, the drift check in
  `engine-rs.yml`) move with them.
- **Host helpers:** `UndoHistory.ts` (`src/main.ts`), `towerCatalog.ts` and
  the lookups in `catalogTypes.ts` (`catalogFacility`, `catalogBuildKind`:
  the catalog handle, minus its TypeScript tables), `wellFormed.ts` (save
  compression and `uiCallbacks.ts`), `canonicalJson.ts` (conformance
  tooling).

The step driver (`sim/fixedStep.ts`, `timePacing.ts`) goes once #867 (S8,
AD-2) ports it into the crate.

### What stays in the browser

Each frontend writes its own version of these:

- **The host:** `src/wasmhost/` minus the merge (boot, package load and
  identity, `startWasmHost.ts`, `frameView.ts`, `engineEvents.ts`,
  `stepGate.ts`, the experimental worker host); the binding's surface in
  `src/dualrun/` (`binding.ts`, `engine.d.ts`, `exportTiers.ts`,
  `catalog.ts`, `ShadowEngine`'s `apply`, the one wrapper that applies
  commands to the engine, and the `ShadowCommand` vocabulary in
  `commands.ts`, which the worker protocol speaks); `src/bootstrap.ts`,
  edited.
- **Rendering, UI and input:** `src/render/`, `src/ui/`, `src/game/`,
  `src/presentation/`, `src/audio/`, `src/styles/`, plus the public gallery
  and preview pages (`src/gallery.ts`, `src/preview.ts`), which read the
  facility tables today.
- **PWA and package integrity:** `src/pwa*.ts`, `src/precacheEntry.ts`,
  `src/build/` (edited), `scripts/verify-precache.ts`, the engine package
  check (#985).
- **Save I/O:** slots, compression, preferences and the `.vctower`
  container in `src/storage/`. `vctowerWriter.ts` keeps its fflate writer
  for when the engine's writer throws and for saves past
  `ENGINE_WRITER_MAX_BYTES`.
- **Analytics and diagnostics:** `src/analytics*.ts` and `src/telemetry.ts`.
  The engine kinds `ts` and `ts-fallback` in `analyticsEngineStatus.ts` are
  governed values, so dropping them is a data-map change.

### How far `src/ui`, `src/game` and `src/render` reach into the engine

Non-test files that import `src/engine/` (a module's figure counts the files
that import it at all):

| Directory | Files importing the engine | With a runtime import | Most imported |
| --- | --- | --- | --- |
| `src/ui` | 17 of 49 | 9 | `types` 11, `Simulation` 9, `catalogTypes` 8 |
| `src/game` | 19 of 28 | 16 | `Simulation` 13, `towerCatalog` 12, `catalogTypes` 9 |
| `src/render` | 46 of 91 | 31 | `types` 41, `Crowd` 13, `facilities` 12 |
| The three | 82 of 168 | 56 | |

Outside these three, `src/main.ts`, `src/gallery.ts`, `src/preview.ts` and
`src/analyticsEngineBridge.ts` import it at runtime, and `src/presentation/`
and `src/audio/` by type only. The tables above cover `src/storage/`,
`src/wasmhost/` and `src/dualrun/`.

The runtime imports, by kind:

1. **What moves out first:** the catalog handle and its lookups
   (`towerCatalog`, `catalogTypes`), the most common, plus `wellFormed` and
   the view constants in `types.ts` (`VIEW_ZOOM_MIN`, `VIEW_ZOOM_MAX`).
2. **Rule tables and reference data:** `facilities`, `gameRules`,
   `residentialRentals`, `retailSubtypes`, `households` and `catalog`,
   which #921 and #926 move to the engine's catalog; the `Ledger` copy,
   which #868's row lists; `elevatorSchedule`'s hours and `sim/charges`'
   refusal text, which no row names yet.
3. **Gameplay rules evaluated on the read model:** `sim/gripe`,
   `sim/satisfactionStep`, `scheduleAuthoring`, `scheduleOrigins` and the
   rules in `types.ts`, which #868's backlog row lists as engine queries;
   `EconomySystem`, `economy/housekeeping`, `sim/constants`, `traffic` and
   the `Simulation` constants in `facilityDiagnostics.ts`, which #926's row
   lists as catalog values. The inspector's gripe lines
   (`src/game/gripeCopy.ts`, `facilityDiagnostics.ts`) and the elevator
   schedule dialog run them on the merged instance, so while hosted they can
   disagree with the engine's own decision, which AD-4 forbids.
4. **The instance itself:** `Simulation` in `src/main.ts` and
   `src/game/saveLoad.ts`, the step driver in `src/game/frameLoop.ts`
   (#867), and `visibleOccupants` in 11 renderer files (#831 routes seven of
   them through one shared helper, `pixelSprites/common.ts`, leaving 5).

### Before the removal

Beyond row 7's own gates (rows 4, 4b and 5, #873, row 6, two releases on
WASM, the test-mapping table):

- **Locks:** give each lock a Rust writer (the story's AC1). TypeScript
  writes all four today (`expected.json`, `loader-cases.json`,
  `catalog-digests.json`, `tdt-cases.json`, through
  `VC_CONFORMANCE_UPDATE=1`).
- **Frontend reads:** land #921 and #926, #868's engine queries and #867's
  step driver, and give the schedule hours and the refusal text a home, so
  no staying file imports `src/engine/` at runtime.
- **Load paths:** boot TDT import, every save load and undo from the crate
  (AD-8, #1066).
- **Migrations:** add a test that the crate's `migrate_save` handles every
  save version the TypeScript migrations do (v1 to v7).
- **Types:** add a test that pins the moved types to what the binding sends.
- **Conformance:** strip the runner's TypeScript adapters (above). WASM
  conformance runs in `engine-rs.yml` and stays.
- **Benchmarks:** decide whether a Rust bench replaces `hourCost.bench`.
- **Coverage:** re-baseline the global floors in `vite.config.ts` once
  `src/engine/` leaves `src/`.
- **The stored choice:** make a stored `vc.engine = "ts"` and old
  `?engine=ts` links fall back to the default.
- **Tooling and docs that name `src/engine/`:** the guard tests that read
  the directory (`engineAnalyticsFree`, `engineLocale`),
  `src/tests/conformance/fuzzKey.ts`, the `src/engine` line in
  `fileSize.ratchet.txt`, `engine-rs.yml`'s `src/engine/**` path filter,
  `load.rs`'s pointer to `loader-case-dump.ts`, and the docs, CLAUDE.md's
  canon among them (build caps in `src/engine/facilities.ts`).
- **The real-game oracle scripts in `tools/simtower/`:** four build a
  TypeScript `Simulation`, and both converters call the TypeScript TDT codec
  (`tdt-to-vctower.ts` uses `parseTDT`, `buildTDT` and `SAVE_VERSION`,
  `vctower-to-tdt.ts` uses `buildTDT`). They sit outside the typecheck, so
  nothing fails when the engine goes. Repoint them at a crate surface that
  converts any file, such as the binding's `importTdt` and `exportTdt`
  (`engine-rs/src/bin/tdt.rs` only replays `conformance/tdt-cases.json`), or
  retire them.

### Open and planned work that adds temporary code

Written as PR (issue). Retirement removes these parts; the rest of each PR
stays.

- **#1092 (#902):** the TypeScript half (`Simulation.ts`, `sim/coerce.ts`,
  `sim/serialization.ts`, `sim/services.ts`, their test), the booking field
  in `src/wasmhost/merge.ts`, the parity setup edits, and the two-engine
  `wasmHostExtermination` test with its `typescriptSide` entry. The Rust
  fix, the `exterminationRoomIds` save field, the conformance scenario and
  the loader cases stay.
- **#1101 (#874, with #1083):** the TypeScript re-adoption of a faulted
  tower: the restore points (validated with `Simulation.deserialize`) but
  `newestSave`, `carryLiveState`, the held-event bookkeeping, the recovery
  and its player lines, the undo trail's tidy and redo hold, the analytics
  bridge's `release` option, the restore-point benchmark and the
  fallback-only tests (each listed in `story-engine-retire-typescript.md`).
  The fault catching, the latch, the strict stop, `newestSave` without its
  TypeScript load check (the newest engine-written save) and the status
  fields stay, as do the commute rows in the load markers. After retirement
  a trap can only stop the game, as the wasm-only build does, unless a later
  change restarts a fresh engine from the newest engine save. The worker's
  restore is #1105.
- **#954 (S9), planned:** the instance mirroring each accepted command
  until S6, and the checks against it: the report of a command the
  instance accepted and the engine refused (S4's third clause, moved here
  from #874), #1064's dry check and #1065's header comparison.
- **#1068 (#1045), held:** the TypeScript record split
  (`src/engine/sim/deserializeRecords.ts`, with its allow-list line) and the
  delta merge into the instance (`merge.ts`, `workerApply.ts`,
  `workerSaveSync.ts`, and their delta tests). The Rust `saveDelta` stays if
  S6 picks design A (the engine-side "changed since last sent",
  `docs/architecture/read-model-deltas.md`).
- **#868 (S6), planned:** nothing, if its getters return data the UI reads
  directly; anything that merges them into a `Simulation` is temporary.
- **#1108:** `perf:compare --aa ts`. The A/A mode itself and `--aa wasm`
  stay, to calibrate the pass rule after retirement.
- **#985 slice 2, planned:** a refused package falls back to TypeScript in
  a switchable build; after retirement it stops the game, as wasm-only does.
- **#1085, remaining slices, planned:** the TypeScript side of the seeded
  differential. The failing-seed corpus and the WASM leg could stay by
  comparing the WASM build with the native one.
- **#926, planned:** it moves the UI's reads to the catalog, which removes
  frontend imports. Each item also lands in the TypeScript engine so the
  fallback quotes the same catalog (`conformance/catalog-digests.json`), and
  those copies go.

#1100, #1103, #817, #831 and #1039 add no other runtime frontend import of
`src/engine/` (#831's one import in `pixelSprites/common.ts` replaces
seven). Three of their tests import `FACILITIES` or `subtypeListFor` and
join the tests above: #817's existing `serviceScale.test.ts`, and the new
`roomOccupants.test.ts` (#831) and `originSeeds.test.ts` (#1039).

Re-count the import table (shown for `src/ui`; repeat for `src/game` and
`src/render`). The grep reads one line at a time; at `e34dfdf` it matches
the parser.

```sh
grep -rlE 'from "(\.\./)+engine/' src/ui --include='*.ts' | grep -vE '\.(test|fixture)\.ts$' | wc -l
grep -rE 'from "(\.\./)+engine/' src/ui --include='*.ts' | grep -vE '\.(test|fixture)\.ts:' \
  | grep -vE ':(import|export) type |:import \{ *type [^,}]+( *, *type [^,}]+)* *\} from' \
  | cut -d: -f1 | sort -u | wc -l
find src/ui -name '*.ts' ! -name '*.test.ts' ! -name '*.fixture.ts' | wc -l
```

## Threading

The simulation step is sequential by contract: three random streams are drawn
in a fixed order and every floating-point operation has a fixed order, and the
hash depends on both. Threads inside a step are only admissible where a pass
reads state and writes nothing the rest of the step reads, and where the
merged result is independent of thread timing. Candidates, in the order they
would be tried:

- Scenario replay in the referee (done: one thread per scenario).
- The engine on its own thread, with the host reading snapshots (phase 2).
- Read-only passes inside a step: the per-floor reachability probes, the
  demand map, the satisfaction context. Each one must be proven draw-free and
  order-free before it fans out.

The conformance suite is the regression net for all of it: a threading
mistake shows up as a named checkpoint rather than a slow drift.

## Positioning (owner direction, 2026-10-09)

The engine is open source and renderer-neutral by design: the conformance
suite, the WASM binding and the switch make it a simulation anyone can build
their own front end on, in any application, with the lock proving a
frontend's engine is the real one. That is a headline for the next public
announcement (the subreddit posts included): the web game is one front end
on an open engine, and anyone can build another. Public copy says that and
no more; which front ends the owner builds is not part of the pitch.

## Repository placement

The Rust engine is public, in `maniator/verticopolis` beside the TypeScript
engine, because the private rule for a native client is that it runs the one
public engine package and passes the public conformance suite. Steam,
identity, packaging and store code stay in the private repository.
