# Story: facade slice 6c, the engine's diagnostics facts (#1215)

Status: done (2026-11-10). PR 1 (#1255) moved the tenant family;
families 2 to 4 landed as their own reads (the service facts, #1564 and
#1569; the retail block's catalog match and the venue's lobby distance,
#1616; the recycling and near-capacity verdicts, #1756; and the port's
`shaftCard`), and #1811's corpus differential below compares them. On
2026-11-10 the owner accepted the four items the completion notes list as
recommended (AC 7 for #1564 and #1569, AC 6 for the families' own reads,
the HP-7 gate and the amended AC 2), and #1215 closed.

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

The facts behind `facilityDiagnostics.ts`, `gripeCopy.ts` and
`housekeepingDiagnostics.ts` (in `src/game/` when this was planned, in
`src/tests/diagnostics/` since #1813; 786 lines, the "790" of the plan) move
into a new engine module, `engine-rs/src/diagnostics/`, behind one binding
getter, and the TypeScript keeps the wording. The one getter held for PR 1
(`diagnosticFacts`). Families 2 to 4 did not extend it: each PR that moved one
shipped its own read (the keyed `serviceDiagnostics` facts, the port's
`shaftCard` and the three recycling reads), and this story records what
landed in its completion notes. This slice changes no wording, no
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
   branches the corpus does not reach. Floats compare exactly. Families 2
   to 4 shipped their own reads (see Scope), so their reference is the
   TypeScript port's `serviceDiagnostics` (`src/engine/port/reports.ts`), its
   `shaftCard` (`src/engine/port/queries.ts`) and the `Simulation`'s three
   recycling reads; `tsDiagnosticFacts` and `inspectorAgreement` are PR 1's.
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
countdown's rounding and every color stay in TypeScript. The later families
did not add the sections planned here (`shoppers`, `retail`, `hotel`,
`housekeeping`, `parking`, `recycling` and a transport getter). They landed
as their own reads: `serviceDiagnostics` answers hotel, parking,
housekeeping and retail, and its `commercial.lobbyFar` is the planned
`shoppers` line (the venue's lobby distance, #1616); the three recycling
reads answer recycling; and the port's `shaftCard` carries the transport
load (see the completion notes).

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
- Families 2 to 4 (#1811), TypeScript
  (`src/tests/integration/conformanceWasmDiagnosticsServices.integration.test.ts`,
  matched by `test:wasm`'s `conformanceWasm` filter): every scenario runs on
  each engine with every room's `serviceDiagnostics`, the first floor tile's
  and the first lobby tile's, every shaft's `shaftCard` and the tower's three
  recycling reads taken before each checkpoint hash and on both sides of each
  reload; the two runs must agree read for read, and both must still match
  the lock. A read that raises a gameplay event no later hash would see fails
  the run. A last test fails if the corpus reaches a section it did not reach
  when this was recorded, or stops reaching one.
- Families 2 to 4, constructed towers
  (`src/tests/integration/portServiceDiagnostics.integration.test.ts`): fixture
  saves loaded into both ports for what the corpus lacks, compared side by
  side: a parking stall exactly covering the offices' cars and one office
  past it (the ramp too), an excluded hotel that is infested, a recycling
  center well over capacity, one person over it, exactly at it, well under
  it and with no one to serve (capacity, fill and verdict, with the
  population pinned, so the pair at capacity pins the verdict's `<=`, read a
  minute before collection so the fill well over capacity reaches its clamp
  at 1), a housekeeping station and a ramp under construction, in a
  fire and gutted, ids that name no unit, shaft ids beside a real shaft that
  name none, and a shaft's id asked for service facts and a room's for a
  shaft card.

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
record has no live caller to trace. Two items carry to the slices that wire
it, and a third records the gate this section set:

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
  `nearNightclub`), which A13's per-pass list answers too.
- The gate this section set was not met. It said no PR gives the getter a
  production caller until #1158's A13, A14 and A33 are on `main`, or the
  owner accepts the deferral on that PR, and it sat on the backlog's #1237
  row. #1560 (merged 2026-10-31) gave it one: the shipped card reads the
  tenant facts through the port's `unitFacts`
  (`src/game/portUnitDiagnostics.ts`, built from `diagnostic_facts` in
  `engine-rs/src/wasm_port_reports.rs`), while A13, A14 and A33 were open
  on #1158, as they still are. #1560's
  record caps the read at once per game hour for a selected unit, plus a
  fresh read when a new room is picked or hovered or the tower is edited,
  and leaves the cost to an independent review; no owner acceptance of the
  deferral is on record there or on the #1237 row, which was closed as done
  on 2026-11-03 with the gate still in its text. This went to the owner with AC 7 (completion notes): accept the
  deferral in their own words, or have A13, A14 and A33 fixed first. On
  2026-11-10 the owner accepted the deferral, and the PC performance run
  checks the cost of the three (#1215).

## Coordination

- Slice 6b owns `housekeeping_coverage` and any elevator utilization read; the
  service facts (#1564) and the port's `shaftCard` call them.
- The step-hotspot lane owns `sim.rs` reachability, `tower_query.rs` and
  `housekeeping.rs`; this slice only adds a memo field to `Simulation` (told to
  that lane) and makes `near_nightclub` crate-visible in `satisfaction.rs`.
- `wasm.rs` and `engine.d.ts`: one appended block each; whichever of 6a, 6b, 6c
  and 6d merges second rebases, bumps the crate again and reruns
  `npm run engine:compat`.
- Merge after 6a (parallel map). 6d (#1244) merged first and took crate
  0.4.0, #1231 took 0.4.1, #1233 took 0.5.0, #1256 took 0.7.0 and 6b
  (#1321) took 0.8.0, and #1068 took 0.9.0. On 2026-10-27 the owner
  approved a stack of PRs into `main` (#1343, #1340, #1284, #1255, #1290,
  #1329, each based on the one before): 6a (#1284) takes 0.10.0 and PR 1
  (#1255), rebased onto 6a's branch, takes 0.11.0 with
  `npm run engine:compat` rerun, and has the head re-checked.

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
    the parking demand line (line 40, family 4), recycling capacity (family
    4), the retail block (family 2) and the transport load line (family 4),
    which landed as their own reads (below).
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

Families 2 to 4 (venues, hotels and housekeeping, services and transport):

- They landed outside this slice's PR order, as the typed service facts
  (`serviceDiagnostics`, `engine-rs/src/diagnostics/service.rs`, #1564: hotel,
  parking and housekeeping), the retail facts (#1569, for #1568), the retail
  block matched to the catalog with the venue's lobby distance restored
  (#1616, for #1614 and #1615), the recycling and near-capacity verdicts
  (#1756, for #1420) and the port's `shaftCard` (the elevator load, from 6b's
  utilization read). The TypeScript keeps the wording
  (`src/game/portServiceDiagnostics.ts`, `src/game/recyclingDiagnostics.ts`).
- Four items went to the owner, posted on #1215. On 2026-11-10 the owner
  accepted all four as recommended ("Confirmed", recorded on #945 and on
  #1215), and #1215 closed:
  - AC 7 is unmet for #1564 and #1569. The owner merged both with no
    `/gds-code-review` run and no HP-1 to HP-12 record posted on either PR.
    #1564 has no outside review, since Copilot and Codex were rate limited
    that day. #1569 has an independent review's GO and a Copilot review that
    came after the merge and left one thread open: `TRAFFIC_FACTOR_MEAN`
    was the literal 0.8 in `engine-rs/src/diagnostics/service.rs` when
    #1569 merged, where the TypeScript derives it from the economy's traffic
    range (`TRAFFIC_FACTOR_MIN + TRAFFIC_FACTOR_SPAN / 2`, which
    `engine-rs/src/economy.rs` also defines), so a retune would move one
    engine's retail baseline and not the other's. #1845 (merged on
    2026-11-10) derives it in Rust with the same value, which closed that
    thread. The call: review those two PRs' engine code now, or accept them
    as merged. Outcome: accepted as merged.
    #1811's own review covers the comparison it adds and none of the engine
    code those two PRs shipped.
  - AC 6 holds for PR 1's getter and not for the families' own reads.
    `serviceDiagnostics` and `shaftCard` take a number at the binding,
    which turns any JavaScript value into one first: `"252"`,
    `" 252 "`, `"252.0"` and `[252]` read unit 252 on the Rust engine, and
    `true` reads unit 1, where the reference answers `undefined` (or an
    empty shaft card). The port declares the id a number
    (`src/dualrun/engine.d.ts`), so a typed caller cannot pass one. The
    call: accept the difference, or have the binding refuse a non-number,
    which changes the binding and takes a crate bump. Outcome: accepted as
    a known difference, with no binding change; the parity register's
    section 8 lists it.
  - The HP-7 gate was not met (see the hot-path plan above): the getter has
    a production caller since #1560, while #1158's A13, A14 and A33 are
    still open, and no owner acceptance of that deferral was on record.
    Outcome: the deferral is accepted, and the PC performance run checks
    the cost of A13, A14 and A33.
  - #1811 amends AC 2 to name the families 2 to 4 reference (the port's
    `serviceDiagnostics` and `shaftCard` and the `Simulation`'s recycling
    reads), since those families shipped their own reads rather than PR 1's
    getter. The call: accept the amended criterion. Outcome: accepted.
- `src/tests/integration/conformanceWasmDiagnosticsServices.integration.test.ts`
  is their corpus differential, the counterpart of PR 1's. The figures in
  this bullet are a snapshot of the test's `afterAll` line, run on #1811 on
  2026-11-10; the test prints the live ones on every full run.
  On all 25 scenarios, at each of the 611 checkpoints and on both sides of
  each of the 8 reloads (627 reads per engine), every room's
  `serviceDiagnostics`, the first floor tile's and the first lobby tile's,
  every shaft's `shaftCard` and the tower's three recycling reads equal the
  TypeScript reference's (`serviceDiagnostics` in
  `src/engine/port/reports.ts`, `shaftCard` in `src/engine/port/queries.ts`
  and the `Simulation` recycling reads), with every pinned hash unchanged on
  both engines. By section, the corpus compared hotels (counting toward the
  rating: 48,631 neither dirty nor infested, 16,137 dirty, 3,856 infested;
  excluded: 27,473 neither dirty nor infested, 13,765 dirty), parking
  (40,753 connected, 785 disconnected, 1,605 ramps), housekeeping (4,853
  adequate, 142 observed shortfalls, 2 nominal shortfalls), retail (6,307
  active reads: tiers 1,301 no data, 1,270 low, 787 average, 2,949 booming;
  advice 2,054 none, 4,091 under-served, 162 over-built; 627 in rain), the
  venue's lobby distance (2,069 too far, 5,639 near), the shafts (10,216
  cards: 2,284 with a load reading, 1,853 standard and 431 express, of which
  2 standard are near capacity; 32 idle, all standard; and 7,900 with no
  load reading: 3,995 stairs and 2,533 escalators, which never carry one,
  1,110 service elevators, which never carry one either, and 262 passenger
  elevators before their first hourly sample, 213 standard and 49 express),
  recycling (317 reads with a center built, all with demand met and the bins
  filling) and service rooms in a fire, gutted or under construction (103:
  20 parking, 61 fast food, 4 cinemas, 4 shops and 2 each of amusements,
  boutique bays, daycares, food halls, nightclubs, sky bars and spas), whose
  parking, housekeeping and retail sections the reference switches off (the
  test checks that on each read) and the Rust engine matches; a venue's
  lobby distance is still answered.
- What the corpus does not reach, and where it is checked instead, all on
  fixture saves loaded into both ports and compared side by side in
  `src/tests/integration/portServiceDiagnostics.integration.test.ts`: a
  parking shortage (pinned at its threshold: one stall exactly covering the
  offices' cars, then one office more, for the stall and the ramp); an
  excluded hotel that is infested; recycling well over capacity (24 floors
  of offices on one center, 2,592 people against 2,500), with the verdict's
  boundary pinned by 416 offices and 5 or 4 occupied single hotel rooms
  (2,501 people, over capacity, and 2,500, at it), one floor of offices and
  a center with no one to serve beside them (capacity, fill, verdict and
  the population behind it, in each mode), all read a minute before the
  collection hour, so the fill well over capacity reaches its clamp at 1
  and the one a person over stops just short of it; a housekeeping station
  and a ramp under construction,
  in a fire and gutted (the corpus's inert rooms include neither), whose
  sections both engines switch off; ids that name no unit (missing, not
  finite, out of range, and four built from the hotel's id: half past it,
  its negative and 2^32 either side of it), which both engines answer with
  `undefined`; shaft ids beside a real shaft (fractional, negative and past
  2^32), which both answer with an empty shaft card; and, since units and
  shafts share one id counter, a shaft's id for service facts and a room's
  for a shaft card, which both answer with `undefined` and an empty card. A
  disconnected stall reports no shortage at all (`shortage: null`), so there
  is no disconnected shortage to reach.
- Not measured on the corpus: the card's printed lines for these families.
  The corpus differential compares the facts the card words; the wording
  itself is compared on constructed towers by the card-text golden
  (`src/tests/goldens/card-text/`): the sweep holds the Rust card to the
  golden, and the golden's referee holds the golden to the TypeScript card.
- Branch coverage of the reference, measured on 2026-11-10 with
  `VC_REQUIRE_WASM=1 npx vitest run --project integration conformanceWasmDiagnosticsServices --coverage --coverage.include=src/engine/port/reports.ts --coverage.include=src/engine/port/queries.ts --coverage.include=src/engine/sim/services.ts --coverage.exclude=nothing --coverage.reporter=json`
  (thresholds set to 0 for the run) for the corpus differential alone, then
  again with `portServiceDiagnostics` added to the filter. Each figure counts
  the v8 branch arms inside the function in `coverage-final.json`:
  `serviceDiagnostics` (in `reports.ts`) 75 of 80, then 77 of 80;
  `shaftCard` (in `queries.ts`) 16 of 18, then 18 of 18; `commercialFacts`
  (in `reports.ts`) 5 of 5 and `recyclingFill` (in `services.ts`) 2 of 2
  both times. The fixtures add the malformed-id guard of each. The capacity
  and demand reads have no branch, and the `countOperational` walk they
  share takes 5 of 6: its other arm is for a floor or lobby kind, and
  recycling is a room. Left in `serviceDiagnostics`: the two `baseline > 0`
  fallbacks (a priced venue's baseline is always positive: the guard above
  requires a positive spend and a daily income, and no catalog entry has a
  daily income of 0) and patronage recorded with no profit (the
  `profitYest ?? 0` arm), which no simulation write produces, since the
  daily roll sets the two together and gutting a unit clears them together;
  only a save carrying one without the other could.

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

#1811 (families 2 to 4): the two integration tests above, this story, and
the WASM host step's timeout in `.github/workflows/test.yml` (12 to 18
minutes: with the corpus file the step takes 4.5 to 8.5 minutes, depending
on the runner, and the file adds about 10% on a given runner, so 18 leaves
room above the slowest run seen and for the next corpus differential).
`vite.config.ts`
needs no change: its `conformanceWasmDiagnostics*` pattern already keeps the
corpus file, which runs each engine itself, off the hosted WASM project.
