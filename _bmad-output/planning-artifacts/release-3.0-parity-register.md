# Release 3.0 feature parity register (#1561)

> **Snapshot, audited 2026-11-04 against `main` at `837575f` with #1780's
> changes on top, trued up on `d7bc12c` (app 2.84.0, engine crate 1.19.0),
> and re-audited on 2026-11-11 against the release candidate's code, `main`
> at `5ab3ad9d` (app 2.90.0, engine crate 1.23.0). Not live.** The live
> state is #1561 and the guards this page names.
> `src/tests/parityRegister.guard.test.ts` keeps parts of it tied to
> the code: every `EnginePort` member has a row in section 3, every file on
> `src/tests/frontendEngineImports.ratchet.txt` has a row in section 2a, every
> host or save file that imports the TypeScript engine at run time is named in
> section 2c, every `proven same` row cites a test, a scenario, or a section
> and another row that does,
> and every path, scenario, link and exception named here exists. A new
> engine member, or a new file that imports the TypeScript engine at run
> time, fails CI until the register names it; a new import added to a file
> already listed does not, so section 2 is re-read by hand at each audit.

## How to read it

**Scope.** The features players had on the TypeScript engine against the
game that ships today, which runs only the Rust/WASM engine (app 2.66.0 and
later). Parity with the original 1994 SimTower (Classic rules, `.TDT`
fidelity) is a separate question (#920 and #740, both closed, and the open
Classic rules issues); it appears here only where a row depends on it.

**Class.** Each row has exactly one:

- **proven same**: a test runs the feature on the real Rust/WASM engine and
  checks it against the TypeScript reference's answer, live (`describeEngines`,
  `tsEngine.golden`) or pinned from it (the card-text sweep's golden, which its
  referee holds to the reference live). For host and UI
  behavior that has no engine answer to compare (a save prompt, an error
  screen), a test on the Rust build checks the behavior players had. The
  `.TDT` codec is the third case: the TypeScript port has no copy of it and
  borrows a short-lived Rust engine for each file (`src/engine/port/tdtCodec.ts`),
  so players' `.TDT` behavior was Rust's on either engine, and its reference
  is the real 1997 saves and the round trip.
- **known divergence**: the two differ, or the TypeScript side still decides
  something the engine should. The row names the issue that removes it or the
  exception entry that would accept it.
- **intentionally different (approved)**: the owner chose the new behavior;
  the row names where.
- **untested**: the feature works on Rust as far as anyone knows, but no test
  runs its main behavior on the Rust/WASM engine against the reference (a
  refusal-only or native-only test leaves a row here).
- **retired**: the feature is gone on purpose, and the row names the decision.

A blank cell never counts as a pass.

**Evidence.** Test files run in these CI jobs: `test-wasm-parity
(integrationWasm)`, which runs `npm run test:wasm` (the suites that start the
Rust engine themselves, with `VC_REQUIRE_WASM=1`, so a missing engine package
fails instead of skipping), and `(unitWasm)`, which runs the unit tests with
the package required; `e2e` (Playwright on the Rust engine), the `engine-rs`
workflow (native Rust tests, clippy, fmt) and the build job's
`verify-engine-bundle` step. Until #1421 the two `test-wasm-parity` legs also
ran the unit and integration suites with every `Simulation` hosted on the Rust
engine. #878 and #1421 are closed, and #878's test-mapping table
(`_bmad-output/implementation-artifacts/story-engine-test-parity.md`) records
where each of those suites' Rust evidence lives now.
"Browser" means a Playwright spec; "native" means a Rust `#[test]`.

**Fields.** #1561 lists the fields an entry records. Here they sit as
follows, so that no row repeats a fact the section already states: the
player-facing consumer is the section (the hover card and the mobile editor
in section 1, the engine reads in section 3, and so on); the Rust source, and
so whether a result is calculated in Rust or only rendered in TypeScript, is
section 1's Rust source column, section 2 for what TypeScript still runs, and
section 3 for each engine member; the modes are a column where they differ
and section 6 otherwise; the edge states are the sweep's cases, named in
section 1's intro; native, WASM, browser and real-save coverage are labeled
inside the Evidence cell, and the CI jobs are the ones listed above;
screenshots are not parity evidence here, since the gallery renders the Rust
build only and checks drift against itself. The user impact is the row
itself and its class. Section 2's tables carry an Owner column, and a
section 8 row names the issue, lane or exception that handles it; the
priority is that issue's P label.

**Exceptions.** An `EX-n` names an entry in
[`release-3.0-exception-register.md`](release-3.0-exception-register.md). An
entry stays proposed until the owner approves it at the #945 sign-off.

## 1. Inspector and editor diagnostics

The lines on the desktop hover card and the mobile editor's folded-in block.
The facts come from the engine (`unitFacts`, `serviceDiagnostics`,
`shaftCard`, the recycling reads); TypeScript picks the words and colors in
`src/ui/tenantDiagnosticCopy.ts`, `src/game/portUnitDiagnostics.ts`,
`src/game/portServiceDiagnostics.ts` and `src/game/recyclingDiagnostics.ts`,
which the test-only TypeScript reference card (`src/tests/diagnostics/facilityDiagnostics.ts`) shares
for every line except its own facts, so a difference shows up as a fact.
The shipped card is port-only (`src/game/cardKit.ts` and `src/game/cardLines.ts`)
and never imports this reference. The
card-text sweep (`src/tests/integration/cardTextParity.integration.test.ts`)
holds the Rust card's lines for every room and shaft of 19 tower cases per
mode, in both modes and in card order, to a committed golden of the
reference card's lines (`src/tests/goldens/card-text/`, since #1809), which
a TypeScript referee held to the TypeScript card until #1875. The cases are service
rooms, retail venues (also on a rainy day), lobby distance, every kind a
slab tower takes (all but the basement kinds and the wedding hall) in each
of seven states, the winning tower, some of them made unhappy (at a top
rent, so the gripe line has a cause to name where no worse cause, such as
crowded elevators, comes first), every transport kind over
occupied offices, a crowded lift, and a recycling center on notice and one
over capacity. Each engine loads the same save: the sweep reads the
committed tower file, and the referee loads the save it builds and checks
that the save packs to that file byte for byte. A save holds no elevator readings, so both engines play the same minutes
before the cards are read: a morning for every transport kind, and a day
and a half for a single-car lift until it passes the near-capacity line.
Each suite starts its engine itself: the sweep runs in `npm run test:wasm`
and the referee in the plain integration run. A row
that names other evidence covers a state the sweep's towers do not reach.

| Line | TypeScript reference | Rust source | Modes | Class | Evidence |
| --- | --- | --- | --- | --- | --- |
| Access (not connected, cut off, no route, reachable) | `src/tests/diagnostics/facilityDiagnostics.ts` `accessLine` | `engine-rs/src/diagnostics/tenant.rs` (`unitFacts.access`) | both | proven same | `src/tests/integration/cardTextParity.integration.test.ts`, `src/tests/integration/conformanceWasmDiagnostics.integration.test.ts`, browser `e2e/mobileGestures.spec.ts` (390px editor) |
| No Rate (occupied, off the market) | `src/tests/diagnostics/facilityDiagnostics.ts` No Rate branch | `engine-rs/src/diagnostics/tenant.rs` (`noRate`) | Classic only (Modern never holds the state; both engines drop it on load) | proven same | `src/tests/integration/conformanceWasmDiagnostics.integration.test.ts` (the corpus reaches the occupied case), `src/game/portUnitDiagnostics.test.ts` (the off-the-market copy), browser `e2e/tenantDiagnostics.spec.ts` (desktop and 390px) |
| Hotel counts toward stars | `hotelRatingLines(sim.hotelsCountTowardRating())` | `engine-rs/src/diagnostics/service.rs` (`hotel.rating`) | both | proven same | `src/tests/integration/portServiceDiagnostics.integration.test.ts`, browser `e2e/serviceDiagnostics.spec.ts` |
| Hotel dirty and infested, exterminator advice | `src/tests/diagnostics/housekeepingDiagnostics.ts` `hotelInfestationLines` | `engine-rs/src/diagnostics/service.rs` (`hotel.condition`) | both (exterminator Modern) | proven same | `src/tests/integration/portServiceDiagnostics.integration.test.ts`, browser `e2e/serviceDiagnostics.spec.ts` (desktop and 390px) |
| Housekeeping coverage and shortfall | `src/tests/diagnostics/housekeepingDiagnostics.ts` `housekeepingCoverageLines` | `engine-rs/src/diagnostics/service.rs` (`housekeeping`) | both | proven same | `src/tests/integration/portServiceDiagnostics.integration.test.ts`, browser `e2e/serviceDiagnostics.spec.ts` (390px) |
| Parking ramp access and demand | `src/tests/diagnostics/facilityDiagnostics.ts` parking branch | `engine-rs/src/diagnostics/service.rs` (`parking`) | both | proven same | `src/tests/integration/portServiceDiagnostics.integration.test.ts`, browser `e2e/serviceDiagnostics.spec.ts` |
| Long walk to transport (W1) | `src/tests/diagnostics/facilityDiagnostics.ts` W1 branch | `engine-rs/src/diagnostics/tenant.rs` (`farWalk`) | both | proven same | `src/tests/integration/conformanceWasmDiagnostics.integration.test.ts`; no browser test |
| Shoppers too far from a lobby (W3) | `commercialLobbyLines` | `engine-rs/src/diagnostics/service.rs` (`commercial.lobbyFar`) | both | proven same | `src/tests/integration/cardTextParity.integration.test.ts` (asserts the far shop's line), browser `e2e/tenantDiagnostics.spec.ts` (desktop and 390px) |
| Too far from any lobby, with the buildable slot | `lobbyWarningCopy` and `nearestBuildableLobbySlot` | `engine-rs/src/diagnostics/tenant.rs` (`lobby`, `slot`) | Modern names the distance, Classic the band | proven same | `src/tests/integration/conformanceWasmDiagnostics.integration.test.ts`, `src/tests/integration/conformanceWasmDiagnosticsTowers.integration.test.ts`; no browser test |
| Recycling fill and capacity | `recyclingLines(sim)` | `recyclingFill`, `recyclingCapacity`, `recyclingDemandMet` (answered from a census tally kept up from the mark log, `engine-rs/src/view/tally.rs`: a read takes the rooms the setters marked since the last one, compares every room when the marks reach half the rooms or the log dropped some, and counts afresh after an edit or a load) | both | proven same | `src/tests/integration/cardTextParity.integration.test.ts` (asserts the winning tower's centers within capacity and filling, and one center over capacity), `src/tests/integration/cardVerdicts.integration.test.ts`; native `engine-rs/src/view/tally_tests.rs` (each way through a read), `engine-rs/src/wasm_port_recycling_tests.rs` (the setters, an edit, a bulldoze with its undo and redo, and a load), `engine-rs/src/view/oracle_tests.rs` (the tally against a fresh count after every step of the seeded sessions); no browser test |
| Main gripe (the canary) | `dominantGripe` and `gripeLineText` | `engine-rs/src/diagnostics/tenant.rs` (`gripe`: cause, binding, coverage) | both | proven same | `src/tests/integration/cardTextParity.integration.test.ts`, `src/tests/integration/conformanceWasmDiagnostics.integration.test.ts` (six causes over the corpus), `src/tests/integration/tsEngine.golden.integration.test.ts` (a real saved tower), native `engine-rs/src/diagnostics/tenant_tests.rs`, browser `e2e/tenantDiagnostics.spec.ts` (desktop and 390px) |
| Won't lease, with the monthly carry | `wontLeaseText` | `engine-rs/src/diagnostics/tenant.rs` (`wontLease`) | both | proven same | `src/tests/integration/conformanceWasmDiagnostics.integration.test.ts`, `src/tests/integration/conformanceWasmDiagnosticsTowers.integration.test.ts`, browser `e2e/tenantDiagnostics.spec.ts` (an imported tower, desktop and 390px) |
| Giving notice, countdown and recovery bar (relocation in Modern) | `noticeCopy` | `engine-rs/src/diagnostics/tenant.rs` (`notice`) | both | proven same | `src/tests/integration/cardTextParity.integration.test.ts` (every kind on notice), `src/tests/integration/conformanceWasmDiagnostics.integration.test.ts` (six reasons), browser `e2e/tenantDiagnostics.spec.ts` (an office on notice, desktop and 390px) |
| Retail patronage, verdict, profit, rain, local demand, Modern advice | `retailStatsLines` | `engine-rs/src/diagnostics/service.rs` (`retail`) | both (advice Modern only) | proven same | `src/tests/integration/portServiceDiagnostics.integration.test.ts`, `src/tests/integration/cardTextParity.integration.test.ts` (the rainy-day case asserts the rain line), browser `e2e/serviceDiagnostics.spec.ts` (desktop and 390px) |
| Line order on the card | `src/tests/diagnostics/facilityDiagnostics.ts` card order | not a fact: `SupplementalLines` in `src/game/portUnitDiagnostics.ts` | both | proven same | `src/tests/integration/cardTextParity.integration.test.ts` (in card order since #1778, which fixed a venue's business block printing above its notice), `src/game/portUnitDiagnostics.test.ts` |
| Line order for a recycling center on notice | the recycling block above the notice | not a fact: `joinParts` in `src/game/portUnitDiagnostics.ts` puts the block between the card's two halves, from `src/game/cardKit.ts` | both | proven same | `src/tests/integration/cardTextParity.integration.test.ts` (a center on notice, from a save, since #1780 fixed the block printing below the notice; only a hand-edited save can put a recycling center on notice), `src/game/portUnitDiagnostics.test.ts` |
| Elevator average load and near-capacity advice, including no line before the first hourly reading | `transportDiagnostics` | `shaftCard.utilization`, `shaftCard.nearCapacity` | both | proven same | `src/tests/integration/cardTextParity.integration.test.ts` (asserts a measured load and the near-capacity advice), `src/tests/integration/tsEngine.golden.integration.test.ts` (`shaftCard`), native `engine-rs/src/wasm_port_panels_tests.rs` (the cutoff), browser `e2e/serviceDiagnostics.spec.ts` (Modern, desktop and 390px) |
| Mobile editor's "Elevator access" row | `hasAccessDiagnostic(catalog, unit)` with `served` and `reachable` | the port's catalog and `unitCard` | both | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` (`unitCard`, both modes: the `served` and `reachable` fields the row reads), browser `e2e/tenantDiagnostics.spec.ts` (Classic at 390px: a served and an unserved security office, each row against the reference's served floor, and no row for an office, whose diagnostics carry the access line), `src/ui/templates/editor.test.ts` (the three answers, on the TypeScript port) |

What TypeScript still decides on these cards, all presentation over engine
facts: which line a fact maps to, its words, color and place on the card; the recycling block's
gate on a Rust-reported state (`INERT_STATES` in `src/game/cardKit.ts`, which
`src/game/cardKit.test.ts` pins to both engines' predicates: the TypeScript
reference's `isOperational`, and the three states the engine's `is_operational`
in `engine-rs/src/tower_query_state.rs` names); and whether the
mobile editor shows its plain access row (`hasAccessDiagnostic`, read off the
port's catalog). None of them grades a tenant or a venue.

## 2. TypeScript left in the shipped game

### 2a. Frontend runtime imports of the TypeScript engine

One row per file on `src/tests/frontendEngineImports.ratchet.txt`. The
**Disposition** column uses its own words: `keep (presentation)`, `move to
Rust`, `delete with the TypeScript engine`, or `tooling only`.
`src/game/appHistory.ts` left the list with #1754, which moved undo and redo
into the engine: it now only drives the port's undo members. With #921 the
catalog handle (`src/catalog/towerCatalog.ts`) lost its TypeScript default
(tests and the tooling tower set the tables themselves), the room preview
(`src/preview.ts`) reads the engine's catalog as the sprite gallery does, and
the TypeScript panel adapter moved to `src/tests/conformance/tsPanels.ts`. An
ESLint rule (`eslint.config.js`) now refuses a runtime import of the engine in
any shipped file, so the files left are tooling. The sprite atlas bake
(`src/render/atlas/archive.ts`, `src/render/atlas/browserEntry.ts`) left the list in #1875's
catalog step: it reads the engine's own catalog from the engine package. The harnesses'
tower (`src/game/toolingSim.ts`) left it in #1875's tooling step: `game.sim`
is now a view over the app's Rust engine (`src/game/toolingTower.ts`), so the
ratchet is empty and the table has no rows.

| File | Runs in the shipped game | Decides gameplay | Disposition | Owner |
| --- | --- | --- | --- | --- |

### 2b. The shipped bundle

`scripts/verify-engine-bundle.ts` reads every emitted sourcemap after each
build. No build carries a `src/engine/` module: production has not since #921,
and a `VC_TOOLING=1` build has not since #1875's tooling step, which put the
harnesses' tower (`src/game/toolingSim.ts`, `src/game/toolingTower.ts`) on the
app's Rust engine. `scripts/engine-bundle.allow.txt` lists nothing, and the
guard fails a build of either kind that carries any engine module. The step
loop (`src/engine/sim/loop.ts`) is absent from both, and the CI step "The
bundle guard catches a TypeScript step loop import" (`.github/workflows/test.yml`)
proves the check would catch it.

### 2c. Host and save code

The import ratchet leaves out `src/wasmhost/`, `src/dualrun/` and
`src/storage/`. Since #921 no file there imports the TypeScript engine at run
time: the boot catalog check (`src/wasmhost/catalogCheck.ts`) holds the
engine's catalogs to the kinds the UI draws and to one world for both modes,
`SaveGame.import` moved to the test tree (`importTower` in
`src/tests/fixtures/saveText.ts`), and `src/wasmhost/hostFault.ts` kept only
`isEngineTrap` and `runEach`. The guard fails when a file there gains a
runtime import and this table does not name it.

| File | Runs in the shipped game | Decides gameplay | Disposition | Owner |
| --- | --- | --- | --- | --- |

**Verdict for the "TypeScript decides nothing in production" criterion:**
nothing remains. #1754 moved undo and redo into the engine, and #921 took the
TypeScript engine out of the production bundle, which the postbuild guard
proves on every build. What is left of it ships only in tooling builds (2b)
and leaves when the TypeScript reference is deleted after 3.0.0 (#1875, 3.x).

## 3. Engine reads and commands

Every member of `EnginePort` (`src/simport/enginePort.ts`). The Rust export
for each is in `engine-rs/src/wasm/` (the binding's declaration is
`src/dualrun/engine.d.ts`, held to the engine by `npm run engine:compat`).
`tsEngine.golden` is `src/tests/integration/tsEngine.golden.integration.test.ts`,
which runs the members it lists on the WASM binding and the TypeScript port
over the same towers and requires the same answer; a row that cites other
evidence is one the golden does not cover, or covers only in part.

| Member | Group | Class | Evidence |
| --- | --- | --- | --- |
| `tick` | lifecycle | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, browser `e2e/crowdCull.spec.ts` |
| `advance` | lifecycle | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, browser `e2e/engineBoot.spec.ts` |
| `serialize` | lifecycle | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, `src/tests/integration/conformanceWasmSaves.integration.test.ts`, browser `e2e/saveRoundTrip.spec.ts` |
| `loadSave` | lifecycle | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, `src/tests/integration/conformanceWasmLoadFidelity.integration.test.ts` |
| `restore` | lifecycle | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, `src/tests/integration/conformanceWasmLoadFidelity.integration.test.ts`, browser `e2e/serviceDiagnostics.spec.ts` |
| `foundTower` | lifecycle | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `generation` | lifecycle | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `undoSignature` | lifecycle | proven same | `src/tests/integration/engineContract.integration.test.ts` (through `src/simport/engineLifecycle.fixture.ts`): the signature moves on exactly the steps that change what a player can undo, read from the engine's own save; no shipped code reads it since #1754, when the engine began keeping the steps itself |
| `undoCapture` | undo | proven same | `src/tests/integration/engineContract.integration.test.ts` (through `src/simport/engineLifecycle.fixture.ts`): a gesture is a step only when the tower changed, and a capture over an open gesture keeps the first if it changed the tower; native `engine-rs/src/wasm_port_undo_tests.rs` |
| `undoCommit` | undo | proven same | `src/tests/integration/engineContract.integration.test.ts` (through `src/simport/engineLifecycle.fixture.ts`), as for `undoCapture` |
| `undoDiscard` | undo | proven same | `src/tests/integration/engineContract.integration.test.ts` (through `src/simport/engineLifecycle.fixture.ts`): a dropped gesture that changed nothing leaves no step, and one that changed the tower is kept |
| `undoClear` | undo | proven same | `src/tests/integration/engineContract.integration.test.ts` (through `src/simport/engineLifecycle.fixture.ts`): both stacks empty after it |
| `undoDepths` | undo | proven same | `src/tests/integration/engineContract.integration.test.ts` (through `src/simport/engineLifecycle.fixture.ts`), at each step of its undo cases |
| `undoNotice` | undo | proven same | `src/tests/integration/engineContract.integration.test.ts` (through `src/simport/engineLifecycle.fixture.ts`): the done and the empty steps' notices |
| `undo` | undo | intentionally different (approved) | `src/tests/integration/engineContract.integration.test.ts` (through `src/simport/engineLifecycle.fixture.ts`) for what both engines share (a step back puts the edit back, nothing to step changes nothing, every adopted tower forgets the steps); browser `e2e/elevatorScheduleReview.spec.ts`; `src/tests/integration/undoHistory.integration.test.ts` (the app's history through the port); native `engine-rs/src/sim_undo_tests.rs`, `engine-rs/src/sim_undo_check_tests.rs`, `engine-rs/src/sim_undo_random_tests.rs`. The engine's step holds only what the edit changed, so time keeps moving and only the cash the edit's commands moved comes back, where the reference restores the whole save (section 4) |
| `redo` | undo | intentionally different (approved) | as for `undo`, with the redo case of `src/tests/integration/engineContract.integration.test.ts` |
| `drainEvents` | lifecycle | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `eventText` | lifecycle | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `setBackdrop` | lifecycle | proven same | `src/tests/integration/engineContract.integration.test.ts` (through `src/simport/engineLifecycle.fixture.ts`), native `engine-rs/src/wasm_port_life_tests.rs` |
| `viewLayout` | view | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `viewStructure` | view | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `viewFrame` | view | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `unitMetaChanged` | view | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `unitLabel` | view | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `unitSubtype` | view | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `towerName` | view | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `lastReason` | view | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `logAfter` | view | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `logText` | view | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `view` | view | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `pendingChoice` | view | proven same | `src/tests/integration/conformanceWasm.integration.test.ts` (the ransom and fire-rescue scenarios, through `src/tests/conformance/wasmEngine.ts`), browser `e2e/integration.spec.ts` |
| `bombSearch` | view | intentionally different (approved) | native `engine-rs/src/events_bomb_tests.rs`; Classic's timed bomb search runs in the Rust engine only (#349, which the owner made a 3.x P1 on 2026-11-11). The TypeScript reference answers a ransom at once and has no such member (the member is optional on the interface) |
| `buildAt` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `paintTiles` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `buildShaft` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `demolish` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `demolishTile` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `changeCars` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, browser `e2e/wasmEngine.spec.ts` |
| `startExtend` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `stopExtend` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `extendShaft` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, browser `e2e/wasmEngine.spec.ts` |
| `markStop` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `expressStops` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `dropStops` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `scheduleShaft` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, `src/tests/integration/scheduleAuthoring.integration.test.ts`, browser `e2e/elevatorScheduleReview.spec.ts` |
| `labelUnit` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `stepRent` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, `src/tests/integration/batchPricing.integration.test.ts` |
| `noRate` | command | proven same | `src/tests/integration/batchPricing.integration.test.ts` (`describeEngines`, the Classic success path), `src/tests/integration/engineContract.integration.test.ts` (through `src/simport/engineLifecycle.fixture.ts`), `src/tests/integration/tsEngine.golden.integration.test.ts` (the Modern refusal) |
| `setRent` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, `src/tests/integration/batchPricing.integration.test.ts` |
| `rentBatch` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, `src/tests/integration/batchPricing.integration.test.ts` |
| `setFilm` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `rerollUnit` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `bookExterminator` | command | proven same | `src/tests/integration/engineContract.integration.test.ts` (through `src/simport/engineLifecycle.fixture.ts`) (a booking, its price and the charge), `src/tests/integration/tsEngine.golden.integration.test.ts` (the refusal), native `engine-rs/src/extermination_tests.rs` |
| `answerChoice` | command | proven same | `src/tests/integration/engineContract.integration.test.ts` (through `src/simport/engineLifecycle.fixture.ts`) (the payment and a decline), `src/tests/integration/conformanceWasm.integration.test.ts` (the fire-rescue and ransom scenarios answered through it, to their pinned checkpoints) |
| `chooseAutoBridge` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `flipAutoBridge` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `nameTower` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `setCamera` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `logLine` | command | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `quoteBuild` | query | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `quoteShaft` | query | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `quoteRentBatch` | query | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, `src/tests/integration/batchPricing.integration.test.ts` |
| `shaftSchedule` | query | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, browser `e2e/elevatorScheduleReview.spec.ts` |
| `autoTuneProposal` | query | proven same | `src/tests/integration/autoTuneProposal.integration.test.ts`, `src/tests/integration/scheduleAuthoring.integration.test.ts` |
| `scheduleFacts` | query | proven same | `src/tests/integration/scheduleAuthoring.integration.test.ts` |
| `schedulePreset` | query | proven same | `src/tests/integration/scheduleAuthoring.integration.test.ts` |
| `founder` | query | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `statsStrip` | query | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `hotspot` | query | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `onboarding` | query | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, `src/tests/integration/onboarding.integration.test.ts` |
| `autoBridge` | query | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `evaluatedTower` | query | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, browser `e2e/win.spec.ts` |
| `heatCells` | query | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` (every heat mode) |
| `crewCoverage` | query | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `unitCard` | query | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `shaftCard` | query | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, browser `e2e/serviceDiagnostics.spec.ts` |
| `statsSheet` | query | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `unitFacts` | query | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, browser `e2e/tenantDiagnostics.spec.ts` |
| `serviceDiagnostics` | query | proven same | `src/tests/integration/portServiceDiagnostics.integration.test.ts`, browser `e2e/serviceDiagnostics.spec.ts` |
| `roomTiers` | query | intentionally different (approved) | `src/tests/integration/roomTiersWasm.integration.test.ts`, `src/simport/roomTiers.test.ts` (the reader, and no rows from an engine without the read), native `engine-rs/src/panels/tests_room_tiers.rs`, `engine-rs/src/wasm_port_panels_tests.rs`. The Map's Eval and Pricing read (#343 S7), which only the Rust engine answers: the TypeScript reference has no Map views, and a reader takes its absence as no rows. The owner moved the Map's views into 3.0 for parity with the original (owner decision 6 in [`overview-map-343-plan-2026-11-03.md`](overview-map-343-plan-2026-11-03.md)), and no player sees this read until S6 to S9 ship together; S8's Eval and Pricing views then show it |
| `loadVctower` | file | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `exportVctower` | file | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, browser `e2e/saveRoundTrip.spec.ts` |
| `loadTdt` | file | proven same | `src/tests/integration/tdtRealSaves.integration.test.ts` (the real 1997 saves), `src/tests/integration/tsEngine.golden.integration.test.ts` (the Rust codec on both ports) |
| `tdtNote` | file | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` (the Rust codec on both ports; see the class note on `.TDT`), `src/tests/integration/tdtRealSaves.integration.test.ts` |
| `tdtTowerName` | file | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` (the Rust codec on both ports; see the class note on `.TDT`), `src/tests/integration/tdtRealSaves.integration.test.ts` |
| `adoptTdt` | file | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` (the Rust codec on both ports; see the class note on `.TDT`), `src/tests/integration/tdtRealSaves.integration.test.ts` |
| `tdtExport` | file | proven same | `src/tests/integration/tdtExport.integration.test.ts`, native `engine-rs/tests/tdt_round_trip.rs`, `src/tests/integration/tsEngine.golden.integration.test.ts` (the Rust codec on both ports) |
| `tdtFile` | file | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` (the Rust codec on both ports; see the class note on `.TDT`), `src/tests/integration/tdtRealSaves.integration.test.ts` |
| `prepareTdt` | file | retired | the TypeScript port's lazy load of the Rust `.TDT` codec it borrows (`src/engine/port/tdtCodec.ts`); the Rust binding reads `.TDT` itself and has no such member (the member is optional on the interface), and it goes with the TypeScript port under the Rust-only decision, [`release-3.0-rust-only-2026-10-30.md`](release-3.0-rust-only-2026-10-30.md) |
| `congestion` | render | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `floorCongestion` | render | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` (through `src/tests/integration/goldenFloorCongestion.ts`), native `engine-rs/src/wasm_port_render_tests.rs` |
| `queueView` | render | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `parkingSet` | render | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `parkingUsage` | render | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |
| `recyclingFill` | render | proven same | `src/tests/integration/cardTextParity.integration.test.ts` (a nonzero fill on the winning tower and the over-capacity tower), `src/tests/integration/tsEngine.golden.integration.test.ts` (a tower with no center) |
| `recyclingCapacity` | render | proven same | `src/tests/integration/cardTextParity.integration.test.ts` (through the recycling card lines) |
| `recyclingDemandMet` | render | proven same | `src/tests/integration/cardTextParity.integration.test.ts` (met on the winning tower, not met on the over-capacity tower), `src/tests/integration/cardVerdicts.integration.test.ts` |
| `positionReachable` | render | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` |

## 4. Saves, files and recovery

| Feature | Class | Evidence | Notes |
| --- | --- | --- | --- |
| New tower in each mode | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` | `foundTower` |
| Autosave and save slots | proven same | `src/tests/integration/conformanceWasmSaves.integration.test.ts`, `src/tests/integration/conformanceWasmSlotCensus.integration.test.ts` | EX-2 covers the raw text form |
| Loading every save version the game wrote | proven same | `src/tests/integration/conformanceWasmLoadFidelity.integration.test.ts`, native `engine-rs/src/load/loader_cases.rs` (replays `conformance/loader-cases.json`, which `src/tests/integration/loaderCases.integration.test.ts` writes from the TypeScript loader) | EX-3 covers a number past the double range |
| `.vctower` import and export | proven same | `src/tests/integration/conformanceWasmVctower.integration.test.ts`, `src/tests/vctowerCodecPin.guard.test.ts`, browser `e2e/saveRoundTrip.spec.ts` | the Rust codec since #1498 |
| A save from a newer build is refused with an update prompt | proven same | `src/tests/newerSaveRefusal.guard.test.ts`, browser `e2e/saveRoundTrip.spec.ts` | |
| An unreadable save is kept and offered for download | proven same | browser `e2e/saveRoundTrip.spec.ts` | |
| `.TDT` import, including the nine real 1997 saves | proven same | `src/tests/integration/tdtRealSaves.integration.test.ts`, native `engine-rs/tests/tdt_real_saves_loaded.rs` | #1534, #1532; 1994 fidelity is #920 and #740 |
| `.TDT` export | proven same | `src/tests/integration/tdtExport.integration.test.ts`, native `engine-rs/tests/tdt_round_trip.rs` | |
| Undo and redo | intentionally different (approved) | the shared contract in `src/simport/engineLifecycle.fixture.ts` on the Rust engine (`src/tests/integration/engineContract.integration.test.ts`); browser `e2e/elevatorScheduleReview.spec.ts` (an undo on the real engine); `src/tests/integration/undoHistory.integration.test.ts` (the app's history through the port); native `engine-rs/src/sim_undo_tests.rs`, `engine-rs/src/sim_undo_check_tests.rs`, `engine-rs/src/sim_undo_random_tests.rs`, `engine-rs/src/wasm_port_undo_tests.rs` | since #1754 the engine keeps each edit's own steps (the units and shafts it touched, the cash its commands moved, the VIP visit day): time keeps moving, and a step that meets a changed tower is refused. The TypeScript reference restores the whole save, clock and cash included. The owner chose the engine's rule on #1754, and it is recorded in the `undo()` / `redo()` row of [`engine-port-contract.md`](architecture/architecture-rust-facade-2026-10-20/engine-port-contract.md) |
| Crash report from the engine-failure screen | proven same | `src/bootstrapEngineSecure.test.ts` (the report offered while the Rust engine is stopped, with download feedback) | #1515 |
| Recovery from a lost graphics context, and the crash screen on a repeat | proven same | browser `e2e/contextRecovery.spec.ts`; the report's contents in `src/tests/integration/crashReport.integration.test.ts` and `src/tests/integration/crashScreen.integration.test.ts` (on the TypeScript port) | |
| Engine identity, fallback reason and UI build in diagnostics | proven same | browser `e2e/engineIdentity.spec.ts`, browser `e2e/engineStatusRows.spec.ts` | |
| Falling back to the TypeScript engine when WASM fails | retired | browser `e2e/engineBoot.spec.ts` | the Rust-only decision, [`release-3.0-rust-only-2026-10-30.md`](release-3.0-rust-only-2026-10-30.md): a package that cannot start stops the game with a message |
| Settings engine choice and `?engine=` | retired | browser `e2e/engineBoot.spec.ts` | same decision |

## 5. Panels, dialogs, controls, events, audio and analytics

UI that reads nothing from the engine (the help pages, the Classic and Modern
comparison, settings) has no row: the engine switch cannot change it.

| Feature | Class | Evidence | Notes |
| --- | --- | --- | --- |
| Tower Statistics sheet | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` | `statsSheet` |
| HUD strip, hotspot and traffic readout | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts`, `src/tests/integration/panelGettersWasm.integration.test.ts` | |
| Heat map cells | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` (`heatCells`, every mode) | |
| Milestones and the TOWER win | proven same | `src/tests/integration/milestones.integration.test.ts`, browser `e2e/win.spec.ts` | |
| Onboarding flags | proven same | `src/tests/integration/onboarding.integration.test.ts`, `src/tests/integration/tsEngine.golden.integration.test.ts` (`onboarding`) | |
| Event log text and order | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` | `logAfter`, `logText` |
| Visual effects and emergency counters from engine events | proven same | `src/tests/integration/fxSequences.integration.test.ts` | the effect sequences and counters, pinned (#879) |
| Sound effects, music and ambience | untested | `src/game/frameLoop.test.ts` (which port fact plays which cue, on a stub port); none on Rust | the game plays them from host code on port facts and command results, and the Tone engine (`src/game/frameLoop.ts`, `src/game/buildActions.ts`, `src/game/appBoot.ts`); presentation only, nothing in it reaches the engine |
| Gameplay analytics events from the engine | untested | none yet | #873 (3.x) |
| Schedule dialog: presets, auto-tune, advice, staging | proven same | `src/tests/integration/scheduleAuthoring.integration.test.ts`, `src/tests/integration/autoTuneProposal.integration.test.ts` | authored in Rust since #1550 and #1552 |
| Schedule review for older underscheduled towers | proven same | browser `e2e/elevatorScheduleReview.spec.ts` | #1548 |
| Batch pricing preview and apply | proven same | `src/tests/integration/batchPricing.integration.test.ts` | |
| Build preview cost and refusal text | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` | `quoteBuild`, `quoteShaft`, `lastReason` |
| Editor and build actions (build, paint, demolish, cars, extend, stops, rent, label, film), by pointer, touch and keys | proven same | the section 3 commands each one calls; browser `e2e/wasmEngine.spec.ts` (the car, extend and removal commands charge inside the engine), `e2e/mobileGestures.spec.ts` (taps place on a phone), `e2e/auto-floor.spec.ts` | `src/game/editorActions.ts`, `src/game/buildActions.ts`, `src/game/keyboardPlay.ts` turn input into those commands |
| Shaft and link pools, cars per shaft, spans | proven same | `src/tests/integration/conformanceWasm.integration.test.ts` (each mode's Rust catalog against the TypeScript catalog and the lock, so the tables match; the `refusals-*` scenarios cover the 30-floor span, and the `engine-charges-classic` scenario refuses a ninth car), `src/tests/integration/fuzzWasmLeg.integration.test.ts` (`conformance/fuzz-corpus/pool-caps-tall.json` fills the 24-shaft pool with standard elevators and the 64-link pool with stairs, and pins each refusal), native `engine-rs/src/tower_census_tests.rs` (`cap_reason` refusing an express shaft after 24 standard ones) | the engine's catalog holds the tables and `cap_reason` enforces them; which kinds share each pool and the cars on every kind are catalog fields the lock compares |
| Express stops and sky lobbies | proven same | `src/tests/integration/tsEngine.golden.integration.test.ts` (`markStop`, `expressStops`, `dropStops`), the `metro-express-modern` scenario in `src/tests/integration/conformanceWasm.integration.test.ts`; the lobby distance lines in section 1 | |
| Emergency dialog (fire rescue, ransom) | proven same | browser `e2e/integration.spec.ts` (none over the title screen), `src/tests/integration/engineContract.integration.test.ts` and `src/tests/integration/conformanceWasm.integration.test.ts` (`answerChoice`) | the outcome is the engine's |
| Report dialogs and their order against other dialogs | proven same | browser `e2e/modalPrecedence.spec.ts` | |
| `.TDT` import and export reports | proven same | `src/storage/tdtImportReport.test.ts`, `src/storage/tdtExportReport.test.ts` | built from the codec's records (`src/simport/tdtRecords.ts`), which are Rust's on either engine |
| Overview map | proven same | browser `e2e/overviewMap.spec.ts` | drawn from the engine's view; desktop opens it, a phone starts closed |
| Speed and pause | proven same | browser `e2e/engineBoot.spec.ts` (only the engine advances a tower) | |
| The crowd drawn from the engine's people | proven same | browser `e2e/crowdCull.spec.ts` | |

## 6. Classic and Modern

The card-text sweep, the `describeEngines` suites and the conformance
scenarios run each case in both modes. The per-mode UI flags are the
`src/simport/headerClock.ts` (now outside section 2a's runtime-import ratchet). A rule that differs between the modes is
the engine's (`engine-rs/src/rules.rs` and the systems that read it), and
the conformance lock (`conformance/expected.json`) pins both: every scenario
in `conformance/scenarios/` replays on the Rust engine through
`src/tests/integration/conformanceWasm.integration.test.ts` and must reach the
checkpoints the TypeScript run wrote, money, tenants and every person
included. One row per rule the game's comparison dialog
(`src/ui/templates/compare.ts`) promises a player:

| Rule (Modern, against Classic) | Class | Evidence |
| --- | --- | --- |
| Variant households set a condo's price and size | proven same | `src/tests/integration/condoModesEngine.integration.test.ts` (the prices written mid-run, on both engines), the `amenities-modern` and `player-edits-*` scenarios; `src/tests/integration/condoModes.integration.test.ts` ran on the Rust engine too until #1421 deleted the hosted projects, and runs on the TypeScript engine only now |
| Households move out on their own | proven same | `src/tests/integration/condoRelocationEngine.integration.test.ts` (`describeEngines`): the Modern move-out and buy-back, Classic over thirty years, the RNG draw, the same month from the same seed, and the notice that does not rescind |
| Overhead, the unsold-condo tax, noise and shop-access notices | proven same | the Modern scenarios' checkpoints, `src/tests/integration/conformanceWasmDiagnostics.integration.test.ts` (the notice reasons) |
| A rent slider against Classic's four rungs and No Rate | proven same | `src/tests/integration/batchPricing.integration.test.ts` (`describeEngines`), the `player-edits-*` scenarios |
| Escalators may serve office floors | proven same | `src/tests/integration/engineContract.integration.test.ts` (through `src/simport/engineLifecycle.fixture.ts`): Classic refuses with the reference's reason and changes nothing, Modern builds |
| The Modern venues and their star unlocks | proven same | the `amenities-modern` and `refusals-classic` scenarios |
| Studio and Apartment rentals | proven same | the `amenities-modern` scenario |
| No climb limit (Classic: 4 flights of stairs, 7 of escalators) | proven same | `src/tests/integration/trafficTeeth.integration.test.ts` (`describeEngines`: the same 10-flight stair climb strands a shop in Classic and reaches it in Modern) |
| Schedule presets, auto-tune and advice | proven same | section 5's schedule dialog row (`src/tests/integration/scheduleAuthoring.integration.test.ts`, `src/tests/integration/autoTuneProposal.integration.test.ts`) |
| The paid exterminator | proven same | the `hotel-exterminator-modern` and `hotel-exterminator-reload-modern` scenarios, `bookExterminator` in section 3 |
| Build hints before the click | proven same | `quoteBuild`, `quoteShaft` and `lastReason` in section 3 |
| A livelier day (school runs, errands, late checkout, gentler rain) | proven same | the Modern scenarios' checkpoints, which hash every person's state; `src/tests/integration/hotelLateCheckoutEngine.integration.test.ts` (the understaffed late checkout on both engines, since #1800) |
| Calendar pace (real-world or compressed) | proven same | the Modern scenarios run the real-world calendar; `src/tests/integration/conformanceWasmFrameDays.integration.test.ts` holds the Rust engine to the frame-day golden, which runs the compressed one on a new Modern game for a day and on `conformance/fixtures/split-tower.vctower` for four days across a quarter's end ("split-tower on the canon calendar across a quarter, at speed 3"); until #1875 a TypeScript referee held that engine to the same golden |
| Office rent smoothed over the calendar | proven same | the Modern scenarios' checkpoints, `src/tests/integration/ledger.integration.test.ts` (`describeEngines`) |

## 7. Test exclusions

On this commit `src/tests/parity/exclusions.ratchet.txt` holds 5
`itTypeScriptOnly` marks in 3 files and 7 `atEngineFrameCadence` calls in 3
files, with no `onWasmParityProject` branches;
`src/tests/parity/exclusions.guard.test.ts` pins each count to the source in
both directions, and the test-mapping table in
`_bmad-output/implementation-artifacts/story-engine-test-parity.md` gives each
file's reason (checked row by row for #878 on this commit). The cadence calls
ran on Rust at the host's own cadence, a cost exemption, until #1421 deleted
the hosted projects; since then the marked tests and the cadence calls run on
the TypeScript engine only, and the marks change nothing. No mark is
left that a save edit before the first tick would convert (`storage`
converted its five that way in #1779, the meal-rush routing tests moved
to the port kit in #1792, and the venue-capacity round trips in #1795). The
ratchet's marks fell in two groups, which the test-conversion lane took in
this order under #878:

- **0 tests** are left that need a write or a reading no command or save
  carries. #1792 added the clock and unit-state writes to the port kit
  (`setClock`, `setUnitState`), #1795 the customer write (`setCustomersIn`),
  #1805 the weather and retail-tally writes (`setWeather`,
  `clearRetailTallies`), and the engine's tooling-only `vacateUnit` and
  `setUnitRent` moved the room-count walk and the two Classic condo price
  tests onto both engines
  (`src/tests/integration/roomCountsEngine.integration.test.ts`,
  `src/tests/integration/condoModesEngine.integration.test.ts`).
- **5 tests** pin the retired `v1` sampled model or the TypeScript save hash
  (`phase2`, `parity`, `goldenMaster`) and retire with the TypeScript engine
  (#1421). `phase2`'s two test the `v1` model itself and `goldenMaster`'s two
  hash the TypeScript serializer's bytes. The `parity` one wins TOWER in a
  built tower with no transport, which only the sampled model keeps
  occupied; the served, hourly-model win is `phase2`'s Step 5 test, which
  carries no mark. The tests that pinned `v1` for a rule the game still runs
  moved onto the hourly model, on both engines: the FAQ cinema booking and
  film-policy tests
  (`src/tests/integration/cinemaBookingEngine.integration.test.ts`), the
  Modern overhead, condo-tax and overhead-RNG tests
  (`src/tests/integration/overheadEngine.integration.test.ts`) and the condo
  relocation tests
  (`src/tests/integration/condoRelocationEngine.integration.test.ts`).

`src/tests/tsEngineTests.ratchet.txt` lists 150 files that still drive the
TypeScript engine directly (129 test files and 21 fixtures and helpers; the
list shrinks as tests convert and grows only with a reason the PR states, as
when #1792, #1795, #1797 and #1800 added
`src/tests/integration/segmentRoutingMealRush.integration.test.ts`,
`src/tests/integration/personRoundTripVenueCap.integration.test.ts`,
`src/tests/integration/attendanceTripwireEngine.integration.test.ts` and
`src/tests/integration/hotelLateCheckoutEngine.integration.test.ts`, port kit
suites that author their towers on a `Simulation`, #1805 the port kit's
TypeScript tooling (gone again with #1875's port kit step), #1809 the two
golden referees (gone again with #1421's in #1875's first step), and #1421 the fixture loader `src/tests/conformance/fixtureSim.ts`,
moved out of the deleted dual-run harness; #1875's test conversions then
shrink it, the first by pinning the perf harnesses' towers as saves under
`src/tests/perfCompare/towers/`, the second by running the port kit on the Rust engine alone, the third by moving the engine port's own unit tests in `src/simport/` and the engagement test onto the Rust engine), and `src/tests/portKit/converted.txt` lists 24 suites
already on the port kit. #1421 deleted the hosted WASM projects
(`integrationWasm` and `unitWasm`), so no suite runs on a hosted `Simulation`
any more; the suites that start the Rust engine themselves run in
`npm run test:wasm`. The card-text sweep is one of them,
and since #1809 (#1806) it holds the Rust card to a committed golden of the
reference card's lines (`src/tests/goldens/card-text/`), so the canary
outlived the TypeScript referee that held the golden to that card until
#1875.

## 8. Known divergences and exceptions

| Item | Class | Where it is handled |
| --- | --- | --- |
| A rollback past #902 and a pending exterminator booking | known divergence | EX-1 |
| The engine's raw save text form and a transport's key order | known divergence | EX-2 |
| A number past the double range in a save | known divergence | EX-3 |
| Undo and redo keep change-only steps, where the reference restores the whole save | intentionally different (approved) | section 4; #1754 |
| Sound effects, music and ambience | untested | the host picks each cue from a port fact that section 3 compares (section 5), and no test plays the cues on both engines; #965 (4.x) moves the cues onto engine events, where that check belongs, and new cues are #967 |
| Real Safari and a phone, the OS-installed app window, the WebKit offline start and update, and Firefox's manual half (the nine real 1997 saves and five hand-played game days), on the Rust build | untested | The owner chose to ship on Playwright WebKit coverage, with real Safari and iOS listed as untested in the 3.0.0 release notes (#945, decision 6, 2026-11-10). #1522, release checks for the candidate: the 2026-11-04 run found the state and crowd digests the same in Chromium, Firefox and WebKit, and the update rehearsal passing in Chrome ([summary](../../docs/performance/results/2026-11-04-55052113-cross-browser-1522.md)); #1815 then made the specs pass in Firefox (35 of 35 on the Windows PC), and WebKit's four failures left are its offline reloads, so this row's WebKit offline start and update stay unverified |
| 14 report-only screenshots where the Rust leg differed from the TypeScript leg | known divergence | #1425: 13 are put down to the harness and no player path reaches them. For 4 (the star bulletins) #1425 traces the cause, the bulletin's cursor skipping the tooling copy's lines; for the other 9 it gives a working explanation, not yet confirmed shot by shot (a hand edit through the tooling handle reaches the engine as a load, which starts the crowd afresh); the 14th, `features/inspector-recycling`, was the card's missing recycling lines, which #1441 fixed. The comparison leg no longer runs in CI |
| A guard against TypeScript rule ownership spreading through re-exports or client-side calculations | untested | #1551 (3.x); this register's guard and the bundle guard cover the imports on this commit (sections 2a to 2c) |
| A service card or shaft card asked for a non-number id (`"252"`, `" 252 "`, `"252.0"`, `[252]` or `true`) | known divergence | The binding turns any JavaScript value into a number first, so the Rust engine reads the unit or shaft that number names, where the reference answers `undefined` or an empty shaft card. The port declares the id a number (`src/dualrun/engine.d.ts`), so a typed caller cannot pass one, and `src/tests/integration/portServiceDiagnostics.integration.test.ts` compares the number ids a caller can pass. The owner accepted the difference on 2026-11-10, with no binding change (#1215) |
| Gameplay analytics events from the engine | untested | #873 |

Not divergences, and so not classed here: the TypeScript engine's modules
that a `VC_TOOLING=1` build carries for the harnesses' tower, which a
production build does not (2b; #921, then #1875). The long walk, the lobby
distance and the recycling lines have no browser spec; each is compared on
real WASM against the reference (section 1).

## 9. Against #1561's "done when"

- **Matrix and register checked in, no unclassified feature:** this page. The
  guard keeps the engine members and the frontend imports of the TypeScript
  engine classified on every commit, and keeps section 2c naming every host
  and save file that imports it at run time; sections 1, 4, 5 and 6 are kept
  by hand and are as complete as this audit.
- **Every legacy feature works on Rust or is retired on purpose:** sections 1
  to 6, with the untested rows in section 8; the retirements are the Rust-only
  decision's.
- **Every diagnostic omission repaired or excepted:** section 1, with no
  exception needed. The audit found two gaps, both in line order and both
  reachable only from a save, and each is fixed with a failing-before,
  passing-after test: a venue's business block above its notice (#1778) and
  a recycling center's block below its notice (#1780). An apparent gap in the
  elevator load line came from the sweep reading a live tower against a
  loaded one; since #1809 both engines load the case's tower from the same
  file and play the same minutes before the cards are read.
- **TypeScript supplies no gameplay decision in production:** met. Undo was
  the last, and #1754 moved it into the engine. Since #921 a production
  build carries no TypeScript engine module, and the postbuild guard fails
  one that does (2b).
- **Both modes, real saves, edge cases:** the card-text sweep's 19 cases per
  mode, the conformance scenarios, the real-save `.TDT` suite, and
  `conformance/fixtures/split-tower-4.vctower` imported in the browser.
- **CI and release gates on the last audited commit:** every check passed on
  `5ab3ad9d`, the release candidate's code, on 2026-11-11, including `test`
  (which runs this page's guard), both `test-wasm-parity` legs, `e2e`, the
  `engine-rs` workflow and `rust-coverage`. The candidate is that code with
  the release's version raise; #945 holds the owner's sign-off and the
  exception register (EX-1 to EX-3).
