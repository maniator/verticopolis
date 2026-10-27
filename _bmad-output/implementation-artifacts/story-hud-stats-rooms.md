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
This change still leaves one pass over the rooms per refresh, where the
checklist's HP-12 asks for a flat HUD tier; whether that pass may stay for
now, in this change and in 4e, is the owner's call (F2 in Review, pending).

## Acceptance criteria

1. **AC1 Same numbers.** `stats()` returns the same object as before for any
   tower: every count, the population, money, star, the floor and transport
   figures and the fire count. The HUD shows the same population.
2. **AC2 One pass over the rooms for the HUD's stats.** The counts walk
   `roomUnits` (the tower's units minus floor and lobby tiles, in the same
   order), and the population comes from the same pass. The HUD refresh
   (`uiStatus.update`) reads `stats()` once for the population label and the
   stats grid, where it read `sim.population` as well. The same refresh's
   traffic readout makes its own pass (#338), and a flat HUD tier is F2,
   pending the owner (Review).
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
  `tower_stats` (`engine-rs/src/panels/stats.rs`, bound as `towerStats` but
  called by no production code yet) makes the same two passes this change
  folds into one (counts, then `population()`); 4e carries the fold over
  when it routes the HUD there.
- Other per-frame and per-refresh reads of the rooms on the same path, all
  older than this change: the crowd renderer reads `sim.population` every
  frame, and so does the meal-rush bulletin check (`emitMealRushes`) before
  it knows a meal starts (both #1234); the HUD's traffic readout and the
  renderer rebuild the congestion map (#338); the host's hourly merge reads
  the whole save (#868).
- Making the HUD refresh flat as the tower grows (counters kept on every
  state write, across the engine, the host's frame apply and the merge) is
  F2 in Review: always patched under the checklist's section 7 unless the
  owner accepts a deferral, and pending his answer.

## Result

These are cloud estimates from this sandbox (Node 22, 2026-10-27); gate
figures come only from the owner's PC. The harness is a pair of scripts kept
outside the repository: they load each perf tower from
`src/tests/perfCompare/scenarios.ts`, check that `main`'s `stats()` (d09aa64,
unchanged on `main` through 035231a) and this one return the same object,
warm up, and take the median of batches of 100 calls.

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
  at (the test checks the list was memoized and that the revision and unit
  count held), and checks the HUD equals a fresh load's `stats()` and its
  population equals the mirror's `population`.
- `uiStatus.test.ts` runs one HUD refresh and checks it calls `stats()` once,
  never reads `sim.population`, and labels the population from `stats()`.
- Seeded mutations, each failing a test: the population counted for absent
  rooms, the population off by one, half the offices skipped, the rooms
  list memoized without the revision, the merge without `forgetUnitLists`
  (the HUD test fails, with #1325's two drop tests), the label read from
  `sim.population`, and the grid drawn from a second `stats()` read.

## Review

`/gds-code-review` round 1 on 1b2757a against `main` d09aa64 (the branch was
rebuilt on `main` 035231a after #1325 merged; see the first item): Blind Hunter,
Edge Case Hunter, Acceptance Auditor and Hot-Path Auditor. No layer found a
wrong count on a path the tests reached. The Edge Case Hunter found the merge
path that could serve the HUD a stale rooms list, and the Hot-Path Auditor
found a second rooms pass at the HUD's entry point (F1) and that the one
pass left still grows with the rooms (F2).

- [x] [Review][Patch] The host's merge keeps the unit array and sets the engine's revision, which can equal the one the rooms list was memoized at (at attach the read model and the engine count their bumps separately), so a merged tower could serve the HUD a stale list; an id that named another kind on the engine side would change a held unit's kind in place (Edge Case Hunter E3; Blind Hunter M3) [merge.ts, rooms.ts]: round 1 added a `forgetRooms` drop to the merge. #1325 (issue #1253) then landed `forgetUnitLists` on `main`, which drops the list whenever the revision or a unit's id, kind, floor, x or width moved, so the rebuilt branch carries no merge code and keeps the HUD-level merge test, which fails without that drop. Design said the change opened no new staleness path, which held for the population only; it now says so.
- [x] [Review][Patch] The HUD refresh read `sim.population` and then `stats()`, two rooms passes for one population, so AC2's one pass did not hold at the entry point (Hot-Path Auditor F1) [uiStatus.ts, story]: the refresh reads `stats()` once and takes the population from it.
- [x] [Review][Patch] Both tests changed the unit count at every step, and the merge test added units and passed a revision of its own, so neither showed the revision key or the merge's drop doing anything (Blind Hunter M1, M2; Edge Case Hunter E1, E2) [stats.test.ts, merge.test.ts]: each test swaps an office for a hotel room at the same unit count with no read in between, and the merge test passes the held revision.
- [x] [Review][Patch] The counted kinds were a hand list whose presence the test checked with its own filter (Blind Hunter L6) [stats.test.ts]: the test checks that every kind `stats()` counts is in the list, and counts four of each through `roomUnits`.
- [x] [Review][Patch] The fixture's comment said three basements where it builds four levels, and its wrap jumped from floor 11 to a basement (Blind Hunter L7) [stats.test.ts]: the comment is corrected, the fixture asserts it stays on the upper floors, and a kind they refuse goes below on its own cursor.
- [x] [Review][Patch] AC5 named no date, commit or method, and the mutation list had no memo that ignores the revision (Blind Hunter L9, L10; Acceptance Auditor) [story]: Result names the date, the commits and the method, and the two new mutations each fail a test.
- [ ] [Review][Patch, pending the owner] `stats()` still makes one pass over the rooms per HUD refresh, about 2,900 visits on the large tower and 17,400 a second at 6 Hz, where HP-12 asks for a flat HUD tier (Hot-Path Auditor F2) [stats.ts]: always patched under section 7 unless the owner accepts a deferral in his own words. The fix is counters kept at every write (the step, the hosts' frame apply, the merge) or a census snapshot from a rooms pass the step already makes, carried in the frame header; the cost estimate is in round 2's F2. Asked on 2026-10-27, with the recommendation to accept for now and track a flat HUD as a P3 row; no GO before he answers.
- [x] [Review][Defer] The other caches keyed on an object the merge keeps and on the tower's revision (`segmentsOf` and the staff ceiling on the tower, the reach verdicts on the simulation) read a merged tower the same way, and the merge can hand back a revision they were memoized at (Edge Case Hunter E3, beyond this change) [merge.ts]: deferred to #1331 (row `wasm-merge-revision-caches`), with its remedy: the merge's drop on a moved revision or moved units (#1325) takes those caches too, with the transports in the check for the reach verdicts.
- Dismissed (3): the inlined population duplicates `totalPopulation`'s sum (Blind Hunter M4), but the first test asserts `stats().population` equals `sim.population` in every round; the swap and merge tests match a subset of the fields (L5), but the fields they leave out are read straight from the simulation, untouched by this change; and the issue numbers (L11) follow the PR's Refs, with #905 left open for its loaded-tower gate.

### Round 2

`/gds-code-review` round 2 (a confirming pass) on 86ccc02 against `main`
035231a: Blind Hunter, Edge Case Hunter, Acceptance Auditor and Hot-Path
Auditor. The Edge Case Hunter found no unhandled path: it traced every writer
of the unit array and of a unit's kind, the merge at a repeated or earlier
revision, and the frame apply, and a probe compared `stats()` with the walk
over every unit and with `sim.population` through each. The Acceptance
Auditor found every AC met as worded, with the claims below to correct. The
Hot-Path Auditor confirmed F1's fix, restated F2 with its numbers, and found
two older room walks on the same frame path. The record is on the PR.

- [x] [Review][Patch] The merge test did not show the rooms list was memoized before the merge, that the revision and unit count held through it, or that the HUD's population matched the mirror's (Blind Hunter B1, B4) [merge.test.ts]: it checks all three.
- [x] [Review][Patch] No test pinned the HUD's single `stats()` read or its population label, so a return to `sim.population` would have passed (Acceptance Auditor A7; Blind Hunter B9) [uiStatus.test.ts]: a HUD refresh test counts the reads and checks the label; both mutations fail it.
- [x] [Review][Patch] The story said the Rust `tower_stats` is not exported (it is bound as `towerStats`, with no production caller), scoped F2 out while it is pending, gave AC2 a whole-refresh claim the traffic readout breaks, said Result named a script, left F2 out of round 1's summary, and used one "X, not Y" phrase (Acceptance Auditor A1 to A5, A9, A11) [story, PR body]: each is corrected.
- [x] [Review][Patch] The comment on `population` in `star.ts` called it the single source of truth for the displayed number, which the HUD now sums in `stats()` (Acceptance Auditor A10) [star.ts]: it names the HUD's sum and the test that pins the two equal.
- [x] [Review][Patch] The #905 row called the walk part done without F2 (Acceptance Auditor A8) [backlog.md]: it says the flat HUD is pending the owner.
- [x] [Review][Defer] `emitMealRushes` reads `totalPopulation()` on every frame, paused included, before it knows a meal starts: about 0.2 ms a frame on the large tower, older than this change (Hot-Path Auditor F3) [frameLoop.ts]: deferred onto #1234 (its row and issue), with the remedy of reading the population only on a frame that crosses a meal start.
- [x] [Review][Defer] The HUD's traffic chip rebuilds the congestion map on every refresh, about 0.6 ms on the large tower and 0.9 ms on the owner's save, now the larger HUD cost (Hot-Path Auditor F4; Acceptance Auditor A2) [trafficHud.ts]: deferred onto #338, whose row now names this reader beside the render frame.
- F2 stays pending the owner (round 1's item above).
- Dismissed (10): the population rule copied from `totalPopulation` (Blind Hunter B2, B5 to B7), since `censusCount` holds the rule, floor and lobby tiles have catalog population 0, and the first test pins `stats().population` to `sim.population` every round; units replaced in place without a revision bump (B3), since the Edge Case Hunter found no writer that does so; the subset match (B8), since the fields left out are read straight from the simulation; the read moved to the top of `update` (B10), since nothing before the grid writes unit state; the comment on the old second pass (B11), since `sim.population` was an uncached room walk; the fixture's numbers and basement branch (B12 to B14), which the assertions bound; the serialize path on both sides of the merge test (B15), which the host's own merge also takes; lint (B16), which passes; the version (B17), since the label shows the same number; and the hand list of counted kinds (Acceptance Auditor A6), since a kind `stats()` began to count would need a new field, which the reference would have to name as well.
