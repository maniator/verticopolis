# Story: facade slice 6c, the engine's diagnostics facts (#1215)

Status: in-progress (PR 1 of 4, the tenant family)

Tracking: #1207 (the Rust-backed facade, AD-9), parent #945. Plan: `slice-plan.md`
and `ARCHITECTURE-REVIEW.md` in
`_bmad-output/planning-artifacts/architecture/architecture-rust-facade-2026-10-20/`
(decision F3, review section 5.4, risk row "Diagnostics port is large", hot-path
row HP-7). File ownership: `/mnt/project-files/release-3.0/rust-facade/parallel-map.md`.

## Story

As the player inspecting a facility on the Rust engine, I want the "why is this
unhappy" readout (access, lobby distance, the long walk, the main gripe, won't
lease, the notice countdown, and the service and retail lines) to be decided by
the engine that runs my tower, so that the inspector stops running TypeScript
gameplay code against a mirrored copy of the state, and the TypeScript fallback
shows the same facts the healthy path does.

## Scope

The facts behind `src/game/facilityDiagnostics.ts`, `src/game/gripeCopy.ts` and
`src/game/housekeepingDiagnostics.ts` (786 lines, the "790" of the plan) move
into a new engine module, `engine-rs/src/diagnostics/`, behind one binding
getter. The TypeScript keeps the wording. This slice changes no wording, no
simulation behavior and no conformance hash; moving the panel onto the getter is
slice 4's (panels through the port) and slice 7's (`RustSim`).

One PR per facility family, in this order, each with its own differential test,
crate minor bump and review:

| PR | Family | Lines it feeds | Engine pieces |
| --- | --- | --- | --- |
| 1 | Tenants: office, condo, hotel rooms, rentals, lease amenities | access, No Rate, the long walk (W1), lobby distance with the buildable sky lobby slot (#394), "Main gripe", "Won't lease" with the carrying cost, the notice countdown | `reaches_lobby`, `position_reachable`, `dominant_gripe`, the move-in gate (`build_satisfaction_context`, `would_evict_fresh_tenant`), `binding_transport_class_at`, `serving_transport_kinds_at`, `noise_afflicted`, the nightclub halo, `unmet_coverage`; new: the inspector's demand map memo, the floor bounds memo, `nearest_buildable_lobby_slot` |
| 2 | Commercial venues | W3 (too far from a lobby), the retail patronage block (today, yesterday's verdict inputs, profit, rain, local demand fraction and share, the Modern advice flag) | the demand map memo from PR 1, `nearest_lobby_floor_distance`, the catalog yardstick |
| 3 | Hotels and housekeeping | counts toward stars, dirty and infested rooms, the housekeeping station's coverage block | `housekeeping_coverage` from slice 6b (`engine-rs/src/panels/coverage.rs`, agreed with that lane on 2026-10-20; this slice does not port it a second time), the housekeeping report |
| 4 | Services and transport | parking ramp access and demand, recycling fill and capacity, a passenger elevator's average load | `functional_parking_set`, `parking_demand`, `recycling_capacity`, the recycling fill, the elevator utilization average (6b's read if it lands first) |

## Acceptance criteria

1. `Simulation::diagnostic_facts(id)` in `engine-rs/src/diagnostics/` returns the
   facts for one unit, or `None` for an unknown id. The binding exports it as
   `diagnosticFacts(id)` (JSON text, or `undefined` for an unknown or malformed
   id; malformed input neither throws nor traps), in its own `#[wasm_bindgen] impl Engine` block
   appended after the last item of `engine-rs/src/wasm.rs` before its test
   module (clippy's `items_after_test_module` refuses anything after it),
   declared in `src/dualrun/engine.d.ts` by `npm run wasm:build`.
2. Each family's facts equal the TypeScript reference
   (`src/tests/diagnostics/{tsDiagnosticFacts,inspectorAgreement}.ts`, built from the same TypeScript
   engine helpers `facilityDiagnostics` calls, with its gating) for every room on
   every checkpoint of every conformance scenario, run on each engine in turn
   and compared read by read, plus targeted constructed towers for the
   branches the corpus does not reach. Floats compare exactly.
3. The story records the branch coverage the corpus and the targeted towers
   reach in the compared TypeScript reference, and names any branch left out.
4. The getter is read-only for the simulation: every conformance scenario run
   with the getter called on every room at every checkpoint still matches
   `conformance/expected.json` (state, crowd and events digests). The caches it
   fills are keyed on at least what the TypeScript keys on, filled at the same
   reads the TypeScript inspector fills its own, and sit outside the save and
   digest.
5. The conformance lock, `SAVE_VERSION`, the frame layout and the catalog are
   unchanged. The crate version goes up one minor per merged PR, with
   `npm run engine:compat` re-recorded.
6. Malformed input: a non-number, fractional, negative, out-of-range or missing
   id returns `undefined`, as does an id that names a transport (the getter
   reads units only); a floor tile returns the bare `{ id, kind, mode }` a
   non-tenant gets. Never a panic.
7. `/gds-code-review` with the Hot-Path Auditor; the HP-1 to HP-12 record is on
   the PR; every `patch` finding fixed, every `defer` in the backlog with an
   issue.
8. No closing keyword before #868 or #954 in any PR text.

## The facts contract (PR 1, tenants)

`diagnosticFacts(id)` returns `{ id, kind, mode, ...sections }`. A section is
present only when its line's gate holds, mirroring `facilityDiagnostics`, so
the JSON stays small and a section the gate rules out never reaches the copy.
Present does not always mean a line, because the copy, which stays in
TypeScript, decides what to print. The `gripe` section names the inspector's
dominant gripe whatever it is, and the "Main gripe" line spells out only the
causes with no line of their own (rent, congestion, noise, unmet demand): for
`access`, `noTransport`, `lobbyFar` and `transportFar` the card prints nothing,
because the access, long walk and lobby distance lines already say it. Unmet
demand at coverage 0 with `floorReachable: false` prints nothing for the same
reason. The won't-lease line names the same causes and falls back to "a new
tenant here would soon give notice" for the rest.

| Section | Present when (the TypeScript gate) | Fields |
| --- | --- | --- |
| `access` | `hasAccessDiagnostic`: the kind has population or a daily income in the tower's catalog | `"notConnected"` (floor not served), `"cutOff"` (the unit's segment does not reach the lobby, #647), `"reachable"`, `"noRoute"` (ground-connected floor by floor, but no rider route reaches it, such as a transfer floor split by a gap between its two shafts) |
| `noRate` | `u.noRate` | `"occupied"` (a present tenant) or `"offMarket"` |
| `farWalk` | W1: office or rental Apartment, not on floor 1, its segment reaches the lobby, nearest stair, escalator or passenger elevator over `TRANSPORT_FAR_TILES` (none counts as far) | `true` |
| `lobby` | office, condo, hotel or Apartment whose segment reaches the lobby, and the mode's lobby distance drain caps below 1 | `distance`, `sinking` (erosion over `SERVED_RECOVERY`), `slot`: `null` when no nearer legal sky lobby slot exists, else `{ floor, onSlot, needsSupport, clearFirst }` |
| `gripe` | present tenant, not vacating, satisfaction at or under `GRIPE_WARN`, office, condo, lease amenity, hotel or rental, and the inspector's dominant gripe is not null | `cause` (the `VacateReason` key), plus what the copy branches on: `binding` and, for a walkway binding, `elevatorHere` (congestion, #699, #701); `adjacent` and `club` (noise, #684); `coverage` and, at coverage 0, `floorReachable` (unmet demand, #395) |
| `wontLease` | empty, on market, served and position-reachable office, condo, lease amenity or rental that the move-in gate holds vacant | `gripe` (as above, attributed with congestion neutralized and the gate's candidate-aware coverage, or absent) and `carry` (monthly overhead plus a condo's hold tax, 0 in Classic) |
| `notice` | vacating with a reason | `reason`, `minutesLeft` (never negative), `satisfaction`, `keepAt` (`VACATE_RESCIND`) |

The getter decides the facts; `gripeCopy`'s table, the sky lobby phrasing, the
countdown's rounding and every color stay in TypeScript. The later families add
`shoppers`, `retail`, `hotel`, `housekeeping`, `parking`, `recycling` and a
transport getter, each specified in its PR.

## Design notes

- **One getter, lazy sections.** The getter evaluates a section only when its
  gate holds, in the order `facilityDiagnostics` does, so a plain unit costs a
  few lookups and only an unhappy or gated unit pays for congestion, the demand
  map or the gate's horizon.
- **The engine's own attribution.** The main gripe calls
  `Simulation::dominant_gripe`, the function the eviction path uses, with the
  flags the TypeScript inspector recomputes when it passes none: served is the
  segment-aware `reaches_lobby`; congestion is the floor's spatial reading;
  the far walk and noise are the live predicates; lobby-far is the drain cap at
  or under `GRIPE_WARN` for the demand tenants; unmet demand is active on a cap
  or an erosion (the inspector's wider reading, where the eviction path takes
  erosion only). Won't lease passes congestion 0 and the gate's own
  candidate-aware coverage, as `wontLeaseText` does.
- **Coverage is read lazily, where the TypeScript reads it.** `dominantGripe`'s
  `readCov` reads coverage only at a noise tier that fires (to see whether
  unmet demand's steeper erosion takes the tier, #548) and at the last tier,
  unmet demand itself. The main gripe therefore first runs with unmet demand
  off, and only a first answer of noise or nothing, on a served unit of an
  unmet-demand kind, reads the demand map, so `diag_memo` fills at the reads
  that fill `demandMemo`; a unit whose gripe is decided before the noise tier
  (rent, lobby-far and the rest) never builds the map. Both the #548 override
  and the last tier need the drain active, so the second pass runs only when
  the coverage turns unmet demand on; otherwise the first pass's answer
  stands.
- **One read per pass.** The getter reads the unit's position reachability
  once for access and won't lease, and builds the spatial congestion map once
  for the ratio and the binding (`spatial_congestion_with_attribution` in
  `presence.rs`, `binding_class_from` in `churn.rs`, both agreed with the
  bare-step lane on 2026-10-21).
- **Caches (HP-8).** The TypeScript inspector reads the demand map through
  `demandMemo`, keyed on the tower revision and the game hour, and the highest
  floor through `floorBounds`, keyed on the revision. The Rust engine had no
  cache for the demand map, so this slice adds one in
  `engine-rs/src/diagnostics/memo.rs`; the highest floor reads the tower's
  `floor_bounds`, which #1276 (#1237) ported, keyed on the revision and the
  unit count. (Until that landed the slice carried a memo of its own for it;
  the rebase dropped it.) The demand memo's key adds the unit count to the
  TypeScript's inputs, which can only add a rebuild. It is held on the
  `Simulation` beside `reach_memo` and `noise_memo` (a load builds a fresh
  `Simulation`, which resets it). Its lag within an hour is the TypeScript's
  documented one and only the inspector sees it; the simulation never reads
  the memo. The move-in gate keeps building its own map per
  call, as the TypeScript does, because it registers the candidate in it.
  PR 2's retail block must read the map through `diag_memo.demand` too, at
  the reads where `retailStatsLines` reads `demandMemo`, or the two memos fill
  at different points and the lag differs.
- **A `&mut` getter.** Reachability, noise and the floor-reachable memo fill
  revision-keyed caches, as they do in TypeScript; AC 4 proves that filling them
  from the inspector changes no result.
- **Sky lobby slot.** `nearestBuildableLobbySlot` is ported into the module
  (a walk over the every-15th slots, a handful), reading `floor_has_lobby`.

## What it removes

Nothing yet. The getter is the Rust side of F3; slice 4 routes the panel through
`port.query`, and from slice 10 the inspector on the healthy path reads this
getter instead of running `dominantGripe`, `wouldEvictFreshTenant` and the rest
on the mirror. `src/tests/diagnostics/tsDiagnosticFacts.ts` is the reference the
TypeScript adapter can adopt when slice 4 needs a facts query on the fallback.

## Tests

- Rust unit tests in the module (`tenant_tests.rs`): each section's gate and
  fields on constructed towers (access in all four states, No Rate both ways,
  the long walk, the slot search, the slot to clear, the slot that needs
  support and the unit on its slot, no slot past a lobby on the last slot, the
  Classic sinking band, the rent gripe and its gates, a noise gripe with its
  adjacent source, the binding names the serving-kinds fallback gives
  (elevator, walkways and escalator, read without the gripe's attribution, so
  never with an elevator stop), the gate in Modern and its carrying cost in
  each mode,
  the notice), malformed and unknown ids. The plain slot, the other gripe
  causes, the nightclub source, the attributed congestion path and the
  elevator stop are compared against the TypeScript on its towers and the
  corpus.
- Rust (`memo_tests.rs`): the demand memo rebuilds on each key input on its
  own (a new game hour, a transport edit that bumps the revision alone, a room
  edit, a unit list cut behind the revision) and a load starts it empty; it
  holds through occupancy changes and 59 minutes within the hour (the tower's
  `floor_bounds` has its own tests from #1276); the main gripe leaves the demand
  memo empty for a rent gripe and fills it for an unhappy office whose ladder
  reaches unmet demand; `asking_changes_nothing` (Classic and Modern) asks
  about every unit every hour for three game days and keeps state, crowd and
  gameplay events equal to a twin that never asks, and fails unless the run
  reached access, a gripe, a won't-lease hold and a filled demand memo.
- TypeScript (`src/tests/integration/conformanceWasmDiagnostics.integration.test.ts`,
  matched by `test:wasm`'s `conformanceWasm` filter): every scenario runs on
  each engine with every room's facts read before each checkpoint hash (and on
  both sides of a reload); the two runs must agree fact for fact and both must
  still match the lock (AC 2, AC 4). A third TypeScript run renders the
  inspector card beside each read and checks the reference against it
  (`src/tests/diagnostics/inspectorAgreement.ts`: each tenant line shows
  exactly when its section is present and the copy prints it, since the
  "Main gripe" line stays silent for a cause another line names, and each
  line prints the copy its
  fields choose: the lobby distance and slot advice, the gripe's binding,
  elevator stop, noise sources and coverage, the won't-lease cause and
  carrying cost, the notice's countdown and percentages). It runs apart
  because the card fills the demand memo for lines this family does not read.
  A last test fails if the corpus stops reaching any section it reached when
  PR 1 was recorded; it skips when not every scenario finished (a `-t` run or
  a failure above), since the tally is then partial.
- TypeScript (`conformanceWasmDiagnosticsTowers.integration.test.ts`):
  fourteen cases on constructed towers (sixteen towers: the congestion case
  and the slot-above-the-top case each build two), each saved and loaded into
  both engines and checked against the card, for the branches the corpus
  never reaches. The cases that pin a section's fields also edit each field
  the card branches on (the congestion binding to each other name and the
  elevator stop flipped, the nightclub and neighbor sources, the coverage and
  the reachable floor, the slot's support flag, the carry) and check that the
  card check catches every edit. Four of the cases came from the independent
  review's mutation pass over `tenant.rs`, and each fails when its line is
  mutated: the slot one story above the top (no support) beside one two
  stories above it, a condo whose noise the ladder reaches before it reads
  the coverage and where unmet demand takes the tier, an open condo set to No
  Rate beside the same spot on the market (No Rate is a Classic state, since
  Modern loads drop it, and an office at No Rate pays no rent and stays,
  which is why the case uses condos), and an unsold condo whose 1.5% hold
  tax is fractional and rounds up. A lag case holds the demand memo's lag
  within the hour on both engines: two shops finish building inside one
  hour, a rent gripe read before either opens leaves each memo empty, a read
  between the two fills it with one shop open, a read after the second still
  sees one shop with the hour and revision unchanged, and a fresh load on
  each engine sees both. A negative control checks that the card check
  catches a wrong fact in each section and in each field the copy branches
  on (the access state, No Rate, the long walk, the lobby distance, band and
  each slot flag, the gripe cause and its absence, the won't-lease cause and
  carry, the notice reason, countdown, satisfaction and keep threshold). The
  last case holds the binding's answers for ids that name no unit (a
  transport, zero and negative zero, negative, fractional, not finite, past
  2^32, at and past the edge of the safe integers on both signs, a string, a
  boolean, null, undefined) beside one that does.
- Coverage of the reference and the card, measured with
  `VC_REQUIRE_WASM=1 npx vitest run --project integration conformanceWasmDiagnostics --coverage --coverage.include=<file> --coverage.exclude=nothing --coverage.reporter=text`
  (thresholds set to 0 for the run).

## Hot-path plan (HP-7)

Entry point: the inspector and the mobile editor panel, refreshed about every
160 ms while a facility is shown, and the desktop hover. Their budget is
HP-12's for the HUD and panels: the work scales with what is on screen and
stays flat as the tower grows. Per call, for one unit: a clone of the unit,
field reads, `reaches_lobby` (a per-revision connected set) and
`position_reachable` (a per-revision set lookup since #1246), the noise memo,
the transport columns memo. Only gated units pay for more: the lobby distance
band's slot search (the every-15th slots between the unit and its lobby, a
handful) and the highest built floor (the tower's `floor_bounds`, memoized on
the revision and unit count since #1237); the spatial
congestion map (a pass over rooms and shafts plus the parking flood and its
seed walk over every unit, which is about two thirds of the build; the
TypeScript's own cost, uncached there too); the nightclub halo for a noise
gripe on a home (each check walks every unit: up to five walks per read when
unmet demand is active and the ladder runs twice, against the TypeScript's
three); the demand map (memoized per hour); and for an empty gated unit the
move-in gate (a context pass over rooms, a fresh demand map and up to 48
probe steps, as `wontLeaseText` costs today). The record lists each pass with
its reason, per HP-2's rule that a pass over rooms at this tier needs one.

Not reachable yet: no production code calls the getter in this PR, so the
record has no live caller to trace. Two items carry to the slices that wire it:

- The desktop hover fires on every pointer move (F5), and today's TypeScript
  card re-renders on each one (#1287). The wiring (slice 4 for the panel,
  slice 10 for the healthy path) reads the facts at most once per 160 ms
  refresh, a pick change marking the card for the next one. This is an
  acceptance item for those slices, posted on #1211 and #1222.
- The whole-unit walks the gated sections inherit are the bare-step lane's
  to cut, deferred by reference: the congestion map's rebuild per eviction to
  #1237 (whose fixes in #1276 already seed the parking flood and count the
  operational rooms from the room index); the nightclub walks to
  #1158 A13; the parking flood and the move-in probes to #1158 A14; the
  demand map's SipHash maps and its unread `delivered_by_unit` to #1158 A33;
  the demand map's per-room `segments_of` clones to #859 (A8). The route
  searches the gate used to repeat have been per-revision set lookups since
  #1246 (#1143 item 2).
  Beyond those, the getter adds call sites of one walk, where the TypeScript
  inspector makes the same one: the nightclub halo (`gripeCopy`'s
  `nearNightclub`), which A13's per-pass list answers too. The backlog's
  #1237 row carries the gate: no PR gives the getter a production caller
  until #1158's A13, A14 and A33 are on `main`, or the owner accepts the
  deferral on that PR.

## Coordination

- Slice 6b owns `housekeeping_coverage` and any elevator utilization read; PR 3
  and PR 4 call them.
- The step-hotspot lane owns `sim.rs` reachability, `tower_query.rs` and
  `housekeeping.rs`; this slice only adds a memo field to `Simulation` (told to
  that lane) and makes `near_nightclub` crate-visible in `satisfaction.rs`.
- `wasm.rs` and `engine.d.ts`: one appended block each; whichever of 6a, 6b, 6c
  and 6d merges second rebases, bumps the crate again and reruns
  `npm run engine:compat`.
- Merge after 6a (parallel map). 6d (#1244) merged first and took crate
  0.4.0, #1231 took 0.4.1, #1233 took 0.5.0, #1256 took 0.7.0 and 6b
  (#1321) took 0.8.0. Other open PRs claim 0.8.1, 0.9.0 and the next
  free one after that, so PR 1 (#1255) carries 0.11.0 as a placeholder.
  When PR 1 is ready to merge it rebases, takes the next free version on
  `main`, reruns `npm run engine:compat` and has the head re-checked.

## Dev Agent Record

### Completion notes

PR 1 (tenants):

- The facts agree on all 25 scenarios, every room at each of the 611
  checkpoints and on both sides of each reload, with every pinned hash
  unchanged on both engines. By section, the corpus compared `access`
  (325,461 reachable, 8,096 cut off, 163 not connected), the long walk
  (3,417), the lobby distance with a slot that needs support (20,100), the
  main gripe (lobby far 2,942, noise 7,361, rent 923, transport far 731, no
  transport 419, access 10), won't lease (noise 2,076, transport far 1,549,
  rent 255), No Rate while occupied (291) and notices for six causes (no
  transport 2,716, noise 626, transport far 527, relocation 471, rent 351,
  access 40).
- The constructed towers add what the corpus lacks: `noRoute` (a transfer
  floor split by a gap, and a Classic floor past the four-flight stair climb),
  `offMarket`, the slot to clear and the unit on it, a sinking room's slot to
  build on or to clear, no slot at all (a room past a lobby on floor 90), the
  stairs binding with and without an elevator stop, the elevator binding, the
  nightclub halo,
  unmet demand at zero coverage for a tenant and for an open spot, at partial
  coverage for a tenant, and at zero on a floor no rider reaches, a lease amenity held back, and a
  notice with no deadline.
- Branch coverage under the two suites, measured on the final branch with
  the command under Tests (v8 branch counts):
  - `tsDiagnosticFacts.ts`, the reference: 98 of 99. The one left is
    `gripeFacts`' "no coverage" arm for an unmet demand gripe, which cannot
    happen: the gripe is only active on a coverage reading.
  - `inspectorAgreement.ts`, the card check: 94 of 96. Left: a lit value
    that is null or undefined (the card renders none) and the phrase for a
    congestion binding no copy knows (no fact carries one). The walkway,
    escalator and "none" arms are reached by the towers' field edits.
  - `gripeCopy.ts`: 54 of 62. Left: the congestion arms for walkways,
    escalators and "none" (no tower crowds the first two; a fired congestion
    gripe cannot produce the third, since it needs a served floor) and the won't-lease lead with no named cause
    (the gate held no spot whose attribution names nothing).
  - `facilityDiagnostics.ts`: 152 of 168. Left, on the tenant lines: the
    capped copy for a room on the slot (a room on a slot sits at least 14
    floors from the nearest lobby, past the capped band in both modes) and
    the sinking copy with no slot, which the card itself calls unreachable at
    the current geometry. The other misses are lines of the later families:
    the parking demand line (line 40, PR 4), recycling capacity (PR 4), the
    retail block (PR 2) and the transport load line (PR 4).
- The card check (`inspectorAgreement`) finds no disagreement on any read of
  the corpus or the towers, with each line's copy checked against the fields
  that choose it.
- Not constructed: a tenant on floor 1. Placement refuses rooms on the ground
  floor ("The ground floor is a lobby concourse"), so only an old save could
  carry one; both engines gate the long walk and the congestion reading on
  `floor != 1` the same way.
- Not compared by the differential: the escalator and walkway congestion
  bindings (a full floor of offices does not crowd an escalator), which share
  the binding name mapping with the stairs and elevator cases.

### File list

PR 1: `engine-rs/src/diagnostics/{mod,memo,memo_tests,tenant,tenant_tests}.rs`,
`engine-rs/src/{lib,sim,satisfaction,presence,churn,wasm}.rs`, the crate version files and
`compat-record.json`, `src/dualrun/{binding,exportTiers,engine.d.ts}`,
`src/tests/diagnostics/{tsDiagnosticFacts,inspectorAgreement}.ts`,
`src/tests/conformance/{scenario,wasmEngine}.ts` (`scenario.ts` gains the
start and reload helpers, `wasmEngine.ts` the start and reload helpers),
the two `conformanceWasmDiagnostics*` integration tests, `vite.config.ts` (the
WASM parity project skips them, since they run each engine themselves),
`docs/performance/hot-path-review.md` (the HP-8 rows: the demand memo, and
the floor bounds row naming the inspector's read) and
`_bmad-output/implementation-artifacts/backlog.md` (the #1237 gate, the A33
note on the #1158 row, and the hover re-render split from the #1170 row into
its own row, #1287).
