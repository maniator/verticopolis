# Story facade.4: Panels and queries go through the port

Status: in-progress

Slice 4 of the Rust-backed facade
(`_bmad-output/planning-artifacts/architecture/architecture-rust-facade-2026-10-20/slice-plan.md`),
under spine AD-9 (owner direction 2026-10-20 20:45 UTC, signed off 21:40 UTC).
Issue #1211, under the facade tracker #1207. Built on slice 1 (#1245, merged
to `main` at ee5ae06) and on slice 2's `app.port` line (#1209, PR #1290, its
commit c370c2b, the same commit in both branches, so slice 2's merge carries
it). Relates to #868 and #954 by reference only: no closing keyword.

## Story

As the developer moving the web game onto Rust authority,
I want every panel (the stats screen, the inspector and editor cards, the
build preview, the diagnostics readout, the onboarding checklist and the HUD's
tower-stats strip and traffic chip) to ask the port for its data in the shape
the Rust panel getters answer, with `TsSim` answering from today's TypeScript
functions,
so that slice 7's `RustSim` can answer the same questions from the engine
with no panel change, the panels never run TypeScript gameplay functions on
the healthy WASM path, and the fallback shows the same numbers the engine
does.

## Planning, risk and testing review (done before the first edit)

**Inputs read:** #1211 and its forward requirements (no per-frame query; one
query per action; read `view.header` once per refresh), the slice plan, the
parallel map's file ownership, the #1184 architecture docs (5.1 to 5.4, the
consumer inventory's 1Q table, HP-8 and HP-12), slice 1's story and code
(`SimPort`, `TsSim`, the reach guard), 6b's story, getters and held binding
patch (#1228 at 6073d2a; shapes confirmed final by the 6b thread
2026-10-21 01:59 UTC), 6d's `placeTransportDryRun`, `validateTransport` and
`previewRentBatch` exports (#1244), and the coordinator's #1237 gate.

**Agreed boundaries (2026-10-21, 01:58 to 02:00 UTC):**

- Slice 2 (thread "Facade commands") moves every command and owns
  `commands.ts` and `TsSim`'s `COMMANDS`; this slice moves every query and
  owns `queries.ts`, `TsSim`'s `QUERIES` and `CACHE_CAPS`, and the new
  `src/simport/panels.ts`, `tsPanels.ts`, `headerClock.ts`, `latest.ts`. In
  slice 2's files this slice touches only the query reads slice 2 left as
  direct reads, and only after slice 2 merges: `onActionMove`'s shaft dry run
  (`engineWiring.ts`), `refreshCursorPreview`'s dry run (`keyboardPlay.ts`),
  `transportReason`'s `validateTransport` and `isUnlocked`
  (`buildActions.ts`), and in `editorActions.ts` `previewRentBatch`,
  `elevatorHourlyLoad`, `elevatorOriginLoad`, `lobbyFloors`, `stopsAt` and
  `floorHasLobby`. Latest-wins build-preview quotes are this slice's.
- The facade lane (owner of `view.ts`) approved two header fields,
  `mode` and `modernCalendar`, added in this slice's first PR with one
  contract assertion in this slice's own fixture.
- 6b (thread "Facade panel getters"): the result types here are its getters'
  JSON; when its wrapper commit lands, its differential's TypeScript side
  imports `tsPanels.ts` instead of the test-only `panelReference.ts`, and
  `GATE_IDS` goes for the star gates' new `id`. Whoever merges second makes
  that switch. (#1228 merged at b80bc03 with the getters only; the wrappers,
  the differential and `panelReference.ts` wait in 6b's held patch, so the
  switch falls to that commit, after 4a.)
- 6c (thread "Facade diagnostics facts"): asked for its facts shape; the
  diagnostics PR waits for it.
- Independent review gate (coordinator, 01:55 UTC): no per-UI-tick caller of
  `towerStats` or `peakCongestionHotspot` until #1237's floor-bounds memo and
  parking-seed fix are on `main`. Those callers land last.

**Risks and how the slice meets them:**

| Risk | Mitigation |
| --- | --- |
| A panel shows a TypeScript-derived value that differs from the engine's | Each answer's type is the Rust getter's JSON; `tsPanels.ts` is the one TypeScript definition. 6b's differential compares the Rust getters with a TypeScript reference on the 24-scenario conformance corpus (606 checkpoints) and moves onto `tsPanels.ts` when its held wrapper commit lands; until then a scratch run pins `tsPanels.ts` equal to that reference on the 8 conformance saves |
| Async answers land out of order or after the selection changed (a worker resolves later) | `latest.ts`: each panel keeps a token; an answer overtaken by a newer ask is dropped. On `TsSim` and a main-thread `RustSim` the answer lands in a microtask of the same task, so nothing paints between the ask and the render |
| A rejected query becomes an unhandled rejection where a throw used to reach a guard | Modal and card refreshes surface the failure the way a click handler's throw did (the analytics error tracking sees `unhandledrejection`); per-tick refreshes (4e) route it to the frame guard's error log |
| Per-tick panel queries cost more on the engine than the TypeScript did | No per-frame query; per-UI-tick queries only where the panel refreshes per UI tick today; `towerStats` and `peakCongestionHotspot` callers wait for #1237; `transportDetail` per tick is measured before 4b ships |
| The view lacks what panels read off the `Simulation` (date, mode rules) | `headerClock.ts` derives the clock and rules from the header's `mode`, `modernCalendar` and `minutes` (pure, static) |
| `main.ts` sits at 500 of 500 lines (499 before slice 1's merge of `main`) | Panel refresh bodies move to `src/game/` modules; `main.ts` lines only shrink |
| Templates lose test coverage when their signature changes | Tests build answers through a real `TsSim` (`createTsSim(() => sim)`), so they exercise the port's own answers |

## Acceptance Criteria

1. **Query members.** `src/simport/queries.ts` gains one member per panel
   getter, each answering the Rust getter's JSON shape, typed in
   `src/simport/panels.ts` (explicit interfaces, `null` for an absent
   TypeScript field, heat-cell `tint` omitted when absent):
   `towerStats`, `statsReport`, `housekeepingCoverage`, `unitDetail { id }`
   (`null` for an unknown id), `transportDetail { id }` (`null` for an
   unknown id), `floorHeatmap { mode }`, `peakCongestionHotspot`,
   `onboardingFacts`; later PRs add `placeTransportDryRun`,
   `validateTransport`, `previewRentBatch` (6d's exports) and
   `diagnosticFacts { id }` (6c). `queryKey` covers every member; `cached`
   keeps a bounded number of answers per op.
2. **One TypeScript definition.** `src/simport/tsPanels.ts` builds each
   answer from today's TypeScript functions, field for field as 6b's
   reference does, and `TsSim` answers from it. A type test pins each
   TypeScript function's output assignable to its result type; a unit test
   pins each answer JSON-clean (`JSON.parse(JSON.stringify(a))` deep-equals
   `a`, so `RustSim`'s parsed answer has the same shape).
3. **Ids for the copy.** Star gates and milestones answer stable ids with a
   met or done flag. TypeScript `star.ts`'s `StarRequirement` gains `id`
   (additive; no save, hash or conformance change); the stats screen keys
   gate copy by id from a UI table, and a drift test pins that table to the
   engine's labels. Milestone copy comes from the static `MILESTONES` table by
   id.
4. **The header.** `HeaderView` gains `mode` and `modernCalendar`, fixed at
   founding and stored as the save stores them; `TsSim` fills them; this
   slice's fixture asserts they match the tower's. `headerClock.ts` derives
   the panel clock and the rule set from the header, so no panel reads
   `sim.clock` or `sim.rules`.
5. **Consumers on the port, in this order of PRs:**
   - **4a** the stats screen (`statsReport` on open and after an
     exterminator booking) and the exterminator gate and confirm
     (`housekeepingCoverage`); `statsTemplate` and its sections become pure
     functions of the answer, the header and the catalog.
   - **4b** the inspector and editor cards (`unitDetail`, `transportDetail`)
     and the elevator editor's reads; the diagnostics block stays on the
     TypeScript functions until 4d.
   - **4c** the build preview: `canBuild` and the shaft dry run per pointer
     move with latest-wins quotes, `isUnlocked` in the preview and the build
     actions, `validateTransport`, and the batch-pricing preview.
   - **4d** the diagnostics readout over 6c's facts (`gripeCopy`,
     `facilityDiagnostics`, `housekeepingDiagnostics` keep only the wording),
     removing `facilityDiagnostics.ts` from the reach ratchet.
   - **4e** the per-UI-tick HUD callers: the tower-stats strip
     (`towerStats`), the palette lock scan (`isUnlocked`), the traffic chip
     (`peakCongestionHotspot`) and the onboarding checklist
     (`onboardingFacts`), after #1237 is on `main`.
6. **No player-visible change.** Every panel shows the same text, colors and
   rows as before on both of today's hosts; existing panel tests keep their
   assertions (rewritten to build answers through `TsSim`), and the relevant
   e2e specs pass. No version bump (internal only).
7. **Hot-path record.** Each PR carries a proportional HP-1 to HP-12 record:
   no query per frame (HP-12), one query per action or pointer move, the
   header read once per refresh, answer caches bounded (HP-3), and the
   measured cost of any query a panel asks per UI tick.
8. **Tests.** Unit tests for every query and answer (classic and modern
   towers, an infested hotel, a stranded floor, a cinema, an elevator with
   telemetry, unknown ids); the port suite run under the `unitWasm` parity
   project (`npm run test:wasm:parity`) so `TsSim` answers on today's WASM
   host; 6b's differential repointed at `tsPanels.ts` so the Rust getters are
   compared with the answers the panels read.
9. **Gates and review.** `npm run typecheck`, `npm run lint`, `npm test`,
   `npm run build` green; coverage ratchet holds; files under 500 lines;
   `/gds-code-review` (panels decide what the player sees of gameplay data,
   and 4a touches `star.ts`) plus `/bmad-code-review` for the port plumbing;
   every `patch` fixed, every `defer` in the backlog with its issue; the
   independent review through the coordinator on the exact head; merge
   commit only on a GO and green CI, no auto-merge.

## Tasks / Subtasks

- [x] 4a (AC 1 to 4, 5a, 6 to 9)
  - [x] `panels.ts` types; `queries.ts` members and keys
  - [x] `tsPanels.ts`; `TsSim` `QUERIES` and `CACHE_CAPS`
  - [x] `star.ts` gate ids; the UI gate table and its drift test
  - [x] header `mode` and `modernCalendar`; `headerClock.ts`
  - [x] `latest.ts`
  - [x] the stats screen and exterminator modal on the port
  - [x] tests, gates, parity run
  - [x] review: `/gds-code-review` round 1, `/bmad-code-review` rounds 2
        and 3 (round 3 the confirming pass), four layers each, findings below
  - [ ] draft PR with the hot-path record, independent review
  - [ ] 6b's held wrapper commit points its differential at `tsPanels.ts`
        (6b's lane, after 4a merges; 4a's scratch run already shows the two
        TypeScript sides equal)
- [ ] 4b inspector and editor cards (after slice 2 merges, for `editorActions.ts`)
  - [ ] Hot path (carried from 4a's review, F4): `tsTransportDetail` copies
        the origin rings (48 slots, up to about 5,280 pairs), builds a stop
        row per spanned floor (each `stopsAt` scans `skipFloors`) and a lobby
        floor set. Ask on selection, revision or hour change, never per UI
        tick; measure before wiring. Both lookups already have caches (round
        3, HP-8): read the served stops from `tower.stopsOf(t)` (the
        revision-keyed `stopsCache`) and lobby membership from
        `tower.floorHasLobby(fl)` (the `lobbyTiles` counter); recomputing
        them per floor bypasses both, an always-`patch` once reachable.
- [ ] 4c build preview and unlocks
- [ ] 4d diagnostics facts (after 6c's shape)
- [ ] 4e per-tick HUD callers (after #1237)
  - [ ] Hot path (carried from 4a's review, F3): `tsOnboardingFacts` walks
        every unit with no early exit. Keep `Onboarding.tick`'s inactive guard
        ahead of the query, walk `roomUnits` for the office facts, and stop
        once all five are true. The lobby and floor facts read structure
        tiles, which `roomUnits` skips: keep them in a memo keyed on
        `tower.revision` (they depend on structure only), and keep `play`,
        which reads unit state, out of that memo.
  - [ ] Hot path (carried from 4a's round 3, P3): the HUD strip's
        `sim.stats()` walks every unit per UI tick (about 46k visits, #905).
        Moving it onto `towerStats` would make that new code with a whole-unit
        walk per UI tick, an always-`patch`. The remedy is to walk `roomUnits`
        (every kind it counts is a room kind, so the counts are identical)
        and take the population in the same pass, never caching it by
        revision alone, which leaves out tenancy, sales, hotel states and
        money. The Rust bare-step lane owns that change to
        `src/engine/sim/stats.ts` under #1051 (agreed 2026-10-21, after a
        hosted profile put `stats()` at 54% of the WASM HUD samples); 4e
        builds on its PR and does not edit the function itself.

### Review Findings (4a, round 1: `/gds-code-review`, four layers)

- [x] [Review][Patch] Fire-and-forget `showStats` and `confirmExterminate`
      left a failed answer silent: the stats screen and the exterminator now
      say so in a toast and still reject, so error tracking sees the failure
      where the old synchronous throw reached it [src/game/appModals.ts]
- [x] [Review][Patch] An answer about a tower swapped out while it was in
      flight is dropped; a second exterminator click while the coverage
      answer is out opens no second confirm [src/game/appModals.ts]
- [x] [Review][Patch] `latest` forwarded the rejection of a question a newer
      one replaced [src/simport/latest.ts]
- [x] [Review][Patch] The JSON-clean checks used `toEqual`, which passes an
      undefined field and a class instance; now `toStrictEqual`, plus each
      answer's key list as the Rust getter writes it
      [src/simport/panelQueries.fixture.ts, src/simport/tsPanels.test.ts]
- [x] [Review][Patch] The contract fixture's gate-id loop never ran and its
      stop-list check assumed every transport is an elevator: the fixture now
      builds a stair link, checks it answers no stops, and pins a one-star
      tower's next rung to no gates [src/simport/panelQueries.fixture.ts]
- [x] [Review][Patch] The "stranded floor" was an unconnected one: the
      Classic fixture now strands floor 8 six flights up a stair chain and
      asserts `strandedFloors` is `[8]`; also asserts the infested room, the
      TOWER rung's null threshold, the stairs' empty stop list, and a heat
      cell carrying its tint [src/simport/tsPanels.test.ts]
- [x] [Review][Patch] The AC 2 type test was missing
      [src/simport/panels.types.test.ts]
- [x] [Review][Patch] The minute-zero test read back its own assignment, and
      the clock test ticked about 1.9 million times; it now moves the clock
      to chosen minutes and checks midnight's readings
      [src/simport/headerClock.test.ts]
- [x] [Review][Patch] Hot path F1: `households` walked every unit; it walks
      `roomUnits`, as the Rust getter does [src/simport/tsPanels.ts]
- [x] [Review][Patch] An unknown star gate id drew a blank line; it falls
      back to the id, as milestones do [src/ui/templates/stats.ts]
- [x] [Review][Patch] The heat-map cache cap was a hard-coded 4; the
      `HeatmapMode` union bounds it [src/simport/tsSim.ts]
- [x] [Review][Patch] Docs: `port.ts`'s `cached` note, `tsSim.ts`'s "no
      runtime edge" note, the `showStats` contract, the drift test's
      heading; the strict fake port in `appModals.test.ts`
- [x] [Review][Defer] Hot path F2: the stats report's helpers walk every unit
      10 to 14 times per open (pre-existing; 4a lowers the Modern cost).
      Mostly tracked (#539, #905, #1173, #1237); the three unlisted walks are
      row `stats-report-unit-walks`, #1262 (deferred, pre-existing)
- [x] [Review][Defer] On an async host an answer can reopen a closed dialog or
      displace a protected one (not reachable on `TsSim` or main-thread
      `RustSim`): row `panel-answer-async-dialog`, #1263, deferred to the
      worker host (slice 12)

### Review Findings (4a, round 2: `/bmad-code-review`, four layers)

- [x] [Review][Patch] The exterminator's in-flight guard was per app, so an
      ask that never settled held the button for the session, loads included;
      it is per tower now [src/game/appModals.ts]
- [x] [Review][Patch] The exterminator failure test leaned on a global
      `unhandledRejection` listener; `confirmExterminate` is exported and the
      test awaits its rejection [src/game/appModalsStats.test.ts]
- [x] [Review][Patch] `showStats` and the test fixture each put the screen
      together; both use `statsScreen` now, and a test pins what `showStats`
      hands the template [src/ui/templates/stats.ts, src/game/appModals.ts]
- [x] [Review][Patch] The adapter-neutral fixture pinned `TsSim`'s card bound
      of 16; the bounds moved to a `TsSim` test, and the fixture checks an
      overlay is painted and treats every non-elevator shaft as stop-less
      [src/simport/panelQueries.fixture.ts, src/simport/panelQueries.test.ts]
- [x] [Review][Patch] Onboarding facts checked off the usual order (a
      basement story, an unconnected tenant), and the header clock checked on
      every conformance save [src/simport/tsPanels.test.ts,
      src/simport/headerClock.test.ts]
- [x] [Review][Patch] Docs: the differential is still in 6b's held commit
      (comments said it ran), the module doc of `appModals.ts`, the toast
      also covers a failed draw, a stale `BFS-bearing` note, three
      "X, not Y" phrasings, and the story's ticks and removal notes
- [x] [Review][Defer] Hot path F5: the stats report repeats the recycling
      count and the population walk inside one open (pre-existing, per
      command): added to row `stats-report-unit-walks`, #1262
- [x] [Review][Defer] On an async host the header and tower name are read at
      draw time, a few steps newer than the report: added to row
      `panel-answer-async-dialog`, #1263

### Review Findings (4a, round 3: `/bmad-code-review`, the confirming pass, four layers)

- [x] [Review][Patch] `showStats` asked the port before its failure handler
      was attached, so a port that throws as it is asked skipped the toast;
      it is `async` now [src/game/appModals.ts]
- [x] [Review][Patch] A load while the exterminator confirm was open booked
      the new tower at the old tower's quote; the confirm drops a click for a
      tower since replaced [src/game/appModals.ts]
- [x] [Review][Patch] A gate id naming an `Object` prototype member (say
      `constructor`) drew native code; the label lookup reads own keys only
      [src/ui/templates/stats.ts]
- [x] [Review][Patch] The fake port answered about the tower it was built
      with; it answers about `app.sim`, and the swap test checks the new
      tower's quote [src/game/appModals.fixture.ts]
- [x] [Review][Patch] Tests: the "older answer lands first" case landed the
      newer one first, and a replaced question's quiet failure, a draw
      failure, a port that throws, an unknown milestone, every rung's gates
      met and unmet, nested answer keys, fresh objects per call, the basement
      placement and midnight's readings were unpinned
      [src/simport/latest.test.ts, src/game/appModalsStats.test.ts,
      src/ui/templates/stats.test.ts, src/simport/tsPanels.test.ts,
      src/simport/headerClock.test.ts]
- [x] [Review][Patch] The panel contract found the starter lobby through
      `units`; it reads `structureKindAt`, as slice 1's contract does after
      its review, and cards only rooms [src/simport/panelQueries.fixture.ts]
- [x] [Review][Patch] Docs: `port.ts`'s `cached` note (per tower, possibly
      stale, bounded per question, the card bounds owned here, as slice 1
      asked), `latest.ts`'s microtask claim, stale comments in `stats.ts`,
      `stats.fixture.ts`, `src/engine/sim/stats.ts` and the test helper, and
      this story's records
- [x] [Review][Defer] Hot path P1: the hourly star ladder walks every unit
      once per gate (pre-existing, unchanged by 4a beyond an `id` per gate):
      by reference to #539 item 2 and #1158 A11
- [x] [Review][Defer] Hot path P3: `stats()` walks every unit where
      `roomUnits` gives the same counts, and #905's revision-cache remedy
      would leave out state inputs (pre-existing): added to #905's row and
      issue, and carried to 4e as a task

## Dev Notes

### Shapes (6b's getters, confirmed final at 6073d2a)

- `towerStats`: `sim.stats()`.
- `statsReport`: `{ stats, ratingPopulation, hotelsCountTowardRating,
  functionalParking, parkingDemand { officePop, offices, suites, total },
  housekeeping (coverage), housekeepingReport ({ cleaned, leftover } or
  null), recycling { capacity, demandMet }, strandedFloors (number[]),
  nextStarThreshold (number or null), nextStar ({ star, isTower, popHave,
  popNeed, popMet, gates [{ id, met }], allMet } or null), milestones
  { achieved, total, list [{ id, done }] }, income { averages, hasData },
  elevators (elevatorStats rows), vipVisits, vipFavorable,
  exterminationDueDay (number or null), households { households, residents,
  mix [[size, count]] } }`.
- `unitDetail`: the unit's fields plus `price`, `served`, `reachable`,
  `floorHasLobby`, `blockbuster` (null off a cinema).
- `transportDetail`: geometry and `cars` plus `capacity`, `utilization`,
  `hourly`, `origins` (rings as `[floor, count][]`), `stops` (per floor,
  elevators only).
- `floorHeatmap`: `HeatCell[]`; `peakCongestionHotspot`: `{ ratio, floor }`;
  `onboardingFacts`: `{ lobby, floor, office, connect, play }`.

### The async pattern

A panel asks with `port.query(q)` and renders in the promise's callback,
through a `latest()` token so an answer overtaken by a newer ask is dropped.
`port.cached(q)` is for a synchronous reader that cannot wait (a click
handler's gate), never as a stale first paint followed by a second render.

### What it removes (temporary TypeScript)

From the panels: every `Simulation` parameter and every gameplay function
call. `facilityDiagnostics.ts`'s reach ratchet line goes with 4d. Runtime
engine imports in the panel templates shrink: `stats.ts` drops `facilities`
and `types` and keeps `Ledger`, plus `milestones` for the static milestone
copy by id. `headerClock.ts` adds one ratchet line (`Clock`, `calendar`,
`gameRules`: pure date arithmetic and the rule table, the header's
derivations), and `tsPanels.ts` another (the adapter's answers call the
engine's own functions), each with its reason.

### For the UI catalog work (#921, #926)

Panels now take the catalog as a parameter at one call site per panel
(`towerCatalog(app.sim)` in `src/game/`), so moving the catalog handle off
the `Simulation` object changes those call sites only. Star-gate and
milestone copy are UI tables keyed by the engine's ids.

### Constraints

American English, no em-dashes, no "X, not Y" restatements; 500-line ceiling;
tests beside their code. In `src/simport/`, engine types come in through
`import type`, with two exceptions that each carry a ratchet line with its
reason: `headerClock.ts` (pure date arithmetic and the rule table) and
`tsPanels.ts`, the TypeScript adapter's answers, which call the TypeScript
engine's own functions (and `unitPrice` from `src/ui/catalogPricing.ts`, the
price the card has always shown; the Rust getter computes the same) and leave
with that engine.

### As built (4a), where it reads differently from AC 5

- The stats screen gates its exterminator button on the report's own
  `housekeeping` block (one answer per open); the click asks
  `housekeepingCoverage` again, since the tower can change in between.
- `statsTemplate` takes the tower name from `view.tower` beside the answer,
  the header and the catalog.
- The `appModals` tests keep their fake app (`appModals.fixture.ts`, split
  out under the line ceiling with the stats cases in
  `appModalsStats.test.ts`), with a strict fake port that answers about the
  app's current tower and refuses any query it does not expect; the stats
  template and integration tests build their answers through a real `TsSim`.
- The answer an app draws is checked against the tower it asked about
  (`app.sim`), until slice 7 gives the port a tower identity of its own.

### References

- [Source: architecture-rust-facade-2026-10-20/ARCHITECTURE-REVIEW.md#5.4 Queries and panels], #5.1, #5.2
- [Source: architecture-rust-facade-2026-10-20/consumer-inventory.md, bucket 1Q]
- [Source: architecture-rust-facade-2026-10-20/slice-plan.md, slice 4 row]
- [Source: _bmad-output/implementation-artifacts/story-facade-1-port.md]
- [Source: _bmad-output/implementation-artifacts/story-facade-6b-panel-getters.md] (on #1228)
- [Source: docs/performance/hot-path-review.md]

## Dev Agent Record

### Agent Model Used

Claude Code (the "Facade panels" thread), 2026-10-21.

### Debug Log References

- `tsPanels.ts` against 6b's `panelReference.ts` (from #1228 plus its held
  patches), on all 8 conformance saves, loaded and after 26 game hours, every
  room and shaft card and every answer: equal (scratch test, not committed).

### Completion Notes List

- 4a: the eight panel queries, `TsSim`'s answers, the header's `mode` and
  `modernCalendar`, `headerClock`, `latest`, and the stats screen and
  exterminator modal on the port. No player-visible change; no version bump.
- Gates on the first cut: typecheck, lint, `npm test` (5,736 passed),
  `npm run test:wasm:parity` with a fresh engine build (5,660 passed), build.
- Review round 1 (`/gds-code-review`, Blind Hunter, Edge Case Hunter,
  Acceptance Auditor, Hot-Path Auditor): 12 patch findings fixed, 2 deferred
  to #1262 and #1263, the rest dismissed (pass-through answers are fresh
  objects; `nextStarThreshold` is already null at TOWER; origin order and an
  omitted field are the getters' differential's to catch; confirm closes
  before its callback; `hotelsCountTowardRating` is in the Rust getter).
- Review round 2 (`/bmad-code-review`, the same four layers on the
  committed change): 6 patch findings fixed, 2 folded into #1262 and #1263,
  the rest dismissed (a load always builds a new `Simulation`, so the tower
  check holds until slice 7 gives the port a tower identity; the Rust getter
  writes `exterminationDueDay: null` explicitly; the milestone count is
  computed as `milestoneProgress` computes it; an unknown gate id showing as
  itself is the chosen fallback; `stats_open` counts the click, as before).
- Review round 3 (`/bmad-code-review`, the confirming pass, four layers on
  the tidied branch with slice 1's fixes merged in): no acceptance-criterion
  violation and no new hot-path `patch`; 7 small patch findings fixed, 2
  pre-existing hot-path findings deferred by reference (#539, #1158 A11,
  #905). Dismissed: pass-through answers are fresh objects (now pinned by a
  test); `tsPanels.ts` importing `unitPrice` from the UI is the recorded
  exception and makes no import cycle (`catalogPricing.ts` imports only engine
  types); the tower name comes from the live tower on `TsSim`, and a Rust
  view's freshness per revision is slice 7's contract; a hung coverage ask
  can only happen on an asynchronous host (#1263); the header's
  `modernCalendar` already documents that a Classic tower runs canon
  whatever it says; the queries no 4a panel asks yet are 4b to 4e's; a throw
  from local UI code after the coverage answer is a bug that rejects to
  error tracking as before, and the bail path's `showStats` toasts on its
  own.
- The hot-path record goes on the PR.
- Two new toasts, on failure paths only: "Tower Statistics could not be
  shown." and "The exterminator could not be booked right now." A healthy
  game never shows them, so 4a stays internal-only (no version bump).

### File List

- `src/simport/panels.ts` (new), `src/simport/tsPanels.ts` (new),
  `src/simport/headerClock.ts` (new), `src/simport/latest.ts` (new)
- `src/simport/queries.ts`, `src/simport/tsSim.ts`, `src/simport/view.ts`,
  `src/simport/port.ts` (the `cached` note)
- `src/engine/sim/star.ts` (gate ids), `src/engine/sim/stats.ts` (a comment)
- `src/ui/templates/stats.ts`, `src/game/appModals.ts`, `src/main.ts` (one line)
- Tests: `src/simport/{tsPanels,panelQueries,headerClock,latest,panels.types}.test.ts`,
  `src/simport/panelQueries.fixture.ts`, `src/simport/tsSim.test.ts`,
  `src/ui/templates/stats.fixture.ts`, `src/ui/templates/stats.test.ts`,
  `src/game/appModals.test.ts`, `src/game/appModalsStats.test.ts` (new, the
  stats and exterminator cases split out under the 500-line ceiling),
  `src/game/appModals.fixture.ts` (new, the shared fake app),
  `src/tests/integration/condoStatsPanel.integration.test.ts`
- `src/tests/frontendEngineImports.ratchet.txt`
- `_bmad-output/implementation-artifacts/backlog.md` (two rows)
