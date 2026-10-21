---
story: unit-walk-reads
status: review
issue: 1237
---

# Story: engine reads under the panel getters stop walking every unit (#1237)

## Why

The facade 6b panel getters (PR #1228) walk rooms only, but the engine reads
they call still walk every unit. On the large tower that is 43,358 units, and
40,458 of them are floor and lobby tiles that none of these reads can count.
The independent reviewer has gated facade slice 4 on this: the "Facade
panels" lane can't wire the getters into per-tick callers until these reads
are fixed on `main`. #1237 lists the reads:

- `count_operational` and `has_operational` (`economy.rs`) filter every unit
  by kind. `stats_report` reaches them about a dozen times, and star
  evaluation reaches them every game hour.
- `highest_floor` and `lowest_floor` (`star.rs`) fold every unit's floor on
  each call. The TypeScript keeps both in `floorBounds` (`Tower.ts`), keyed on
  revision (A11 in #1158).
- `functional_parking_set` (`tower_query.rs`) walks every unit to find the
  ramps that seed its flood.
- `is_floor_served` clones the whole served-floor set on every call (#859),
  about 2,800 clones in one stranded-floor scan.

The same pattern sits under the same getters in five more reads, so this
story takes them too: the star gates `every_occupied_floor_served` and
`no_leasable_vacancy` (`star.rs`), `stranded_floors` and
`nudge_metro_platform` (`services.rs`), and `has_any` (`economy.rs`). The four
scans each test a predicate no tile can pass; `has_any` goes through the same
kind iterator as the operational checks.

## Acceptance criteria

1. **AC1 Same results.** Byte-identical: every conformance fixture's state and
   crowd digests every 30 steps and its final save digest over 720 steps are
   unchanged, the conformance lock is unchanged, and the seeded differential,
   parity hashes, fuzz and day gate pass. No simulation rule changes and no
   new random draws.
2. **AC2 Room kinds read the room index.** `count_operational`,
   `has_operational` and `has_any` list the units of a room kind from
   `room_units()`, in list order; a tile kind still walks every unit.
   `has_operational` stops at the first operational unit.
3. **AC3 Floor bounds are cached.** `Tower::floor_bounds` ports `floorBounds`:
   one fold over every unit from the ground floor, kept in `tower.memo` and
   keyed on revision and unit count like the other `tower_index.rs` indexes,
   so `Tower::reindex` resets it on load.
4. **AC4 No set clone per served-floor test.** `is_floor_served` reads the
   served-floor memo in place. `served_floors` keeps its contract and still
   returns a copy.
5. **AC5 Scans skip the tiles.** The parking flood seeds from `room_units()`,
   and the star-gate, stranded-floor and metro scans walk `room_units()`. A
   test pins the premise: no tile kind has a population, is a hotel, or is a
   kind these scans name.
6. **AC6 Tested and measured.** Tests compare every read with the walk it
   replaced after placements, removals, swaps that keep the unit count, every
   unit state, `reindex` and a save round trip, and pin the memo reset. The
   reads are timed before and after on the large tower and the owner's save,
   and callgrind runs the bare step on `split-tower-4` and `sixseven_2`, all
   labeled cloud estimates.

## Design

- `Tower::units_of_kind(kind)` (`tower_index.rs`) chains an empty or full
  unit slice with an optional room iterator, so a room kind never touches a
  tile and the call allocates nothing beyond the room index's own rebuild
  after an edit. Callers keep their order and short circuits.
- `floor_bounds` sits at the end of the `tower_index.rs` impl, after
  `structural_tiles`, with one new `Memo` field, `bounds`. No path moves a
  unit's floor without a revision bump, which is what the other
  revision-keyed indexes rely on too.
- `served_floors` is split into `fill_served`, which builds the memo when the
  revision has none, and the copy it returns. `is_floor_served` keeps its
  ground-floor shortcut, fills the memo, then reads it under a shared borrow.
- A ramp is a room kind, so the room index lists every seed in the order the
  full walk did, and the flood's stack sees the same pushes.

## Coordination

- The Rust step hotspots thread confirmed no overlap with its items 2 to 4
  (`crowd/graph.rs`, `crowd/routing.rs`, `crowd/fasthash.rs`, `crowd/spawn.rs`).
- Facade 6d's #1239 follow-up will put its per-kind count after
  `housekeeping_units` and its `Memo` fields after `bounds`. A per-kind count
  can't answer `count_operational`, because unit state changes without a
  revision bump.
- Facade 6c's churn.rs split and presence.rs accessor are untouched here.
  `spatial_congestion_by_floor` still builds and discards an attribution map;
  #1237 keeps that item open for 6c's refactor.

## Out of scope

- The congestion ramp's `powf` (the last bullet of #1237, which stays open
  for it). The differential allows 1e-12 on `severity` only, and this story
  changes no arithmetic.
- `Tower::count_kind` and the Classic escalator office scan (#1239, facade 6d).
- The `served_floors` copies taken by `dispatch.rs`, `churn.rs`,
  `satisfaction.rs` and `presence.rs` (#859, A8 in #1158; #1143 items 5 and 8
  in this lane take the first three).

## Result

All figures are cloud estimates (native release build, this sandbox); the PC
is the source for any gate figure.

**Same results.** The state and crowd digests every 30 steps and the final
save digest over 720 steps of 2 game minutes match `main` on all 8
conformance fixtures, both on a2be596 and after the rebase onto 67ca193. Nine
new tests compare each read with the walk it replaced; 12 of 13 seeded
mutations of the new code fail them, and the 13th (dropping the ramp seed's
operational check) is equivalent, since the flood rejects a ramp that is not
operational anyway.

**The reads**, median microseconds per call at one revision after an hour of
play, `main` then this change:

| Read | Large tower (43,358 units, 2,900 rooms) | Owner's save, `split-tower-4` (19,806 units, 1,699 rooms) |
| --- | --- | --- |
| `count_operational`, 7 kinds | 1,640 to 24 | 701 to 15 |
| `has_operational`, 7 kinds | 1,630 to 7 | 840 to 6 |
| `has_any(Security)` | 119 to 0.06 | 4 to 0.6 |
| `highest_floor` + `lowest_floor` | 260 to 0.03 | 91 to 0.03 |
| `functional_parking_set` | 129 to 6 | 321 to 217 |
| `is_floor_served`, once per room | 222 to 62 | 426 to 37 |
| `stranded_floors(true)` | 694 to 123 | 350 to 63 |

On `split-tower-4` most of the parking set's cost is its flood fill (hashed
tile lookups and a visited set), which is A14 in #1158 and part of #1143
item 8 in this lane.

**The bare step** (callgrind, 720 steps, instructions inside
`Simulation::tick`): `split-tower-4` 7,965.9M to 7,882.9M (-1.0%), and
`sixseven_2` 2,059.5M to 2,026.3M (-1.6%). The step reaches these reads
hourly (star evaluation) and daily (milestones, the stranded-floor and metro
nudges), so the step gain is small; the getters are what this unblocks.
`evaluate_star` drops from 23.5M to 4.4M and `is_floor_served` from 35.5M to
8.2M on `split-tower-4`.

The served-floor rebuild after an edit (one `is_floor_served` read after a
revision bump) drops from 8.0 to 5.1 us on the large tower, 20.8 to 18.2 us
on `split-tower-4` and 13.5 to 8.9 us on `sixseven_2`; the base figures
include the set copy `is_floor_served` used to make.

**The 6b getters** (#1228, on `main` since the rebase), median microseconds
per call at one revision after an hour of play, `main` 4b1e440 then this
change on it:

| Getter | Large tower | `split-tower-4` |
| --- | --- | --- |
| `tower_stats` (HUD strip, every UI tick) | 313 to 19 | 135 to 14 |
| `stats_report` (stats screen) | 2,560 to 249 | 1,830 to 488 |
| `peak_congestion_hotspot` | 256 to 108 | 470 to 330 |
| `onboarding_facts` | 1.6 to 1.2 | 1.2 to 1.0 |

## Review

`/gds-code-review` round 1 on 235a701: Blind Hunter, Edge Case Hunter,
Acceptance Auditor and Hot-Path Auditor. No layer found a wrong result, a
stale read or a borrow panic. The Hot-Path Auditor's record is on the PR.

### Review Findings

- [x] [Review][Patch] The four room-only scans had no test against the walk they replaced [tower_scans_tests.rs]: `the_room_only_scans_match_the_full_walk` compares both star gates, both stranded-floor scopes and the metro cut-off with full-walk copies across placements, every state of each room, two shaft layouts and a save round trip.
- [x] [Review][Patch] The premise test checked stand-ins for the scans' predicates [tower_scans_tests.rs]: it now calls `is_tenant_floor_unit` and `is_stranded_candidate` in both scopes for every tile kind in every state, and pins every kind the scans name, `ParkingRamp` included, as a room kind.
- [x] [Review][Patch] The parking test had no count-keeping swap and no save round trip [tower_reads_tests.rs]: both added.
- [x] [Review][Patch] The served-floor fixpoint re-tested every transport's stops on every sweep (HP-2, moved code; up to about 132,000 compares per edit on an express-heavy tower) [tower_query.rs]: each transport's stops are listed once and a joined transport drops out; `the_served_floors_close_over_chains_listed_top_down` compares it with the old fixpoint over a chain placed top down, skipped stops, an express, a staff-only shaft and stairs.
- [x] [Review][Patch] A missing served memo after the fill would have read as "nothing served" [tower_query.rs]: `expect`.
- [x] [Review][Patch] The unit-state list in the tests could skip a new state [tower_reads_tests.rs]: an exhaustive match guards it.
- [x] [Review][Patch] `units_of` grew `economy.rs` past its ceiling [economy.rs]: moved to `Tower::units_of_kind` in `tower_index.rs`.
- [x] [Review][Patch] Docs: the `floor_bounds` comment named callers not on `main`, the module header left out the bounds, this story miscounted the extra reads and overstated the allocation and borrow, two hand-offs named no issue, and #859's backlog row still listed `is_floor_served`: all corrected.
- [x] [Review][Defer] The nightclub gripe scans walk every unit per evicted room [satisfaction.rs]: deferred by reference, A13 in #1158 (#1143 item 8 in this lane).
- [x] [Review][Defer] `evaluate_star` repeats room passes across its gate rounds, up to about 37,700 visits per hour after this change [star.rs]: deferred by reference, A11 in #1158; `tower_demand_bonus`'s repeats are A10 in #1158 and #849.
- [x] [Review][Defer] `served_floors` still clones, and the served set still hashes each query [tower_query.rs]: deferred by reference, #859 (A8 in #1158); row updated.
- [x] [Review][Defer] `accumulate_waiting` makes a second room pass per step [dispatch.rs]: deferred by reference, A10 and A20 in #1158 (#1143 item 5 in this lane).
- [x] [Review][Defer] The parking flood hashes per tile and is uncached [tower_query.rs]: deferred by reference, A14 in #1158.
- [x] [Review][Defer] `collect_rent` and `maybe_vip_stay` walk every unit; `nudge_service_shortfalls` repeats room passes; a buy-back eviction rebuilds the satisfaction context and congestion map [economy.rs, services.rs, churn.rs]: deferred to #1257 (backlog row `rust-nudge-rent-eviction-passes`).
- [x] [Review][Defer] `Unit` clones in satisfaction and move-ins, and `reaches_lobby`'s segment clone [satisfaction.rs, churn.rs]: deferred by reference, A13, A14 and A8 in #1158.
- [x] [Review][Patch] `onboarding_facts` cloned the served set where `is_floor_served` now answers in place, and the stats panel's module comment said the floor reads walk the units [panels/onboarding.rs, panels/stats.rs]: #1228 merged during this review, so both are fixed here after the rebase.
- [x] [Review][Defer] `stats_report` repeats about 19 room passes per refresh, and the HUD getters still grow with the room count per UI tick [panels/] (#1228, on `main`): deferred by reference to #1237's backlog row `rust-reads-walk-every-unit`, which now carries the figures above; #1237 stays open.
- Dismissed as false positives (8): the room split is pinned by `tower_index_tests.rs`; a memo served stale after an edit behind the revision is the documented contract of every revision-keyed index and no production path makes one; the Result section is filled in; the borrow paths were traced and are exercised cold by the new tests; the parking oracle copies the old flood on purpose; the reload test pins the reset the way the staff-ceiling test does; and the remaining O(rooms) cost per read is the deferred A11 and #1228 items above.
