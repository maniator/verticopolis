---
story: facade-6b-panel-getters
status: review
issue: 1214
tracking: 1207
parent: 945
depends_on: facade-6a-engine-view (wrappers only; the Rust functions and their tests do not)
plan: _bmad-output/planning-artifacts/architecture/architecture-rust-facade-2026-10-20/slice-plan.md (slice 6b)
---

# Story: facade slice 6b, the engine's panel getters

## Why

Under the facade (AD-9) the page keeps no TypeScript `Simulation` on the
healthy WASM path, so every number a panel shows has to come from the engine.
Today the stats screen, the HUD strip, the inspector and editor cards, the
elevator editor, the overlays' heat cells and the onboarding checklist read
their numbers by calling TypeScript methods on the mirrored `Simulation`
(`stats()`, `ratingPopulation()`, `strandedFloors()`, `housekeepingCoverage()`,
`incomeBreakdown()`, `floorHeatmap()`, `peakCongestionHotspot()` and the unit
and transport fields the frame lacks). Each of those is a plain function of
engine state. This slice ports the reads to Rust as read-only getters, so slice
4 can move the panels onto `port.query()` and slice 7 can answer them from the
engine.

The getters return facts. Wording stays in TypeScript (labels, milestone text,
the star-gate sentences), exactly as the plan says for the diagnostics family.

## Acceptance criteria

1. **AC1 One Rust getter per panel family**, each a read-only method on
   `Simulation` in a new module under `engine-rs/src/panels/`, none touching
   the simulation, the rng, the save, `state_view` or any hash:
   | Getter | Replaces (TypeScript) | Consumer |
   | --- | --- | --- |
   | `tower_stats` | `Simulation.stats()` | `uiStatus.ts` HUD strip, every UI tick |
   | `stats_report` | the reads in `statsTemplate` | stats screen |
   | `next_star_requirements`, `milestone_progress`, `next_star_threshold` | `star.ts` | stats screen |
   | `housekeeping_coverage` | `services.housekeepingCoverage` | stats screen, exterminator modal, 6c's housekeeping diagnostics |
   | `income_breakdown` | `Ledger.averagePerDay`, `hasData` | stats screen |
   | `elevator_stats`, `transport_detail` | `congestion.elevatorStats`, `transportCapacity`, `elevatorUtilization`, `elevatorHourlyLoad`, `elevatorOriginLoad`, `lobbyFloors`, `stopsAt` | stats screen, transport inspector and editor, elevator schedule dialog |
   | `unit_detail` | the unit fields the frame lacks, `isFloorServed`, `floorReachable`, `isShowingBlockbuster`, `unitPrice` | unit inspector and editor |
   | `floor_heatmap`, `peak_congestion_hotspot` | `congestion.floorHeatmap`, `peakCongestionHotspot` | overlays, traffic HUD |
   | `onboarding_facts` | the five `ONBOARD_STEPS.done` predicates | onboarding checklist |
2. **AC2 Facts, not wording.** Star gates come back as stable ids with a met
   flag, milestones as ids with a done flag; the TypeScript tables keep the
   labels and descriptions.
3. **AC3 Differential against TypeScript.** For every conformance scenario,
   at every checkpoint, each getter's JSON equals the TypeScript reference
   (`src/tests/conformance/panelReference.ts`, built only from the functions in
   the table above) after the same normalization on both sides. The test runs
   the scenario on each engine independently (the lock already proves the two
   agree at every checkpoint) so transient state such as elevator telemetry and
   the housekeeping report is the engine's own. It reports, per getter, how
   many checkpoints and distinct inputs it compared.
4. **AC4 Branch coverage of the compared TypeScript functions on the corpus**
   is measured (`vitest --coverage`, the files in the table) and recorded in
   the PR with the list of branches the corpus never reaches. Each unreached
   branch gets a native Rust test on a scripted tower instead, so no getter
   branch is untested.
5. **AC5 Native Rust tests** pin each getter on scripted towers: refusals
   (unknown id answers `None`), every `HeatmapMode`, a tower with no units, a
   basement-only tower, 6+ stars, a Classic and a Modern tower, an infested
   hotel, a stranded floor.
6. **AC6 Cost.** A native timing test on the largest conformance fixture
   records each getter's median cost. The plan says "cached by revision or
   hour"; this story keeps a memo only where the key is provably complete
   (see Dev notes) and otherwise computes in one linear pass. The measured
   figures go in the PR's HP record. A getter over 1 ms on the large fixture
   gets a revision-keyed memo or a documented deferral.
7. **AC7 The binding** (appended after 6a's block): one `#[wasm_bindgen]`
   method per getter returning JSON text, one-line wrappers only,
   `src/dualrun/engine.d.ts` lines appended, crate minor bumped with
   `npm run engine:compat`, `independence.rs` green.
8. **AC8 Nothing else moves.** Conformance lock, simulation hashes, save
   format, `state_view`, the frame layout, catalog digests: unchanged.

## Out of scope

- The diagnostics facts (`facilityDiagnostics`, `gripeCopy`, `housekeepingDiagnostics`):
  slice 6c. It calls `housekeeping_coverage` and `transport_detail` from here.
- The HUD clock, tower name and header: slice 6a's view header.
- Moving any panel onto the port: slice 4. No TypeScript consumer changes here.
- `exterminator` cost and rooms as command results, `previewRentBatch`,
  transport dry runs: slice 6d.
- Static rule tables (`isOpenAt`, `hasAccessDiagnostic`, `householdPrice`,
  catalog lookups): they need no instance and stay in TypeScript.

## Dev notes

- New files only under `engine-rs/src/panels/` (one module per family, each
  well under the 500-line ceiling), plus one `pub mod panels;` in `lib.rs`.
  `sim.rs` is not edited unless a memo field proves necessary.
- Getters take `&mut self` only where the engine's own reads do (`floor_reachable`
  memoizes by revision); everything else is `&self`.
- Output is `serde_json::Value` built with the TypeScript field names, so the
  wrapper is `self.sim.<getter>().to_string()`.
- Cache keys: 6a reports `tower.revision`, `tower.meal_overlay_revision` and a
  new `tower.meta_revision`, plus `Simulation::change_counter()` which is
  undo's signature rather than a cache key. Unit state (`occupied`, `dirty`,
  `asleep`), customers, satisfaction and money change between revisions and
  between hours, so a revision-or-hour key would show stale numbers where the
  TypeScript recomputes. `stats`, `unit_detail`, `transport_detail`,
  `income_breakdown` and the heatmap are therefore single linear passes. The
  structure-only inputs already carry revision memos in the engine
  (`served_floors`, `staff_components`, `floor_reachable`).
- Order of work: Rust functions and native tests first, then the differential
  harness, then the wrappers once 6a's block is on `main`.
- `HK_NOMINAL_ROOMS_PER_MAID` (19) is ported with the coverage struct.
- Quality gates: `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run build` (with the engine package), `cargo fmt --check`,
  `cargo clippy -D warnings`, `cargo test`, `npm run test:wasm`, `npm run engine:compat`.
- Review: `/gds-code-review`, then the independent review on the final head,
  with the HP-1..HP-12 record in the PR body. No closing keyword before #868
  or #954; the PR relates to #1214, #1207 and #945 by reference.

### Hot-path record plan

| Item | Plan |
| --- | --- |
| HP-1 entry points | `tower_stats` per UI tick (160 ms); the rest on panel open or per UI tick while open; `floor_heatmap` hourly while an overlay is on; `peak_congestion_hotspot` per UI tick |
| HP-2 wall-clock budget | each getter under 1 ms on the large fixture (AC6), measured natively |
| HP-8 TypeScript walk | `stats()` walked every unit per UI tick on the mirror (5.7 ms large); the Rust pass is the measured replacement |
| Other items | filled from the diff at review |

### What it removes

Nothing yet: the TypeScript reads stay until slice 4 moves the panels and
slice 11 removes the mirror. The reference module in `src/tests` is test-only
and is deleted with the TypeScript functions it calls.

## Dev Agent Record

### Agent Model Used

Sonnet 5.5 (high)

### Completion Notes List

- **Differential (AC3).** `panelGettersWasm.integration.test.ts` runs all 24
  conformance scenarios on each engine and probes every getter at every
  checkpoint. Compared on the corpus: 606 checkpoints, 10,387 unit cards, 4,678
  shaft cards, 501,186 heat cells, 739 stranded-floor readings, 23 checkpoints
  with an infested room, 484 with a shaft of two or more cars. Every answer
  equals its TypeScript reference; only `severity` carries a 1e-12 tolerance
  (V8 `Math.pow` against Rust `powf`).
- **TypeScript branch coverage (AC4)** of the compared functions, from
  `vitest --coverage` on that suite alone (v8, branches reached/total):
  `averagePerDay` 6/6, `hasData` 1/1, `elevatorStats` 5/5, `parkingDemand` 8/8,
  `housekeepingCoverage` 14/14, `strandedFloors` 4/4, `ratingPopulation` 1/1,
  `cumulativeStarGates` 3/3, `unitPrice` 4/4, `stats` 18/19, `floorHeatmap`
  50/52, `peakCongestionHotspot` 6/7, `congestionSeverity` 4/5,
  `nextStarRequirements` 6/9, `nextStarThreshold` 0/1. The one-line readers
  (`incomeBreakdown`, `isShowingBlockbuster`, `recyclingCapacity`,
  `recyclingDemandMet`, `hotelsCountTowardRating`, `milestoneProgress`) have no
  branch of their own. Unreached on the corpus, and the native test that
  covers each: the gridlock clamp in `congestionSeverity` (ramp test), the
  `star >= 5` and `star >= 6` returns and the TOWER rung in `nextStarThreshold`
  and `nextStarRequirements` (star progress test), a No Rate vacancy in `stats`
  (tower stats test). The remaining two branches are the legacy `simModel`
  `"v1"` paths in `peakCongestionHotspot` and `floorHeatmap`: the Rust engine
  has only the v2 model, so there is nothing to port or test.
- **Cost (AC6).** Medians from the cloud sandbox, so indicative only; the
  owner's PC is the source for figures that go in a gate. Large fixture
  (43,358 units), after the review fixes (before in brackets): `towerStats`
  0.33 ms (0.45), `statsReport` 2.0 ms (3.7), `housekeepingCoverage` 0.01 ms
  (0.27), `unitDetail` 0.008 ms, `peakCongestionHotspot` 0.28 ms (0.31),
  `onboardingFacts` 0.02 ms (0.40), `floorHeatmap` congestion 1.0 ms (2.6),
  occupancy 0.67 ms (1.8), satisfaction 0.72 ms (3.6, now written straight to
  text), cleanliness 0.01 ms (0.42). `statsReport` is still over the 1 ms bar
  and the congestion overlay is at it. What is left is in engine reads the
  getters call and the Rust step hotspots lane owns (`count_operational`,
  `highest_floor` / `lowest_floor`, `functional_parking_set`, the served-set
  clone): documented deferral, backlog row `rust-reads-walk-every-unit`
  (#1237). The overlay refreshes hourly game time, which is every 0.5 s at top
  speed, so `statsReport` and the three overlays go on the slice 9 PC list
  (#1220) at top speed; a frame-time or long-task impact makes the fix required
  before 50/50.
- **For the binding and slice 4.** The wrappers bind eight methods; the five
  small getters (`next_star_requirements`, `milestone_progress`,
  `next_star_threshold`, `income_breakdown`, `elevator_stats`) are reached
  inside `statsReport`, the only screen that reads them. Heat cells cross as
  text built straight from typed cells (`floor_heatmap_json`), not a `Value`
  per cell; keep that when the overlay moves onto the port, keep the renderer's
  (mode, hour, revision, meal revision) cache, and throttle the congestion
  recompute to once per UI tick. `transport_detail` builds a `Value` per floor
  and per origin ring; fine on panel open, measure it before a per-tick refresh.
  Absent TypeScript fields answer `null` (see `panels/mod.rs`).
- **Review (`/gds-code-review`, four layers).** Patched: `milestone_progress`
  evaluated all eleven milestone tests to read ids (now a table with a drift
  test); the overlay extent walk hashed every unit (dense floor table); heat
  cells were a `Value` each (typed, written to text); coverage, cleanliness,
  stats, households and onboarding walked tile units (rooms only); the crew
  reach was copied (shared); the elevator sort was not a total order; two
  capacity formulas (one); `LEDGER_CATS` duplicated (the ledger's); the module
  doc claimed no writes; the tie, housekeeping and basement tests did not pin
  what they named. Deferred: #1237 above. Dismissed with parity evidence (the
  differential matches TypeScript at 606 checkpoints): the infinite ratio
  reading green, the hotel `Asleep` count, the `tenanted` versus `Occupied`
  tests, the household size 0 bucket, the population measure in `popHave`,
  elevator counts in the HUD versus the list, the partial running day in the
  income average.

### File List

- `engine-rs/src/panels/` (new): the getters and their native tests
- `src/tests/conformance/panelReference.ts`, `panelProbe.ts`: the TypeScript reference and the probe
- `src/tests/integration/panelGettersWasm.integration.test.ts`, `panelGettersCost.integration.test.ts`
- Wrappers, `engine.d.ts`, binding tiers and the crate bump: after slice 6a
