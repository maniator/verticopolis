---
story: engine-test-parity
status: review
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

This section describes the mechanism as it stands after review round 2.

The hook is a wrap of `Simulation.prototype.tick`, chosen over a module
mock of the construction points (`new Simulation`, `Simulation.newGame`,
`Simulation.deserialize`, the fixture helpers in
`src/tests/fixtures/towerFixtures.ts`) for two reasons. One hook covers
every construction path, the `.vctower` fixture loads included, and no test
file changes. And attaching at the first tick lets a test set its tower up
the way the suites do today (`tower.place`, a direct field write) before
the engine starts from the instance's own save, so setup that bypasses the
command relay still reaches the engine. `callExterminator` is hooked too:
it attaches the host ahead of the first tick, so the booking is relayed and
compared like other commands. Since #902 the save carries the booked room
ids (`exterminationRoomIds`), so a re-host mid-booking keeps them.

**Attach-time normalization.** The engine's load can log lines the
instance never had (the Classic rent-snap bulletin). The instance adopts
the tail of the engine's ring past its own log, comparing each of its own
lines in the form the load keeps it (`coerceLog`: text cut to
`LOG_TEXT_CAP`, a bad minute or kind coerced), so a long line is not
adopted twice and a repeated bulletin from a re-host is kept. Then one
`host.syncStructure()` makes the instance the engine's loaded state (a
Classic tower's rents snap onto the 1994 ladder, a shell with no
`completeAt` is opened by `finishConstruction`), so the first compare
agrees.

**When the compare runs.** The compare checks the instance's own state view
against the engine's:

- before every tick while the crowd is empty, in the default tick mode;
- before a tick when the tower revision moved since the last sync;
- before a tick when the fingerprint changed since the last sync;
- around a relayed `callExterminator`, once before the booking and once
  after it.

A relayed command (`sim.build`) moved both engines in step and they agree.
A disagreement is an edit the relay does not carry (`tower.place`, a direct
field write) or a divergence on a relayed command. While the crowd is still
empty the engine is restarted from the instance's save (a re-host, the same
start a load gets). Once the crowd exists the tick throws a
`WasmParityError` naming the first differing path, because a restart would
drop the crowd and hide the difference.

**The fingerprint** is a 32-bit hash taken after every sync, of every
unit's and every transport's own fields (each primitive, and the JSON of an
array or a schedule), the Simulation's own primitive fields, the JSON of
`events.pending`, and the clock. It costs about 10 ms on a 13,000-unit
fixture (`towerone-star4` 10.1 to 10.7 ms, `sixseven_2` 9.0 to 10.7 ms
across runs; the round 1 hand list cost 7.2 ms on `towerone-star4`). It
leaves out the people (the frame owns them), the weather (engine owned: no
save carries it, and a load recomputes it from the day), and the
engine-owned per-frame counters (`onHourRuns`, the effect sequences,
`logSeq`) and memo keys. A direct write to any of those is replaced by the
next frame sync, and no error names it; a counter stamped on a unit before
the first tick (`customersIn`) is the same case, since the state view
leaves it out.

**The refusals**, each by name:

- the sampled v1 model (`simModel = "v1"`), at attach and again on every
  hosted tick, since the save does not carry it and the engine never ported
  it;
- an instance that already has a crowd at attach (one Simulation shared
  between tests and ticked on the TypeScript engine after its release);
- a re-host after the first tick under `VC_WASM_SYNC=hour`, where the
  instance is behind the engine between merges and its save would rewind
  the engine.

**The tick.** Each hosted tick runs on the engine through the host's relay
tick (`engine.tick` plus the frame sync). In tick mode the engine's full
save is then merged into the instance (`host.syncStructure()`), so an
assertion between hours reads the state the engine holds after that tick.
`VC_WASM_SYNC=hour` keeps the host's own cadence (frame sync per tick,
merge on an hour pass or a revision change) for a cost comparison.

Every host is detached after each test, all of them even when one release
throws, so the engines are freed and the instances are plain TypeScript
simulations again. A test that never ticks and never calls
`callExterminator` is never hosted; it exercises the TypeScript command
surface only, and the table counts it as such.

No CI job ran the parity projects at this point. (Slice 3 added a CI job
of its own instead of folding `test:wasm:parity` into `test:wasm`.)

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
| `integrationWasm` (merge per tick), after slice 2 | 86 | 1628 | 19 | 11 | 323 s | 10 files fail; the 11 skips are the 10 `itTypeScriptOnly` marks plus one pre-existing skip (the hour-cost bench; that run's environment had the disc reader's package, so its four tests ran) |
| `unitWasm` (merge per tick), after slice 2 | 204 | 2525 | 2 | 0 | 143 s | 2 files fail, both the merge-per-tick cost |
| `integrationWasm` (merge per tick), after review round 1 | 87 | 1610 | 8 | 46 | 374 s | 4 files fail, all named in the table; the 46 skips are the 41 `itTypeScriptOnly` marks plus 5 pre-existing (the opt-in hour-cost bench, the disc reader without its package); the 87th file is the setup's own spec (`src/tests/parity/wasmHostSetup.integration.test.ts`) |
| `unitWasm` (merge per tick), after review round 1 | 205 | 2537 | 2 | 0 | 136 s | 2 files fail, both the merge-per-tick cost; `dualRun.test.ts` left the project (205 files by `vitest list --project unitWasm --filesOnly`; the earlier rows' 204 is as reported then) |
| `integrationWasm` (merge per tick), after review round 2 | 87 | 1621 | 9 | 43 | 504 s | run alone in this worktree, but other sessions loaded the machine (load average 7 to 13 on four cores); 4 files fail, all named in the table: the four (b) tests and five `fixedStep` timeouts (its fifth, the slow-host test, timed out under the load); the 43 skips are the 38 `itTypeScriptOnly` marks plus 5 pre-existing (the opt-in hour-cost bench, the disc reader's four tests without its package); 1621 + 9 + 43 = 1673 |
| `unitWasm` (merge per tick), after review round 2 | 205 | 2542 | 4 | 0 | 368 s | run alone in this worktree under the same outside load; 2 files fail, all timeouts: `rooms` and all three of `rentalCrowd`'s day-long runs; 2542 + 4 = 2546 |

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
  with a reason. Four of them come from the load and involve no write: the
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

### Test-mapping table (after review round 2, rows updated in slice 3)

Buckets: (a) engine divergence, (b) read-model gap, (c) TypeScript-only,
(d) un-relayed write after the crowd exists, (cost) merge-per-tick
timeout, (fixed) a slice 1 row that passes now. Counts are failing tests
out of the file's total under `integrationWasm` (merge per tick, except
the rows marked `atEngineFrameCadence`, which run at the host's own
cadence) or `unitWasm`; "(n marked)" counts the tests the file keeps TypeScript-only
through `itTypeScriptOnly`, which the parity projects skip under the test's
name suffixed with `[TypeScript-only: <reason>]`, the reason this table
repeats.

For a row marked "(left out)" the Fails column counts the file's tests
(as of slice 3), since none of them runs on the parity projects. A row's
passes are its count minus the marked tests; the project totals are in the
run records below.

| Test file | Fails | Bucket | Reason |
| --- | --- | --- | --- |
| `attendanceTripwire.integration.test.ts` | 0/12 (4 marked) | d | four marked: three jump the clock after the crowd exists (one of them also rebuilds the venue through an un-relayed `tower.place` mid-run), one drives the event system directly (`events.restore`, `events.pending`) mid-run; the other eight pass on the engine, five of them reading the routing fields slice 2 added |
| `cockroachInfestation.integration.test.ts` | 0/14 | fixed | the booking is relayed: `callExterminator` hosts the instance ahead of the first tick (see slice 2) |
| `commuteStress.integration.test.ts` | 0/9 | fixed | `crowd.commuteStressByFloor` comes from the engine at every merge (`Engine.commuteStress()`, slice 3) |
| `condoModes.integration.test.ts` | 0/28 (2 marked) | d | the condo is built through `sim.build` (the Classic ladder's Average rung, $150,000, on every engine), its construction finished by ticking past `completeAt`, and the No Rate flag set through `sim.setNoRate`; the two load-clamp tests forge prices on a placed condo that never ticks; two stay TypeScript-only: the re-list test writes `condo.rent = 240_000` after the sale while the crowd is still empty, so the next tick re-hosts (minute 720 under `VC_PARITY_TRACE`) and that load snaps the off-ladder 240,000 onto the Classic ladder, so the buy-back charges the snapped $200,000; and the unpriced band default of a `tower.place`d condo on a never-loaded tower (the load snaps it onto the ladder) |
| `demographicRoutines.integration.test.ts` | 0/11 | fixed | reads `routine` and `originUnitId`, which the frame carries now |
| `condoRelocation.integration.test.ts` | 0/8 (6 marked) | c | `simModel = "v1"` in the shared fixture (one monthly roll per tick) |
| `economyDepth.integration.test.ts` | 0/8 (5 marked) | c | `simModel = "v1"` (the sampled model is not in the save and not ported) |
| `elevatorStats.integration.test.ts` | 0/3 | fixed | `elevatorUtil` comes from the engine since the 2026-10-10 telemetry fix |
| `faqComplete.integration.test.ts` | 0/26 (2 marked) | d, c | `sim.weather = "rain"` before the ticks: no save carries the weather (a load recomputes it from the day) and the frame sync writes the engine's weather onto the instance on attach and every tick (the test fails unmarked); the cinema booking test sets `simModel = "v1"` |
| `fixedStep.integration.test.ts` | 0/6 | cost, fixed | all six at the host's own cadence (`atEngineFrameCadence`, slice 3): the fixture is ticked frame by frame and only the final save, the engine's own while hosted, is compared |
| `goldenMaster.integration.test.ts` | 0/7 (2 marked) | c | the pinned TypeScript save hash; the engine's golden master is row 4's gate |
| `hotelLateCheckout.integration.test.ts` | 0/19 (1 marked) | d | the understaffed test runs `economy.hotelCheckout()` on the instance mid-run (the checkout pass is the engine's own hourly step) and swaps the clock to each afternoon hour after the crowd exists; the Modern deferred-guests test lost its mark in review round 2 (its `hotelCheckout()` runs before the first tick, so the engine starts from that state) |
| `housekeepingLegibility.integration.test.ts` | 0/6 | fixed | the housekeeping report comes from the engine since the 2026-10-10 telemetry fix |
| `housekeepingMaids.integration.test.ts` | 0/10 | fixed | the noon dispatch is reached by ticking to it (`tickToNoonDispatch`) in place of a clock write plus `dispatchHousekeepers()` |
| `legibility.integration.test.ts` | 0/16 | fixed | the shortcut elevator and the late condo go through `sim.buildTransport` and `sim.build`; the shell test gives its `construction` unit a `completeAt` (see the advisory note in slice 2) |
| `mealCadence.integration.test.ts` | 0/40 | fixed | reads `floors`, which the frame carries now |
| `modernEconomy.integration.test.ts` | 0/9 (2 marked) | c | `simModel = "v1"` |
| `moveInGateLegibility.integration.test.ts` | 0/17 | fixed | the buy-back note is ported (`bindingTransportClassAt`) |
| `parity.integration.test.ts` | 0/2 (1 marked) | c | `simModel = "v1"` on the TOWER-rating run; the star-gate test sets v1 but never ticks, so it passes on both projects (unmarked in review round 2) |
| `personCensus.integration.test.ts` | 0/24 | fixed | reads `originUnitId`, which the frame carries now |
| `personRoundTrip.integration.test.ts` | 0/19 (2 marked) | d | two stamp `customersIn` on the instance (one mid-run, which the frame sync restores every tick; one before the first tick, which the save does not carry); the other four read the routing fields |
| `phase2.integration.test.ts` | 0/14 (2 marked) | c | `simModel = "v1"`; the tower-wide coverage test sets v1 but never ticks (unmarked in review round 2) |
| `segmentRoutingReachable.integration.test.ts` | 0/11 (3 marked) | d | reads `returning` and the route, which the frame carries now; the three meal-rush tests pin lunch by swapping `sim.clock` and re-force the condo and venue occupancy every tick after the crowd exists, which only the fingerprint check (round 1) sees |
| `simulation.integration.test.ts` | 0/107 (1 marked) | d | clears the render-only `patronageToday`/`profitToday` accumulators on units every hour mid-run |
| `storage.integration.test.ts` | 0/66 (5 marked) | c | the TypeScript serializer's own round-trip and hardening tests: four write instance fields after the ticks and read `serialize()`, which is the engine's while hosted, and one compares the engine save's unit JSON bytes with the TypeScript serializer's key order |
| `venueAttendance.integration.test.ts` | 0/21 | fixed | reads `mealVenueId`, which the frame carries now |
| `venueOrigins.integration.test.ts` | 0/9 | fixed | reads `mealVenueId` and `originUnitId`, which the frame carries now |
| `src/engine/aquaticCenter.test.ts` (unit) | 0/6 | fixed | reads `mealVenueId`, which the frame carries now |
| `src/engine/rentalCrowd.test.ts` (unit) | 0/5 | cost, fixed | three tests at the host's own cadence (`atEngineFrameCadence`, slice 3): minute-tick runs of one to three days that read the crowd, which the frame carries |
| `src/engine/tower/rooms.test.ts` (unit) | 0/8 | cost, fixed | one test at the host's own cadence (`atEngineFrameCadence`, slice 3), which calls `refreshFromEngine` before each assertion: 360 ticks on a 12,000-unit fixture, with a merge before each census check |
| `src/tests/perfCompare/fixtureHotelTower.test.ts` (unit) | 0/6 | cost, fixed | two tests at the host's own cadence (`atEngineFrameCadence`, slice 3): one and two-day minute-tick runs on a large hotel fixture that assert frame-carried dirty-room state counts |
| `conformance.integration.test.ts` (left out) | 24 | c | the TypeScript side of the referee and the scenario lock writer; its engine twin is `conformanceWasm` |
| `loaderCases.integration.test.ts` (left out) | 1 | c | the loader-case lock writer; the Rust test replays the lock |
| `dualRunDay`, `dualRunEdits`, `wasmHost` (left out) | 53 | c | attach a mirror or a host themselves |
| `wasmHostTelemetry`, `wasmHostLogText` (left out) | 5 | c | drive the TypeScript engine and their own engine side by side |
| `wasmHostAnalyticsBridge`, `wasmWorkerHost`, `wasmWorkerLifecycle`, `wasmWorkerSaves` (left out, slice 3) | 29 | c | start their own host, in process or on the worker; a second host on the instance is refused, and the lifecycle suite's fallback hands a crowded instance back to the TypeScript engine |
| `conformanceWasmTdt`, `conformanceWasmCanBuild`, `conformanceWasmVctower` (left out) | 51 | c | drive the binding directly, as `conformanceWasm` does |
| `wasmHostCatalog` (left out) | 10 | c | starts its own host to read the engine's catalog |
| `perfCompare/*.integration.test.ts` (left out) | 6 | c | the engine comparison's checks (`page`, `scenarios`) run each engine themselves (#972) |
| `conformanceWasm.integration.test.ts` (left out) | 26 | c | drives the binding directly through its own engine instances (the raw binding suites that build no host of their own, `chargeBindingRaw` and the like, stay in the project and pass) |
| `src/dualrun/mirror.test.ts` (left out) | 12 | c | attaches the relay itself |
| `hourCost.bench.integration.test.ts` | opt-in | n/a | skipped everywhere unless `RUN_HOUR_BENCH=1`; not a parity exclusion, listed so the 39 skips reconcile (38 marks plus this) |
| `src/dualrun/dualRun.test.ts` (left out) | 6 | c | attaches the dual run's relay itself |
| `e2e/regions.spec.ts` (Playwright, `chromium-wasm`) | skipped (1 test) | c | toggles a unit between fire and empty in place; see the e2e slice |
| `e2e/perf.spec.ts` (Playwright, `chromium-wasm`) | skipped (1 test) | c | the perf baseline is the TypeScript engine's (#900) |

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
  the setup file: `callExterminator` hosts the instance first so the relay
  books the same rooms on both engines (the booked room ids have been in the
  save since #902).
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
- **The stranded-floor advisory comes from the load, and the engines agree.** The
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

After review round 2 (landed as a follow-up to #891), integration: 9
failures in 4 files, all named. Bucket (b) is the #868 list only
(`commuteStressByFloor` twice, `elevatorUtil`, the housekeeping report);
(cost) is `fixedStep`, four alone and five under load. The 38 marks: 14 in
bucket (d), the writes after the crowd exists that the fingerprint check
names, and 24 in bucket (c): the v1 sampled model (17 tests), the
TypeScript golden master (two) and the serializer's own tests (five).
Unit: four failures in two files, all (cost) timeouts: `rooms` on the
12,000-unit fixture and `rentalCrowd`'s three day-long minute-tick runs
(one fails alone, all three under load). Bucket (a) is empty, and every
bucket (d) test is relayed or marked. The parity projects want the machine
to themselves: a run under load times out tests that pass alone.

### Next slice

(Slice 3 at the end of this story took another route: item 1's timeouts run at the host's own cadence instead of waiting on the structural snapshot, item 2 is a CI job of its own, and the (b) getters are filled. Item 3 landed in the e2e and gallery slice.)

1. The structural snapshot (#868) for the merge-per-tick timeouts
   (`fixedStep`, `rooms`, `rentalCrowd`), and the getters the save does not
   carry (`elevatorUtil`, the housekeeping report, `commuteStressByFloor`)
   for the four (b) tests, or a TypeScript-only mark for the ones the
   engine will never expose.
2. Once both parity projects pass, add `test:wasm:parity` to `test:wasm`
   so CI runs them (no CI job runs them yet). The (c) marks landed in review
   round 1, and round 2 took three of them off tests that never tick.
3. The remaining ACs: AC2 (the helper-scripted e2e specs onto relayed
   commands) and AC3 (the gallery and the baselines on the engine).

### Review Findings

Round 1 of `/gds-code-review` (with `/bmad-code-review` for the tooling
surface) on PR #891. Layers: Blind Hunter, Edge Case Hunter, Acceptance
Auditor.

- [x] [Review][Patch] attach() normalizes the instance with one syncStructure() and adopts load-time log lines by tail, so a re-host never repeats the rent-snap bulletin; a parity spec pins one host and one bulletin [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] The header doc and mechanism bullet 1 say when the compare runs (every tick while the crowd is empty in tick mode, a revision move otherwise) and that a pre-tick customersIn stamp raises no parity error [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] A re-host is refused with a WasmParityError while an exterminator booking is pending (#902) [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] attach() refuses an instance that already has a crowd, naming the one-Simulation-per-test rule [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] VC_PARITY_DUMP creates its directory and a failed dump never replaces the parity error [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] The callExterminator booking runs the state-view compare after the relayed command (the host's relay already wraps the method; cockroachInfestation passes on the engine) [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] release() removes a leftover own tick wrapper and checks the prototype tick is reachable again [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] attach() refuses simModel "v1"; every v1 test and the rest of bucket (c) (the golden master hashes, the serializer's round-trip and hardening tests) are marked itTypeScriptOnly; gameEvents' v1 is a SimContext literal no Simulation ticks, so it stays unmarked [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] itTypeScriptOnly appends the reason to the skipped test's name on the parity projects [src/tests/parity/typescriptOnly.ts]
- [x] [Review][Patch] dualRun.test.ts attaches its own relay and leaves unitWasm [vite.config.ts]
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
- [x] [Review][Dismissed] Hour mode: merge before the pre-tick compare (checked: a merge first replaces the instance's records with the engine's, so it discards the un-relayed edit the compare exists to catch and the re-host never fires) [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Dismissed] legibility's removeTransport after the ticks (checked: the host's relay wraps tower.removeTransport, so the removal reaches the engine, and the test passes on integrationWasm) [src/tests/integration/legibility.integration.test.ts]

Round 2 of `/gds-code-review` (with `/bmad-code-review` for the tooling
surface), landed as a follow-up to #891 (the owner merged #891 while the
round 2 patches were in progress).

- [x] [Review][Patch] The fingerprint is generic: every unit's and every transport's own fields (primitives, and the JSON of arrays and schedules), the Simulation's own primitive fields, events.pending and the clock, as a 32-bit hash; people, the weather and the engine-owned counters stay out and the doc says so; specs pin a car-count write and a label write after the crowd exists [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] The fingerprint is refreshed after the callExterminator compare [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] callExterminator runs the compare before the relayed booking too, so an un-relayed edit re-hosts while no booking is pending; a spec pins both engines clearing the same room [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] attach() refuses booked room ids on the instance (a due day alone, as a load leaves it, is in the save and is hosted), and bookingPending reads a falsy due day as no booking (the resolution clears it to undefined on both engines) [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] Hour mode refuses a re-host after the first tick with a WasmParityError [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] afterEach releases every host and then throws an AggregateError; attach() detaches the host when a later step throws [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] Every hosted tick refuses v1 [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] Log adoption compares each own line in its coerceLog form and keeps a repeated bulletin; a spec pins one copy of a 500-character line [src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] Specs for the v1 refusal (at attach and after the first tick), the shared-instance crowd refusal and the re-host refusal while booked [src/tests/parity/wasmHostSetup.integration.test.ts]
- [x] [Review][Patch] The condoModes re-list reason names the re-host at minute 720 and the ladder snap of 240,000 [src/tests/integration/condoModes.integration.test.ts]
- [x] [Review][Patch] Three marks removed from tests that pass on the engine (hotelLateCheckout's Modern deferred guests, phase2's and parity's v1 tests that never tick) [src/tests/integration/]
- [x] [Review][Patch] phase2 imports itTypeScriptOnly and V1_MODEL at the top [src/tests/integration/phase2.integration.test.ts]
- [x] [Review][Patch] servedCondo asserts the condo left construction, and the No Rate test sets the flag before the condo opens [src/tests/integration/condoModes.integration.test.ts]
- [x] [Review][Patch] syncPeople leaves the optional person fields in the TypeScript engine's shape (absent until set, cleared by assignment where motion.ts clears them, the flags absent or true); the fidelity test compares the values strictly and the presence of staff and returning [src/wasmhost/wasmHost.ts]
- [x] [Review][Patch] with_thousands prints -0 and the non-finite values as toLocaleString() does, in release builds too [engine-rs/src/services.rs]
- [x] [Review][Patch] The sale and buy-back vectors agree: householdPrice rounds before the line on both engines (106,667), and a churn test pins a rounded household buy-back and a fractional stored price through the buy-back line [engine-rs/src/churn.rs]
- [x] [Review][Patch] frame_view sends an unknown routine as 255, which the decoder rejects [engine-rs/src/wasm.rs]
- [x] [Review][Patch] decodeFrame checks the header counts and each transport's car count [src/wasmhost/frameView.ts]
- [x] [Review][Patch] The mechanism section and the setup file's header describe the code as it is [this file, src/tests/parity/wasmHostSetup.ts]
- [x] [Review][Patch] The runs table is re-run per project, with the file and skip counts reconciled, and the attendanceTripwire row adds up [this file]
- [x] [Review][Patch] The review tallies agree here and in the backlog [this file, backlog.md]
- [x] [Review][Patch] The #868 row names the placeholder-route deferral [backlog.md]
- [x] [Review][Patch] The #878 row states the current state [backlog.md]
- [x] [Review][Patch] The #911 row opens with its state and follows #902 in date order [backlog.md]
- [x] [Review][Patch] The "rather than" restatements in new text are rewritten [this file, src/wasmhost/frameView.ts]
- [x] [Review][Patch] The parity sentence in CONTRIBUTING.md is its own paragraph [CONTRIBUTING.md]
- [x] [Review][Dismissed] `is_multiple_of` in with_thousands (checked: stable since Rust 1.87, and the crate requires 1.97) [engine-rs/src/services.rs]

## Review record

- Round 1 (2026-10-09, PR #891): 18 Blind Hunter, 9 Edge Case Hunter and 13
  Acceptance Auditor raw findings (40). After dedupe: 23 patches applied, 2
  checked and dismissed (merging before the hour-mode compare, which would
  erase the direct edits the compare exists to catch; relaying the
  transport removal in legibility, already relayed with 16/16 passing), and
  1 defer (the placeholder route of a fresh frame person, on #868). Codex
  then reviewed the pre-fix head: three findings, one already covered (the
  log tail), one applied (the fingerprint), one deferred to #911 (the
  vacancy context). In all: 24 patches applied, 2 dismissed, 2 defers
  (#868, #911).
- Round 2 (2026-10-10, landed as a follow-up to #891): 15 Blind Hunter, 10
  Edge Case Hunter and 13 Acceptance Auditor raw findings (38). After
  dedupe: 26 patches applied, 1 dismissed (`is_multiple_of` is stable since
  Rust 1.87 and the crate requires 1.97), no defers. The Rust changes keep
  every conformance digest (21 scenarios ok).

## Slice: e2e and gallery (AC2, AC3) (2026-10-09)

This slice is a stacked PR on top of slices 1 and 2 and merges after them. Status: in
review.

### What landed

#### AC2: the helper-scripted e2e specs drive relayed commands

Under the WASM host the TypeScript `Simulation` is a read model: only the
relayed commands (`sim.build`, `sim.buildTransport`, `sim.evaluateStar`,
`sim.tick`, `sim.resolveChoice`, a money write) and a load (`adoptSim`, which
the host follows by starting the engine from the adopted save) reach the
engine. The specs used to stage towers with `tower.place`, unit field writes,
`clock.advance`, a direct `checkVip` and a hand-set `events.pending`, which
changed the read model alone and passed on `chromium-wasm` only because
speed 0 meant nothing synced the read model back from the engine.

- `e2e/helpers.ts` `buildToStar`, when the tower is hosted, scripts its
  structure and occupancy on a scratch copy loaded from the engine's own save,
  and the app adopts that copy, which is the load path a player's save takes.
  The star is then evaluated by a relayed
  `evaluateStar`. For TOWER, the Wedding Hall goes in with a relayed
  `sim.build`, a second save finishes its construction and parks the clock one
  minute before the inspection day (no command fast-forwards either), and one
  relayed `sim.tick(1)` runs the engine's own day pass, so `checkVip` runs on
  the engine. `adoptSim(sim, true)` (the undo-restore flavor) keeps the camera
  as the in-place build does. On the TypeScript engine (no host) it still
  scripts the tower in place: the instance is the engine there, and the
  perf gate's committed baseline measures that in-place tower. The first CI
  run of this slice, with the load path on both projects, failed the perf gate
  (`ui.update` median 1.39 ms against a 0.65 ms baseline): `sim.stats()` over
  a loaded 44,000-unit tower costs about twice what it costs over the same
  tower built in place (`loaded-tower-stats-cost`, #905). One
  limit, by design: the fixture's placements and occupancy are authored on
  the TypeScript side of that load, so the engine never validates them
  (`buildToStar` is a fixture builder; the specs' own building goes through
  relayed commands, and the relayed `sim.build` checks are what exercise the
  engine's placement rules). A guard fails the TOWER rung loudly if the hall
  scheduled no visit or the inspection day rolled an emergency.
- `crowdCull.spec.ts` builds the shaft and the extra floor with
  `sim.buildTransport` and `sim.build`, and reads the tower back from the
  engine before seeding its render-only crowd.
- `integration.spec.ts` boots the splash-emergency case from a stored
  autosave whose tower carries the pending bomb threat (a reload loads it,
  and on `chromium-wasm` the engine loads the same pending choice; the test
  checks the engine's save carries it).
- `auto-floor.spec.ts`, `mobileGestures.spec.ts` and `visual.spec.ts` lay
  their concourse and floors with `sim.build` and read the tower back from the
  engine (`syncStructure`) before asserting, so a step the relay does not
  carry is wiped by the merge and fails the spec.
- `win.spec.ts` and `milestones.spec.ts` check the engine's own save reached
  the star (and, at TOWER, `evaluatedTower`).
- New helpers: `expectEngineHosted` (an `afterEach` in every game spec that
  runs on `chromium-wasm`; it
  fails a `chromium-wasm` test unless the host is up, reports the tower
  hosted with no errors, and the app's live `sim` is the hosted instance),
  `engineSave`, `syncEngine`, and `tsOnlyOnWasm(reason)`, the one greppable
  skip.

What stays a direct write, by design: presentation pins on a paused read
model (the visual spec's clock and weather, `crowdCull`'s seeded people, the
`perf` spec's UI stubs). At speed 0 no frame syncs the read model from the
engine, so these hold on both engines until a test merges explicitly (the
pinned-footer test re-pins the clock after its merge), and the render path
they feed is the same for both.

`buildToStar` builds in place on the TypeScript project and through a load on
the WASM project. Before that split both projects took the load path, and on
the host the 10 visual specs rendered byte-identically to the in-place
references on both engines, so no load-only effect reaches those scenes and
the engine visual leg still compares like with like. The TOWER rung does end
on a different day on each project (the in-place branch advances ten days, the
hosted one parks a minute before the inspection day and relays that minute, so
it ends on the inspection day); nothing compares those states across engines
today, and `milestones.spec.ts` keeps its shots as unasserted artifacts (the
gallery's milestone ladder comes from `scripts/screenshots.ts` and is in the
engine leg).

#### AC3: the gallery and the visual baselines render on the WASM engine

- (Superseded 2026-10-10: the clock pin now moves the engine's clock
  ("Engine fixes from the gallery's engine leg", harness methods), and both
  legs load at the same points ("The symmetric settle" at the end of this
  story). The bullet below records the slice as it landed.)
- `scripts/screenshot-engine.ts`: `VC_SHOT_ENGINE=wasm` seeds `vc.engine` in
  every scene's page before boot. After a scene's build, after any shot setup
  and after a clock pin, the runner hands the live tower to the engine through
  `adoptSim` when a builder swapped a fresh `Simulation` into `game.sim`
  (which the host never sees) or edited the hosted instance past the relay (a
  structural difference between the instance's own save and the engine's),
  puts back what `adoptSim` resets (the frame-loop latches, the log cursor and
  panel, the selection), lets a fresh tower's owed hour pass run on the engine
  when the clock sits on the hour, and fails the scene if the live tower is
  not hosted. `pgSetClock` pins the hour on the engine's own save; in a running
  scene the engine is parked one minute short of each boundary the pin crosses
  (midnight, then the hour) and one relayed minute crosses it, so it runs the
  day and hour passes the TypeScript leg runs on its next tick. `pgMaskVersion`
  masks the " · WASM engine" label with the version. Unset, the TypeScript
  leg is untouched (its render was byte-identical before and after this
  slice on the host).
- `playwright.config.ts`: `PW_WASM_VISUAL=1` lets the `chromium-wasm` project
  run `visual.spec.ts` against the `chromium` baseline files, never writes a
  snapshot (`updateSnapshots: "none"`), and refuses `--update-snapshots`.
- `pr-drift-check.yml`: a `capture-wasm` leg runs the reusable capture
  (`screenshot-capture.yml`, new `engine` input; artifacts, the diff evidence
  and the concurrency group are keyed by engine, and the engine leg uploads
  what rendered even when a scene fails, marked `.render-failed`).
  `engine-parity` compares that render byte for byte with the TypeScript
  render of the same run (the committed gallery whenever `drift-gate` is
  green, so a PR that changes rendering is not read as an engine
  difference), fails on any difference, and prints the first differing shot
  plus the full list. `engine-parity-visual` runs the visual specs on the
  engine against the committed baselines on every render-affecting PR.
- `update-visual-baselines.yml`: an `engine-parity` job runs the visual specs
  on the engine after the mint, against the baselines it left on the tip.
- `CONTRIBUTING.md` (Testing & coverage, the screenshot regeneration section)
  documents the two legs.

No threshold moved, nothing rendered on this machine was committed, and no
version bump (nothing changes for a player on the default engine).

Departures from the brief, for the owner to accept:

- **Separate jobs instead of matrix legs.** The brief asked for the engine run
  as a second matrix leg. In `pr-drift-check` a matrix entry on `capture`
  would make a scene that cannot render on the engine (or a nondeterministic
  engine render) fail `capture`, and with it the required `drift-gate`, on
  every render PR until the flip. In `update-visual-baselines` a matrix entry
  on `update` would share its write token. The engine legs are their own jobs
  with read-only tokens; they report, and `drift-gate` stays the TypeScript
  engine's.
- **The gallery leg compares against the same run's TypeScript render.** The
  brief said "the same committed gallery". On a same-repo PR the two are
  identical whenever `drift-gate` is green (a fork PR passes `drift-gate` with
  drift, so there they can differ); while a render PR waits on
  `commit-on-approval`, the committed gallery is stale and would flag every
  changed shot as an engine difference.
- **Some setup reaches the engine through a load.** The brief allows relayed
  commands or a TypeScript-only skip. On the WASM project `buildToStar`'s
  fixture, the staged autosave in `integration.spec.ts` and the gallery's
  handoffs reach the engine as a save the app adopts (the load path a player's save takes), because no
  command sets occupancy, a pending choice, or the clock. Presentation pins on
  a paused read model (the visual spec's clock and weather, `crowdCull`'s
  seeded people) stay direct writes, since no engine state is involved. These
  specs run on both projects and are not in the TypeScript-only table.
- **The gallery engine leg starts red for known harness reasons.** Until the
  engine takes a clock command (#899), a load drops the crowd and cannot
  replay every pass the TypeScript leg owes, so shots with people (and a few
  pinned-clock shots) differ for a reason other than the engines disagreeing,
  and `27-elevator-schedule` cannot render on the engine (below). The leg is
  not a required check; its list is the parity report, with those causes to
  rule out first.

(Superseded 2026-10-10: the TypeScript leg now settles at the same points as
the WASM leg, so its render changes and the differences below are closed;
see "The symmetric settle" at the end of this story.)

Known harness differences on the engine legs (tracked as
`engine-gallery-clock-handoff`, #899): a load drops the crowd, so a shot
taken after a handoff or a clock pin shows the people the engine spawned
since, while the TypeScript leg keeps its crowd; a load also marks every owed
pass done, so an off-hour hour pass or a day pass, a fresh builder tower's
first rent and maintenance, and (for a clock pin across midnight to another
hour) the hour pass run differently on the two legs. One read-model gap, added to the
`engine-rs-binding-read-model` row (#868):
`27-elevator-schedule` cannot render on the engine, since its builder seeds
`elevatorHourly` (the measured ridership curve), which no save carries and no
command sets, so the Modern advice line never appears.

The vitest twins of these specs (the slice 1 bucket (d) tests) moved onto
relayed commands or `itTypeScriptOnly` in slice 2; this slice touches no
`src/tests/` file.

### TypeScript-only on `chromium-wasm`

Every skip goes through `tsOnlyOnWasm(reason)` (grep `tsOnlyOnWasm(`).

| Spec | Test | Reason |
| --- | --- | --- |
| `e2e/regions.spec.ts` | regions compose settled rooms, animate fires privately, and drain on budget | It toggles one office between fire and empty in place to pin the per-sync region move; no relayed command douses a fire, and a load would rebuild every region instead. The renderer mechanism it pins does not depend on the engine. |
| `e2e/perf.spec.ts` | ui.update cost, end-to-end speed, and node identity clear the committed baseline | `e2e/perf/baseline.json` was measured on the TypeScript engine, so the WASM engine has no baseline to clear yet (`wasm-perf-baseline`, #900). |

### Results

Gates on this machine (2026-10-09, after the rebase onto slice 2):
`npm run typecheck`, `npm run lint`, `npm test` (292 files, 4,235 passed, 67
skipped) and `VC_TOOLING=1 npm run build` pass; Playwright
`--project=chromium` passes 31 of 31, and `--project=chromium-wasm` passes 19
with 2 skipped (the two TypeScript-only tests above).

Host-browser preview only (not the pinned image, so not a CI result and
nothing committed):

- The TypeScript leg of the gallery renders byte-identically to the base
  branch (0 of 91 shots changed), and so do the 10 visual specs.
- The WASM engine matches all 10 visual baselines on the host.
- The WASM gallery matches the TypeScript render in 50 of 91 shots. 40 differ
  and `27-elevator-schedule` does not render (the #868 gap). In the shots
  inspected, the tower, stats and chrome agree and the differences are the
  moving layer (people and car positions), which the known crowd and pass
  gaps (#899) explain; the CI legs give the authoritative list.

CI results, first run on PR #904 (head `fe94c30`, before the perf fix):

- `engine-parity`: 41 shots differ between the engines. 38 differ in pixels
  (`03-tower-day` through `26-night-rooms`; `features/install-affordance-*`,
  `lobby-awning-*`, `metro-*`, `overlay-congestion/occupancy/satisfaction`,
  `stats-dialog-demand`, `stats-income-elevators`, `stats-tenancy-classic`,
  `tablet-*`; `milestones/tower`), the same list as the host preview, and 3
  are missing on the engine (`27-elevator-schedule`, `27b`, `27c`).
- `capture-wasm / shoot (features)` fails on those three scenes. `27` is the
  #868 gap; without its advice line the dialog is shorter, and in the pinned
  image's fonts `27b` and `27c` then fall under their below-the-fold guard.
  The other three shards render.
- `drift-gate` and `verify-drift`: green (no TypeScript drift).
- `e2e`: all 49 tests pass, and the perf gate failed (`ui.update` median
  1.39 ms against 0.65 ms), fixed by keeping `buildToStar`'s in-place build
  on the TypeScript engine (above); after the fix the local median is
  0.37 ms, the base's own figure, and both projects pass again (31; 19 with
  2 skipped), with the TypeScript visual specs unchanged.

CI results, second run on PR #904 (head `3a6c77f`, with the perf fix):

- `e2e`: green, perf gate included.
- `engine-parity-visual`: green. The 10 visual specs render on the engine
  against the committed `chromium` baselines with no pixel difference.
- `engine-parity`: the same 41 shots as the first run (38 pixel diffs, 3
  missing), and `capture-wasm / shoot (features)` fails on the same three
  `27*` scenes.
- `drift-gate`, `verify-drift`, `test`, `engine-rs`, `disc-rs`: green.

### Review record

`/bmad-code-review` (Blind Hunter, Edge Case Hunter, Acceptance Auditor) on the
full branch diff; no file under `src/engine` or `src/wasmhost` changed, so no
`/gds-code-review`.

| Round | Patch | Defer | Dismissed | Notes (counts after round 1 are approximate) |
| --- | --- | --- | --- | --- |
| 1 | 20 | 2 | 12 | compare the engines on the same run; engine visual leg on PRs; handoff catches in-place edits; owed hour pass; relayed builds checked; TOWER guards. Defers: #899, #900 |
| 2 | ~21 | 0 | ~13 | fail closed in the parity jobs; wider edit check with post-handoff verification; clock pin paths; departures 3 and 4 recorded; #899 widened |
| 3 | ~9 | 0 | ~6 | the frame loop's own blocking test; known lag kept out of the edit check; shards compared past a missing one; #868 row noted |
| 4 | 5 | 0 | 3 | missing shards kept out of the parity list; a missing baseline named; mint-failed message |
| 5 | 3 | 0 | 2 | optional fields normalized across both saves; no-compare summary wording |
| 6 | 0 | 0 | 3 | confirming pass on the round-5 delta: clean |
| 7 | 0 | 0 | 2 | confirming pass on the full diff: clean |
| 8 | 4 | 0 | ~6 | the CI perf-gate fix (in-place build on the TypeScript engine) and its doc follow-ups; #905 filed |

Copilot review: requested on the PR (Codex is out of quota).

## Engine fixes from the gallery's engine leg (2026-10-10)

The engine leg's first runs showed engine gaps under the harness noise. Fixed
in `engine-rs`, with the host reading the results:

- **Elevator telemetry (#868):** the hour pass now runs `sampleElevatorUtil`
  (`engine-rs/src/telemetry.rs`), with the dispatcher's boarding tally
  (`dispatch.rs`), so the
  schedule dialog's demand curve and advice, the stats screen's elevator loads
  and the diagnostics' utilization exist on the engine. The host adopts them at
  every merge (`src/wasmhost/telemetry.ts`).
- **Housekeeping report:** the morning checkout latches yesterday's shift
  result, which the stats screen's "unserved yesterday" and the diagnostics
  read.
- **Log text:** the rent, maintenance, checkout and treasure lines printed
  dollar amounts without thousands separators (`$1520000`), the garbage line
  printed its population count the same way, and five lines flattened a plural
  (`1 clubs`, `1 clinics`, `1 rentals`, `Recycling Center(s)`, `suite(s)`).
  `jsmath::to_locale_string` ports `Number#toLocaleString()` (en-US) and now
  formats every amount and count a TypeScript line formats that way, and the
  plural lines are pinned word for word by Rust unit tests. The TypeScript
  engine's log lines used the host's default locale (`1.520.000` in a German
  browser) where the engine always writes en-US; they now name `en-US` too,
  held by `src/tests/engineLocale.guard.test.ts`, so both engines write the same
  text for every player. The conformance
  view drops log text, so `wasmHostLogText.integration.test.ts` also compares
  the prose across a day, a quarter boundary and a maintenance boundary on
  every fixture.
- **Harness methods:** `advanceClock`, `seedLoopMemos` and
  `seedElevatorTelemetry` let the gallery pin the clock without a load and
  hand over a tower built in place with its owed passes and authored curve
  (#899, partly). They are binding methods the harness calls directly: no game
  command reaches them and the mirror does not relay them, though the browser
  package exports them like every other method.

Host preview after the fixes: 69 of 91 shots match (from 50), all three
`27-elevator-schedule` shots included. What remains is listed on #899.

Review: `/gds-code-review` round 1 (Blind Hunter, Edge Case Hunter,
Acceptance Auditor). Patched: the treasure line's amount, order-dependent
aggregate tests (each aggregate comparison is now one self-checking test), weekend coverage
in the telemetry suite, a quarter jump that could be skipped, the plural lines
pinned by unit tests, seed validation (non-object documents, ids past
`MAX_SAFE_INTEGER`), the handoff restoring the page when the engine refuses a
seed, and this section's wording. Deferred to #899: a handoff in the middle of
an hour drops the pending boarding tally, a handoff after a morning checkout
clears the housekeeping report, and a second handoff of a hosted tower
re-derives its loop memos. Dismissed:
the stats builder's money write (the relay forwards it as `setMoney`), the
plural rules (each copies its TypeScript template), and a NaN boarding count
(the waiting counts are never NaN).

Round 2 (confirming pass, the same three layers). Patched: the TypeScript
engine's log lines name the `en-US` locale (above), the treasure line and the
single-office line are pinned by unit tests, the weekend jump skips a weekend
start less than an hour ahead, a narrower comment on the merged telemetry
objects, and wording here and on #868 and #899. Dismissed: the overlay
builder's clock reference (unused after the ticks), the clock pin's delta (the
read model's clock is synced from the engine every frame and no scene writes it
directly), `is_multiple_of` (CI pins Rust 1.97), and a deeper memo test (both
engines derive the memos with the same formulas).

Round 3 (`/gds-code-review` confirming pass, and `/bmad-code-review` on the
scripts, each with all three layers). Patched: the host's telemetry merge now
updates each shaft's rings in place, since an open schedule dialog holds them
and recomputes from them (a merge that swapped in new objects froze the dialog
on the curve it opened with; a test now holds the rings across hosted hours),
a stale comment in `e2e/visual.spec.ts` about the clock pin, and wording on
#899. The scripts review found nothing else.

Round 4 (`/gds-code-review` confirming pass on the round-3 fixes, all three
layers): clean, with no new patch or defer finding.

Parity projects (`npm run test:wasm:parity`, against #891's head as the
baseline): this change fixes the two parity failures that read the
elevator telemetry and the housekeeping report (`elevatorStats`,
`housekeepingLegibility`) and adds none. The two new suites drive both
engines themselves, so they join the TypeScript side of the parity config
with `wasmHost.integration.test.ts`. `rentalCrowd`'s known merge-per-tick
timeout (#868) fails on both heads; run alone, its file takes about 5% longer
here (116 s against 110 s), the cost of reading the telemetry at each merge.

## The symmetric settle: no engine differences left in the gallery (#899, 2026-10-10)

The 22 shots left after the engine fixes differed for one harness reason. The
WASM leg reached the engine through a load, and a load normalizes a tower
(Classic ladder rent snap, silent milestone adoption, an empty crowd,
boarding tally and housekeeping report), while the TypeScript leg never
loaded. The fix loads on both legs at the same points.

### What landed

- `scripts/screenshot-engine.ts` `pgSettle` (both legs): deserializes the
  live instance's own save into a fresh instance and adopts it through the
  app's load path (`adoptSim`, undo-restore flavor). It carries what a load
  would drop and the TypeScript leg would keep: the loop's pass memos (read
  from the engine with the new `loopMemos()` getter when the tower is already
  hosted, so a second settle no longer re-derives them) and the elevator
  telemetry. It restores what `adoptSim` resets in the app (speed, pause,
  the star and win latches, the step accumulator, the meal-rush day, the log
  cursor and panel, the selection), skips while the title screen is up, and on the WASM leg
  seeds the memos and telemetry into the new host and verifies them.
- Settle points: before a builder's ticks (`__vcShotHandoff`, now installed
  on both legs), once a game scene is ready (after its build if it has one,
  unless the builder already settled, since a second load would drop the
  crowd the ticks grew), and after the
  setups in `SETTLE_AFTER_SETUP` (the engine demo tower, the six milestone
  shots, and the staged office vacancies in `stats-tenancy-classic`). Before
  a scene build or such a setup the WASM leg forces a merge, so the build or
  setup edits the engine's current tower rather than a read model that lags
  it until the hour. A listed setup must settle (a title screen still up
  fails it), and a list entry that names no shot with a setup fails the run.
  When a build or a listed setup already settled through a builder, the
  runner does not load again; the WASM leg checks instead that what changed
  since that settle reached the engine.
- The settle is told which leg it runs on, and after every settle the WASM
  leg checks that the live sim is the hosted instance, so a leg whose engine
  package never loaded cannot pass as a TypeScript render, and that the
  engine loaded the same tower the page did.
  Both legs check that the page holds the carried telemetry; the TypeScript
  leg checks the page's loop memos, and the WASM leg the engine's.
- One asymmetry is left by design: the merge before a build or a listed
  setup runs on the WASM leg only, so a presentation pin an earlier shot left
  on the read model alone (a staged satisfaction spread, say) is merged away
  there and kept on the TypeScript leg. No current shot does this; one that
  did would show as a pixel difference between the legs.
- Everywhere else the WASM leg runs `checkHosted`: it snapshots the page's
  tower before a clock pin or a setup and fails the scene by name when the
  step changed the clock, the star, a unit's place, state, occupancy, rent
  or label, or a transport, and the engine did not follow (also a
  row the step added or removed that the engine did not follow, or a row only
  the engine added). Only the fields the step changed are
  compared, since some fields reach the read model only at a merge (a gutted
  office's label, for one) and may lag harmlessly. Money stays out, since a
  relayed build can roll a treasure from the read model's hour-old rng
  (#868); the relay forwards a money write as `setMoney`. One shape function
  (`shotShape`), installed in the page, serves every check. An edit outside
  that shape shows up as a pixel difference instead.
- Three setups moved the page's clock only (`07-people-rush`,
  `recycling-filling`, `13-game-night`); they now call `pgSetClock`, which
  moves the engine's clock too. `13-game-night` used to set 23:00 on the
  same day even when that meant going back; `pgSetClock` only moves forward,
  so the setup now fails if the clock is already past 23:00 (it is not).

### An engine-host finding on the way

`18-sun-clip`'s cinema screen froze on a different frame on each leg with
identical sim state on both (people, clock, money, occupancy). The renderer
repaints rooms when `tower.mealOverlayRevision` moves, and the host copied
that counter only at a full merge, so on the WASM engine a lunch dip or a
venue visit redrew at the next hour pass or structural change. The read
model now keeps its own counter and bumps it at the frame the engine's
moves, so a bump the read model makes for a relayed command never collides
with an engine bump and the counter never steps back. A test in
`wasmHost.integration.test.ts` checks it frame by frame (it fails without
the fix). Player-visible on the WASM engine, so 2.29.4.

### Results

In `mcr.microsoft.com/playwright:v1.61.1-jammy` with `npm ci`,
`VC_TOOLING=1 npm run build` and the full Chrome (`PW_CHROME`), the
TypeScript and WASM legs render all 91 shots byte for byte the same, with no
scene failures. The committed gallery is refreshed from that TypeScript leg:
21 shots change, all of them for the load normalization above (the
"Milestone:" bulletin lines gone, Classic hotel income and population on
the Average rung, the crowd started fresh at a settle).

The items #899 deferred from the previous review (a mid-hour handoff drops
the boarding tally, a handoff after a morning checkout clears the
housekeeping report) now happen on both legs alike, since both load a fresh
instance at the same points, so they no longer move a shot. They are what a
load does on either engine (the TypeScript deserialize drops both too), so no
follow-up row tracks them.

### Review record

`/gds-code-review` (all three layers each round) ran six rounds on the whole
change; `/bmad-code-review` then ran three on the scripts.

- gds round 1. Patched: the settle after a scene build now skips when the
  builder already settled (a second load dropped the crowd the ticks grew,
  which changed the overlay and stats shots); the WASM leg merges before a
  listed setup, so the setup edits the engine's current tower; the WASM leg
  fails when the live sim is not hosted; the read model's meal counter
  became its own monotonic counter (a copy of the engine's could collide
  with a local bump or step back); the hosted check compares only the fields
  the step changed; a stale `SETTLE_AFTER_SETUP` entry fails the run;
  `13-game-night` refuses to roll into the next day; wording. Deferred:
  `overlay-heatmap-stale-after-load` (#927), pre-existing.
- gds round 2. Patched: one shared shape (`shotShape`) installed in the page;
  `pgSettle` records the settled shape and checks the engine loaded the same
  tower; a builder that settled gets a content check in place of a second
  load; the merge before a scene build; engine-only rows; a listed shot must
  have a setup; the 23:00 boundary; doc and row wording.
- gds round 3. Patched: the settle is told which leg it runs on (a WASM leg
  whose engine never loaded settled as the TypeScript leg did), and checks
  the live sim is hosted before comparing shapes; wording. Dismissed: the
  relay forwards a money write as `setMoney`; `frameView` drains nothing.
- gds round 4. Patched: money left the shape again (round 3 had added it; a
  relayed build can roll a treasure from the read model's hour-old rng,
  #868), with the reason recorded.
- gds round 5. Patched: comment and row wording only.
- gds round 6. Clean: no reachable finding in any layer.
- bmad round 1. Patched: the merge and the settle flag reset are one step
  (`beginSettleStep`), with the merge's own error named; a missing shape
  helper fails by name; `checkHosted` names the fix for its call site;
  `settleTower` is private; `docs/screenshots.md` describes the settle and
  `SETTLE_AFTER_SETUP`; the stale AC3 text points here. Deferred:
  `gallery-chained-shot-cascade` (#931), pre-existing.
- bmad round 2. Patched: fix hints for a clock move inside a setup, the
  `13-game-night` message, the leg prefix, two doc lines.
- bmad round 3. Clean in code; one docs sentence narrowed to what the hosted
  check covers.

After each code round the pinned image rendered both legs again: 91 of 91
shots the same on both legs every time, and the same as the committed
gallery from the round-1 refresh on.


## Slice 3: green on both engines, and in CI (2026-10-15)

What was left after review round 2 was the #868 read-model list and the
merge-per-tick timeouts. Most of the list had landed with the engine's
telemetry fix on 2026-10-10 (`elevatorUtil`, the housekeeping report);
this slice closes the rest and puts the projects in CI.

- **The commute-stress averages.** The engine already kept them
  (`Crowd::record_commute`, the same fold and alpha as the TypeScript
  engine); nothing read them out. `Engine.commuteStress()` returns
  `[[floor, seconds], ...]` by floor (`Crowd::commute_stress_json`, with a
  Rust unit test), and both hosts adopt the rows at every merge
  (`Crowd.adoptCommuteStress`; the worker carries them in the merge payload
  as `commute`, shape-checked with the rest of the reply).
  `wasmHostTelemetry.integration.test.ts` now compares them with the
  TypeScript engine hour by hour on every fixture, and they agree exactly.
  Nothing in the game reads the averages (they are the read-only #514 substrate; #502 settled as legibility only), so this changes
  no player-visible behavior.
- **The cost bucket.** A test that reads only what the frame carries every
  tick (the people, the clock, the unit states and counters) or the
  engine's own save at the end does not need a full merge after every
  tick. It calls `atEngineFrameCadence(reason)` (beside
  `itTypeScriptOnly` in `src/tests/parity/typescriptOnly.ts`) and runs at
  the host's own cadence, a merge on an hour pass or a tower edit, as the
  game does. The call goes in the test body before its first hosted tick
  (a later call, or one outside a test, throws, so a host never changes
  cadence partway through a run), and the setup clears it after each test.
  The opt-in also narrows what the setup checks: with no merge per tick,
  the full compare runs only when the revision or the fingerprint moves, as
  under `VC_WASM_SYNC=hour`, so such a test makes every tower edit before
  its first tick (after it, the instance lags the engine between merges,
  and a compare would read the lag as a divergence). The reason is required, and the table repeats
  it word for word: `fixedStep` (all six),
  `rooms` (the census on the 12,000-unit fixture) and `rentalCrowd` (its
  three day-long runs). A test at that cadence that asserts on state the
  frame does not carry calls `refreshFromEngine(sim)` first, which merges
  the engine's save into the instance: `rooms` does before each census
  check, since the census reads `residents`. The parity projects also take
  a 120 s test timeout, since every hosted tick syncs the engine's frame.
- **The worker-host suites.** `wasmWorkerHost`, `wasmWorkerLifecycle`,
  `wasmWorkerSaves` and `wasmHostAnalyticsBridge` start their own host, so
  they sit outside `integrationWasm` with the other host suites (the
  lifecycle suite's fallback failed by name, an instance with a crowd).
- **CI.** `test.yml` runs both projects on every PR as
  `test-wasm-parity` (one job per project, after `engine-wasm` fills the
  package cache). The job lives in `test.yml` because the parity projects
  run every suite, so a change anywhere in `src/` can break them, while
  `engine-rs.yml` runs only on engine paths. It is not a required check
  yet; that is the owner's call.
- **The setup's own pins.** `wasmHostSetup.integration.test.ts` calls
  `atEngineFrameCadence` in one of its pins to test the opt-in itself; it
  is the setup's test and has no row in the table.

- **The exclusions are counted (2026-10-20, #945's "Unit and integration"
  row).** `src/tests/parity/exclusions.ratchet.txt` pins how many
  `itTypeScriptOnly` marks and `atEngineFrameCadence` calls each test file
  holds, and `exclusions.guard.test.ts` fails on a new one, on a bare one
  (no reason) and on a stale line. The cadence calls (`fixedStep`,
  `rooms`, `rentalCrowd`) are the merge-per-tick cost exclusions; the
  structural snapshot of S6 (#868) removes them, and each removal lowers the
  ratchet. `ciJob.guard.test.ts` keeps the `test-wasm-parity` job and
  `npm run test:wasm:parity` on the same two projects, on the real engine.

### The runs (2026-10-15, this machine, four cores)

| Project | Files | Pass | Fail | Skip | Wall time |
| --- | --- | --- | --- | --- | --- |
| `integrationWasm` | 92 | 1682 | 0 | 39 | 180 s |
| `unitWasm` | 252 | 2794 | 0 | 0 | 116 s |

The 39 skips are the 38 `itTypeScriptOnly` marks (24 in bucket (c), 14 in
bucket (d), all in the table) plus one pre-existing skip (the opt-in
hour-cost bench, `hourCost.bench.integration.test.ts`); the round 2 run's
other four pre-existing skips no longer run in this project.
The unit project's file count grew with main (205 files then, 252 now). These figures are
from a local run; the `test-wasm-parity` job is the live check. The (b) bucket is
empty, as are (a) and the cost timeouts.

### The run on the takeover branch (2026-10-20, `claude/vitest-on-wasm-3k4ylx` merged with `main`)

`npm run test:wasm:parity` (both projects in one run, four cores): 350 files
pass and 1 is skipped; 4,545 tests pass and 39 are skipped (the 38
`itTypeScriptOnly` marks and the hour-cost bench); 0 fail, in 270 s. The same
branch passes `npm test` (4,793 pass, 14 skipped), `npm run test:wasm` (176
pass, 13 skipped), typecheck, lint, `npm run build`, `cargo fmt --check`,
`cargo clippy -D warnings` and `cargo test`. The `test-wasm-parity` job is the
live check. Both parity projects run with a 120 s test and hook timeout
(`vite.config.ts`, against the 30 s default), a relaxation S6 (#868) lifts
with the merge per tick (backlog row `wasm-parity-exclusion-pins`, #1084).

### What is left for #878

The vitest half (AC1) and the table (AC4) are done once the
`test-wasm-parity` job is green on this slice's PR, and AC2 and AC3 landed
in the e2e and gallery slice. Two items stay open: making
`test-wasm-parity` a required check (the owner's call; until then a red run
does not block a merge), and the CI half of AC3 at the flip (the committed
gallery and the minted baselines coming from the WASM engine), which the
3.0.0 switch (#945) does.
