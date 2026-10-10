---
story: engine-test-parity
status: in progress
depends_on: engine-wasm-switch
---

# Story: test parity, the suites running on the WASM engine

Roadmap row 4b, GitHub issue #878, backlog row `engine-rs-test-parity`.

## Why

After the switch story (#877) everything but the vitest suites runs on both
engines: the conformance scenarios through the binding, the dual run, the
host fidelity gate, and the e2e suite under a second Playwright project.
The unit and integration vitest suites (about 4,270 tests) still construct
`Simulation` directly and assert on internals between hours, so they prove
the TypeScript engine only. Before the default flips (the 3.0.0 milestone in
row 4) and before the TDT port (row 5) merges, those suites have to run on
the WASM engine too, and every test that cannot has to be named with its
reason. The owner set this order on 2026-10-09.

## Acceptance criteria

1. **AC1 The vitest suites run on the WASM engine.** A vitest project
   attaches the WASM host to every `Simulation` the tests create and
   refreshes the instance before assertions, so the integration (and, where
   feasible, the unit) suites run on the engine in CI next to the
   TypeScript run. Failures are triaged into engine divergence (fixed and
   pinned), read-model gaps (filled, or named against #868) and
   TypeScript-only internals (kept on the TypeScript project with a reason).
2. **AC2 The helper-scripted e2e specs drive relayed commands.** The specs
   that script a tower through test helpers on the instance
   (`e2e/helpers.ts` `buildToStar`, `crowdCull.spec.ts` placing transports
   on the tower directly, `integration.spec.ts` writing `events.pending`)
   move onto relayed commands (`sim.build`, `sim.buildTransport`) so the
   `chromium-wasm` project exercises the engine, or are marked
   TypeScript-only on that project with a reason.
3. **AC3 The screenshot gallery and the visual baselines render on the WASM
   engine.** `scripts/screenshots.ts` and the visual baselines render with
   the engine hosting the tower, and the existing drift gate
   (`pr-drift-check`, `update-visual-baselines.yml`) is the pixel parity
   check: a pixel difference between the engines is a parity finding. At
   the flip the committed gallery and the minted baselines come from the
   WASM engine.
4. **AC4 The test-mapping table.** This file carries a table naming every
   test file that stays TypeScript-only, its bucket and its reason, and the
   count of tests that pass on the engine.

## Out of scope

- The default flip itself (row 4, 3.0.0) and the TypeScript engine's
  retirement (row 7).
- The read model's faster shapes (typed arrays over WASM memory, a
  structural snapshot instead of a save deserialization) and the getters the
  save does not carry (#868), except where a test here names the field.

## Slice 1: the mechanism and the first triage (2026-10-09)

### The mechanism

Two vitest projects, `integrationWasm` and `unitWasm`, mirror the two
tiers with one setup file, `src/tests/parity/wasmHostSetup.ts`. They exist
only under `VC_REQUIRE_WASM=1` (the switch `npm run test:wasm` already
sets), so `npm test` and the coverage gate run the TypeScript tiers exactly
as before; `npm run test:wasm:parity` runs them. The suites that attach a
mirror or a host themselves (`dualRunDay`, `dualRunEdits`, `wasmHost`,
`conformanceWasm`) are left out of `integrationWasm`, since a second host
on one instance is refused and the referee's TypeScript side has to stay
TypeScript.

The hook is a wrap of `Simulation.prototype.tick`, chosen over a module
mock of the construction points (`new Simulation`, `Simulation.newGame`,
`Simulation.deserialize`, the fixture helpers in
`src/tests/fixtures/towerFixtures.ts`) for two reasons. One hook covers
every construction path, the `.vctower` fixture loads included, and no test
file changes. And attaching at the first tick rather than at construction
lets a test set its tower up the way the suites do today (`tower.place`,
a direct field write) before the engine starts from the instance's own
save, so setup that bypasses the command relay still reaches the engine.

Per tick the wrapper does three things:

1. Before the tick it compares the instance's own state view with the
   engine's: in the default tick mode on every tick while the crowd is
   empty, and once the crowd exists on a tower revision move or a change
   in a cheap fingerprint of the fields tests write directly (the clock,
   money, weather, star, and each unit's state, rent, occupancy and
   satisfaction counters), taken after every sync; under
   `VC_WASM_SYNC=hour` on a revision or fingerprint move only. A relayed command
   (`sim.build`) moved both in step and they agree. A
   disagreement is an edit the relay does not carry (`tower.place`, a direct
   unit write) or a divergence on a relayed command. While the crowd is
   still empty the engine is restarted from the instance's save (a
   re-host, the same start a load gets). Once the crowd exists the tick
   throws a `WasmParityError` naming the first differing path, because a
   restart would drop the crowd and hide the difference. A counter stamped
   on the instance before the first tick (`customersIn`) raises no parity
   error: the state view leaves it out, and the first frame sync replaces
   it, since the frame carries it as engine-owned.
2. The tick runs on the engine through the host's relay tick (`engine.tick`
   plus the frame sync).
3. After the tick the engine's full save is merged into the instance
   (`host.syncStructure()`), so an assertion between hours reads the state
   the engine holds after that tick. `VC_WASM_SYNC=hour` keeps the
   host's own cadence (frame sync per tick, merge on an hour pass or a
   revision change) for a cost comparison.

Every host is detached after each test, so the engines are freed and the
instances are plain TypeScript simulations again. A test that never ticks
and never calls `callExterminator` is never hosted (the `callExterminator`
hook hosts the instance before the first tick, see slice 2); it exercises
the TypeScript command surface only, and the table counts it as such.

No CI job runs the parity projects yet. Adding `test:wasm:parity` to
`test:wasm` (which CI runs) waits until both projects pass.

### The cost (measured on this machine, one worker)

| Tower | `tick(1)` TypeScript | `tick(1)` hosted (frame sync) | `syncStructure()` | `engine.serialize()` | own `serialize()` | `frameView()` |
| --- | --- | --- | --- | --- | --- | --- |
| `newSeededGame` (40 lobby tiles, no crowd) | 0.009 ms | 0.037 ms | 0.30 ms | 0.04 ms | 0.05 ms | 0.002 ms |
| `towerone-star4.vctower` (139 people after an hour) | 1.06 ms | 3.72 ms | 75.6 ms | 11.7 ms | 17.1 ms | 0.38 ms |
| `sixseven_2.vctower` (140 people after an hour) | 1.70 ms | 3.47 ms | 69.1 ms | 11.2 ms | 17.5 ms | 0.36 ms |

The merge per tick is cheap on the small towers most suites build (a day of
minute ticks adds under half a second) and prohibitive on the fixtures (a
day of minute ticks would add nearly two minutes), which is what #868's
structural snapshot is for. The whole-suite numbers are in the triage
below.

### The runs (2026-10-09, this machine, after the fixes below)

| Project | Files | Pass | Fail | Skip | Wall time | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `integrationWasm` (merge per tick) | 86 | 1596 | 61 | 1 | 296 s | 26 files fail |
| `integrationWasm` (`VC_WASM_SYNC=hour`) | 86 | 1596 | 61 | 1 | 142 s | the same total: `fixedStep`'s four timeouts pass, and the pre-tick direct writes the hour cadence cannot compare fail instead (`reviewFixes`, `venueOccupancy`, `faqComplete`, two `condoRelocation` cases) |
| `unitWasm` (merge per tick) | 204 | 2523 | 4 | 0 | 124 s | 3 files fail |
| `integrationWasm` (merge per tick), after slice 2 | 86 | 1628 | 19 | 11 | 323 s | 10 files fail; the 11 skips are the 10 `itTypeScriptOnly` marks plus the one pre-existing skip |
| `unitWasm` (merge per tick), after slice 2 | 204 | 2525 | 2 | 0 | 143 s | 2 files fail, both the merge-per-tick cost |
| `integrationWasm` (merge per tick), after review round 1 | 87 | 1610 | 8 | 46 | 374 s | 4 files fail, all named in the table; the 46 skips are the 41 `itTypeScriptOnly` marks plus 5 pre-existing (the opt-in hour-cost bench, the disc reader without its package); the 87th file is the setup's own spec (`src/tests/parity/wasmHostSetup.integration.test.ts`) |
| `unitWasm` (merge per tick), after review round 1 | 204 | 2537 | 2 | 0 | 136 s | 2 files fail, both the merge-per-tick cost; `dualRun.test.ts` left the project |

The first run, before any fix, failed 90 integration tests in 32 files and
took 1046 s, of which 936 s was `conformance.integration.test.ts` alone
(the TypeScript referee serializing fixture towers every tick); that file
and the loader-case lock writer now sit outside the project (their engine
twins are `conformanceWasm` and the Rust replay test).

### What the first triage found

- **Bucket (a), engine divergence, is small but real, and all of it is
  log text**, which the conformance hash strips. The Rust engine logged the
  vacate-reason key (`access`) where the TypeScript engine logs the player
  phrase (`no route to the lobby`), dropped the per-cause tally from the
  multi-tenant notice, and formatted the condo sale without the thousands
  separator and without the household wording. Fixed in `engine-rs`
  (`vacate_reason_text`, `emit_notices`, the sale and buy-back lines), with
  Rust unit tests; the parity suites are the pin, since no scenario digest
  can see log text. Still open: the buy-back line's trailing note (off the
  market, stays empty until the cause is fixed, the congestion churn note),
  which needs `bindingTransportClassAt` ported, and the stranded-floor
  advisory firing on the engine for a floor of gutted, burning and
  under-construction shells (`legibility.integration.test.ts:207`), to
  confirm with a scenario.
- **Bucket (b), read-model gaps, dominates (31 of 61 integration failures,
  3 of 4 unit failures)**, and nearly all of it is one gap: the per-frame
  person record carries position and state only, so every test that reads a
  person's routing (`originUnitId`, `venueUnitId`, `mealVenueId`,
  `countedHotelGuest`, `routine`, `returning`, `floors`) sees placeholders.
  The rest is #868's list: `elevatorStats` (`elevatorUtil`), the
  housekeeping report, and the crowd's `commuteStressByFloor`, which no
  save carries.
- **A fourth cause the three buckets did not name: un-relayed writes after
  the crowd exists (13 integration failures).** A test that edits the
  tower through `tower.place`, `tower.placeTransport`, a direct unit field
  write (`condo.rent = 240_000`, `b.state = "dirty"`), a subsystem call
  (`economy.hotelCheckout()`, `economy.dispatchHousekeepers()`) or a clock
  write mid-run drives the instance and never the engine. The mechanism
  carries such writes while the crowd is still empty (the re-host) and
  names them once it exists (`WasmParityError` at the first differing
  path). These are the vitest twins of the e2e specs AC2 names: the next
  slice moves them onto relayed commands or keeps them TypeScript-only
  with a reason. Four of them are a load artifact rather than a write: the
  host always starts from a save, and loading a founded Classic tower
  snaps a `tower.place`d condo's rent onto the 1994 ladder (both engines
  agree on the load; the test's TypeScript instance was never loaded).
- **Bucket (c), TypeScript-only (11 integration failures plus the files
  left out of the project)** is the v1 sampled simulation model
  (`simModel = "v1"`, which the save does not carry and the port never
  had), the TypeScript serializer's own round-trip and hardening tests
  (the hosted `serialize` is the engine's), and the TypeScript golden
  master hash (the engine's golden master is row 4's own gate).
- **Cost:** the merge per tick is what makes the suite honest, and it is
  what times out the five fixture-driven tests (`fixedStep` and the
  `rooms` census test tick a 12,000-unit save hundreds of times). The
  structural snapshot in #868 is the fix; until then those five run only
  under the hour cadence.

### Test-mapping table (after review round 1)

Buckets: (a) engine divergence, (b) read-model gap, (c) TypeScript-only,
(d) un-relayed write after the crowd exists, (cost) merge-per-tick
timeout, (fixed) a slice 1 row that passes now. Counts are failing tests
out of the file's total under `integrationWasm` (merge per tick) or
`unitWasm`; "(n marked)" counts the tests the file keeps TypeScript-only
through `itTypeScriptOnly`, which the parity projects skip under the test's
name suffixed with `[TypeScript-only: <reason>]`, the reason this table
repeats.

| Test file | Fails | Bucket | Reason |
| --- | --- | --- | --- |
| `attendanceTripwire.integration.test.ts` | 0/12 (4 marked) | d | three jump the clock after the crowd exists (one of them also rebuilds the venue through an un-relayed `tower.place` mid-run), one drives the event system directly (`events.restore`, `events.pending`) mid-run; the other five read the routing fields slice 2 added |
| `cockroachInfestation.integration.test.ts` | 0/14 | fixed | the booking is relayed: `callExterminator` hosts the instance ahead of the first tick (see slice 2) |
| `commuteStress.integration.test.ts` | 2/9 | b | `crowd.commuteStressByFloor`, a live accumulator no save carries (#868) |
| `condoModes.integration.test.ts` | 0/28 (2 marked) | d | the condo is built through `sim.build` (the Classic ladder's Average rung, $150,000, on every engine), its construction finished by ticking past `completeAt`, and the No Rate flag set through `sim.setNoRate`; the two load-clamp tests forge prices on a placed condo that never ticks; two stay TypeScript-only: the re-list test writes `condo.rent = 240_000` after the sale, when the crowd exists and no re-host runs, so the write never reaches the engine and the next merge overwrites it, and the unpriced band default of a `tower.place`d condo on a never-loaded tower (the load snaps it onto the ladder) |
| `demographicRoutines.integration.test.ts` | 0/11 | fixed | reads `routine` and `originUnitId`, which the frame carries now |
| `condoRelocation.integration.test.ts` | 0/8 (6 marked) | c | `simModel = "v1"` in the shared fixture (one monthly roll per tick) |
| `economyDepth.integration.test.ts` | 0/8 (5 marked) | c | `simModel = "v1"` (the sampled model is not in the save and not ported) |
| `elevatorStats.integration.test.ts` | 1/3 | b | `elevatorStats()` reads `elevatorUtil`, which the engine does not fill (#868) |
| `faqComplete.integration.test.ts` | 0/26 (2 marked) | d, c | `sim.weather = "rain"` before the ticks: no save carries the weather (a load recomputes it from the day) and the frame sync writes the engine's weather onto the instance on attach and every tick (the test fails unmarked); the cinema booking test sets `simModel = "v1"` |
| `fixedStep.integration.test.ts` | 4/6 | cost | frame-sized ticks on a fixture save with a merge per tick (passes under `VC_WASM_SYNC=hour`) |
| `goldenMaster.integration.test.ts` | 0/7 (2 marked) | c | the pinned TypeScript save hash; the engine's golden master is row 4's gate |
| `hotelLateCheckout.integration.test.ts` | 0/19 (2 marked) | d | `economy.hotelCheckout()` on the instance mid-run; the checkout pass is the engine's own hourly step; the understaffed test also swaps the clock to each afternoon hour after the crowd exists |
| `housekeepingLegibility.integration.test.ts` | 1/6 | b | `economy.housekeepingReport()` (#868) |
| `housekeepingMaids.integration.test.ts` | 0/10 | fixed | the noon dispatch is reached by ticking to it (`tickToNoonDispatch`) in place of a clock write plus `dispatchHousekeepers()` |
| `legibility.integration.test.ts` | 0/16 | fixed | the shortcut elevator and the late condo go through `sim.buildTransport` and `sim.build`; the shell test gives its `construction` unit a `completeAt` (see the advisory note in slice 2) |
| `mealCadence.integration.test.ts` | 0/40 | fixed | reads `floors`, which the frame carries now |
| `modernEconomy.integration.test.ts` | 0/9 (2 marked) | c | `simModel = "v1"` |
| `moveInGateLegibility.integration.test.ts` | 0/17 | fixed | the buy-back note is ported (`bindingTransportClassAt`) |
| `parity.integration.test.ts` | 0/2 (2 marked) | c | `simModel = "v1"` |
| `personCensus.integration.test.ts` | 0/24 | fixed | reads `originUnitId`, which the frame carries now |
| `personRoundTrip.integration.test.ts` | 0/19 (2 marked) | d | two stamp `customersIn` on the instance (one mid-run, which the frame sync restores every tick; one before the first tick, which the save does not carry); the other four read the routing fields |
| `phase2.integration.test.ts` | 0/14 (3 marked) | c | `simModel = "v1"` |
| `segmentRoutingReachable.integration.test.ts` | 0/11 (3 marked) | d | reads `returning` and the route, which the frame carries now; the three meal-rush tests pin lunch by swapping `sim.clock` and re-force the condo and venue occupancy every tick after the crowd exists, which only the fingerprint check (round 1) sees |
| `simulation.integration.test.ts` | 0/107 (1 marked) | d | clears the render-only `patronageToday`/`profitToday` accumulators on units every hour mid-run |
| `storage.integration.test.ts` | 0/66 (5 marked) | c | the TypeScript serializer's own round-trip and hardening tests: four write instance fields after the ticks and read `serialize()`, which is the engine's while hosted, and one compares the engine save's unit JSON bytes with the TypeScript serializer's key order |
| `venueAttendance.integration.test.ts` | 0/21 | fixed | reads `mealVenueId`, which the frame carries now |
| `venueOrigins.integration.test.ts` | 0/9 | fixed | reads `mealVenueId` and `originUnitId`, which the frame carries now |
| `src/engine/aquaticCenter.test.ts` (unit) | 0/6 | fixed | reads `mealVenueId`, which the frame carries now |
| `src/engine/rentalCrowd.test.ts` (unit) | 1/5 | cost | three day-long minute-tick runs (4,320 merges) on a six-floor tower against the 30 s timeout, 66 s alone (passes under `VC_WASM_SYNC=hour`); the routing fields it reads are carried now |
| `src/engine/tower/rooms.test.ts` (unit) | 1/8 | cost | 360 ticks on a 12,000-unit fixture with a merge per tick (passes under `VC_WASM_SYNC=hour`) |
| `conformance.integration.test.ts` (left out) | 23 | c | the TypeScript side of the referee and the scenario lock writer; its engine twin is `conformanceWasm` |
| `loaderCases.integration.test.ts` (left out) | 1 | c | the loader-case lock writer; the Rust test replays the lock |
| `dualRunDay`, `dualRunEdits`, `wasmHost` (left out) | 18 | c | attach a mirror or a host themselves |
| `conformanceWasm.integration.test.ts` (left out) | 21 | c | drives the binding directly |
| `src/dualrun/mirror.test.ts` (left out) | 10 | c | attaches the relay itself |
| `src/dualrun/dualRun.test.ts` (left out) | 6 | c | attaches the dual run's relay itself |

Tests that never tick (the construction and command-surface tests) pass
on both projects without the engine; a later slice can count them apart.

## Slice 2: the routing fields, the un-relayed writes, the two (a) items (2026-10-09)

### The person record

The frame view's person record grew from 8 fixed slots to `PERSON_FIXED`
(18) plus the route: `originFloor` (always present, so -1 is a real
basement floor), `originUnitId`, `venueUnitId`, `mealVenueId` (each -1
when absent), `countedHotelGuest`, `routine` (0
none, 1 schoolRun, 2 salesCall), `returning`, `dwellSecondsLeft`, then the
floors count, the shafts count, and the route's floors and shafts. The
absent dwell timer crosses as NaN: a drained timer stays negative on the
person through the return leg, so no number is free for a sentinel. The
routine codes are engine-set literals (never read from a save); the
encoder sends any other string as none behind a `debug_assert`. The decoder
(`src/wasmhost/frameView.ts`) reads the record and the host merges it onto
the instance's `Person` objects: the route arrays in place (a holder sees
the new legs), the optional fields deleted when absent, the flags set only
when true, so a hosted person reads as the instance's own would. The host
fidelity test (`wasmHost.integration.test.ts`) now projects both sides
through one shape carrying every frame field and requires a round-tripper
in the day's crowd, so the routing fields are compared on people that
carry them. The conformance digest is unchanged (the referee reports every
scenario ok); the frame view is a read model and hashes nothing.

That one gap was 31 integration and 3 unit failures in slice 1; all of
them pass now (the `fixed` rows in the table).

### The un-relayed writes (bucket d)

Each slice 1 (d) test either moved onto a relayed command or was kept
TypeScript-only through `itTypeScriptOnly(reason)` from
`src/tests/parity/typescriptOnly.ts`, which is `it` on the plain projects
and `it.skip` on the parity projects, with the reason appended to the
skipped test's name (the setup file raises a global flag).
The reason is required, so a bare skip cannot land, and the table above
repeats it.

- **Relayed:** `legibility` builds its shortcut elevator and the late condo
  through `sim.buildTransport` and `sim.build`; `condoModes` builds its condo
  through `sim.build` (which stamps the Classic ladder's Average rung,
  $150,000, so the sale line and the rent assertions read that on both
  engines) and sets No Rate through `sim.setNoRate`; `housekeepingMaids`
  ticks to the noon dispatch in place of a clock write plus a direct
  `dispatchHousekeepers()`; `cockroachInfestation` passes through a hook in
  the setup file: `callExterminator` keeps its booked room ids in memory
  only (`exterminationRoomIds`, which no save carries), so a booking before
  the first tick would reach the engine as a due day with no rooms; the
  setup hosts the instance first and the relay books the same rooms.
- **TypeScript-only (10 tests, 6 files):** two clock jumps and one direct
  drive of the event system (`attendanceTripwire`), two `customersIn`
  stamps (`personRoundTrip`), the weather write (`faqComplete`), the
  `hotelCheckout()` call (`hotelLateCheckout`), the hourly accumulator clear
  (`simulation`), and in `condoModes` the legacy out-of-band price and the
  unpriced band default of a `tower.place`d condo on a never-loaded tower
  (the four load artifacts slice 1 named: three became the `sim.build`
  shape, one is kept as the test about the unpriced default).

### The two open (a) items

- **The buy-back note is ported.** `engine-rs/src/churn.rs` carries
  `serving_transport_kinds_at`, `binding_transport_class_at` (the tie band
  and the walkways rule from `sim/gripe.ts`) and `congestion_churn_note`,
  on the per-class attribution `presence.rs` now folds beside the
  congestion map (`spatial_congestion_attribution_by_floor`, one pass for
  both). `vacate` asks the move-in gate on the emptied unit for the verdict
  the TypeScript asks (`would_evict_fresh_tenant` with a fresh satisfaction
  context), so the line ends in one of: nothing (a clean re-list), "It is
  off the market (No Rate); set a rate to sell it again.", "It stays empty
  until you fix the cause.", or "A new owner will buy in, but the crowded
  {elevators | stairs | escalators | stairs and escalators | vertical
  transport} will wear them down too until you {add cars | add capacity}."
  Two Rust unit tests pin every shape against the TypeScript wording,
  including the cross-loaded stair chain that binds past a healthy elevator
  (#701). `moveInGateLegibility` passes on the engine.
- **The stranded-floor advisory is a load artifact rather than a divergence.** The
  test wrote `state = "construction"` on a shell with no `completeAt` and
  never added it to `constructing`, so the TypeScript instance kept the
  shell forever, while any load (the host's start included) rebuilds
  `constructing` from the units and `finishConstruction` opens a shell with
  no `completeAt` on its first tick (`minutes >= (completeAt ?? 0)`, the
  same on both engines, `sim_loop.rs`). The opened shell is then an empty
  rentable unit on a stranded floor, and the advisory is right to fire. The
  test now gives its shell a real `completeAt`, and the engine stays silent
  as the TypeScript does. No Rust change, and no scenario is needed: the
  rule is the shared construction path the conformance suite already
  exercises.

### What is left on the parity projects

After review round 1, integration: 8 failures in 4 files, all named.
Bucket (b) is the #868 list only (`commuteStressByFloor` twice,
`elevatorUtil`, the housekeeping report); (cost) is `fixedStep`'s four.
Bucket (d) after the crowd exists is now caught by the fingerprint check
and marked (five more tests in three files). Bucket (c) is marked: the v1
sampled model (19 tests), the TypeScript
golden master (two) and the serializer's own tests (five) skip on the
parity projects under their reasons. Unit: two failures, both (cost):
`rooms` on the 12,000-unit fixture and `rentalCrowd`'s three day-long
minute-tick runs (4,320 merges, 66 s alone). Bucket (a) is empty, and
every bucket (d) test is relayed or marked. A full run under load (the TypeScript tiers in parallel on four
cores) times out more tests that pass alone; the parity projects want the
machine to themselves.

### Next slice

1. The structural snapshot (#868) for the six merge-per-tick timeouts
   (`fixedStep`, `rooms`, `rentalCrowd`), and the getters the save does not
   carry (`elevatorUtil`, the housekeeping report, `commuteStressByFloor`)
   for the four (b) tests, or a TypeScript-only mark for the ones the
   engine will never expose.
2. Once both parity projects pass, add `test:wasm:parity` to `test:wasm`
   so CI runs them (no CI job runs them yet). The (c) marks landed in review
   round 1.
3. The remaining ACs: AC2 (the helper-scripted e2e specs onto relayed
   commands) and AC3 (the gallery and the baselines on the engine).

### Review Findings

Round 1 of `/gds-code-review` (with `/bmad-code-review` for the tooling
surface) on PR #891. Layers: Blind Hunter, Edge Case Hunter, Acceptance
Auditor.

- [x] [Review][Patch] attach() normalizes the instance with one syncStructure() and adopts load-time log lines by tail, so a re-host never repeats the rent-snap bulletin; a parity spec pins one host and one bulletin [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] The header doc and mechanism bullet 1 say when the compare runs (every tick while the crowd is empty in tick mode, a revision move otherwise) and that a pre-tick customersIn stamp raises no parity error [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] Hour mode: merge before the pre-tick compare (on inspection not applied: a merge first replaces the instance's records with the engine's, so it discards the un-relayed edit the compare exists to catch and the re-host never fires) [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] A re-host is refused with a WasmParityError while an exterminator booking is pending (#902) [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] attach() refuses an instance that already has a crowd, naming the one-Simulation-per-test rule [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] VC_PARITY_DUMP creates its directory and a failed dump never replaces the parity error [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] The callExterminator booking runs the state-view compare after the relayed command (the host's relay already wraps the method; cockroachInfestation passes on the engine) [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] release() removes a leftover own tick wrapper and checks the prototype tick is reachable again [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] attach() refuses simModel "v1"; every v1 test and the rest of bucket (c) (the golden master hashes, the serializer's round-trip and hardening tests) are marked itTypeScriptOnly; gameEvents' v1 is a SimContext literal no Simulation ticks, so it stays unmarked [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] itTypeScriptOnly appends the reason to the skipped test's name on the parity projects [src/tests/parity/typescriptOnly.ts]
- [x] [Review][Patch] dualRun.test.ts attaches its own relay and leaves unitWasm [vite.config.ts]
- [x] [Review][Patch] legibility's removeTransport after the ticks (on inspection not applied: the host's relay wraps tower.removeTransport, so the removal reaches the engine, and the test passes on integrationWasm) [src/tests/integration/legibility.integration.test.ts]
- [x] [Review][Patch] faqComplete's weather test still fails unmarked; its reason names the true mechanism (no save carries the weather and the frame sync writes the engine's) [src/tests/integration/faqComplete.integration.test.ts]
- [x] [Review][Patch] condoModes finishes its condo's construction by ticking past completeAt, and the re-list reason names the write after the crowd exists [src/tests/integration/condoModes.integration.test.ts]
- [x] [Review][Patch] attendanceTripwire's bulldozing reason names the un-relayed tower.place [src/tests/integration/attendanceTripwire.integration.test.ts]
- [x] [Review][Patch] The host fidelity test compares wait, and its routed-crowd comment drops the restatement [src/tests/integration/wasmHost.integration.test.ts]
- [x] [Review][Patch] decodeFrame rejects a negative or non-integer route count by name [src/wasmhost/frameView.ts]
- [x] [Review][Patch] frame_view sends an unknown routine as none behind a debug_assert; the doc says originFloor is always present [engine-rs/src/wasm.rs]
- [x] [Review][Patch] syncPeople notes the placeholder leg, shaftId and carIndex of a fresh frame person (#868) [src/wasmhost/wasmHost.ts]
- [x] [Review][Patch] A Rust unit test pins the condo sale line in both shapes [engine-rs/src/churn.rs]
- [x] [Review][Patch] with_thousands formats a fractional amount as toLocaleString() does, where it truncated [engine-rs/src/services.rs]
- [x] [Review][Patch] The story's runs table, CI status, hosting rule, skip naming and sync wording are corrected [_bmad-output/implementation-artifacts/story-engine-test-parity.md]
- [x] [Review][Patch] The attach-after-booking hole is its own backlog row (#902) and the #868 row points at it [_bmad-output/implementation-artifacts/backlog.md]
- [x] [Review][Patch] The spliced CONTRIBUTING.md paragraph is re-wrapped [CONTRIBUTING.md]
- [x] [Review][Patch] Version 2.29.2 with a changelog line for the engine's matching notice wording [package.json]
- [x] [Review][Patch] (Codex) A direct write after the crowd exists that moves no revision is caught by a fingerprint taken after each sync; a parity spec pins it, and the five tests it surfaced are marked [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Defer] (Codex) Hoist the buy-back's satisfaction context and congestion attribution map to once per satisfaction pass [engine-rs/src/churn.rs]: deferred to #911, behavior-changing as proposed (on inspection: a condo probe fills the context's demand map from the live tower, and the attribution folds every present unit's census, so each earlier vacate in the pass changes both; a hoist would change the buy-back verdict and note. Both engines build them per vacate today; #911 records the incremental fix that keeps behavior)
- [x] [Review][Defer] fresh frame people carry a route with placeholder leg, shaftId, carIndex [src/wasmhost/wasmHost.ts]: deferred, read-model gap on #868

## Review record

- Round 1 (2026-10-09, PR #891): 18 Blind Hunter, 9 Edge Case Hunter and 13
  Acceptance Auditor raw findings; triage kept 25 patch, 1 defer and 2
  dismissed. Every patch is listed above (two were checked and left
  unapplied, with the evidence in their lines). Codex then reviewed the
  pre-fix head: three findings, one already covered (the log tail), one
  applied (the fingerprint), one deferred to #911 (the vacancy context).
  Dismissed after inspection: merging before the hour-mode compare (it
  would erase the direct edits the compare exists to catch) and relaying
  the transport removal in legibility (already relayed; 16/16 pass).
