---
story: dispatch-hot-path
status: review
issue: 1143
---

# Story: elevator dispatch without per-floor hashing (#1143 item 5)

Tracking: A20 and A10 in #1158. "Item 5" is its rank in the hotspot ranking
of 2026-10-20, which split the bare-step costs left after #1143's A1 to A3
between two lanes (#1143's backlog row lists the items).

## Why

After #1139 and #1143's first two items, elevator dispatch is the next
largest share of the Rust bare step that nobody owns: about 19% on the
owner's Modern save (`split-tower-4`) and 18% on the medium tower
(`sixseven_2`), by that ranking's cloud profile. #1158 lists it as A20
(`move_cars` allocations, the served clone, the lobby sort, the prune set)
and A10 (`total_population` twice per step).

A callgrind profile of `main` at d06e2a6 (cloud, 720 steps of 2 game minutes)
shows where it goes. On the medium tower `move_cars` is 11.7% of the step
inclusive and `accumulate` 6.8%; on `split-tower-4`, 4.3% and 3.2% of a step
that is still dominated by items 1 and 2. Nearly all of it is SipHash on small
integer floor keys:

- `next_demand_stop` tests every stop against two `HashSet`s (`calls`,
  `claimed`) and the car's cab set, for every car, in each scan direction:
  about 710,000 hashes per game day on the medium tower.
- `move_cars` rebuilds the `calls` set per shaft per chunk by looking every
  stop up in the waiting map and the hall calls, and clones the shaft's
  schedule and sorts the lobby floors on every call.
- `accumulate` clones the served-floor set every step, then hashes each
  room's floor twice (served test, waiting update), walks the rooms a second
  time for `total_population`, and builds a set of live shaft ids to prune
  the dwell timers.

## Acceptance criteria

1. **AC1 Same results.** Byte-identical: every conformance fixture's state
   and crowd digests every 30 steps and its final save digest over 720 steps
   are unchanged, the conformance lock is unchanged, and the seeded
   differential, parity hashes, fuzz and day gate pass. No simulation rule
   changes and no new random draws.
2. **AC2 No per-stop hashing in the scan.** The stop search hashes nothing:
   `calls`, `claimed` and the car's cab floors are bit sets over the shaft's
   stops, and the nearest answering stop is found from the words. Building
   `calls` still asks the crowd's hall map once per stop, and each car still
   finds its cab floors by one map lookup (#1293). Round 1 met this with one
   flag byte per stop and a walk out from the car; review round 2 replaced
   both (see Design and Review round 2).
3. **AC3 No per-room hashing in the waiting pass.** Each room's floor is
   found by binary search in the served floors, kept ascending per tower
   revision; the waiting map is read once and written once for each floor
   that has rooms. `total_population` folds into the same pass.
4. **AC4 Caches keyed and reset correctly.** The served and lobby floor lists
   live in `tower.memo` (reset by `Tower::reindex`, so on load), keyed on the
   revision and unit count like the other `tower_index.rs` indexes. Tests cover
   a shaft placed and removed, a new lobby floor, `reindex` and a reload.
5. **AC5 Measured.** Callgrind instruction counts before and after on
   `split-tower-4` and `sixseven_2`, and paired wall-clock reps, all labeled
   cloud estimates.

## Design

- `waiting` becomes a `BTreeMap<i64, f64>`, so a lookup compares small
  integer keys where the hash map ran SipHash on each floor. Round 1 read
  each shaft's span with one `range`; Part A (below) went back to one `get`
  per stop, which round 2 kept: at most one lookup per stop (105 per chunk on
  the large tower, 336 on many-unit), where the range visited every waiting
  floor in a shaft's span, which a whole-tower express shaft with a few stops
  paid in full. Every read and write is by floor, and `retain` decays each
  entry on its own, so no result depends on the order.
- Per shaft, reused bit sets over the stops (64 stops a word) carry the
  TypeScript's `calls` and `claimed` sets: stop `k` is bit `k`. `stops` is
  ascending (`stops_of` filters `bottom..=top`), so a floor's stop is a
  binary search away; a claimed floor that is not a stop (a dwelling car
  between stops) can never be asked about, so it is dropped. The flag pass
  reads the hall calls once per stop, and the waiting map only where the hall
  has not already raised the call, as the TypeScript's `||` does.
- Each active car reads its cab floors once into a third bit set over the
  stops, one binary search per cab floor; a cab floor that is not a stop is
  left out, as the scan never reached it. The crowd keeps each car's cab
  floors in a `BTreeSet` (`crowd/mod.rs`), so the fill reads them in floor
  order and no hashed set is iterated (HP-10, R2-H1). The parked car's reach
  test reads the same bit for its cab exemption, and the claim reuses the
  index the search returned (R2-H2), so a car's cab set is never probed by
  hash.
- `Demand::next_stop` (the TypeScript's `nextDemandStop`) answers from the
  words: a stop answers when it has a call nobody has claimed or is one of
  the car's cab stops. `stops` ascends, so going up the scan's nearest is the
  lowest answering stop ahead (a trailing-zero count) and going down it is
  the highest one below (a leading-zero count). The TypeScript keeps the
  first strict minimum, the lowest floor among equal distances, so going down
  the search steps on to any lower answering stop at the same distance, which
  only a position far beyond any tower can produce; a position that is not
  finite still finds nothing. Round 1 walked out from the car instead (H5);
  round 2 replaced the walk because a car with nothing to serve still tested
  every stop of its shaft in both directions (R2-1, below). A search now
  reads at most two words per direction, since no shaft has more than 110
  stops.
- The served list is built once per revision by asking the served-floor memo
  about each floor from the lowest to the highest a passenger shaft spans,
  so no set is iterated and nothing is sorted (review, H2).
- The waiting pass keeps one slot per served floor. A floor's first room
  reads the map's value, each room folds in order exactly as the per-room
  update did, and the slots are written back in floor order before the lobby
  pass reads the map. `pop` sums the same rooms in the same order as
  `total_population`.
- Dwell timers are pruned against the shaft index (`transport_index`), which
  motion already relies on every chunk, instead of a fresh set.
- Dispatch only reads the schedule, so it borrows it.
- Part A, pushed to the branch between the rounds (c5972de, c547890), also
  moved `Memo` and the `Unit` state predicates from `tower_query.rs` into
  `tower_query_state.rs`, which brought `tower_query.rs` from 542 to 454 lines
  and off the file-size ratchet. That changes `tower.rs`'s memo field path
  and doc and adds a private module to `lib.rs`, one line each in two facade
  files; the facade lanes were told.

## Out of scope

- `stops_of` still returns a clone per shaft per chunk (#859, A8). Changing
  what it returns reaches its callers across `tower.rs`, a facade file where
  this PR changes only the memo path and its doc, and the crowd's routing and
  banks.
- The crowd's call maps are still std `HashMap`s rebuilt every chunk by
  `crowd/routing.rs`: the flag pass asks the hall map once per stop, each
  active car asks the cab map once, and each shaft asks both once. That is
  about 133 lookups per chunk on the large tower, 414 on the owner's save,
  532 on many-unit and 984 at the canonical cap (24 shafts of 31 stops, 192
  cars), all under the small-collection allowance: #1293 (backlog row
  `rust-dispatch-call-map-hashing`).
- `total_population` is still walked by the spawn step (A10 in #1158).
  `accumulate` now computes the same sum one call earlier, so `spawn_step`
  could take it; `crowd/spawn.rs` belongs to the other hotspot lane.

## Result

All figures are cloud estimates (native release build, this sandbox); the PC
is the source for any gate figure. Round 1 measured against `main` efb4bdf
(with #1237's change, PR #1276). Round 2 measured its final head, 835f46d
merged with `main` d09aa64, against d09aa64.

**Same results.** The state and crowd digests every 30 steps and the final
save digest over 720 steps of 2 game minutes match the base on all 8
conformance fixtures, in both rounds; round 2's final head also matches on
the `large`, `many-unit` and `hotel-heavy` perf towers. On the final head the
Rust referee (`cargo run --release --features conformance --bin
conformance`) passes every scenario and catalog, the conformance lock is
untouched, and `npm run test:wasm` on the built engine (the WASM conformance
and parity suites, the seeded dual-run differential and the day gate in
`dualRunDay.integration.test.ts`, the host and worker tests) passes:
368 tests, 14 skipped. The fuzz seeds run in CI (`engine-fuzz.yml`).

The dispatch tests run this dispatcher beside the hashed one it replaced
(kept in `dispatch_reference_tests.rs`):

- `dispatch_matches_the_hashed_reference_step_for_step` runs both for 3,000
  steps on a scenario tower with a scheduled shaft and an 80-floor express
  shaft, under random occupancy, hall and cab calls, hours and weekends.
  Shafts are placed and removed, a stop is taken from under a dwelling car
  every 20 steps and given back every 100, and every room empties every 50
  steps. It compares car positions, directions, loads and dwell timers (bit
  for bit) and the waiting map after every step, and the boarding tally every
  30 steps, and asserts the run reached a car dwelling on a dropped stop, an
  empty tower, a raised call, a non-empty tally and a car past the express
  shaft's 64th stop, where the bit sets need a second word.
- `the_stop_search_finds_what_the_full_scan_found` (in
  `dispatch_search_tests.rs`) compares the search with the full scan over
  20,000 random stop lists, more than 500 of them at each length from one
  word to four, including every fifth list unbroken at a length on or beside
  a word boundary (1, 63 to 65, 127 to 129, 192, 193 and 256 stops). Both
  directions, cab floors on and off the stops, positions on, beside and
  between stops, and positions that are not finite or far beyond any tower.
- `the_stop_search_crosses_empty_words` puts a single answering stop, a call
  or a cab stop, at the far end of 64 to 256 stops, so the search crosses
  empty words to reach it, and checks that a claim hides the call and leaves
  the cab stop.
- The floor lists follow a shaft placed and removed, a new lobby floor and a
  stop toggle at the same unit count; `reindex_resets_the_floor_lists` pins
  the memo reset with a stop list changed behind the revision; a reload
  rebuilds them; a removed shaft loses its dwell timers.
- Seeded mutations, round 1: the dwelling claim dropped, `CLAIMED` ignored,
  every boarding tallied (Acceptance Auditor), the walk's tie rule, its
  non-finite rule and its tolerance: each fails a test. Round 2, 13 on the
  final code: the upward search ignoring its start inside a word, claims
  ignored, cab stops ignored, no tie step, an off-stop cab floor taking its
  neighbor's bit, the dwelling claim dropped, the estimate never raising a
  call, the estimate raising a staff shaft's calls, the reach test ignoring
  the cab, the reach test ignoring reach and the target never claimed each
  fail a test. The downward search keeping bits at or above its end hangs
  the tests, since its tie step never moves, and CI's job timeout fails it.
  The tie step run on infinite distances survives as an equivalent mutant:
  the final check returns nothing for an infinite distance either way, and
  the guard only spares the walk.

**The bare step** (callgrind, instructions inside `Simulation::tick`), the
final head against `main` d09aa64:

| Tower | Steps | Step | `accumulate` | `move_cars` |
| --- | --- | --- | --- | --- |
| `split-tower-4` | 720 | 2,196.8M to 1,736.0M (-21.0%) | 287.6M to 118.2M | 383.0M to 92.6M |
| `sixseven_2` | 720 | 1,204.1M to 959.7M (-20.3%) | 140.4M to 66.7M | 241.4M to 68.4M |
| `large` | 240 | 827.5M to 634.7M (-23.3%) | 273.5M to 111.2M | 43.4M to 9.7M |
| `many-unit` | 240 | 780.7M to 668.5M (-14.4%) | 61.9M to 45.5M | 134.0M to 37.7M |

The crowd's `elevator_calls` also drops (50.1M to 38.6M on `split-tower-4`,
36.2M to 27.7M on `sixseven_2`), since an ordered cab set inserts without
hashing.

The review asked whether the bit sets are cheaper than round 1's walk, which
an earlier cross-base comparison could not show. `move_cars` with each
round's dispatcher on the same engine (the first four columns built on
`main` d8e5a84, whose dispatcher is the same as d09aa64's and whose step is
within 0.3% of it; the final head on d09aa64):

| Tower | `main` | Round 1 walk (4b99d9e) | Part A (11f694b) | Bit sets (c89902a) | Final head |
| --- | --- | --- | --- | --- | --- |
| `split-tower-4` | 383.0M | 97.1M | 103.7M | 100.0M | 92.6M |
| `sixseven_2` | 241.5M | 73.7M | 79.8M | 73.5M | 68.4M |
| `large` | 43.4M | 8.2M | 10.0M | 10.1M | 9.7M |
| `many-unit` | 134.0M | 48.1M | 44.5M | 40.7M | 37.7M |

The final head's `move_cars` is the lowest of the four dispatchers on three
towers. On `large`,
round 1 stays ahead: its flag pass read the waiting map with one `range` per
shaft, which visits fewer entries on that tower's five shafts than Part A's
lookup per stop. On `many-unit`, whose 14 express shafts each span the tower
with 9 stops, the lookup per stop wins.

**Wall clock**, 20 interleaved pairs of 720 steps, median of the per-pair
ratios, final head against d09aa64: `split-tower-4` 0.844 (medians 273.8 and
231.8 ms), `sixseven_2` 0.909 (120.3 and 107.5 ms). The ratio is a median of
pairs, so it differs a little from the ratio of the two medians. Single pairs
range from 0.55 to 1.22 on this machine, so the instruction counts are the
figure to quote.

No desktop figure isolates this change yet. The October 22 owner desktop
run on the combined measurement branch included it beside the
DO-NOT-MERGE #1196 facade spike, so it cannot attribute the gain, and the
size runs on `main` do not contain it until it merges.

## Review

`/gds-code-review` round 1 on 327782b: Blind Hunter, Edge Case Hunter,
Acceptance Auditor and Hot-Path Auditor. No layer found a wrong result: the
Acceptance Auditor traced every change against the base and
`ElevatorDispatch.ts`, and the reference differs from the base dispatcher
only in names and layout. The Hot-Path Auditor's record is on the PR.

### Review Findings

- [x] [Review][Patch] The scan tested every stop of the shaft for each car (H5, HP-2; up to about 3,900 stop visits per chunk on the owner's save, 11,900 at the cap) [dispatch.rs]: it walks out from the car to the first stop that answers; `the_stop_walk_finds_what_the_full_scan_found` pins it against the full scan.
- [x] [Review][Patch] `dispatch_floors` iterated a copy of the served set and sorted it (H2, HP-5 and HP-10) [tower_index.rs]: it asks the memo floor by floor over the passenger shafts' span, with no copy, no set iteration and no sort.
- [x] [Review][Patch] The reindex and reload tests could not fail on a missing reset, and no test toggled a stop at the same unit count [dispatch_tests.rs]: `reindex_resets_the_floor_lists` pins the reset, and the layout test toggles a stop.
- [x] [Review][Patch] The side-by-side test never had a car dwelling on a floor that stopped being a stop, never emptied the tower, and did not show the tally or the calls were reached; it zipped shafts without a length check and compared dwell timers by value [dispatch_tests.rs]: all added, with counters asserted at the end; dwell timers compare bit for bit.
- [x] [Review][Patch] No checks that the stops and lobbies ascend, that the folded population matches `total_population`, or that a scan direction is set [dispatch.rs, tower_index.rs]: `debug_assert`s.
- [x] [Review][Patch] The HP-8 table had no row for the new index, the served-floors row and #859's backlog row still listed dispatch as a cloner, and the `tower_index.rs` header left the dispatch lists out [hot-path-review.md, backlog.md, tower_index.rs]: all updated.
- [x] [Review][Patch] The reference module did not follow the `*_tests.rs` naming that section 1 and `independence.rs` use to tell test code apart [dispatch_reference_tests.rs]: renamed, and mounted under `#[cfg(test)]`.
- [x] [Review][Patch] Docs: the `waiting` comment said the map is only read by floor, two comments used an "X, not Y" phrase, this story pointed at a file outside the repository, named one base for two runs, left AC1's other checks and the desktop figure unstated, gave a stale reason for leaving `stops_of` alone, and did not say where "item 5" comes from: all corrected; `Memo.floors` is one line, so `tower_query.rs` grows by one.
- [x] [Review][Defer] `stops_of` clones each elevator's stops per chunk (H3) [tower_query.rs]: deferred by reference, #859 (A8 in #1158); row updated.
- [x] [Review][Defer] The scan hashes the crowd's hall and cab call maps per stop (H4) [dispatch.rs, crowd/routing.rs]: deferred to #1293 (backlog row `rust-dispatch-call-map-hashing`).
- [x] [Review][Defer] The spawn step walks the rooms again for `total_population` (H6) [crowd/spawn.rs]: deferred by reference, A10 in #1158; `accumulate` already holds the same sum.
- [x] [Review][Defer] The TypeScript dispatcher's own costs: three room passes per step, per-chunk sets and the prune set (H8) [src/engine/ElevatorDispatch.ts]: deferred by reference to #1170, the TypeScript sweep (comment added there).
- Dismissed (2): `car_dwell.retain` iterates a `HashMap` of at most 24 shafts, and each keep-or-drop reads only its own entry, so no result follows the order (H7); `transport_index` asserts its own consistency on every lookup, so the prune cannot read a stale index (B4).

### Review round 2

`/gds-code-review` round 2 on c89902a (a local commit; its fixes are folded
into 835f46d): Blind Hunter, Edge Case Hunter, Acceptance Auditor and
Hot-Path Auditor, over Part A (4b99d9e..11f694b, pushed to the branch between
the rounds) and Part B, the bit sets. No layer found a wrong result: the
Acceptance Auditor traced the search, the claims, the tally and the word
boundaries against `ElevatorDispatch.ts` and the reference. The Hot-Path
Auditor's record is on the PR.

R2-1 started the round: round 1's walk still had a car with nothing to serve
test every stop of its shaft in both directions. Codex raised it on the PR,
and the third reviewer counted up to about 1,560 stop visits per chunk on the
owner's save and about 5,760 at the cap.

- [x] [Review][Patch] R2-1: a car with nothing to serve tested every stop of its shaft (HP-2) [dispatch.rs]: bit sets and a word search, at most two words per direction.
- [x] [Review][Patch] R2-H1: the cab fill iterated a std `HashSet` (HP-10; its order could not reach a result, but the item bars the iteration) [dispatch.rs, crowd/mod.rs]: `ElevatorCalls.cab` holds a `BTreeSet`, read in floor order.
- [x] [Review][Patch] R2-H2: `held` still probed the cab set by hash, and the #1293 row, its remedy and the #1170 comment described round 1 [dispatch.rs, backlog.md]: `next_stop` returns the stop's index, `held` reads the cab bit and the claim reuses the index; the row and its remedy are rewritten and #1170 has a new comment. Round 1's H4 deferral now covers only the hall map and one cab-map lookup per car.
- [x] [Review][Patch] The step-for-step test never had a shaft over 64 stops, and the search generator never reached four words or asserted the word-boundary lengths (Edge Case Hunter, Blind Hunter) [dispatch_tests.rs, dispatch_search_tests.rs]: an 80-floor express shaft with an asserted second-word visit, unbroken boundary lengths with per-length counts, and the empty-word test. The search tests moved to their own file to keep both under 500 lines.
- [x] [Review][Patch] The flag pass looked `waiting` up even where the hall had raised the call (Blind Hunter, Hot-Path Auditor) [dispatch.rs]: it short-circuits as the TypeScript does.
- [x] [Review][Patch] `tower_query_state` was a public module, the `tower.rs` memo doc named four memos, the reference's doc named the wrong predecessor, and the module doc said the move kept a file under the ceiling that was over it [lib.rs, tower.rs, dispatch_reference_tests.rs, tower_query_state.rs]: a private module, a doc that points at the module and the indexes, the reference described as the dispatcher before item 5, and "bring".
- [x] [Review][Patch] Measurements: round 2 set its `move_cars` beside round 1's across two bases, put the difference on the cab fill without measuring Part A's change, and ran the perf towers only for digests (Blind Hunter, Acceptance Auditor) [story]: a same-engine table of all four dispatchers on four towers, in Result.
- [x] [Review][Patch] Docs: AC2 kept its round-1 clause, AC3 an "X, not Y" phrase, Design bullet 1 described flag bytes, R2-1 was undefined, Out of scope said this lane does not edit `tower.rs`, Part A's move and its effect on the round-1 note that `tower_query.rs` grows by one went unrecorded, the `test:wasm` count was round 1's, and the PR body was stale [story, PR body]: all rewritten, with counts from the final head.
- [x] [Review][Defer] R2-H3: `move_cars` still asks the crowd's call maps by hash, at most 984 lookups per chunk at the cap [dispatch.rs, crowd/routing.rs]: deferred by reference to #1293.
- [x] [Review][Defer] R2-H4: `stops_of` clones each shaft's stops per chunk [tower_query.rs]: deferred by reference to #859 (A8).
- [x] [Review][Defer] R2-H5: `elevator_calls` rebuilds nested maps every chunk [crowd/routing.rs]: deferred by reference to #1158 and #1293.
- [x] [Review][Defer] R2-H6: the TypeScript twin keeps the costs this PR removed [src/engine/ElevatorDispatch.ts]: deferred by reference to #1170 (comment updated).
- [x] [Review][Defer] A hand-edited save's fractional or huge `carDir` reads differently in the two engines (Edge Case Hunter) [load.rs]: pre-existing and already listed in #858.
- Dismissed (3): a dense per-stop waiting slot, since the lookups are under the allowance (at most 105 per chunk on the large tower); an ascending-stops assert, which `move_cars` already has; and where the `Unit` predicates live, which is cosmetic, since they moved verbatim.
