---
story: hud-stats-rooms
status: review
issue: 905
---

# Story: the HUD's `stats()` walks only the rooms (#905)

## Why

`Simulation.stats()` (`src/engine/sim/stats.ts`) feeds the HUD strip on
every UI refresh, about 6 times a second. It walks every unit in the tower,
floor and lobby tiles included, and then reads `sim.population`, which walks
the rooms a second time. On the large tower that is 43,358 units, about
40,000 of them structure tiles that no count in `stats()` can match. On the
WASM host the HUD reads the same function on the host's mirror of the tower,
and a cloud hosted profile put `stats()` at 54% of the WASM HUD samples
(2026-10-21).

Facade slice 4's PR 4a review deferred this as a P3 hot-path finding (#905's
row and issue carry it), and its part 4e moves the HUD strip onto the
`towerStats` port query. Moving the walk there would make new code with a
whole-unit walk per UI tick, which the hot-path checklist always patches. The
Rust bare-step lane took the change to `stats.ts` under #1051 (agreed with
slice 4 on 2026-10-21); 4e builds on this PR and leaves the function alone.

## Acceptance criteria

1. **AC1 Same numbers.** `stats()` returns the same object as before for any
   tower: every count, the population, money, star, the floor and transport
   figures and the fire count. The HUD shows the same population.
2. **AC2 One pass over the rooms per HUD refresh.** The counts walk
   `roomUnits` (the tower's units minus floor and lobby tiles, in the same
   order), and the population comes from the same pass. The HUD refresh
   (`uiStatus.update`) reads `stats()` once for the population label and the
   stats grid, where it read `sim.population` as well.
3. **AC3 No revision cache of the result.** `stats()` reads tenancy, condo
   sales, hotel states, `noRate`, residents and customers, which change
   without a revision bump, so the result is computed on every call. Only the
   rooms list is memoized, as it already is for `totalPopulation`.
4. **AC4 Hosted.** On the WASM host, a merge of the engine's tower (which
   keeps the unit array and the unit objects and sets the engine's revision)
   gives the HUD the merged rooms, even at the same unit count and the
   revision the rooms list was memoized at.
5. **AC5 Measured.** Before and after timings of `stats()` on the large,
   many-unit and hotel-heavy perf towers, labeled cloud estimates.

## Design

- Every kind `stats()` counts (office, condo, the hotel kinds, shop,
  restaurant, fast food, parking) is a room kind, so `roomUnits` yields every
  unit that can match, in `tower.units` order, and the counts are identical.
- The population is `totalPopulation`'s sum inlined: `censusCount` of each
  present room, over the same list in the same order, so the sum is the same
  number. `stats()` no longer calls `sim.population`.
- `roomUnits` is keyed on the unit array, its length and `tower.revision`.
  Before this change only the population read through that memo; the counts
  walked `tower.units` live and could not go stale. Now they share it, so a
  path that changes the rooms without moving a key would skew every HUD
  count. Every edit pushes or splices a unit and bumps the revision, and a
  load replaces the array. The host's `mergeSimulation` is the exception: it
  keeps the array and each held unit object and sets the engine's revision,
  which can equal the one the list was memoized at (the read model's own
  bumps and the engine's need not match, at attach or after a command), and
  if an id ever named another kind on the engine side, `Object.assign` would
  change a held unit's kind in place. `main` covers that since #1325 (issue
  #1253): the merge drops the rooms list and the structure runs
  (`forgetUnitLists`) whenever the revision moved or any unit's id, kind,
  floor, x or width did, and keeps them over an hourly merge that moved
  neither. The HUD's counts depend on the list's membership only (state,
  tenancy and occupants are read live from each unit), so that drop is
  exactly what they need. This change adds a HUD-level test of it and no
  merge code of its own.
- The HUD refresh read `sim.population` for its label and then `stats()`,
  two passes over the rooms for one population. It now reads `stats()` once
  and takes the population from it; `stats().population` equals
  `sim.population` (a test pins it), and nothing between the two reads writes
  unit state.

## Out of scope

- The loaded-tower cost #905 also tracks (a deserialized tower's `stats()`
  measured about twice as slow as one built in place) stays open there: this
  change shortens both, and the gate in #905 compares them.
- Moving the HUD strip onto `towerStats` is facade slice 4e. The Rust
  `tower_stats` (`engine-rs/src/panels/stats.rs`) makes the same two passes
  this change folds into one (counts, then `population()`); it is not
  exported today, and 4e carries the fold over when it routes the HUD there.
- The crowd renderer reads `sim.population` every frame (#1234), and the
  host's hourly merge reads the whole save (#868).
- Making the HUD refresh flat as the tower grows (counters kept on every
  state write, across the engine, the host's frame apply and the merge) is
  pending the owner (see Review).

## Result

Cloud estimates (Node 22, this sandbox, 2026-10-27), not gate figures: the
harness is a pair of scripts outside the repository that load each perf
tower from `src/tests/perfCompare/scenarios.ts`, check that `main`'s
`stats()` (d09aa64) and this one return the same object, warm up, and take
the median of batches of 100 calls.

`stats()` alone, milliseconds per call, 20 batches:

| Tower | Units | Rooms | Before | After | Ratio |
| --- | --- | --- | --- | --- | --- |
| `large` | 43,358 | 2,900 | 0.563 | 0.119 | 0.21 |
| `many-unit` | 41,880 | 1,422 | 0.387 | 0.032 | 0.08 |
| `hotel-heavy` | 10,490 | 876 | 0.329 | 0.041 | 0.12 |

One HUD refresh's engine reads, milliseconds, 21 batches: before is
`sim.population` and then `main`'s `stats()`; after is this change's single
`stats()`:

| Tower | Units | Rooms | Before | After | Ratio |
| --- | --- | --- | --- | --- | --- |
| `medium` | 12,062 | 1,103 | 0.464 | 0.066 | 0.14 |
| `large` | 43,358 | 2,900 | 1.906 | 0.206 | 0.11 |
| `many-unit` | 41,880 | 1,422 | 1.756 | 0.067 | 0.04 |
| `hotel-heavy` | 10,490 | 876 | 0.554 | 0.077 | 0.14 |

Tests:

- `stats.test.ts` compares `stats()` with the walk over every unit (the
  population summed over every unit too, so no memoized list stands behind
  the reference) across ten rounds of states, on a tower holding four of
  every counted kind (the test checks the list covers every kind `stats()`
  counts) and some uncounted ones. It follows a room removed and placed
  again, and a room swapped for another kind at the same unit count with no
  read in between, where only the revision tells the memoized list it is
  out of date.
- `merge.test.ts` (beside #1325's merge tests) memoizes the host mirror's
  rooms list through `stats()`, merges a tower in which an office became a
  hotel room at the same unit count, with the revision the list was memoized
  at, and checks the HUD equals a fresh load's `stats()`.
- Seeded mutations, each failing a test: the population counted for absent
  rooms, the population off by one, half the offices skipped, the rooms
  list memoized without the revision, and the merge without
  `forgetUnitLists` (the HUD test fails, with #1325's two drop tests).

## Review

`/gds-code-review` round 1 on 1b2757a against `main` d09aa64 (the branch was
rebuilt on `main` 035231a after #1325 merged; see the first item): Blind Hunter,
Edge Case Hunter, Acceptance Auditor and Hot-Path Auditor. No layer found a
wrong count on a path the tests reached. The Edge Case Hunter found the merge
path that could serve the HUD a stale rooms list, and the Hot-Path Auditor
found a second rooms pass at the HUD's entry point.

- [x] [Review][Patch] The host's merge keeps the unit array and sets the engine's revision, which can equal the one the rooms list was memoized at (at attach the read model and the engine count their bumps separately), so a merged tower could serve the HUD a stale list; an id that named another kind on the engine side would change a held unit's kind in place (Edge Case Hunter E3; Blind Hunter M3) [merge.ts, rooms.ts]: round 1 added a `forgetRooms` drop to the merge. #1325 (issue #1253) then landed `forgetUnitLists` on `main`, which drops the list whenever the revision or a unit's id, kind, floor, x or width moved, so the rebuilt branch carries no merge code and keeps the HUD-level merge test, which fails without that drop. Design said the change opened no new staleness path, which held for the population only; it now says so.
- [x] [Review][Patch] The HUD refresh read `sim.population` and then `stats()`, two rooms passes for one population, so AC2's one pass did not hold at the entry point (Hot-Path Auditor F1) [uiStatus.ts, story]: the refresh reads `stats()` once and takes the population from it.
- [x] [Review][Patch] Both tests changed the unit count at every step, and the merge test added units and passed a revision of its own, so neither showed the revision key or the merge's drop doing anything (Blind Hunter M1, M2; Edge Case Hunter E1, E2) [stats.test.ts, merge.test.ts]: each test swaps an office for a hotel room at the same unit count with no read in between, and the merge test passes the held revision.
- [x] [Review][Patch] The counted kinds were a hand list whose presence the test checked with its own filter (Blind Hunter L6) [stats.test.ts]: the test checks that every kind `stats()` counts is in the list, and counts four of each through `roomUnits`.
- [x] [Review][Patch] The fixture's comment said three basements where it builds four levels, and its wrap jumped from floor 11 to a basement (Blind Hunter L7) [stats.test.ts]: the comment is corrected, the fixture asserts it stays on the upper floors, and a kind they refuse goes below on its own cursor.
- [x] [Review][Patch] AC5 named no date, commit or script, and the mutation list had no memo that ignores the revision (Blind Hunter L9, L10; Acceptance Auditor) [story]: Result names them, and the two new mutations each fail a test.
- DECISION_F2
- [x] [Review][Defer] The other caches keyed on an object the merge keeps and on the tower's revision (`segmentsOf` and the staff ceiling on the tower, the reach verdicts on the simulation) read a merged tower the same way, and the merge can hand back a revision they were memoized at (Edge Case Hunter E3, beyond this change) [merge.ts]: deferred to #1331 (row `wasm-merge-revision-caches`), with its remedy: the merge's drop on a moved revision or moved units (#1325) takes those caches too, with the transports in the check for the reach verdicts.
- Dismissed (3): the inlined population duplicates `totalPopulation`'s sum (Blind Hunter M4), but the first test asserts `stats().population` equals `sim.population` in every round; the swap and merge tests match a subset of the fields (L5), but the fields they leave out are read straight from the simulation, untouched by this change; and the issue numbers (L11) follow the PR's Refs, with #905 left open for its loaded-tower gate.
