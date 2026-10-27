# Hot-path complexity review

This page is the one checklist for reviewing algorithmic cost on the game's hot
paths. `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`,
`_bmad-output/project-context.md`, the Copilot review overlay, the engine parity
skill and the pull request template point here and keep only a short summary.
Rule changes go here, and the summaries follow.

It exists because the rule it replaces did not stop the Rust port (#857) from
shipping per-person and per-step scans of every unit in the tower, or from
dropping caches the TypeScript engine already had. Profiling found them (#1051,
#1139), after review had passed them. Section 8 shows which item catches each of
those misses, and the audit in #1158 lists every one found in the Rust engine
and the hosts.

## 1. When it applies

Apply the checklist to any change that adds, ports, rewrites, moves or removes
production code reachable from an entry point in section 2, or makes such code
call something new. The paths in the table below are hot-path surfaces, and so
is any other production file whose changed code an entry point calls, apart
from these, which are not hot paths even inside a listed path:

- tests: `*.test.ts`, `src/tests/`, `e2e/`, `engine-rs/tests/`, the
  `*_tests.rs` files under `engine-rs/src/` and Rust `#[cfg(test)]` modules;
- test fixtures and helpers: `*.fixture.ts` and `src/ui/testing/`;
- the engine's command-line tools in `engine-rs/src/bin/` (conformance, dump,
  fuzz and TDT), and docs;
- code that runs once per session, such as module setup, WASM instantiation or
  reading the engine identity, since no section 2 tier calls it. Only the HP-1
  trace can show that, so the gate leaves this case to the Hot-Path Auditor. A
  load is a command, so the load path counts, and so does attach, which runs
  on every undo, redo and fault restore.

The build files in the table do count: they set the cost of every engine path
at once (HP-11). A Rust toolchain or Cargo configuration file added later
(`rust-toolchain.toml`, `.cargo/config.toml`) joins the engine build row.

| Surface | Paths |
| --- | --- |
| Rust engine and its build | `engine-rs/src/`, `engine-rs/Cargo.toml`, `engine-rs/Cargo.lock`, `scripts/wasm-build.ts`, `scripts/build-engine-wasm.sh` |
| App build settings (which engine and code paths ship) | `vite.config.ts`, `src/build/` (the build modules it imports) |
| TypeScript engine | `src/engine/` |
| WASM binding | `engine-rs/src/wasm.rs`, `engine-rs/src/frame.rs`, `src/dualrun/` |
| Hosts (main thread and worker) | `src/wasmhost/` |
| Saves (load per command, autosave on a timer) | `src/storage/` |
| Rendering, frame loop and UI | `src/render/`, `src/presentation/`, `src/game/`, `src/ui/` |
| Per-frame and periodic services | `src/analytics*.ts`, `src/audio/` |
| App shell | `src/main.ts` (`GameApp`, read on every HUD refresh) and any other root `src/*.ts` module that `src/game/`, `src/render/` or `src/ui/` imports |

A port or a rewrite changes every line it adds, so all of it is in scope,
including algorithms copied unchanged. A diff that touches no hot-path surface
records one line saying so (section 6).

This page took effect when it merged (2026-10-20, 19:49 UTC). For the pull
requests open then, the owner set the scope on 2026-10-20 at 20:16 UTC (quoted
on #1168). #1139 (at 9cd44d1), #1157 (at a146861) and #1092 (at f1777e1) have
since merged, so for them the bullets record the scope the owner set, and each
PR's comments hold the review it got:

- #1139 (the bare-step indexes for #1051) keeps its independent review's GO at
  3fa30a8c for the code that review covered. A docs-only results commit on it
  does not restart the hot-path review; any other hot-path change pushed to it
  gets the checklist.
- #1092 gets the checklist on its Rust simulation, TypeScript simulation and
  WASM host merge changes.
- #1157 gets a focused assessment of its WASM binding, frame and identity
  changes, which separates code that runs once per session from hot paths.
- #1068 gets the checklist on its worker synchronization and Rust delta paths,
  with no exemption, and keeps its performance-evidence hold.

Each of these records the complexity note (section 5) and the section 6 table
when its diff touches a surface above, in proportion to what it changed. A
file being in scope is not a finding: a finding needs code that runs at a
section 2 tier, and the review asks for no refactoring that a finding does not
justify. Every other pull request, whenever it was opened, gets the checklist
on its next review, over its whole diff.

## 2. Frequencies and sizes

Cost is frequency times collection size. Use these reference numbers instead of
guessing. Sizes were measured on 2026-10-20 at `main` c12bc1b; recount them
with `buildLargeTower` and the fixture loaders in
`src/tests/perfCompare/scenarios.ts` when they matter.

**Entry points.** Rust names first, TypeScript second.

| Tier | Entry point | How often |
| --- | --- | --- |
| Per frame | the host's frame read (`frame_view`, then `decodeFrame` or `applyRecords` in `src/wasmhost/`), render sync, `runFrame` in `src/game/frameLoop.ts`, build preview (`canBuild` on every pointer move) | every rendered frame |
| Per step | `Simulation::advance_step` (`engine-rs/src/sim_loop.rs`) / `advanceStep` (`src/engine/sim/loop.ts`): elevator demand, the spawn step, construction. `tick` runs one or more steps, so "per tick" elsewhere means per step | a step from the frame loop is 1 to 20 game minutes (`quantumFor` in `src/engine/sim/fixedStep.ts`), sized so about one runs per frame, at most `MAX_STEPS_PER_FRAME` (4); `tick` splits a longer advance into steps of up to 30 minutes; the perf harness steps 2 minutes, 720 per game day |
| Per chunk | motion chunks of up to 2.5 game minutes inside a step: `elevator_calls` / `elevatorCalls`, `move_cars` / `moveCars`, `motion::advance` and the crowd's advance | one per short step, up to 8 per 20-minute step (12 when `tick` runs a 30-minute sub-step, which the frame loop does not send) |
| Per hour | `on_hour` / `onHour`: presence, hotel checkout, housekeeping dispatch, satisfaction, move-ins, traffic income, elevator utilization, star evaluation | every 60 game minutes (30 steps in the perf harness) |
| Per day | `on_day` / `onDay`: rent and maintenance, random events, VIP, milestones, nudges | every game day |
| Per command | place, remove, transport edits, load | per player action. Every revision-keyed cache rebuilds after an edit, so its build cost counts here too |
| Wall clock | HUD and panel refresh (about every 160 ms in `runFrame`), audio (about 6 per second), autosave (serializes the tower every 30 s) | fixed real-time cadence |

**Collections.** The reference towers are the `perf:compare` scenarios
([`ts-vs-wasm.md`](ts-vs-wasm.md)) and the owner's Modern save
`conformance/fixtures/split-tower-4.vctower`. The large tower is a benchmark:
real towers can be bigger.

| Collection | Size | Notes |
| --- | --- | --- |
| units, all (U) | 12,062 medium; 19,806 owner's save; 43,358 large | 40,458 of the large tower's units are floor and lobby tiles, and any walk over `units` pays for every one |
| rooms (R) | 1,699 owner's save; 2,900 large | `room_units()` / `roomUnits` |
| population | 3,240 medium; 6,019 owner's save; 17,322 large | census and statistical demand |
| drawn people (P) | at most 140 trip spawns (`MAX_PEOPLE`), plus up to 6 housekeepers per housekeeping unit (`HK_MAIDS_PER_UNIT`) | the crowd that walks and rides; staff spawns skip `MAX_PEOPLE` |
| housekeeping units | 15 medium (up to 90 staff); 8 owner's save (up to 48); none on the large tower | estimate a staff or housekeeping path on the tower with the most of them, since the large tower has none |
| floors (F) | up to 110 (floors -9 to 100; floor 0 is the first basement) | |
| transports (T) | up to 24 elevator shafts and 64 stair and escalator links | 8 cars per shaft |
| x positions | 375 per floor (`LOT_WIDTH`) | |
| route graph | segments and links across every floor | route searches, reachability and flood fills walk it |

The effective cost of a scan is its own size times every loop and tier above
it. Example: until #1143, `max_staff_for` walked all U to count housekeeping
units. Its call site runs for each staff spawn attempt, inside a loop over
candidate rooms and crews in `dispatch_housekeepers`, which runs every hour in
shift and on every step that returns staff results. The call site still runs
that often; the walk is gone, and the count now comes from a memo per
revision. A cloud native profile of the owner's save at ab49f86 (2026-10-20)
put the walk at 26% self time of the bare step, a cloud estimate of its
relative share.

## 3. The checklist

Each item has an id so a review can record it (section 6).

**HP-1 Trace callers to an entry point.** For every changed, added or ported
function, name its callers up to an entry point in section 2 and write down the
tier and every loop in between. A helper is as hot as its hottest caller. This
needs the repository as well as the diff: search the callers across every
hot-path surface, both engines, the hosts and the frame loop included.

**HP-2 Find whole-collection work under a multiplier.** The rule: flag any
operation whose cost grows with a section 2 collection (units, rooms, floors,
transports, people, tiles, x positions, the route graph) when it runs inside
another loop or at a hot tier. The multipliers are per person, per unit, per
room, per floor, per segment, per transport, per car, per candidate, per
step, per chunk and per frame; every other document refers to this list. Work inside a helper counts: a
helper that scans is a scan, and a route search, reachability check or flood
fill is a walk over the route graph. The idioms below are examples and the
list is open:

- TypeScript: `.find`, `.findIndex`, `.filter`, `.some`, `.every`, `.reduce`,
  `.map`, `.flatMap`, `.forEach`, `.includes` or `.indexOf` on arrays,
  `for (const u of tower.units)`, `Object.values` / `keys` / `entries`,
  `Array.from(map.values())`, `Math.max(...arr)`, `slice`, `concat` and spread
  copies.
- Rust: iterator chains using `filter`, `find`, `position`, `any`, `all`,
  `count`, `sum`, `fold`, `for_each`, `min` / `max` (and the `_by_key` forms)
  or `collect`; `for u in &tower.units` and `iter_mut`; walks over
  `.values()` / `.keys()`; `Vec::contains`; `retain`; `extend`; `Vec::remove`
  and `Vec::insert` (both shift the tail).

A pass costs the items it visits times the work done for each: a pass over
2,900 rooms that probes the tiles around each room costs rooms times tiles
probed. Count the visits per occurrence of the tier (one step, one frame, one
hourly pass, one command), never averaged over a longer period. What one pass
may cost depends on the tier:

- Per frame and per chunk: no walk over any collection that grows with the
  tower (units, tiles, rooms, population, the route graph). Per-frame work
  scales with what is drawn (HP-12). A step runs up to 8 chunks (12 for a
  30-minute `tick` sub-step), so a per-chunk pass also counts once per chunk
  toward its step.
- Per step: no walk over units, tiles, population or the route graph. One pass
  over rooms (about 2,900 visits on the large tower), with constant work per
  room, is allowed when the record says why
  no index, counter or per-revision cache can answer it (for example, a check
  that reads each room's live state). Repeated passes in the same step, and
  per-room work that walks other tiles or runs a route search, are findings.
- Per hour, per day and per command: one pass that visits each item once, with
  constant work per item, is fine. A pass per item of another collection is a
  finding, and so is per-item work that probes other tiles or runs a route
  search, unless the section 4 estimate puts the whole pass under about 50,000
  visits on the large tower, about what the one linear pass over its 43,358
  units that this tier allows already costs.
- Wall clock: the HUD and panel refresh follows HP-12 (it scales with what is
  on screen), audio follows the per-step budget, and autosave may make one
  linear pass.

A pass over a small collection (the 110 floors, the 24 shafts and their cars,
the 64 stair and escalator links, the drawn crowd) is fine at any tier while
one occurrence of the tier stays under about 1,000 item visits on the large
tower, the work per item included.

Two more patterns count at every tier:

- the same walk repeated within one entry point (several `count_operational`
  or `total_population` calls in one hourly pass): compute it once and pass it
  down;
- a walk over `units` when only rooms matter: it pays for every floor and lobby
  tile, so use the rooms index (`roomUnits`; in Rust `room_units()`, which
  #1139 caches) or a kind index.

**HP-3 Count allocations and copies.** These cost as much as a scan when they
run per item:

- Rust: `.clone()` of a cached `HashSet`, `HashMap` or `Vec` on every accessor
  call (return a borrow or an `Rc` / `Arc` slice, or answer the query in place);
  cloning a `Unit` or `Transport` per iteration; a fresh `Vec`, set or map from
  `collect()` or `to_vec()` per call; `format!` in a loop.
- TypeScript: a new array or object per element on a per-frame path,
  `JSON.parse` / `JSON.stringify`, `structuredClone`, spreading a large array.
- Both: rebuilding a lookup structure every step when its inputs change only on
  an edit.

**HP-4 Check sorting and ordered rebuilds.** A sort on every call of a
collection that only changes on an edit (sort once per revision), a sort inside
a per-candidate loop, or an ordered set rebuilt every step.

**HP-5 Check containers and hashing.** Rust's default `HashMap` / `HashSet`
hasher (SipHash) is slow for small integer keys, and a search that builds
`prev` and `seen` maps on every call pays it on every insert. For a map that
is only inserted into and looked up, never iterated, prefer a dense `Vec`
indexed by unit, floor or segment, a reused scratch buffer, or a fast
deterministic hasher: `FastMap` / `FastSet` in
`engine-rs/src/crowd/fasthash.rs`, which offer no iteration at all. A map
that is iterated keeps insertion order (`IndexMap`, `IndexSet` or a `Vec` in
insertion order, engine parity checklist item 7), so its container stays as
it is; iterating a `HashMap` or `HashSet` is an HP-10 finding.

**HP-6 Look up by id, and keep removal linear.** Use `getUnit` / `getTransport`
in TypeScript and `get_unit` / `get_transport` in Rust (the `by_id` and
`transport_by_id` maps behind them). `units.iter().position(|u| u.id == id)`
and `units.find(u => u.id === id)` are the same finding in either language.
Removal must not rebuild a whole index for each removed unit: a bulk sell, a
demolish or a lobby placement removes many units in one command, so an O(U)
rebuild per removal is O(k × U) per command.

**HP-7 Review inherited algorithms.** Ported, rewritten or moved code is
reviewed as if it were new. "Same algorithm as the TypeScript", "faithful
port", "pre-existing" and "no new regression" do not close a finding. If an
inherited algorithm is superlinear on a hot path, the PR fixes it or records it
under section 7. A port is the cheapest time to fix one, because the
conformance suite is already comparing the new code with the old.

**HP-8 Compare with the TypeScript's caches before porting.** Before porting a
function, list the caches, indexes and counters the TypeScript version and its
callees use, and port each one or name the Rust structure that answers the
same query at the same cost or less. Anything else is a dropped cache, which
section 7 makes always `patch`; a reason in the PR body or a comment in the
port (for example that the TypeScript cache "is pure" or the value is
"computed fresh") does not close it. The same holds outside a port: a change
that removes or bypasses a cache, index or counter either engine has (a
refactor that undoes one of #1139's caches, say) is an HP-8 finding.
Bypassing means computing what the cache holds without reading it, such as a
new scan where the cache already answers the query. Removing one is not a
finding in two cases: the change replaces it with a structure the record names
that answers the same query at the same cost or less, or it removes the query
itself, so nothing asks it anywhere any more (as retiring the TypeScript
engine will). Every other removal is a finding.

The table lists the caches, indexes and counters on the hot paths today: the
TypeScript ones, and the Rust-only ones with "none" in the TypeScript column,
with their Rust status at 9cd44d1 (`main` once #1139 merged) unless a row
names a later commit. Each PR that adds, ports or removes one updates its row
and names itself there by number, and its HP-8 review checks that. Once the
PR merges, the table's owner replaces the number with the merge commit.
Between those PRs the table belongs to the repository owner (maniator), the
#1158 audit's assignee, who corrects any row that has gone stale.

| What it keeps | TypeScript | Keyed on | Rust (at 9cd44d1 unless noted) |
| --- | --- | --- | --- |
| units and transports by id | `byId`, `transportsById`, `src/engine/Tower.ts` | kept on every edit | `by_id`, `transport_by_id`; `remove_unit` still finds the unit by a scan and rebuilds the whole index per removal (A17 in #1158) |
| tiles and rooms by position | `structure`, `structKind`, `rooms`, `src/engine/Tower.ts` | kept on every edit | ported (`structure`, `struct_kind`, `rooms`) |
| lobby and room tiles per floor | `lobbyTiles`, `roomTiles`, `src/engine/Tower.ts` | counter | ported (`lobby_tiles`, `room_tiles`) |
| rooms without floor and lobby tiles | `roomUnits`, `src/engine/tower/rooms.ts` | unit array, length, revision | ported (`room_index`, `engine-rs/src/tower_index.rs`, keyed on revision and unit count; #1139) |
| floor and lobby tiles per floor, for `pickX` | none (`pickX` walks every unit, #539) | revision and unit count | `structural_tiles`, `engine-rs/src/tower_index.rs` (#1139) |
| each floor's segment runs | `src/engine/tower/segments.ts` | revision | ported (cloned on read, #859) |
| housekeeping staff ceiling | `staffCeiling` (`maxStaffFor`), `src/engine/crowd/spawn.ts` | revision | ported (`housekeeping_units`, `engine-rs/src/tower_index.rs`, keyed on revision and unit count; #1143; now reads the census below) |
| per-kind unit counts for the build caps, floors that hold an office | none (`countKind` and the Classic escalator office check walk every unit, A24 in #1158 and #1239) | revision and unit count | `census`, `engine-rs/src/tower_index.rs` (#1264) |
| room units per floor, for the spawn step's picks | `unitsByFloor` in `spawnFloors`, `src/engine/crowd/spawn.ts` | one call (rebuilt every spawn step) | `floor_rooms`, `engine-rs/src/tower_index.rs`, keyed on revision and unit count, so the step reads it instead of rebuilding it; the floor lists around it are still built on each spawn step that has room to spawn, where the TypeScript builds them on every spawn step (T2 in #1170; #1143 item 4, #1281) |
| staff and venue floors deduped in one spawn step | `seenStaff`, `venuesByKindSet`, `src/engine/crowd/spawn.ts` | one call | ported as a bit per floor (`engine-rs/src/crowd/spawn_floors.rs`; #1143 item 4, #1281); before it the Rust searched the staff list for each staff room |
| nearest crew and crew order per floor in one dispatch | `distByFloor`, `crewOrderByFloor`, `src/engine/economy/housekeeping.ts` | one pass | `dist_by_floor` ported; crew order missing, so the crews are cloned and sorted per room (A12 in #1158) |
| live staff count | `crowd.staffCount`, `src/engine/Crowd.ts` | counter | ported |
| riders per car | `crowd.carRiders`, `src/engine/Crowd.ts` | counter | ported (`car_riders`) |
| noise verdicts | `noiseMemo`, `src/engine/sim/satisfaction.ts` | revision | ported (`noise_memo`, `engine-rs/src/noise.rs`; #1139) |
| served floors, staff components | `src/engine/tower/routing.ts` (`servedSet`, `staffComp` on `Tower`) | revision | ported; `is_floor_served` reads the served set in place (#1237) and elevator dispatch reads `dispatch_floors` (below, #1143 item 5, #1298); `served_floors` and the staff components are still cloned on read (#859) |
| stops, transport columns | `stopsCache` on `Tower`, `src/engine/tower/transport.ts` | revision | ported (cloned on read, #859) |
| built floor bounds | `floorBounds`, `src/engine/Tower.ts` | revision | ported (`floor_bounds`, `engine-rs/src/tower_index.rs`, keyed on revision and unit count; #1237) |
| served and lobby floors in ascending order, for elevator dispatch | none (`accumulateWaiting` reads `servedSet` in place and walks `lobbyFloors()`, which sorts the lobby tiles' floors, each step the population is above zero; `moveCars` builds a set from `lobbyFloors()` on every call) | revision and unit count | Rust-only: `dispatch_floors`, `engine-rs/src/tower_index.rs` (#1143 item 5, #1298) |
| passenger and staff routing graphs | `adjacency`, `staffAdjacency`, `src/engine/crowd/routing.ts` | revision | ported |
| shaft banks | `src/engine/crowd/shaftBanks.ts` | revision | ported |
| segments served | `segServed`, `src/engine/crowd/segmentGraph.ts` | revision | ported (`connected_set`) |
| queue view | `queueView`, `src/engine/Crowd.ts` | step and revision | no counterpart yet; check before porting one |
| floor reachable from the lobby (`floorReachable`) | `reachMemos`, `src/engine/sim/services.ts` | revision | ported (`reach_memo` in `sim.rs`) |
| segments reachable from a lobby (`segReachable`, behind `floorReachable` and the per-room checks) | none: one route search per lobby segment for each check (#849) | n/a in TypeScript; revision in Rust | Rust-only: a set of every segment reachable from a lobby, which answers as those searches do: `connected_set` (Modern) and `lobby_reach` (Classic walk budget), `engine-rs/src/crowd/graph.rs` (#1143) |
| commute averages revision (the hosts key their copies on it) | none (the TypeScript reads `commuteWaitByFloor` in place) | counter | `commute_revision`, `engine-rs/src/crowd/mod.rs` |
| meal overlay revision (the frame header carries it and the renderer keys its overlay on it every frame) | `mealOverlayRevision`, `src/engine/Tower.ts` | counter | `meal_overlay_revision`, `engine-rs/src/tower.rs` |
| excavated basement tiles | `excavated` (a `Set`), `src/engine/Simulation.ts` | kept on every dig and load | a `Vec` searched linearly on each dig and load (`build.rs`, `load.rs`; #1173) |
| demand map (inspector reads) | `demandMemo`, `src/engine/sim/demand.ts` | revision and game hour | none (no inspector in Rust) |
| reachability within one demand or income pass | `reachCache`, `src/engine/sim/demand.ts`, `src/engine/EconomySystem.ts` | one call | ported |
| reachability during one move-in pass | `reachMemo`, `src/engine/sim/churn.ts` | one pass | ported |

A row marked "cloned on read" keeps the cache but not its cost, since every
read copies it (#859, A8 in #1158). It does not answer at the same cost, so a
port that turns a cached read into a copy is an HP-8 finding, and new code
that adds such a copy is an HP-3 finding.

**HP-9 Name the remedy.** For each finding under HP-2 to HP-6, say which of
these fixes it, in this order of preference:

1. an index (by id, kind, floor or segment) built once per revision;
2. a tower-wide fact hoisted out of the loop and computed once per pass;
3. an incremental counter updated on place, remove or state change;
4. a cache keyed on everything the result depends on (HP-10);
5. a borrowed view instead of a copy;
6. one cache shared by the passes that ask the same question in the same hour.

**HP-10 Keep results identical and invalidate correctly.** An optimization
changes no observable result:

- Iteration stays in insertion order. No new iteration over a `HashMap` or
  `HashSet`, and no sort the other engine does not do.
- The same random draws from the same seeded streams (`engine-rs/src/rng.rs`,
  `src/engine/rng.ts`), in the same order. Caching a value a draw depends on,
  or skipping a call that draws, moves every later hash.
- Events stay in the same order, gameplay results stay identical, and saves
  stay byte-identical.
- The cache key covers every input. `revision` covers structural edits only
  (place, remove, transport edits). A result that reads unit state,
  occupancy, tenancy, the hour, the weekday, the star rating, settings or the
  crowd needs that input in its key, or a lifetime of one step or one pass. A
  cache whose key leaves out an input it reads is a correctness bug unless the
  lag is bounded, documented beside the cache, and invisible to the simulation
  (as with `demandMemo`, keyed on revision and game hour, whose lag within the
  hour only the inspector sees).
- Every cache that outlives one pass is reset on load: in Rust, keep it in
  `tower.memo`, which `Tower::reindex` resets, or on a structure a load builds
  fresh (as `reach_memo` on the `Simulation` that `load::deserialize`
  returns), and say which; in TypeScript, name where it resets. The hosts'
  in-place merge (`src/wasmhost/merge.ts`) also replaces state under the
  caches, so a cache it can see needs a merge test as well.
- Evidence: the conformance lock (`conformance/expected.json`) unchanged, a
  test for each invalidation input (edit, load, merge, each non-structural
  input), and, for engine hot paths, the seeded differential and a
  byte-identical save on the reference saves.

**HP-11 Check the WASM boundary, the hosts and the build.** What crosses from Rust to
JavaScript each frame should scale with what changed or what is drawn. Static
tiles do not need to cross every frame. Look for one JavaScript object or one
`Map` lookup per unit per frame, for `serialize`, `JSON.parse`, `deserialize`
and a merge on every hour or revision, and for worker messages that copy what
they could transfer. Name the issue or PR that already covers it when one does
(#1045, #1049, #1050, #1068). A change to the engine build (the Cargo release
profile, opt-level, LTO, `wasm-opt` flags, panic strategy or features) changes
the cost of every path at once, so its note carries a before and after
bare-step measurement (section 4).

**HP-12 Check rendering and UI refresh.** Per-frame work in renderers, the HUD
and panels scales with what is on screen (camera bounds, the drawn crowd) and
stays flat as the tower grows. No walk over all units per frame, and DOM
rebuilt on change only. Build preview runs on every pointer move, so its cap
checks (`count_kind` / `countKind` over all units, A24 in #1158) are
per-frame work.

## 4. Measuring

Rank findings by measured cost, using Big-O as a guide. Walking
2,900 rooms once an hour is cheap. The same walk for each drawn person in every
chunk is not.

- Estimate first: the visits in one occurrence of the tier (one step, frame,
  hourly pass or command), as multipliers times collection sizes with the work
  per item, using the sizes in section 2 on the large tower; then say how
  often the tier runs. Write the estimate in the record. A visit is one item
  read, compared, hashed, allocated or serialized, so a sort of n items counts
  about n log2 n and a JSON round trip counts each element on both sides.
- Measure when the estimate matters. A native profile of the bare step on a
  reference save, or `npm run perf:compare`, gives relative shares. Numbers
  from a cloud machine are estimates and say so.
- Acceptance figures come only from the owner's desktop, under
  [`benchmark-protocol.md`](benchmark-protocol.md). A review never starts a run
  there.

## 5. The PR complexity note

A PR that touches a hot-path surface (section 1) fills in this note under the
Complexity heading of the pull request template, or writes "n/a" there with a
reason. A significant change must give every field: one that adds, ports,
moves or rewrites code on a per-frame, per-step, per-chunk, per-hour or
wall-clock path in either engine, the binding, a host or rendering; adds,
changes or removes a cache, index or counter; changes what crosses the WASM
boundary or the engine build; or adds per-command work that grows with the
units placed or removed.

```markdown
- Hot paths touched: `function` ← caller ← entry point (tier), for each one.
- Sizes: U, R, P, F, T on the reference saves that matter here.
- Before and after: for example O(P × U) per step becomes O(P) per step plus O(U) per revision.
- Repeated scans that remain, and why each is acceptable (frequency times size, measured or estimated).
- Caches (HP-8): the caches, indexes and counters either engine has here, and whether this ports, keeps or replaces each one, with nothing dropped or bypassed.
- Results and invalidation (HP-10): cache keys, invalidation tests, conformance and differential evidence.
- Measurements, each labeled cloud estimate or desktop evidence, or "none".
```

## 6. Recording the review

A review applies the checklist by recording it. The Hot-Path Auditor layer of
the review skills and the independent reviewer print this table, one row per
item, and Copilot and Codex are asked to:

| Item | Result | What was checked | Findings and resolution |
| --- | --- | --- | --- |
| HP-1 | finding (n), clear or n/a | functions and callers traced, entry points reached | finding ids and their resolution |
| HP-2 | | | |
| HP-3 | | | |
| HP-4 | | | |
| HP-5 | | | |
| HP-6 | | | |
| HP-7 | | | |
| HP-8 | | | |
| HP-9 | | | |
| HP-10 | | | |
| HP-11 | | | |
| HP-12 | | | |

- Every item gets its own row. "Clear" names what was inspected (functions,
  call paths, both engines). A bare "checked" or "looks fine" does not count.
- A row that lists any finding reads "finding (n)", pre-existing findings
  included, and "clear" means the row lists none.
- "n/a" gives a reason tied to the diff.
- When the diff touches no hot-path surface (section 1), one line saying so
  replaces the table.
- When the change has a PR, the record goes on it as a comment, and each record
  names the commit it reviewed and the part of the diff it covers. Whoever runs
  the review skill posts its record at step 4 of every round, then edits that
  comment to fill in the "Findings and resolution" column once the round's fixes
  are in. The fixes make a new commit, and its record comes from the next round
  of the skill or from the independent reviewer's table in a verdict on that
  commit. A record of staged or uncommitted changes covers the commit that holds
  exactly those changes. The independent reviewer puts its own table in each
  verdict, for the commit it reviewed. A review run before the PR exists saves
  its record under `_bmad-output/implementation-artifacts/`, and whoever opens
  the PR posts it there and links it from the template's Complexity section. A
  review split into file groups across runs posts one record per group, each
  naming its group. A "no hot-path surface" line counts only when it covers the
  whole diff of the PR, or when the group records together cover it.
- A port, rewrite, move, addition or removal of more than about 1,000 changed
  lines (added plus removed) of hot-path code, counted over the whole diff even
  when the review runs one file group at a time, adds an appendix to the
  record with one line per changed function: the function, its hottest caller,
  the tier and the multiplier (for a removed function, its former hottest
  caller). The review skills split such a diff by module, or into
  chunks of about 1,000 lines, and run one Hot-Path Auditor per chunk, each
  given its chunk, the list of every changed file and function, and read
  access to the repository at the head commit, so it can trace callers
  outside its chunk. Each returns its table and its appendix lines, and the
  run that launched them merges them into one record. The review is not
  complete, and gives no GO or CONDITIONAL GO, until every chunk has its table
  and every changed function its appendix line.
- A review without the record is incomplete, and an independent reviewer
  cannot give a GO or a CONDITIONAL GO on it. When a Copilot or Codex review
  of a hot-path diff leaves the table out, its findings still count, but its
  sign-off covers the hot-path part only once a record from the review skill
  or the independent reviewer is on the PR.
- A hot-path PR is signed off only when the record for its final commit is on
  the PR and its independent review is complete: the independent reviewer
  (section 9), who is not Copilot or Codex, has posted a GO on that commit, or
  a CONDITIONAL GO on it whose conditions it has confirmed met on the PR. A
  condition that needs a code change makes a new commit, which needs its own
  verdict. A NO-GO, or a verdict on an earlier commit, does not sign it off.
  The PR's author requests the independent review once the record for the
  final commit is on the PR. The record and the verdict carry to a later
  commit only when that commit leaves the PR's own diff unchanged (a merge of
  `main` with no conflict in the PR's files, or a reshape of its history that
  keeps the final tree), or changes nothing on a section 1 surface (a
  screenshot refresh or a version bump, say), and the independent reviewer
  confirms that on the PR. A review that is still running is not complete, and
  auto-merge stays off until both hold (`CLAUDE.md`).

## 7. Resolving a finding

Every hot-path finding ends in one of two states before merge:

1. **Fixed in the PR**, with HP-10 evidence that results are unchanged.
2. **Deferred**, with the estimate or profile (section 4), one sentence on why
   it is not fixed now, and a tracking issue with a backlog row (the backlog
   mirror rule in `CLAUDE.md`). Pre-existing findings from one review may
   share one issue and row, or join an open issue that already has a row
   (such as the #1158 audit) as new items in its body, with the row's notes
   updated. A pre-existing finding in code the PR does not change or only
   moves, which an open issue with a backlog row already lists (for example an
   item in #1158, #1143 or #859), is deferred by reference: cite the issue and
   item, with no new issue or row, since that row already records it.

A finding is never dismissed for being pre-existing, for matching the
TypeScript, or for sitting outside the diff. In BMAD/BMGD triage a hot-path
finding is `patch` or `defer`. It is `dismiss` only when it is a false positive:
the code is not reachable from an entry point, or the written section 4
estimate shows the work is a pass HP-2 allows at its tier: for example the one
per-step pass over rooms whose reason is in the record, a pass over a small
collection under about 1,000 item visits per occurrence, or an hourly, daily
or per-command pass under about 50,000 visits, counted per occurrence on the
large tower with the work per item included. A pass HP-2 rules out at its tier
(a per-step route search, a per-frame walk over rooms) is a finding whatever
its count. "The collection is bounded" is not enough on its own, since every
collection here is.

Two kinds are always `patch`, even when an open issue already lists them:

- code the PR adds, ports or rewrites that puts a whole-collection walk under
  any HP-2 multiplier at a tier HP-2 does not allow;
- a change that drops, removes or bypasses a cache, index or counter either
  engine has, in a port or not, apart from the two removals HP-8 allows
  (HP-8).

The false-positive test above does not apply to these two: a new id scan that
bypasses an index is `patch` even when its pass fits the tier. Section 1's list
of code that is not a hot path still comes first: code it excludes raises no
hot-path finding.

A move changes only where code lives (for example a split of an oversized file
under the file-size ratchet): the moved lines stay identical apart from
whitespace and formatting, visibility (`pub`, `export`), and paths (`use` and
`import` lines, or a `crate::` or `super::` prefix) that still name the same
item. A path changed inside a function body makes it a rewrite when it names
another item, since that points a call at another helper, and so does a `use`
or `import` line that does. Moved code is reviewed as new
(HP-7), and its findings count as pre-existing: deferred by reference when an
open issue lists them, otherwise with a new issue and row. Any other change to
a moved function makes it a rewrite.

Deferring an always-`patch` finding needs the explicit acceptance of the
repository owner (maniator), on top of the evidence and issue above. The PR
records it as a quote of the owner's own message, with its date and where
they gave it, somewhere the independent reviewer can read (for example the
project chat).
Agents here post with the owner's account, so neither a comment nor a review
showing the owner as its author proves the acceptance on its own, and an
acceptance another agent relays counts only as that quote. The independent
reviewer checks the quote against its source before a GO, and gives no GO
when it cannot. Until then the finding stays `patch`, in spec mode and no-spec
mode alike, marked pending the owner, and no choice in the run (resolving a
decision, walking through or skipping patches) dismisses, defers or drops it.
A session user who is not the owner cannot settle it. While it waits, the run
handles the other findings and reports this one as pending. Quick-dev, which
fixes `patch` findings as it goes, halts for the human first instead (section
9).

## 8. Worked example: what the Rust port shipped

| What shipped in the Rust port | Why review passed it | Caught by |
| --- | --- | --- |
| `pick_x` / `pick_x_in_segment` walked every unit and built a `Vec` for each spawned person | the walk sat in a helper, a few calls below the per-person loop in `spawn_trips`, and no one traced the multiplier | HP-1, HP-2, HP-3 |
| `room_units()` filtered every unit on each call, while TypeScript `roomUnits` had been cached since #852 | same algorithm as the TypeScript, minus the cache | HP-8, HP-2 |
| `noise_afflicted` was recomputed per room and per probe; the Rust comment said the TypeScript cache "is pure" | the comment was read as a reason | HP-8 |
| `max_staff_for` counted housekeeping units over every unit per staff spawn; TypeScript `staffCeiling` (#469) already ruled that out | a Rust iterator chain, while the old rule named only TypeScript idioms | HP-2, HP-8 |
| route search built SipHash maps on every call | hashing and allocation, which the old rule never mentioned | HP-3, HP-5 |
| `seg_reachable` ran a route search from every lobby segment for each room on a split floor, in the housekeeping, demand and income passes | inherited from the TypeScript, which caches whole-floor reachability and per-pass results but not the per-segment check (#849) | HP-2, HP-7 |
| cached sets cloned on every read (#859), deferred at P3 | "parity unaffected", with no measurement | HP-3, section 7 |

## 9. How the review tools apply it

- **`/gds-code-review` and `/bmad-code-review`** load this page through the
  team overrides `_bmad/custom/gds-code-review.toml` and
  `_bmad/custom/bmad-code-review.toml`. When the diff touches a hot-path
  surface they run a fourth layer, the Hot-Path Auditor, beside Blind Hunter,
  Edge Case Hunter and Acceptance Auditor. It gets the diff and read access to
  the repository at the diff's head commit, because HP-1 cannot be done from
  the diff alone. Triage follows section 7.
  `src/tests/hotPathReview.guard.test.ts` keeps in step this page's headings,
  its section 1 surfaces and paths, the clauses of sections 1 and 3 to 7 and 9
  that the overrides and summaries rely on, the record table, the auditor
  prompt, the overrides themselves (each fact once, with its load-bearing
  phrases, and the gds and bmad copies identical) and the step anchors they
  name. It checks phrases, so a reworded or removed clause fails it, while an
  added exception does not: that is the review's job. For the summaries it
  checks that each one links here (inside `AGENTS.md`'s Review guidelines and
  the template's Complexity section too) and that `CLAUDE.md` keeps its
  auto-merge rule; it does not check their other wording.
- **The quick-dev skills** run their own review loop, which does not replace
  this one: hot-path work still goes through the review skill `CLAUDE.md`
  names for it (`/gds-code-review` or `/bmad-code-review`). The overrides
  `_bmad/custom/gds-quick-dev.toml` and `_bmad/custom/bmad-quick-dev.toml` say
  so inside a quick-dev run, in both its planned and its one-shot route. They
  keep its classify steps from rejecting a hot-path finding that is not a
  false positive, and make it stop for the owner, without reverting code, when
  the author wants to defer an always-`patch` finding.
- **Copilot and Codex** apply the same items inline (the Performance dimension
  of `.github/copilot-instructions.md`, and the `## Review guidelines` section
  of `AGENTS.md`, which Codex reads) and are asked to print the section 6
  table.
- **An independent reviewer** (a separate agent or person giving GO,
  CONDITIONAL GO or NO-GO; Copilot and Codex reviews do not stand in for it)
  applies the checklist to the final commit and includes the table in the
  verdict. GO and CONDITIONAL GO need every row filled, and the appendix on a
  large port, rewrite, move or addition; GO also needs every finding fixed or
  deferred under section 7.
- **`.github/skills/engine-parity-review/SKILL.md`** item 11 points here for
  changes on the engine seam.

The Hot-Path Auditor's prompt:

> You are the Hot-Path Auditor. You have the diff and read access to the
> repository; read it at the diff's head commit, `<commit>` (`git show
> <commit>:<path>` when the checkout is elsewhere, or the working tree when the
> diff holds uncommitted changes). Apply `docs/performance/hot-path-review.md`,
> items HP-1 to HP-12, to this change. For each changed, added or ported
> function (and each removed one, through its former callers), trace its callers
> across every hot-path surface in section 1 (both engines, the hosts, the frame
> loop, rendering and UI) up to an entry point in section 2, and record the tier
> and the loops in between. Flag whole-collection work, route searches,
> allocations, clones, sorts, hashing and id scans under a multiplier, including
> inside helpers the diff calls but does not change. Check that the change keeps
> every cache, index and counter either engine has on these paths (the HP-8
> table) and computes nothing one already answers; for ported code, also list
> the TypeScript caches, indexes and counters for the same function and its
> callees and check that each was carried over. For each finding give the
> location, entry point and tier, collection sizes from section 2, the section 4
> estimate, the TypeScript equivalent, the proposed remedy, any risk to results
> or cache invalidation (HP-10), and whether an open issue already lists it
> (search #1158, #1143, #859 and the curated rows of
> `_bmad-output/implementation-artifacts/backlog.md` with their issues). Report
> pre-existing code too, marked pre-existing. Output the section 6 table with a
> row for every item, then the findings as a Markdown list. Put each finding in
> the row of every item it falls under: an id scan where an index already
> answers the query is HP-6 and HP-8, and a cost in inherited code on the traced
> path is HP-7 as well. A row that lists any finding, pre-existing ones
> included, reads "finding (n)". When you are given one chunk of a larger port,
> rewrite, move, addition or removal, review that chunk, trace callers outside
> it through the list of changed files and functions and the repository, and
> add the section 6 appendix lines for its changed functions.
