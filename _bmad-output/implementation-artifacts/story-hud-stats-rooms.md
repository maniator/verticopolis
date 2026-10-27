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
   rooms list is rebuilt (a build command, a load, a host merge that moved
   the units) or the counts are dropped (the stats report, on open). The HUD refresh
   (`uiStatus.update`) reads `stats()` once for the population label and the
   stats grid, where it read `sim.population` as well. The same refresh's
   traffic readout makes its own pass (#338).
3. **AC3 Every write marks its room.** Each write of a field the counts read
   (`state`, `noRate`, `everOccupied`, `residents`, `customersIn`), in the
   engine and in the hosts' frame apply and merge, marks the room. A guard
   pins the raw writes of those fields per file and field, in every
   assignment form, so a new one fails until its author updates the table
   (the guard cannot see whether the mark is there; the tests check that).
4. **AC4 Hosted.** On the WASM host, the HUD follows the rooms each frame
   rewrites, on the decode path and the direct apply, and a merge of the
   engine's tower gives the HUD the merged rooms: at the same unit count and
   the revision the rooms list was memoized at, and over an hourly merge that
   kept the list, where the merge marks the rooms it changed and keeps the
   counts.
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
  It takes each record's unit by its position in the tower's units, which
  hold the frame's order between merges, and falls back to the id index for
  a record out of place, so the check costs less than the lookup it
  replaces. `mergeSimulation` rewrites every held unit with `Object.assign`
  once per merge (an engine hour pass or a command). Since #1325 (issue
  #1253) it first checks whether the revision or any unit's id, kind, floor,
  x or width moved, and drops the rooms list if so, which starts a new
  ledger. The same check now also compares the five counted fields and,
  when the list stays, marks the rooms whose fields the merge rewrites.
- **Costs.** A HUD read with nothing marked is a list identity check and the
  rest of `stats()`'s fields; with marks, constant work per marked room. A
  rebuild is one pass over the rooms, at the command, load or unit-moving
  merge that caused it. A mark is one map lookup and one set insert at the
  write.
- **What keeps it right.** A missed mark would leave a count behind
  silently. Three nets: a seeded run over three conformance fixtures holds
  `stats()` to the walk over every unit after every step and command; cases
  for the rarer engine paths and for the hosts do the same; and a guard
  (`src/tests/roomCountsWriters.guard.test.ts`) pins every raw write of a
  counted field outside the tests, per file and field and in every
  assignment form, to a table naming where it is marked, and every file that
  rewrites objects wholesale to a table naming how it keeps the counts. The
  guard catches a new raw write; the tests catch a missing mark. The stats
  report drops the counts before it reads, so the dialog always shows a
  fresh pass (one per open).
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
  flat read of it (row `rust-reads-walk-every-unit`, #1237, keeps "the HUD
  getters still grow with the room count per UI tick" open).
- Other per-frame and per-refresh reads of the rooms on the same path, all
  older than this change: the crowd renderer reads `sim.population` every
  frame, and so does the meal-rush bulletin check (`emitMealRushes`) before
  it knows a meal starts (both #1234); the HUD's traffic readout and the
  renderer rebuild the congestion map (#338); the host's hourly merge reads
  the whole save (#868). The engine's own population reads keep their walk:
  the kept counts serve the HUD only.

## Result

These are cloud estimates from this sandbox (Node 22, 2026-10-27); gate
figures come only from the owner's PC. The live HUD figure is the perf
gate's `ui.update` median and p95 (`e2e/perf.spec.ts`, `npm run perf`), and
the engine comparison reports the share of frame time in `ui.update`
(`npm run perf:compare`). The figures below come from scripts kept outside
the repository: they load each perf tower from
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

What the head pays after the rooms change, milliseconds: a read after one
engine step's marks (the median of 120 steps, one timed call each), a full
recount (the read after the counts are dropped, as the stats report does on
open), and a rooms list rebuild with its recount (the read after a build
command or a load):

| Tower | Read after a step | Full recount | Rebuild after a command |
| --- | --- | --- | --- |
| `medium` | 0.009 | 0.268 | 0.373 |
| `large` | 0.009 | 0.512 | 1.024 |
| `many-unit` | 0.004 | 0.160 | 0.687 |
| `hotel-heavy` | 0.002 | 0.134 | 0.264 |

The read after a step is not flat in the tail. On the large tower the
Hot-Path Auditor's 2,160 two-minute steps read at a p95 of 0.020 ms, and the
read after the daily pass that changes about 1,440 rooms costs 0.7 to 1.0 ms
once (single timed reads). With every room marked a read costs about
0.76 ms, a little more than a full recount (0.64 ms on the auditor's run),
since each marked room costs a map lookup and two tallies. The marks dedupe
per room, so a read never does more than that.

The host merge, on the WASM host, lands on every engine hour pass and every
command: at speed 3 a game hour passes every 0.15 s at night and every 0.5 s
on average, against a HUD read every 160 ms or more. The merge marks the
rooms whose counted fields it rewrites, so the read after it costs what the
read after that hour's pass would. Merging an hour's states in and out of
each tower at the held revision (28 merges, the median after 4), with the
counts read alone:

| Tower | Rooms changed per merge | Merge, head / main | Read after the merge | Full recount |
| --- | --- | --- | --- | --- |
| `medium` | 0 | 0.98 | 0.011 | 0.289 |
| `large` | 2 | 1.03 | 0.026 | 0.547 |
| `many-unit` | 60 | 1.03 | 0.069 | 0.233 |
| `hotel-heavy` | 682 | 1.06 | 0.104 | 0.165 |

The merge's TypeScript side (`mergeSimulation` alone, 15 to 95 ms here) is
within noise of `main`'s, so the five field compares it adds per unit do
not show next to the copy of every field it already makes.

The frame apply's change check, with each record's unit taken by position,
against `main`'s apply of the same unchanged frame (the Hot-Path Auditor's
harness, 40 rounds; the owner's save is `split-tower-4`):

| Tower | Direct apply, head / main | Decode path, head / main |
| --- | --- | --- |
| `medium` | 0.88 | 0.94 |
| `large` | 0.58 | 0.44 |
| `split-tower-4` | 0.89 | 0.69 |

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

The step ratios spread from 0.88 to 1.10 on both sides of 1, which is this
sandbox's noise, so this harness cannot resolve a mark's cost. The Hot-Path
Auditor measured a mark at 26 to 53 ns: a mean step pays well under a
microsecond, and the largest marked step about 76 microseconds, inside an
hourly pass that already visits those rooms.

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
  (`sixseven_2`, `split-tower-4`, `towerone-star4`) for 900 steps of one
  `tick(2)` each (two game minutes, so 30 game hours: one evening, a morning
  checkout, the hourly passes), holding `stats()` to the walk after every
  step and every command. Every 97th step starts a fire. Every 61st vacates
  an office, then sets No Rate on it or reprices it, then applies the batch
  to the offices or the condos, which alternates No Rate and the default
  rate for each kind. Every 113th sells a room and builds it again. It
  checks that the population and every condition count moved between reads,
  leaving out the reads after a sale or a build, which rebuild the list. It
  is TypeScript-only on the parity projects, since no command relays
  `sim.vacate`.
- `roomCounts.test.ts` drives the rarer writes once each and holds `stats()`
  to the walk: a vacate, the No Rate toggle, a reprice, the No Rate batch and
  a batch reprice; the morning infestation and the cockroaches' spread; and a
  venue left empty with customers inside opening again for the hour.
- `merge.test.ts` (beside #1325's merge tests) memoizes the host mirror's
  rooms list through `stats()`, merges a tower in which an office became a
  hotel room at the same unit count, with the revision the list was memoized
  at, and checks the HUD equals a fresh load's `stats()` and its population
  equals the mirror's `population`. A second case merges rooms whose states
  moved over a merge that kept the rooms list, and checks the HUD follows. A
  third changes every counted field over such a merge (an office occupied,
  another empty and off the market, a condo sold with residents, a venue's
  customers taken away by a save that does not carry them), and checks the
  ledger is the same object afterwards, the HUD equals a fresh load's, and a
  later mark still lands.
- `frameApply.test.ts` applies 30 random frames, for each of twelve seeds, to
  a tower standing in for the host's mirror (a plain `Simulation`, no host
  attached), on the decode path and the direct apply. The unit records come
  out of the mirror's order, in it, or in it but for one swapped pair of
  rooms; the test checks each record lands on its own unit and holds
  `stats()` to the walk after every frame.
- `uiStatus.test.ts` runs one HUD refresh and checks it calls `stats()` once,
  never reads `sim.population` or the tower's census, and labels the
  population from `stats()`.
- `roomCountsWriters.guard.test.ts` pins every raw write of a counted field
  outside the tests, per file and field, in every assignment form, prefix
  and postfix step, `delete` and quoted key, to a table naming where each is
  marked. Writes through a person's or a class's own name (`p`, `person`,
  `this`) are pinned in a table of their own. Every file with a wholesale
  write (`Object.assign`, `Reflect.set`, a `delete` through a cast or a
  computed key) is listed, and the unit writer among them, the merge, must
  call `markRoom`. It tests its own patterns on each form and on reads.
- Seeded mutations, run against the behavioral tests above (the guard left
  out) on the final code: 39 at the write sites, the hosts and the ledger.
  - 18 `setRoomState` calls swapped back for a raw `state` write: 13 fail a
    test. The 5 that pass change no count: a notice served, rescinded or
    served for a relocation moves a room between occupied and vacating,
    which count the same (both tenanted and present); an extermination moves
    a hotel room from infested to empty, which count the same; and a room's
    construction starts with the placement, whose revision bump makes the
    next read rebuild the list and count every room. The guard fails all 18,
    since each adds a raw `state` write to a file whose table row has none.
  - 7 `markRoom` calls removed: 6 fail a test. The seventh is the
    attendance venue's in `beginDwell` (`visits.ts`), whose customers no
    count reads (cinema, party hall and wedding hall have catalog population
    0 and are not a counted kind).
  - 5 on the frame apply: either path's mark removed, the direct path's
    check narrowed to the state, and either path's position lookup made to
    ignore the record's id. All fail a test.
  - 7 on the merge: its marks removed, the marks replaced by a drop of the
    counts, and each of the five counted fields left out of its compare. All
    fail a test (the No Rate one only once the merge test changed each field
    on its own; it survived the first run, when the test moved the state with
    it). The guard also fails the first, which leaves the merge without a
    `markRoom` call.
  - 2 in the ledger (a room's old share kept, the marked rooms skipped):
    both fail.
  - The first version's 8 mutations, run again on the final code (the
    population counted for absent rooms or off by one, half the offices
    skipped, the list memoized without the revision, the merge's
    `forgetUnitLists` made a no-op, the label read from `sim.population`, a
    sold condo counted only while tenanted or not empty), each fail a test.

## Review

`/gds-code-review` round 1 on 1b2757a against `main` d09aa64 (the branch was
rebuilt on `main` 035231a after #1325 merged; see the first item): Blind Hunter,
Edge Case Hunter, Acceptance Auditor and Hot-Path Auditor. No layer found a
wrong count on a path the tests reached. The Edge Case Hunter found the merge
path that could serve the HUD a stale rooms list, and the Hot-Path Auditor
found a second rooms pass at the HUD's entry point (F1) and that the one
pass left still grows with the rooms (F2).

- [x] [Review][Patch] The host's merge keeps the unit array and sets the engine's revision, which can equal the one the rooms list was memoized at (at attach the read model and the engine count their bumps separately), so a merged tower could serve the HUD a stale list; an id that named another kind on the engine side would change a held unit's kind in place (Edge Case Hunter E3; Blind Hunter M3) [merge.ts, rooms.ts]: round 1 added a `forgetRooms` drop to the merge. #1325 (issue #1253) then landed `forgetUnitLists` on `main`, which drops the list whenever the revision or a unit's id, kind, floor, x or width moved, so the rebuilt branch carried no merge code (until the F2 fix, whose merge marks are round 3's) and keeps the HUD-level merge test, which fails without that drop. Design said the change opened no new staleness path, which held for the population only; the kept counts' Design names the one new path, a missed mark, and the nets that catch it.
- [x] [Review][Patch] The HUD refresh read `sim.population` and then `stats()`, two rooms passes for one population, so AC2's one pass did not hold at the entry point (Hot-Path Auditor F1) [uiStatus.ts, story]: the refresh reads `stats()` once and takes the population from it.
- [x] [Review][Patch] Both tests changed the unit count at every step, and the merge test added units and passed a revision of its own, so neither showed the revision key or the merge's drop doing anything (Blind Hunter M1, M2; Edge Case Hunter E1, E2) [stats.test.ts, merge.test.ts]: each test swaps an office for a hotel room at the same unit count with no read in between, and the merge test passes the held revision.
- [x] [Review][Patch] The counted kinds were a hand list whose presence the test checked with its own filter (Blind Hunter L6) [stats.test.ts]: the test checks that every kind `stats()` counts is in the list, and counts four of each through `roomUnits`.
- [x] [Review][Patch] The fixture's comment said three basements where it builds four levels, and its wrap jumped from floor 11 to a basement (Blind Hunter L7) [stats.test.ts]: the comment is corrected, the fixture asserts it stays on the upper floors, and a kind they refuse goes below on its own cursor.
- [x] [Review][Patch] AC5 named no date, commit or method, and the mutation list had no memo that ignores the revision (Blind Hunter L9, L10; Acceptance Auditor) [story]: Result names the date, the commits and the method, and the two new mutations each fail a test.
- [x] [Review][Patch] `stats()` still made one pass over the rooms per HUD refresh, about 2,900 visits on the large tower and 17,400 a second at 6 Hz, where HP-12 asks for a flat HUD tier (Hot-Path Auditor F2) [stats.ts, rooms.ts, the engine's room writes, the hosts]: asked on 2026-10-27 with the recommendation to accept a deferral; the owner chose the fix ("Sure. Fix makes sense", Naftali, 2026-10-27 11:17:56 UTC, in the independent reviewer's thread). `stats()` reads counts kept as the rooms change (AC2 to AC4, Design); the HUD read is under a microsecond on every perf tower (Result).
- [x] [Review][Defer] The other caches keyed on an object the merge keeps and on the tower's revision (`segmentsOf` and the staff ceiling on the tower, the reach verdicts on the simulation) read a merged tower the same way, and the merge can hand back a revision they were memoized at (Edge Case Hunter E3, beyond this change) [merge.ts]: deferred onto #1296 (row `merge-repeats-revision-memos`), which already tracked those caches, with its remedy: the merge's drop on a moved revision or moved units (#1325) takes those caches too, with the transports in the check for the reach verdicts. (First filed as #1331, which round 3 found repeated #1296; it is closed as a duplicate.)
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

### Round 3

`/gds-code-review` round 3 on ae28bd0 (the F2 fix on 3803889, merged with
`main` c0787c1) against `main` c0787c1: Blind Hunter, Edge Case Hunter,
Acceptance Auditor and Hot-Path Auditor, the first round over the kept
counts. The outside reviewers were down (Codex at its usage limit, no
Copilot), so the skill loop stands in for them. The Edge Case Hunter's
stress run (2,500 steps with commands, twelve seeded runs) found no read that
differed from the walk over every unit. The Hot-Path Auditor confirmed the
flat read between passes, measured a mark at 26 to 53 ns, found that marks
matched the rooms really changed over three game days, and found two costs
on the hosts. Its record is on the PR.

- [x] [Review][Patch] The frame apply's change check added two reads and compares per unit record inside the per-step and per-frame walk, +7% to +50% of the apply (Hot-Path Auditor F1) [frameApply.ts, frameSync.ts]: each record's unit comes by position when its id matches and from the id index otherwise, which leaves the apply cheaper than `main`'s (Result); the test sends records in the mirror's order, out of it, and in it but for one swapped pair of rooms, and checks each lands on its own unit.
- [x] [Review][Patch] Every host merge dropped the counts, so the next HUD read counted every room again, with an allocation per room, once per engine hour pass and command (Hot-Path Auditor F2; Blind Hunter B15) [merge.ts]: the merge's moved check also compares the five counted fields and marks the rooms that differ, and drops nothing while the list stays; a new test checks the ledger is the same object after the merge and follows each counted field.
- [x] [Review][Patch] The HP-8 table had no row for the ledger (Hot-Path Auditor F3) [hot-path-review.md]: added.
- [x] [Review][Patch] The guard missed prefix steps, logical and compound assignments, `delete`, quoted keys and wholesale writes, and exempted any receiver named `p` or `person` (Blind Hunter B2; Edge Case Hunter 1 to 3; Acceptance Auditor A4) [roomCountsWriters.guard.test.ts]: it sees every assignment form, pins the writes through those names in their own table, and lists every file with a wholesale write, requiring the unit writer among them (the merge) to call `markRoom`; its self-test covers each form and the reads it must pass over.
- [x] [Review][Patch] AC3, the guard's comment and the #905 row said the guard makes a new write fail until it is marked, where it only pins the raw writes (Blind Hunter B3; Acceptance Auditor A4) [story, guard, backlog.md]: each says the guard pins the writes and the tests check the marks.
- [x] [Review][Patch] The mutation tally ran without the guard and did not say so, counted a mark that cannot change a count, and did not add up (Blind Hunter B6; Acceptance Auditor A3) [story]: Result reruns every mutant on the final behavioral tests, lists them by site, and says which the guard also fails.
- [x] [Review][Patch] Result's headline used the read with nothing marked, hid the tail, said a read after many marks costs at most a recount, and read step ratios within noise as no cost (Blind Hunter B7; Hot-Path Auditor F2) [story, backlog.md]: Result gives the tail, the read with every room marked, a mark's measured cost and how often a merge lands.
- [x] [Review][Patch] The stats dialog read the kept counts, so a field written without a mark (the screenshot scene that stages vacancies) would not show there (Blind Hunter B8; Acceptance Auditor A12) [tsPanels.ts, guard]: the report drops the counts and counts afresh on open; the guard's comment names the tooling writes it does not scan.
- [x] [Review][Patch] Comments: `star.ts` still described a pass over the rooms (Blind Hunter B9; Acceptance Auditor A5), `roomCounts` did not say its object changes with later reads (B10) or that the kind invariant leans on the merge's drop (B11), and the guard's `coerce.ts` row named the load where the writes are the save writer's (A6) [star.ts, rooms.ts, guard]: each is corrected, and the population rule is one helper, `populationOf` (B16).
- [x] [Review][Patch] The seeded run would fail `integrationWasm`: it vacates through `sim.vacate`, which no command relays (Acceptance Auditor A2) [roomCounts.integration.test.ts, exclusions.ratchet.txt, story-engine-test-parity.md]: marked TypeScript-only with that reason, with the ratchet line and a row in the parity story's table; `integrationWasm` reports it skipped, and the merge and frame tests pass on `unitWasm`.
- [x] [Review][Patch] The seeded run left each kind off the market for good after the first batch, and counted moves that came from the list rebuilds after a sale or build (Blind Hunter B14; Acceptance Auditor A7) [roomCounts.integration.test.ts]: the batch alternates No Rate and the default rate per kind, and the reads after a sale or build no longer count as moves (`offices`, which only a rebuild moves, left the check).
- [x] [Review][Patch] The HUD test watched only the `population` getter (Blind Hunter B12) [uiStatus.test.ts]: it also watches the tower's census.
- [x] [Review][Patch] #1331 repeated the open #1296 (Acceptance Auditor A1) [backlog.md]: the row is dropped, its extra detail is on #1296's row and issue, #1331 is closed as a duplicate, and round 1's defer item points at #1296.
- [x] [Review][Patch] Inexact test descriptions, stale review and backlog text, no pointer to a live number, and no row cited for the Rust `tower_stats` pass (Acceptance Auditor A8 to A11) [story, backlog.md]: each is corrected.
- [x] [Review][Defer] The crowd renderer and the meal-rush check walk the rooms every frame for the population the ledger now holds (Hot-Path Auditor F4) [towerCrowd.ts, frameLoop.ts]: deferred onto #1234 by reference, with the ledger named in its remedy (row note and issue comment).
- [x] [Review][Defer] Engine functions this diff touched walk every unit where the rooms list answers: the 08:00 checkout hour's up to five passes, the late checkout, condo relocations, the rent batch and three fire walks (Hot-Path Auditor F5) [EconomySystem.ts, housekeeping.ts, churn.ts, rent.ts, EventSystem.ts]: deferred onto #1170 (row note and issue comment); the housekeeping walks were already its T5, now widened to the hour, and the extermination walk is #1173 F1.
- Dismissed (7): a periodic full recount as a safety net (Blind Hunter B1), since the guard, the tests, the mutation pass and the stress run are the nets and a recount would hide drift from them; a mark consumed by a listener between a `setRoomState` and a later counted write in the same function (B4), since the Edge Case Hunter found `emit` synchronous with no listener that reads the counts; inputs beyond the five fields (B5), since `censusCount`, `isPresent` and `isTenanted` read none of the others and the mutant that marks only on a state change fails the frame test; the smoke check and the reference predicate (B13), which the walk over every unit backs; the mark set's references to removed units (B17), since the Hot-Path Auditor found no leak (a removal rebuilds the list and replaces the ledger at the next read); the palette key the HUD test copies (B12's second half), a test-only coupling whose assertions hold either way; and the guard's blindness to generic copiers (Hot-Path Auditor's HP-10 note), now covered by the bulk-writer table.
