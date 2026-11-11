# Deleting the TypeScript engine (#1875, PR 2)

PR 2 deleted `src/engine/`. Before that, every file outside it stopped
importing it. This page maps each of those files to what it reads or runs
now, by batch. The rule suites PR 1 retired are mapped in
[ts-engine-retirement-map.md](./ts-engine-retirement-map.md).

The lead commits also removed the engine identity, the bundle allowlist, the
guards that only watched `src/engine/`, the loader-case dump script and the
coverage exclusion, and ported the Wine-harness save tools in
`tools/simtower/` to the port kit's draft over the Rust engine.

## Batch A: frontend and render tests off src/engine

New shared helper: `src/tests/catalogKinds.ts` (`kindFacts`, `kindKeys`,
`subtypesOf`, `keepsHours`, `openAt`), which reads per-kind facts from the Rust
catalog fixture through `catalogFor("classic")`. No suite moves on or off
`test:wasm:host` or `portKit/converted.txt`.

| File | What changed | Coverage now |
| --- | --- | --- |
| `src/events/gameplayCatalog.test.ts` | `FACILITIES` keys and `GRID` floors now come from the catalog fixture. Milestone ids are now checked against `MILESTONE_COPY` (statsCopy), so every milestone an event names has stats copy, in order. The compile-time `sameMilestones` check is retired. | Same assertions against the Rust catalog. The engine's milestone set is held to the event catalog in Rust by `gameplay::tests::gameplay_event_matches_the_catalog`. |
| `src/presentation/viewKinds.test.ts` | The comparison with the TS predicates is replaced by pinned literal kind sets (commercial, hotel, lease amenity, unmet demand, elevator, business hours) and by each kind's open hours, in both modes. Fractional hours and hour 24 are checked against their whole hour. | The view's kind facts are pinned to the Rust values (`engine-rs/src/facilities.rs`, `Kind::is_open_at`). |
| `src/ui/placement.test.ts` | `GRID` now comes from the catalog `world`. | Same. |
| `src/ui/scheduleDialogRules.test.ts` | Two "while that engine exists" cases are retired (`makeRules().elevatorScheduleUX()` and `topOriginFloors`). The basement slot from the retired case is added as a literal (`[-2, 12]`). | The UX per mode stays pinned literally. In Rust it is held by `catalog::rules_tests::schedule_assist_is_what_the_schedule_queries_answer`. The hotspot ranking is held by its literal cases. |
| `src/ui/templates/batchPricing.test.ts` | `BatchRentResult` and `PriceRung` now come from `shared/engineTypes`. Classic rungs come from `priceOptionsFor(catalogFor("classic"), kind)`. | Same sentences, with rungs from the Rust catalog. |
| `src/ui/templates/help.test.ts` | The drift guard was keyed on the TS `GameRules` seam. It is now `CATALOG_RULE_TO_HELP: Record<keyof CatalogRules, ...>`, plus the named divergences. The runtime backstop now checks every rule key in both catalog fixtures. The null-only entries, which only classified TS seam members, are dropped. | New catalog rules must be classified, by typecheck and at runtime. The copy-sync and distinct-phrase tests are kept. |
| `src/ui/templates/elevatorSchedule.test.ts` | `CLASSIC_RULES` and `MODERN_RULES` `.elevatorScheduleUX()` are replaced by `scheduleDialogUX(catalogFor(mode).rules)`. | Same. |
| `src/game/panelAnchoring.test.ts` | `facilityFloors("cinema")` is replaced by `kindFacts("cinema").floors`. | Same. |
| `src/game/portUnitDiagnostics.test.ts` | `VIEW_LAYOUT` is replaced by `LAYOUT_TEXT` from `portKit/mockPort` (the Rust `viewLayout.json` fixture). | Same. |
| `src/game/appModalsStats.test.ts` | Dropped the `Simulation` type cast (`towerCatalog` takes `{ mode }`). | Same. |
| `src/render/renderSim.types.test.ts` | The type test now checks `PortRenderSim` (the Rust adapter) against `RenderSim`, in place of TS `Simulation`. | Type contract held against the adapter `main.ts` uses. |
| `src/render/excalibur/towerPopulation.test.ts` | The live TS sim (`newSeededGame`) is replaced by a stand-in with only the three reads the gate makes (clock, revision, population), plus a step that adds arrivals. | All 8 cases are kept. It is now a proper unit test. |
| `src/render/excalibur/towerCrowd.test.ts` | `transportCarCapacity` is replaced by `kindFacts(...).carCapacity`, with a guard that it is positive. | Same. |
| `src/render/{cameraBounds,regionGrid,sceneryLayout}.test.ts` | `GRID` now comes from the catalog `world`. | Same. |
| `src/render/{scale,originSeeds,roomRouting}.test.ts`, `src/render/atlas/{additionsArt,catalog,layers,legacyShafts,lookup}.test.ts`, `src/render/excalibur/{roomSignature,towerFocus}.test.ts`, `src/render/pixelSprites/{roomCrowdSpread,roomOccupants}.test.ts`, `src/render/sprites/facilities/serviceScale.test.ts`, `src/render/sprites{,.people}.test.ts`, `src/render/originSeedsSweep.integration.test.ts`, `src/tests/originSeedsHarness.ts` | `FACILITIES`, `facilityFloors`, `subtypeListFor`, `*_SUBTYPES`, `hasBusinessHours`, `isOpenAt`, `isElevatorKind` and `isFixedSpanTransport` are replaced by the `catalogKinds` helpers, which read the Rust catalog. | Same assertions, with values from the Rust catalog. |

### Notes

**Rust differences**

- The wedding hall's footprint: the TS `FACILITIES.weddingHall` is 16 wide,
  and the Rust catalog has it 28 wide and 5 floors. The render tests that loop
  over every kind now use the Rust size, and all of them pass.
- Every other width, floor count, population, attendance, car capacity,
  subtype list, hours window and the kind order matched the TS tables. I
  checked this before converting.

**Retired cases**

- `scheduleDialogRules`: "shows what the TypeScript rule set showed" is
  retired. The Rust coverage is
  `catalog::rules_tests::schedule_assist_is_what_the_schedule_queries_answer`,
  and the literal UX case is kept.
- `scheduleDialogRules`: "marks the floors the TypeScript engine's ranking
  marked" is retired. It compared against a TS-only helper. The frontend
  ranking keeps its literal cases, plus the basement case.
- `gameplayCatalog`: the compile-time `sameMilestones` check is retired. The
  Rust coverage is `gameplay::tests::gameplay_event_matches_the_catalog`, and
  the runtime check against `MILESTONE_COPY` is kept.
- `help`: "classifies every MODERN_RULES member" is retired. It is replaced
  by the catalog-rule classification.

**Break-checks.** For each, I made the change, saw the test fail, then
restored it.

- `viewKinds`: dropping `daycare` from the commercial set fails 1 test.
  Changing fastFood's hours to `span(7, 21)` fails 1 test.
- `gameplayCatalog`: removing the `skyline` entry from `MILESTONE_COPY` fails
  1 test.
- `scheduleDialogRules`: changing the basement pin to `[12, -2]` fails 1 test.
- `towerPopulation`: making the gate always reuse its memo
  (`towerPopulation.ts`) fails 4 tests.
- `help`: removing `scheduleAssist` from `CATALOG_RULE_TO_HELP` fails 1 test.
- Catalog fixture: changing `lotWidth` to 374 fails 7 tests across
  `placement`, `regionGrid` and `sceneryLayout`.

**Checks**

- `npx tsc --noEmit` is clean.
- With `src/engine` moved aside, tsc reports no errors in the batch's files.
- `npx eslint` on the 34 files is clean.
- `npx vitest run` on the 32 test files: 566 tests passed.

**Pre-existing guard failures on d9fe30d5 (not from this batch).** Both are in
`src/engine` and go away when the lead deletes it.

- `namedFlags.guard` flags `src/engine/port/viewEncode.ts:126`.
- `testHonesty.guard` flags `src/engine/port/tsEngine.test.ts -> tdtWasm`.

`renderSim.ts`'s doc comment still says the TS `Simulation` satisfies
`RenderSim`. I left it for the lead, since it is not a test file.

## Batch B: schedule, TDT and view integration suites off the TypeScript engine

| File | What changed | Coverage now |
|---|---|---|
| fixtures/scheduleTower.ts | Rebuilt on the port kit: `draftTower` lays the same 20-story tower with the sky lobby at 15, `measure` records telemetry on the fixture, `openEngine` opens a Rust engine from the draft's save, skips floor 6 with `markStop` and seeds the telemetry document | Used by autoTuneProposal and scheduleAuthoring |
| fixtures/autoTuneDouble.ts | Replaced the TypeScript reference double (`referenceEngine`) with `rustScheduleEngine`. It answers `autoTune`, `facts` and `preset` from a real Rust engine holding one shaft shaped like the dialog's fakes (span, cars, kind, served floors, lobbies where a lobby may stand, measured curves and origins). It reads the stops live, caches the engine by shape, and passes `scheduleSlots(draft)` as `editorActions.ts` does | Used by uiDialogs, elevatorScheduleAllCars and scheduleDialogEngine |
| autoTuneProposal | Dropped the TypeScript-vs-Rust comparison. Kept on Rust: the grid of shafts, measures, drafts and day tabs (Classic offers none and answers `unavailable-in-mode`; Modern offers more than 40, and anything else is `insufficient-data`), the refusal statuses, and "asking never writes" | Rust: `schedule_authoring_tests` (12 tests), `wasm_port_life_tests::{a_schedule_reaches_the_shaft_and_reads_back, a_schedule_crosses_as_slots}` |
| scheduleAuthoring | Dropped the comparison. Kept on Rust: the facts and preset refusals (including Classic advice `unavailable-in-mode`), the no-cars statuses, the sky-lobby stop edit moving `topLobby` 15 to 20 (now through `markStop` on the engine), and "asking never writes plus a preset applies as one command" | Rust: `schedule_facts_tests` (16), `schedule_presets_tests` (14), `wasm_port_life_tests::the_facts_and_preset_queries_answer_their_statuses_and_write_nothing` |
| uiDialogs | Schedule UX from `scheduleDialogUX(catalogFor(mode).rules)`; Classic office rungs from `priceOptionsFor(catalogFor("classic"), "office")`; a local `emptyOriginRings`; the double is `rustScheduleEngine`. Three sky-lobby cases now run a 16-story shaft with the sky lobby at 15 (see Notes) | Same 230 tests, on the Rust engine's answers |
| elevatorScheduleAllCars | Classic schedule UX from the catalog fixture; the Rust-backed double | Same 3 tests |
| scheduleDialogEngine | Schedule UX from the catalog fixture; the Rust-backed double for Auto-tune (facts and presets stay per-test stubs) | Same tests |
| tdtExport | `newSeededGame` from towerFixtures replaced with port kit `newSeededDraft`; lot width, lobby interval, office width, rent default and subtypes from the Classic catalog fixture; `SAVE_VERSION` from the engine identity (`readEngineIdentity`/`parseEngineIdentity`) | Same tests |
| tdtImport | Facility widths, populations, max span, lot width and subtypes from the Classic catalog fixture; `SAVE_VERSION` from the engine identity | Same 119 tests |
| tdtRealSaves | `deserializeSave`/`writeVctower`/`readVctower`/`stageTdt` replaced with the Rust engine: `Engine.fromSave`, `encodeVctower`, `Engine.fromVctower`, and the game's import path `loadTdt` then `adoptTdt` | Same 20 tests |
| storageEngineSave | Starting money from the Classic catalog fixture; the current save version from the engine identity | Same tests |
| paintPersistence | Subtypes and the attendance check (`attendance === null`) from the catalog fixture | Same tests |
| viewStateParity | `GRID.maxFloor` replaced with `viewWorld().maxFloor`, the bound world the camera itself reads | Same tests |
| subtypeVisuals | The eight subtype lists from the Modern catalog fixture | Same tests |
| canon | Rewritten on the Classic catalog fixture: pools, max cars, spans, car capacities, world bounds and lot width, tenant populations, starting money, subtype order, spend per customer. Walkway willingness and the star ladder are not catalog facts and moved to Rust | NEW `rule_tests::canon::the_star_ladder_is_the_1994_ladder`; existing `crowd::graph::tests::{the_classic_walk_budget_bounds_the_reach, a_walk_keeps_the_lowest_budget_it_has_met}`, `rule_tests::walkway_willingness` |
| cardVerdicts | `VIEW_LAYOUT.records.shaftCard` replaced with `LAYOUT.records.shaftCard` from `portKit/mockPort` (the checked-in layout fixture) | Same tests |
| onboarding | The onboarding bit order from the layout fixture (`LAYOUT_TEXT`) | Same tests |
| viewLayoutJson | Deleted. It checked `src/engine/viewLayout.json` against the package, and that file goes with the engine | `portReads.integration.test.ts` holds `src/simport/fixtures/viewLayout.json` to the engine's `viewLayout()` |
| engine-rs/src/rule_tests/canon.rs (new), mod.rs | One test pinning `STAR_THRESHOLDS` (300/1000/5000/10000) and `TOWER_POPULATION` (15000) | NEW |

### Notes

- **For the lead:**
  - `package.json` `test:wasm:host` lists `viewLayoutJson`, which is now deleted. Remove that entry.
  - `.github/workflows/engine-rs.yml` line 493 still checks `src/engine/viewLayout.json`.
  - `cardVerdicts` stays on `portKit/converted.txt`, unchanged.
  - autoTuneProposal, scheduleAuthoring, viewStateParity, paintPersistence and subtypeVisuals stay on `test:wasm:host`.
  - uiDialogs, elevatorScheduleAllCars and scheduleDialogEngine now need the engine package for their schedule cases, because the double calls `wasm()`. CI's test job downloads the engine artifact, so they run there, but they no longer pass without the package.
  - The stale comment in `cardVerdicts` that points at `fixtures/scheduleTower.ts` still holds, since the fixture still builds that tower.
- **Rust differences:**
  - The dialog fakes put a sky lobby on floor 8. The engine refuses a lobby off the ground floor and every 15th floor ("Lobbies only go on the ground floor and every 15th floor"), so the Rust-backed double cannot build one there.
  - As a result, three uiDialogs cases ("a Modern preset rewrites both day rows and the staging", "Auto-tune seeds split staging on an untouched shaft", "asks the engine with the working copy...") now use a 16-story fake shaft with its sky lobby at 15. They expect the up-tower homes at 15 instead of 8. Every other case keeps its fakes, because none of their answers depend on a lobby at 8.
  - tdtRealSaves: the import marks `preserveBasementStops` only on the game's import path (`loadTdt` then `adoptTdt`, `engine-rs/src/load/reader.rs`). A plain `fromSave` of the importer's save does not mark it, as the TypeScript `stageTdt` used to do, so the test now imports the way the game does.
- **Retired cases (the TypeScript reference was the whole point):**
  - autoTuneProposal: "the seed on 1, 2 and 3 cars, whichever floor is busiest" and the per-answer equality over the grid. Covered by `schedule_authoring_tests::{untouched_homes_are_seeded_and_hand_set_homes_are_kept, the_seed_keeps_a_one_car_shafts_only_car_at_the_lobby, the_up_tower_half_aims_at_the_busiest_served_boarding_floor, an_aimed_seed_still_keeps_a_one_car_shafts_only_car_at_the_lobby, each_hour_follows_its_load_with_a_one_car_floor_and_the_installed_cap}`.
  - scheduleAuthoring: "facts over every shaft, measurement, draft and day tab" and "every preset on 1, 2, 3 and 8 cars, each shaft kind". Covered by `schedule_facts_tests` (a_warm_day_names_the_over_and_short_hours, each_day_tab_reads_its_own_curve, the_staging_summary_counts_cars_homed_above_the_base, and the rest) and `schedule_presets_tests` (rush_fills_the_peaks_halves_the_shoulders_and_caps_the_night, a_small_fleet_keeps_one_car_and_the_overnight_cap_never_exceeds_it, a_sky_lobby_is_the_up_tower_target_until_its_stop_is_skipped, and the rest).
- **Break-checks** (each restored afterward):
  - The Rust-backed double built without sky lobbies (`LOBBY_INTERVAL` set to 1000): the three sky-lobby uiDialogs cases failed.
  - The fixture `catalog.classic.json` elevator pool cap set to 25: canon failed.
  - scheduleAuthoring with the sky-lobby `markStop` removed: the stop-edit case failed.
  - autoTuneProposal expecting one Classic proposal: failed.
  - `TOWER_POPULATION` set to 15001 in `engine-rs/src/star.rs`: `rule_tests::canon` failed.
  - tdtRealSaves opened through `fromSave` instead of `loadTdt`/`adoptTdt`: the basement-stop case failed (seen while converting).
- **Checks run:**
  - `npx tsc --noEmit` and `npx eslint` are clean on the batch files.
  - The 15 batch suites pass together (554 tests).
  - `cargo fmt --check` and `cargo clippy --features wasm --tests -D warnings` are clean; `rule_tests::canon` passes.
  - The fileSize, namedFlags and testHonesty guards fail only on files under `src/engine/` (Tower.test.ts, port/viewEncode.ts, port/tsEngine.test.ts), which the lead deletes.

## Batch C: diagnostics and economy suites off the TypeScript engine

| File | What changed | Coverage now |
|---|---|---|
| `integration/conformanceWasmDiagnostics` | The TypeScript facts reference and the inspector-card agreement run are gone. The suite now runs the whole corpus (the `PAST_THE_TYPESCRIPT_REFERENCE` filter is dropped) on the Rust engine alone. It reads `diagnosticFacts` for every room before each hash, requires each answer to name the unit it was asked about, and requires the pinned hashes to reproduce (asking moves nothing). The section-reach check is unchanged. | Here, plus Rust `diagnostics::tenant_tests::*`, `diagnostics::memo_tests::{asking_changes_nothing_in_classic, asking_changes_nothing_in_modern}`, `rule_tests::diagnostics_towers::*`, and `cardTextParity` for the text |
| `integration/conformanceWasmDiagnosticsServices` | The TypeScript reads are gone and it runs the whole corpus on Rust. Kept: reads of every room's `serviceDiagnostics`, every shaft card and recycling, at every checkpoint and around reloads; the hash reproduction; no gameplay event left pending; the header-slot check; the read count (checkpoints + 2 per reload); and the exact section list. The inert-room rule (no parking, housekeeping or retail section) now runs on the Rust answers. `isCommercialKind` comes from catalog `.commercial`, and the layout from `src/simport/fixtures/viewLayout.json`. | Here, plus Rust `wasm_port_reports_tests::keyed_service_diagnostics_*`, `cardVerdicts`, `cardTextParity` |
| `integration/wasmHostTelemetry` | Rust only. Each fixture opens through `Engine.fromVctower` and runs hour by hour across 48 hours, then 26 hours of weekend. Every hour: the document must pass `isTelemetryDocument` (what the host adopts); every shaft id must be a real transport; inside one day, a weekday hour must leave the weekend rings alone and the reverse; the housekeeping report must have the `{cleaned, leftover}` shape; commute stress must be sorted by floor. The "real values seen" flags are kept. The week lengths are named literals mirroring `CANON` and `REAL_WORLD` in `engine-rs/src/clock.rs`. | Here, plus Rust `crowd::tests::commute_stress_lists_each_floor_in_order`, `panels::tests::transport_detail_lists_stops_and_the_telemetry_slice` |
| `integration/wasmHostLogText` | Rust only, same run shape (a day, then across a quarter, then across a maintenance period; periods from the catalog's calendars). Asserts every `$` amount is grouped in threes; every counted noun (office, condo, clinic, club, rental, hotel room) agrees with its count; and every rent, maintenance (both wordings) and checkout line matches its exact template, with at least one of each written. | Here |
| `integration/overheadEngine` | `ECON.overheadPerLeasableUnitMonthly` and `ECON.condoMonthlyTaxRate` became `catalogFor("modern").economy.{overheadPerUnitMonthly, condoHoldTaxRate}`; `rentConfig("condo").default` became the Modern condo band default. | Same assertions, catalog-derived |
| `integration/condoModesEngine` | `ECON.rent.condo.default` became the Modern catalog's condo band default (160,000). | Same |
| `integration/condoRelocation` | Deleted. It tested the TypeScript `CLASSIC_RULES/MODERN_RULES.condoRelocationChance` seam. | New Rust `rule_tests::condo_relocation::{classic_never_relocates_a_condo, modern_scales_the_chance_with_the_household_size}`; departures stay in `condoRelocationEngine.integration` |
| `integration/roomTiersWasm`, `integration/lobbyFloorCharge` | `facilityFloors` became `floorsOfPort(port)` (`src/game/portAccess.ts`, the engine's own catalog, as the app sizes rooms). | Same |
| `integration/nextStarRequirements` | `FACILITIES.*.width` now comes from the catalog. `STAR_THRESHOLDS` and `TOWER_POPULATION` are named literals citing `engine-rs/src/star.rs`. | Same |
| `integration/milestones` | `MILESTONES.find(label).id` became the milestone ids (`"pop-500"`, `"well-served"`, typed `GameplayMilestoneId`); office width now comes from the catalog. | Same |
| `integration/personRoundTripVenueCap`, `segmentRoutingMealRush`, `venueOccupancy` | `FACILITIES.<kind>.<field>` became `facility(kind)` from the Modern catalog fixture. The catalog writes a missing attendance as `null`, so the "keeps none" checks use `toBeNull`. | Same |
| `integration/batchPricing` | `PRICED_KINDS` comes from the kinds with a `rent` in the Modern catalog. `rentOf` is a local reader over the save: No Rate reads 0, else the stored price, else the catalog default (it takes a mode where the modes differ, and throws if a kind's defaults differ and no mode is given). The plain `describe` that unit-tested the TypeScript `rentOf` is retired. | Rust `rule_tests::condos::a_no_rate_unit_never_sells_or_leases_and_earns_nothing`, `rule_tests::pricing_split::{a_vacant_no_rate_office_never_fills_and_its_twin_does, a_reprice_puts_a_no_rate_unit_back_on_the_market}`, and this suite's own No-Rate cases on the engine |
| `integration/roomCountsEngine` | `TALLIED_VENUES` comes from catalog `commercial && population > 0`. | Same; it runs `walkedStats` (below) |
| `fixtures/walkedStats.ts` | Rewritten without the engine. The census walk uses the catalog (`catalogResidents`, `.commercial`, `.population`, `.hotel`) plus a named `CENSUS_FOLLOWS_THE_DAY` set mirroring `census_follows_the_day` in `engine-rs/src/economy/visitors.rs`. | An independent walk the engine's kept counts are held to |
| `conformance/fixtureSim.ts` | Now holds only the `FIXTURES` list (`loadFixture` and its TypeScript load are gone). The two wasmHost suites open fixtures with `Engine.fromVctower`. | n/a |
| `diagnostics/inspectorRetailStats.test.ts` | Rewritten as a plain test of the shipped `retailDisplayLines`: each phrase once and one bar; inactive means no block; noData; verdict colors; the rain and profit lines; plurals; bar width; the local-demand and advice lines. The cases that tested the TypeScript verdict math are retired. | Rust `diagnostics::service::tests::{yesterday_is_the_only_basis_for_the_business_verdict, demand_advice_is_modern_only_and_uses_raw_tower_pressure, the_traffic_mean_keeps_todays_value}`, new `rule_tests::retail_yardstick::*` |
| `diagnostics/facilityDiagnostics.ts` + `.test.ts`, `gripeCopy.ts`, `housekeepingDiagnostics.ts`, `inspectorAgreement.ts`, `tsDiagnosticFacts.ts` | Deleted (the TypeScript reference card). | See Notes |
| `diagnostics/facilityDiagnosticsCatalog.test.ts` | Deleted. It held the catalog to the old TypeScript tables (#921 migration); with the tables gone, a catalog-only rewrite would only restate `hasAccessDiagnostic`. | Rust `diagnostics::tenant_tests::the_access_line_gate_matches_the_catalog_values`; `conformance/catalog-digests.json` pins the catalog's `population`, `dailyIncome` and `spendPerCustomer`; `rule_tests::retail_yardstick` covers the Modern yardstick in both modes |

New Rust tests: `engine-rs/src/rule_tests/condo_relocation.rs` (2) and `engine-rs/src/rule_tests/retail_yardstick.rs` (2), registered in `rule_tests/mod.rs`.

### Notes

**Lists.** No suite moves on or off `test:wasm:host` or `portKit/converted.txt`. The renamed and kept suites keep their names (`conformanceWasm*`, `wasmHost*`, `lobbyFloorCharge` and `roomTiersWasm` still match). `condoRelocation.integration.test.ts` is deleted, but it was on neither list.

**No shared helper was added.** `fixtureSim.ts` and `walkedStats.ts` are in the batch.

**Rust differences found.** None that look like bugs:
- `conformanceWasmDiagnosticsServices` now also reaches `inert:cinema` and `inert:shop`. These come from `ransom-ignored-modern`, the scenario the old TypeScript filter skipped (its own comment predicted them). They are added to the section list.
- The catalog writes a venue's missing `attendance` as `null` (the TypeScript table left it undefined).
- The Modern condo default is 160,000 and the Classic ladder default is 150,000. The TypeScript `rentOf` had one default for both, so `batchPricing`'s sold-condo case now reads the Modern default explicitly.

**Retired reference-card cases and their Rust/golden coverage** (`facilityDiagnostics.test.ts`, `inspectorAgreement`, `tsDiagnosticFacts`). The shipped card's text for every kind and state is held by the `cardTextParity` golden (cases: service rooms, retail venues and rainy day, lobby distance, every kind in each state, every transport, crowded lift, recycling, winning tower). The facts behind it:
- Access lines (reachable, not connected): `diagnostics::tenant_tests::{access_reads_each_connection_state, a_ground_connected_floor_no_rider_reaches_reads_no_route}`.
- On-notice text and the recovery target, and relocation framing: `tenant_tests::the_notice_counts_down_and_never_goes_negative` and `cardTextParity` "every kind, *".
- Housekeeping, dirty and infested rooms, the mode-specific fix, maid staffing: `wasm_port_reports_tests::{keyed_service_diagnostics_keep_housekeeping_decisions_in_rust, keyed_housekeeping_fixture_emits_observed_shortfall_only_with_hotel_rooms}`, `rule_tests::housekeeping_legibility`, `rule_tests::infestation`, `cardTextParity` "service rooms(, unhappy)".
- Lobby-distance slot advice (above the top, on the top, bare floor, tenant on the slot, a room on the slot, the tower's top): `tenant_tests::{the_slot_search_walks_only_legal_free_slots_nearer_than_the_lobby, lobby_distance_names_the_slot_and_the_work_it_needs, a_room_past_a_lobby_on_the_last_slot_finds_no_slot, classic_lobby_distance_sinks_only_in_the_very_far_band}`, `rule_tests::diagnostics_towers::a_slot_one_story_above_the_top_needs_no_support_and_two_stories_does`, `cardTextParity` "lobby distance(, unhappy)".
- No Rate lines and their order: `tenant_tests::no_rate_reads_occupied_or_off_the_market`, `cardTextParity` "every kind, *".
- Gripe and won't-lease facts: `tenant_tests::{main_gripe_names_rent_and_stays_off_for_content_or_leaving_tenants, a_noise_gripe_carries_its_sources, wont_lease_names_the_gate_cause_and_the_carrying_cost, the_carrying_cost_is_overhead_plus_a_condos_hold_tax, walkway_bindings_name_their_class_and_the_elevator_stop}`, `memo_tests::the_main_gripe_reads_coverage_only_past_the_causes_that_outrank_it`.
- Classic shop on the Modern yardstick: new `rule_tests::retail_yardstick::both_modes_score_a_shop_against_the_same_average_good_day`.
- Bar width and negative clamp: new `retail_yardstick::the_bar_fills_with_todays_count_against_the_yardstick`.

**Break-checks** (each broken once, the test seen failing, then restored):
- `rule_tests::condo_relocation`: dropped the household scaling in `engine-rs/src/rules.rs`. 1 of 2 failed.
- `rule_tests::retail_yardstick`: scored against `commercial_daily_income(mode)` (the sellout ceiling) in `diagnostics/service.rs`. 2 of 2 failed.
- Catalog fixture edits:
  - Overhead 700 to 701 and hold tax 0.015 to 0.016: `overheadEngine` failed 2.
  - Condo default 160,000 to 170,000: `condoModesEngine` and `batchPricing` failed.
  - Fast food population 25 to 26: `venueOccupancy` failed 3.
  - Office width 9 to 10: `milestones` failed.
- `nextStarRequirements`: `STAR_THRESHOLDS[2]` 300 to 301 and `TOWER_POPULATION` 15000 to 15001. 2 failed.
- `walkedStats`: dropped `shop` from `CENSUS_FOLLOWS_THE_DAY`. `roomCountsEngine` failed.
- `wasmHostLogText`: an ungrouped-amount pattern failed, and so did a flipped plural rule.
- `wasmHostTelemetry`: comparing the same day's ring instead of the other one failed.
- `conformanceWasmDiagnosticsServices`: an inverted inert rule failed 8 scenarios.
- `conformanceWasmDiagnostics`: an inverted identity check failed 27.
- `inspectorRetailStats`: always pluralizing in `retailDisplayLines` failed 1.

**For the lead.**
- Stale comments outside the batch still point at `src/tests/diagnostics/` as the TypeScript reference card: `src/game/cardKit.ts:22`, `src/game/recyclingDiagnostics.ts:7`, `engine-rs/src/diagnostics/mod.rs:3`, and the `TRAFFIC_FACTOR_MEAN` comments in `engine-rs/src/diagnostics/service.rs`, which mention "the WASM parity tests" and the TypeScript reference.
- The two converted diagnostics suites import `CONFORMANCE_DIR`, `firstDivergence`, `loadScenario`, `runScenario`, `Checkpoint` and `ScenarioEngine` from `scenario.ts`, and `hasWasmPackage`, `wasm`, `startWasmHandle`, `reloadWasmHandle` and `wasmEngine` from `wasmEngine.ts`. Batch D must keep these. They no longer use `tsEngine`, `startTsSim`, `reloadTsSim` or `PAST_THE_TYPESCRIPT_REFERENCE`.
- The base branch already fails `fileSize`, `namedFlags` and `testHonesty` on files under `src/engine/`. These go away with the folder.

## Batch D: the conformance harness and the simport type tests (#1875)

| File | What changed | Coverage now |
|---|---|---|
| src/tests/conformance/scenario.ts | Dropped the TypeScript runner (`tsEngine`, `startTsEngine`, `startTsSim`, `reloadTsSim`, the `stateView`/`crowdView` re-export, `PAST_THE_TYPESCRIPT_REFERENCE`). `runScenario` now takes `start` as required. Every other export is kept. | The runner drives the Rust engine through `startWasmEngine`; conformanceWasm, fuzzWasmLeg and the suites below |
| src/tests/conformance/scenarioSchema.ts | The kind and transport checks read the checked-in Rust catalog (`simport/fixtures/catalog.classic.json`) through `readCatalog`, found from this module's own path so the fuzz scripts can load it as ESM | scenario.test.ts ("refuses a shaft built as a room"), break-check 2 |
| src/tests/conformance/chargeOps.ts | Dropped `tsCharges` and `chargeOf` | chargeOps.test.ts |
| src/tests/conformance/checkpointDetail.ts | Dropped `tsFxSlots` and `tsCheckpointDetail` | The WASM record is held to the native Rust golden by fuzzWasmLeg.integration.test.ts |
| src/tests/conformance/checkpointDetail.test.ts | Retired the two TS-engine cases; kept the DetailError case | fuzzWasmLeg.integration.test.ts (record vs native Rust) |
| src/tests/conformance/fixedStepCases.ts | Deleted (the TS host loop that wrote the cases) | engine-rs/tests/fixed_step.rs replays the pinned JSON (its doc comment is updated) |
| src/tests/conformance/fixedStepCases.test.ts | Dropped the TS replay; kept the coverage check on the pinned file, with named constants | engine-rs/tests/fixed_step.rs; break-check 3 |
| src/tests/conformance/canonical.ts | `canonicalJson` moved in from src/engine/canonicalJson.ts | canonical.test.ts; engine-rs/src/canonical.rs |
| src/tests/conformance/wasmEngine.ts | Its own `rentOf`: noRate is 0, else the unit's rent, else the kind's default from the live catalog (`readCatalog(wasm(), mode)`) | tuneOps adjustRent through starter-classic and starter-modern; break-check 9 |
| src/tests/conformance/tdtWasm.ts | Dropped `installTdtCodec` (it fed the TS engine's codec) | parseTDT and buildTDT are unchanged |
| src/tests/conformance/panelProbe.ts | Kept `HEATMAP_MODES` and `probedWasmStart`; the TS probe, `pickIds`, `firstDifference` and `probedTsStart` are gone | panelGettersWasm, panelGettersCost |
| src/tests/conformance/tsPanels.ts | Deleted (the TS panel reference) | Rust panel getters, panelGettersWasm |
| src/tests/conformance/tuneOps.test.ts → tuneOps.integration.test.ts | Moved to integration; the runner drives `startWasmEngine` | Also engine-rs/src/scenario_tune_tests.rs (native runner) |
| src/tests/conformance/scenarioStar.test.ts → scenarioStar.integration.test.ts | Same | Also engine-rs/src/scenario_star_tests.rs |
| src/tests/conformance/scenarioReason.test.ts → scenarioReason.integration.test.ts | Same | Also engine-rs/src/scenario_reason_tests.rs; break-check 10 |
| src/tests/conformance/fuzzReplay.test.ts → fuzzReplay.integration.test.ts | Calls `replayCompare` with its real default, the WASM build, in place of the TS stand-in. The "Rust records" each case writes come from that build's run, edited per case. The trap wrappers free the real instance. | break-check 11 |
| src/tests/conformance/fuzzCorpus.test.ts | Dropped the TS run of each entry; kept the format checks | fuzzWasmLeg.integration.test.ts and the corpus job replay every entry on Rust |
| src/tests/integration/conformanceWasmStar.integration.test.ts | Retired (it compared TS and WASM starts at each star) | fuzzWasmLeg (corpus at Classic 2, 3, 4, 5 and Modern 5, WASM vs native Rust); engine-rs/src/scenario_star_tests.rs |
| src/tests/integration/fxSequences.integration.test.ts | Dropped the TS half; the pinned fx values hold on the shipped build alone | break-check 4 |
| src/tests/integration/panelGettersWasm.integration.test.ts | The TS-vs-Rust getter differential is retired. Now, at every checkpoint of every conformance scenario (the four past the TS reference included), the stats screen the game decodes from `statsSheet` must equal the engine's `statsReport` getter, and every other getter must answer JSON. The read counters and the bad-id test are kept. | break-check 1; Rust panel getters (`engine-rs/src/panels/`) |
| src/tests/integration/panelGettersCost.integration.test.ts | Unchanged (only `HEATMAP_MODES`, still exported) | itself |
| src/tests/integration/gameControllersCoverage.integration.test.ts | Dropped the `installTdtCodec` call; `itTdt` only skips without the package | itself (passes) |
| src/simport/tsPanels.test.ts | Deleted (TS adapter answers vs `Simulation`) | panelGettersWasm (statsSheet decode vs the getter); portReads.integration.test.ts "the header's clock on the engine" (mode and calendar on the header) |
| src/simport/panels.types.test.ts | Deleted (`Simulation` return types vs the answer types) | n/a: a TS-engine seam |
| src/simport/enginePort.types.test.ts | Dropped the `TsEngine` case; the binding's `Engine` still satisfies `EnginePort` | itself |
| src/simport/view.types.test.ts | Dropped the cases that held TS-engine objects to the view types; kept read-only views, result types and the checker directive | itself |
| src/simport/engineSubject.fixture.ts | The layout comes from `simport/fixtures/viewLayout.json` (exported as `VIEW_LAYOUT`), codes from it with a throwing lookup, and floors from `floorsOfPort(port)` (the catalog) | engineContract, engineLifecycle, engineQueries users (pass) |
| src/simport/engineQueries.fixture.ts | `VIEW_LAYOUT` from engineSubject.fixture | Same |
| src/tests/portKit/rooms.ts | Floors from `floorsOfPort(sim.port)` | attendanceTripwireEngine (passes) |
| src/tests/goldens/{frameDays,portEdits}.test.ts | Unchanged; they broke only through canonical.ts | pass |
| src/tests/conformance/{reloadCheck,fuzzKey,fuzzScripts,fuzzCorpusEntries,fuzzCompare,fuzzShrink}.test.ts | Unchanged; they pass once scenario.ts and scenarioSchema.ts no longer need src/engine | pass |

### Notes

- **The lead needs to update the suite lists.** Five suites became integration tests: `tuneOps`, `scenarioStar`, `scenarioReason` and `fuzzReplay` (all under `src/tests/conformance/`), and `conformanceWasmStar` was retired. Consider adding the four new `*.integration.test.ts` to `test:wasm:host`. They skip without the package. `conformanceWasmStar` was covered by the `conformanceWasm` prefix there already.
- **Allowlist entry for the lead to delete.** `src/tests/testHonesty.allow.txt` line 4 still names `src/tests/conformance/fuzzReplay.test.ts`. That file is gone, so the guard's "keeps every allowlist entry live" case fails until the line is removed.
- **Cross-batch breaks.** These are not edited here, because they belong to other batches:
  - `conformanceWasmDiagnostics` and `conformanceWasmDiagnosticsServices` (batch C) import `tsEngine`, `startTsSim`, `reloadTsSim` and `PAST_THE_TYPESCRIPT_REFERENCE`, which are gone.
  - `tdtRealSaves` and `viewStateParity` (batch B) call `installTdtCodec`, also gone.
  - `src/engine/port/tsEngine.test.ts` does too, but it is deleted with the engine.
  - `fixtureSim.ts` is batch C.
- **Script left as is.** `scripts/loader-case-dump.ts` imports `src/engine/Simulation` directly and `stateView` from scenario.ts (now removed). It prints the TS loader's view, so it goes with the engine.
- **Rust differences.** None found. Two notes:
  - The catalog lists `rentalApartment` and `rentalStudio`, which the TS `FACILITIES` keys did not, so the scenario schema now accepts them.
  - `floorsOfPort` gives the wedding hall its Rust height (five stories) where `facilityFloors` gave one. The contract fixtures and `roomTallies` pass with it.
- **Weak spot in the rent read.** In the WASM adapter, the rent only feeds the runner's "did adjustRent move it" check. A wrong *default* rent goes unseen (break-check 6), because the first adjust writes an explicit rent. A constant rent is caught (break-check 9).
- **Gap after retiring conformanceWasmStar.** A Modern game opened at 2, 3 or 4 stars has no WASM-vs-native check. The corpus covers Classic 2 to 5 and Modern 5.

### Break-checks

Each check made one edit, ran the named suite, then restored the file. The working tree was verified clean afterward.

| # | Edit | Result |
|---|---|---|
| 1 | `statsSheet.ts` `orNull` returns 0 for NaN | panelGettersWasm fails on every scenario |
| 2 | schema `place` accepts any listed kind | scenario.test "refuses a shaft built as a room" fails |
| 3 | `CATCHUP_CAP_MINUTES` 30 → 29 | fixedStepCases.test fails |
| 4 | fx pin `santaFxSeq` 2 → 3 | fxSequences holidays-classic fails |
| 5 | adapter rent for noRate 0 → 1 | not seen (no scenario adjusts a No Rate unit) |
| 6 | adapter default rent → 7 | not seen (see the weak-spot note above) |
| 8 | adapter explicit rent → 0 | not seen (the default stays unequal to the new explicit rent) |
| 9 | adapter rent constant 0 | conformanceWasm starter-classic, starter-modern and the twice-run case fail |
| 10 | runner reason comparison removed | scenarioReason "fails, naming both" fails |
| 11 | fuzzCompare `money` renamed | fuzzReplay agreement and divergence cases fail |
