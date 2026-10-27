---
story: hud-stats-rooms
status: review
issue: 905
---

# Story: the HUD's `stats()` reads kept room counts (#905)

## Why

`Simulation.stats()` (`src/engine/sim/stats.ts`) feeds the HUD strip on
every UI refresh, about 6 times a second. It walked every unit in the tower,
floor and lobby tiles included, and then read `sim.population`, which walks
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
slice 4 on 2026-10-21); 4e builds on this PR.

The first version walked only the rooms, one pass per refresh. Review found
that the pass still grows with the tower, where the checklist's HP-12 asks
for a flat HUD tier (F2), and the owner chose to fix it here (2026-10-27,
quoted in Review). So the HUD now reads counts kept as the rooms change.

## Acceptance criteria

1. **AC1 Same numbers.** `stats()` returns the same object as before for any
   tower at any moment: every count, the population, money, star, the floor
   and transport figures and the fire count. The HUD shows the same
   population.
2. **AC2 A flat HUD read.** `stats()` reads counts kept as the rooms change
   (`roomCounts` in `src/engine/tower/rooms.ts`). A read recounts only the
   rooms written since the last read, and counts every room once after the
   rooms list is rebuilt (a build command, a load, a merge that moved the
   units) or the counts are dropped (every host merge). The HUD refresh
   (`uiStatus.update`) reads `stats()` once for the population label and the
   stats grid, where it read `sim.population` as well. The same refresh's
   traffic readout makes its own pass (#338).
3. **AC3 Every write marks its room.** Each write of a field the counts read
   (`state`, `noRate`, `everOccupied`, `residents`, `customersIn`), in the
   engine and in the hosts' frame apply, marks the room; the host merge, which
   rewrites every unit in place, drops the counts. A guard pins the raw
   writes of those fields, so a new one fails until it is marked.
4. **AC4 Hosted.** On the WASM host, the HUD follows the rooms each frame
   rewrites, on the decode path and the direct apply, and a merge of the
   engine's tower gives the HUD the merged rooms: at the same unit count and
   the revision the rooms list was memoized at, and over an hourly merge that
   kept the list.
5. **AC5 Measured.** The HUD read and the rebuild on the perf towers, before
   and after, labeled cloud estimates.

## Design

- **The ledger.** `roomCounts(tower)` keeps, per tower, the counts, each
  room's share of them (a set of condition flags and its population) and the
  set of rooms marked since the last read. A read whose `roomUnits` list is
  the one the ledger was built from takes each marked room's old share out,
  puts its share as its fields stand now back in, and clears the marks. A
  read over a new list, or after `forgetRoomCounts`, counts every room in
  one pass and starts a new ledger. The kind counts move only with the list:
  a room's kind never changes in place, which `roomUnits` relies on as well.
- **The rules are the old ones.** A room's flags are the tests `stats()`
  always made (an office tenanted, empty, empty and off the market; a condo
  sold; a hotel room asleep, dirty), and its population is `censusCount` when
  it is present, as `totalPopulation` sums it. The counts are integers, so
  taking a share out and putting it back is exact.
- **Marks.** Every engine write of a room's `state` goes through
  `setRoomState`, which writes it and marks the room. The other fields are
  written in a few places that call `markRoom` (the rate commands, a venue's
  customers coming and going) or sit in a function whose `setRoomState`
  already marked the room (vacate, move-in, a fire gutting a room). A mark
  is a set insert, made only once the tower has a ledger. The next read takes
  the fields as they stand then, so one mark covers every write before it.
- **Hosts.** The frame apply (`applyUnits`, `syncUnits`) writes every unit's
  state and customers each frame; it marks a unit only when either moved.
  `mergeSimulation` rewrites every held unit with `Object.assign`, so it drops
  the counts, once per merge (an engine hour or a command), and the next read
  counts every room. Since #1325 (issue #1253) the merge also drops the rooms
  list when the revision or a unit's id, kind, floor, x or width moved, which
  starts a new ledger anyway.
- **Costs.** A HUD read with nothing marked is a list identity check and the
  rest of `stats()`'s fields; with marks, constant work per marked room. A
  rebuild is one pass over the rooms, at the command or merge that caused
  it. A mark is one map lookup and one set insert at the write.
- **What keeps it right.** A missed mark would leave a count behind
  silently. Three nets: a seeded run over three conformance fixtures holds
  `stats()` to the walk over every unit after every step and command; cases
  for the rarer engine paths do the same; and a guard
  (`src/tests/roomCountsWriters.guard.test.ts`) pins every raw write of a
  counted field outside the tests to a table naming how it is marked.
- The HUD refresh read `sim.population` for its label and then `stats()`.
  It now reads `stats()` once and takes the population from it;
  `stats().population` equals `sim.population` (a test pins it).

## Out of scope

- The loaded-tower cost #905 also tracks (a deserialized tower's `stats()`
  measured about twice as slow as one built in place) stays open there for
  its gate.
- Moving the HUD strip onto `towerStats` is facade slice 4e. The Rust
  `tower_stats` (`engine-rs/src/panels/stats.rs`, bound as `towerStats` but
  called by no production code yet) walks the rooms twice per call (counts,
  then `population()`); when 4e routes the HUD there, HP-12 asks the same
  flat read of it.
- Other per-frame and per-refresh reads of the rooms on the same path, all
  older than this change: the crowd renderer reads `sim.population` every
  frame, and so does the meal-rush bulletin check (`emitMealRushes`) before
  it knows a meal starts (both #1234); the HUD's traffic readout and the
  renderer rebuild the congestion map (#338); the host's hourly merge reads
  the whole save (#868). The engine's own population reads keep their walk:
  the kept counts serve the HUD only.

## Result

These are cloud estimates from this sandbox (Node 22, 2026-10-27); gate
figures come only from the owner's PC. The harness is a pair of scripts kept
outside the repository: they load each perf tower from
`src/tests/perfCompare/scenarios.ts`, check that `main`'s `stats()` (035231a,
unchanged since d09aa64), the first version's one rooms pass (4973e51) and the
kept counts return the same object, warm up, and take the median of 21
batches.

One HUD refresh's engine reads, milliseconds. Main is `sim.population` and
then `main`'s `stats()`; the first version is its single `stats()`, one pass
over the rooms; the head is the kept counts with nothing marked:

| Tower | Units | Rooms | Main | First version | Head |
| --- | --- | --- | --- | --- | --- |
| `medium` | 12,062 | 1,103 | 0.583 | 0.103 | 0.0005 |
| `large` | 43,358 | 2,900 | 1.980 | 0.213 | 0.0008 |
| `many-unit` | 41,880 | 1,422 | 1.560 | 0.065 | 0.0007 |
| `hotel-heavy` | 10,490 | 876 | 0.490 | 0.070 | 0.0001 |

What the head pays elsewhere, milliseconds: a read after one engine step's
marks (the median of 120 steps, one timed call each), the full recount the
next read makes after a host merge drops the counts, and a rooms list rebuild
with its recount (the read after a build command):

| Tower | Read after a step | Recount after a merge | Rebuild after a command |
| --- | --- | --- | --- |
| `medium` | 0.009 | 0.268 | 0.373 |
| `large` | 0.009 | 0.512 | 1.024 |
| `many-unit` | 0.004 | 0.160 | 0.687 |
| `hotel-heavy` | 0.002 | 0.134 | 0.264 |

The engine step with the marks, against `main`'s step: three copies of each
save stepped in turn for 24 rounds of 40 steps (`main`, the head with the
counts read after every step, the head with them dropped so every mark
misses), and the median of each round's ratio to `main`. Marks per step come
from an instrumented copy:

| Tower | Marks per step, mean (max) | Head kept / main | Head dropped / main |
| --- | --- | --- | --- |
| `medium` | 0.3 (6) | 0.99 | 0.88 |
| `large` | 6 (1,439) | 0.93 | 0.94 |
| `many-unit` | 0.7 (60) | 0.98 | 1.10 |
| `hotel-heavy` | 4.3 (682) | 0.96 | 0.97 |

The step ratios sit within this sandbox's noise on both sides of 1, so the
marks show no step cost here. The largest marked steps are the hourly and
daily passes (checkout, the morning cleaning); the read after one recounts
those rooms only, at most the recount after a merge.

Tests:

- `stats.test.ts` compares `stats()` with the walk over every unit
  (`src/tests/fixtures/walkedStats.ts`, the population summed over every unit
  too, so neither the rooms list nor the kept counts stand behind the
  reference) across four laps of the ten states, each lap with its own pair
  of `noRate` and `everOccupied` flags so every state meets every pairing (a
  sold condo standing empty among them), on a tower holding four of every
  counted kind (the test checks the list covers every kind `stats()` counts)
  and some uncounted ones, marking each room as the engine does. It follows a
  room removed and placed again, and a room swapped for another kind at the
  same unit count with no read in between, where only the revision tells the
  memoized list it is out of date. Two cases pin the ledger itself: an
  unmarked write stays out of the counts until they are dropped, and a mark
  on a structure tile, or before the first count, changes nothing.
- `roomCounts.integration.test.ts` runs three conformance towers
  (`sixseven_2`, `split-tower-4`, `towerone-star4`) for 900 steps of two
  ticks (30 game hours: two evenings, a morning checkout, the hourly
  passes), holding `stats()` to the walk after every step and every command,
  with a fire every 97 steps, a departure and a rate change (the No Rate
  toggle, a reprice or the No Rate batch) every 61, and a sale and a build
  every 113. It checks that the population and the office, condo and hotel
  counts each moved.
- `roomCounts.test.ts` drives the rarer writes once each and holds `stats()`
  to the walk: a vacate, the No Rate toggle, a reprice, the No Rate batch and
  a batch reprice; the morning infestation and the cockroaches' spread; and a
  venue left empty with customers inside opening again for the hour.
- `merge.test.ts` (beside #1325's merge tests) memoizes the host mirror's
  rooms list through `stats()`, merges a tower in which an office became a
  hotel room at the same unit count, with the revision the list was memoized
  at, and checks the HUD equals a fresh load's `stats()` and its population
  equals the mirror's `population`. A second case merges rooms whose states
  moved over a merge that kept the rooms list, and checks the HUD follows.
- `frameApply.test.ts` applies 30 random frames to a hosted tower for each of
  ten seeds, on the decode path and the direct apply, and holds `stats()` to
  the walk after every frame.
- `uiStatus.test.ts` runs one HUD refresh and checks it calls `stats()` once,
  never reads `sim.population`, and labels the population from `stats()`.
- `roomCountsWriters.guard.test.ts` pins every raw write of a counted field
  outside the tests, per file and field, to a table that names how each is
  marked, and tests its own pattern.
- Seeded mutations: 30 at the write sites and the ledger (each
  `setRoomState` swapped back for a raw write, each `markRoom` removed, the
  frame apply's and the sync's marks removed or narrowed to the state, the
  merge's drop removed, the ledger keeping a room's old share or skipping
  the marked rooms). 25 fail a test. The 5 that pass change no count: a
  notice served, rescinded or served for a relocation moves a room between
  occupied and vacating, which count the same (both tenanted and present);
  an extermination moves a hotel room from infested to empty, which count
  the same; and a room's construction starts with the placement, whose
  revision bump makes the next read rebuild the list and count every room.
  The first version's mutations, run again on the kept counts (the
  population counted for absent rooms or off by one, half the offices
  skipped, the list memoized without the revision, the merge without
  `forgetUnitLists`, the label read from `sim.population`, a sold condo
  counted only while tenanted or not empty), each fail a test.

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
- [x] [Review][Patch] `stats()` still made one pass over the rooms per HUD refresh, about 2,900 visits on the large tower and 17,400 a second at 6 Hz, where HP-12 asks for a flat HUD tier (Hot-Path Auditor F2) [stats.ts, rooms.ts, the engine's room writes, the hosts]: asked on 2026-10-27 with the recommendation to accept a deferral; the owner chose the fix ("Sure. Fix makes sense", Naftali, 2026-10-27 11:17:56 UTC, in the independent reviewer's thread). `stats()` reads counts kept as the rooms change (AC2 to AC4, Design); the HUD read is under a microsecond on every perf tower (Result).
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
- F2: fixed after the owner's answer (round 1's item above).
- [x] [Review][Patch] The independent review (R3, CONDITIONAL GO on 4973e51, review 5666150813) found that every flag in the first test moved with the state, so a sold condo never stood empty and a `soldCondos` mutant survived (nit N1) [stats.test.ts]: the test runs four laps of the states, each with its own flag pair, and the mutants that count a sold condo only while tenanted or not empty now fail it.
- Dismissed (10): the population rule copied from `totalPopulation` (Blind Hunter B2, B5 to B7), since `censusCount` holds the rule, floor and lobby tiles have catalog population 0, and the first test pins `stats().population` to `sim.population` every round; units replaced in place without a revision bump (B3), since the Edge Case Hunter found no writer that does so; the subset match (B8), since the fields left out are read straight from the simulation; the read moved to the top of `update` (B10), since nothing before the grid writes unit state; the comment on the old second pass (B11), since `sim.population` was an uncached room walk; the fixture's numbers and basement branch (B12 to B14), which the assertions bound; the serialize path on both sides of the merge test (B15), which the host's own merge also takes; lint (B16), which passes; the version (B17), since the label shows the same number; and the hand list of counted kinds (Acceptance Auditor A6), since a kind `stats()` began to count would need a new field, which the reference would have to name as well.
