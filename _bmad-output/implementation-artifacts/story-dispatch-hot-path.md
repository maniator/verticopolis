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
2. **AC2 No per-stop hashing in the scan.** `calls` and `claimed` become one
   flag byte per stop; the cab set is consulted only for a stop without a free
   call. (Review round 2 replaced the flag bytes with bit sets over the stops
   and reads the cab set once per car; see Design.)
3. **AC3 No per-room hashing in the waiting pass.** Each room's floor is
   found by binary search in the served floors, kept ascending per tower
   revision; the waiting map is read and written once per touched floor, not
   once per room. `total_population` folds into the same pass.
4. **AC4 Caches keyed and reset correctly.** The served and lobby floor lists
   live in `tower.memo` (reset by `Tower::reindex`, so on load), keyed on the
   revision and unit count like the other `tower_index.rs` indexes. Tests cover
   a shaft placed and removed, a new lobby floor, `reindex` and a reload.
5. **AC5 Measured.** Callgrind instruction counts before and after on
   `split-tower-4` and `sixseven_2`, and paired wall-clock reps, all labeled
   cloud estimates.

## Design

- `waiting` becomes a `BTreeMap<i64, f64>`. The map stays in ascending floor
  order so each lookup remains a small integer key comparison instead of a
  SipHash on a floor id, and the shaft's sorted stop list still carries the
  per-stop flag scan. The actual hot path reads and writes by floor via
  `get`/`entry`/`insert`, and the `retain` pass decays each entry in place,
  so the map's ordering does not change the result.
- Per shaft, reused bit sets over the stops (64 stops a word) carry the
  TypeScript's `calls` and `claimed` sets: stop `k` is bit `k`. `stops` is
  ascending (`stops_of` filters `bottom..=top`), so a floor's stop is a
  binary search away; a claimed floor that is not a stop (a dwelling car
  between stops) can never be asked about, so it is dropped. The flag pass
  reads the hall calls and the waiting map once per stop.
- Each active car reads its cab set once into a third bit set over the
  stops, one binary search per cab floor; a cab floor that is not a stop is
  left out, as the scan never reached it. The set is read in its own order,
  which no result depends on, since each floor only sets its own bit.
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
  every stop of its shaft (R2-1).
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

## Out of scope

- `stops_of` still returns a clone per shaft per chunk (#859, A8). Changing
  what it returns reaches its callers in `tower.rs`, a facade file this lane
  does not edit, and in the crowd's routing and banks.
- The hall calls come from `crowd/routing.rs` as a `HashMap`, so the flag
  pass still hashes them once per stop: #1293 (backlog row
  `rust-dispatch-call-map-hashing`). The cab sets are no longer hashed per
  stop (round 2).
- `total_population` is still walked by the spawn step (A10 in #1158).
  `accumulate` now computes the same sum one call earlier, so `spawn_step`
  could take it; `crowd/spawn.rs` belongs to the other hotspot lane.

## Result

All figures are cloud estimates (native release build, this sandbox); the PC
is the source for any gate figure. Round 1 measured against `main` efb4bdf
(with #1237's change, PR #1276). Round 2 measured the head with the bit sets
against `main` d8e5a847, whose engine matches the PR's merge base 245f548
(it includes #1143 item 4, #1281).

**Same results.** The state and crowd digests every 30 steps and the final
save digest over 720 steps of 2 game minutes match the base on all 8
conformance fixtures, in both rounds; round 2 also ran the `large`,
`many-unit` and `hotel-heavy` perf towers the same way, with the same
result. The Rust referee (`cargo run --release --features
conformance --bin conformance`) passes every scenario and catalog, and the
conformance lock is untouched. `npm run test:wasm` on the built engine
(the WASM conformance and parity suites, the seeded dual-run differential and
the day gate in `dualRunDay.integration.test.ts`, the host and worker tests)
passes: 352 tests, 14 skipped. The fuzz seeds run in CI (`engine-fuzz.yml`).

The dispatch tests run this dispatcher beside the hashed one it replaced
(kept in `dispatch_reference_tests.rs`):

- `dispatch_matches_the_hashed_reference_step_for_step` runs both for 3,000
  steps on a scenario tower with a scheduled shaft, under random occupancy,
  hall and cab calls, hours and weekends. Shafts are placed and removed, a
  stop is taken from under a dwelling car every 20 steps and given back every
  100, and every room empties every 50 steps. It compares car positions,
  directions, loads and dwell timers (bit for bit) and the waiting map after
  every step, and the boarding tally every 30 steps, and asserts the run
  reached a car dwelling on a dropped stop, an empty tower, a raised call and
  a non-empty tally.
- `the_stop_search_finds_what_the_full_scan_found` compares the search with
  the full scan over 20,000 random stop lists of up to 200 floors (one to
  four words; more than 5,000 lists span two or more), both directions, cab
  floors on and off the stops, positions on, beside and between stops, and
  positions that are not finite or far beyond any tower.
- The floor lists follow a shaft placed and removed, a new lobby floor and a
  stop toggle at the same unit count; `reindex_resets_the_floor_lists` pins
  the memo reset with a stop list changed behind the revision; a reload
  rebuilds them; a removed shaft loses its dwell timers.
- Seeded mutations: the dwelling claim dropped, `CLAIMED` ignored, every
  boarding tallied (Acceptance Auditor), the walk's tie rule, its
  non-finite rule and its tolerance (round 1): each fails a test. Round 2,
  on the bit sets: the upward search ignoring its start inside a word, the
  downward search keeping bits at or above its end, claims ignored, cab
  stops ignored, no tie step, an off-stop cab floor taking its neighbor's
  bit, the tie step on infinite distances and the dwelling claim dropped:
  MUTATIONS_R2.

**The bare step** (callgrind, 720 steps, instructions inside
`Simulation::tick`), round 2 against `main` d8e5a847:

| Fixture | Step | `accumulate` | `move_cars` |
| --- | --- | --- | --- |
| `split-tower-4` | 2,196.3M to 1,747.1M (-20.5%) | 287.6M to 118.2M | 383.0M to 100.0M |
| `sixseven_2` | 1,207.5M to 968.6M (-19.8%) | 140.5M to 66.7M | 241.5M to 73.5M |

Round 1's walk measured `move_cars` at 90.3M and 70.4M (against efb4bdf,
where dispatch costs the same). The bit sets cost a little more on these
saves, mostly the cab fill per car, in exchange for a search whose cost no
longer grows with the shaft's stops. Round 1's step figures against efb4bdf
were -15.8% and -15.7%.

**Wall clock**, 20 interleaved pairs of 720 steps, median of the per-pair
ratios, round 2: `split-tower-4` 0.902 (medians 257.0 and 230.2 ms),
`sixseven_2` 0.816 (126.3 and 105.5 ms). The ratio is a median of pairs, so
it differs a little from the ratio of the two medians. Single pairs range
from 0.61 to 1.24 on this machine, so the instruction counts are the figure
to quote.

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
