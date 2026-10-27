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
  parking-seed fix are on `main`. Those callers land last. (#1276 put both
  on `main` at efb4bdf on 2026-10-21, which met the gate for the traffic
  chip; 4e-1 also fixes the TypeScript parking seed. The strip and the
  palette scan wait for their own fixes, see 4e-2.)
- Slice 2 (2026-10-27): OK'd 4e-1 moving the frame guard's error log out of
  `engineWiring.ts` into `src/game/frameErrors.ts` before #1290 lands. The two
  PRs touch adjacent lines near the top there: 4e-1 removes the
  `MAX_FRAME_ERRORS` constant right beside slice 2's `commitAfter` lines.
  Whoever merges second drops the constant and keeps slice 2's lines. The
  backlog's #1158 row conflicts as well: each PR appends a sentence, and
  both stay.
- `main.ts` (the Runtime lane's file): 4e-1 changes three things, one line
  fewer net (499): the tooling method `refreshTraffic()` (renamed from
  `updateTraffic()`) returns the chip's rejecting refresh for the screenshot
  tooling, the `lastTickErrorLog` field goes (its throttle lives in
  `frameErrors.ts`), and `adoptSim` resets `lastTrafficTier` on a different
  tower. The Runtime lane (its slice 5a thread) OK'd all three on 2026-10-27
  at 06:15 UTC; 5a's #1294 edits other `main.ts` lines and leaves it at 498,
  so the two together stay under the ceiling, and whichever merges second
  resolves. Slice 2, the first in the parallel map's `main.ts` order, OK'd
  the same three edits landing ahead of #1290 (2026-10-27, 10:07 UTC): #1290's
  `main.ts` hunks (the port field, `renameTower`, the `placeSimpleBuild`
  signature) do not overlap them, and whichever merges second takes
  `refreshTraffic`.

**Risks and how the slice meets them:**

| Risk | Mitigation |
| --- | --- |
| A panel shows a TypeScript-derived value that differs from the engine's | Each answer's type is the Rust getter's JSON; `tsPanels.ts` is the one TypeScript definition. 6b's differential compares the Rust getters with a TypeScript reference on the 24-scenario conformance corpus (606 checkpoints) and moves onto `tsPanels.ts` when its held wrapper commit lands; until then a scratch run pins `tsPanels.ts` equal to that reference on the 8 conformance saves |
| Async answers land out of order or after the selection changed (a worker resolves later) | `latest.ts`: each panel keeps a token. `latest` (cards, previews) drops an answer overtaken by a newer ask; `inOrder` (the traffic chip, whose hysteresis needs every reading) draws each answer in ask order and drops one that lands after a newer question settled. On `TsSim` and a main-thread `RustSim` the answer lands in a microtask of the same task, so nothing paints between the ask and the render. A worker port must add back-pressure before a per-tick panel uses it |
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
5. **Consumers on the port, in this order of PRs** (4e-1, the traffic chip,
   went up straight after 4a: it needs none of the query reads slice 2 left
   in its files nor 6c's facts, and its two small edits in files #1290 also
   touches have their owners' OK, see Agreed boundaries; the rest keep this
   order):
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
6. **No player-visible change, with one exception below.** Every panel shows
   the same text, colors and rows as before on both of today's hosts;
   existing panel tests keep their assertions (rewritten to build answers
   through `TsSim`), and the relevant e2e specs pass. No version bump
   (internal only). The exception, from 4e-1's round 1 review: the traffic
   chip's hysteresis now starts over on a newly
   loaded tower instead of carrying the old tower's tier. The two differ only
   while the new tower sits within 0.03 of a band edge, and what it shows then
   is what a cold start on that tower shows, so no player would notice and
   it needs no bump.
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
  - [x] draft PR with the hot-path record, independent review (PR #1313:
        GO on 19bcfbf, merged into `main` at 3c40f11)
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
- [ ] 4e per-tick HUD callers (after #1237's cost fix, #1276, merged at
      efb4bdf; #1237 itself stays open for P11 and P12)
  - [ ] 4e-1 the traffic chip (`peakCongestionHotspot`), see "As built
        (4e-1)"
    - [x] `updateTraffic` asks the port and draws in the answer's callback,
          every answer in the order it was asked (`inOrderPer`, new in
          `latest.ts`); an answer that lands after a newer question settled,
          or that is about a replaced tower, is dropped
    - [x] a failed answer goes to the frame guard's log (`noteFrameError`,
          moved out of `engineWiring.ts` with slice 2's agreement,
          2026-10-27), throttled per source, and the refresh never rejects
    - [x] the screenshot tooling awaits `window.game.refreshTraffic()`,
          which rejects on a failure
    - [x] `adoptSim` resets the chip's hysteresis on a different tower
    - [x] hot path: the parking flood fill behind the congestion map seeds
          from a per-revision ramp index (`rampUnits`; it walked every unit,
          per frame through the render and per UI tick through the chip),
          and the map's shaft loops read the cached stop lists
          (`tower.stopsOf`)
    - [x] review round 1 (`/gds-code-review`, four layers), findings below
    - [x] review round 2 (`/gds-code-review`, four layers, on the rebased
          branch), findings below
    - [x] round 3, the confirming pass (`/bmad-code-review`, four layers on
          the full diff, round 2's engine fixes included), findings below
    - [x] draft PR #1329 with a hot-path record per round
    - [x] the owner's answer on the chip's congestion build (section 7):
          deferred to #338 (2026-10-27, 11:20 UTC)
    - [ ] the independent review on the exact head, merge
  - [ ] 4e-2 the palette lock scan, the onboarding checklist and the
        tower-stats strip (after #1290, which edits `frameLoop.ts` and
        `main.ts`, and the Rust bare-step lane's `stats()` PR; `appBoot.ts`'s
        `onboarding.arm` line is the Runtime lane's, so ask first). Design:
        `/mnt/project-files/release-3.0/rust-facade/slice4-4e-design.md`.
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

### Review Findings (4e-1, round 1: `/gds-code-review`, four layers on d6632507)

- [x] [Review][Patch] The chip drew only the newest answer, so the stepped
      screenshot clock (several UI ticks in one task) skipped the readings in
      between and its hysteresis could end on another tier, and a port slower
      than the UI tick would never draw; it draws every answer in the order
      asked and drops only one overtaken by a drawn answer (`inOrder`)
      [src/simport/latest.ts, src/game/trafficHud.ts]
- [x] [Review][Patch] One shared throttle let a repeating chip failure hide
      a frame guard throw, and chip failures read "frame error"; the throttle
      is per source and chip entries are tagged `[traffic]`
      [src/game/frameErrors.ts]
- [x] [Review][Patch] The throttle started at 0 (the first two seconds of
      page life logged nothing) and fell back to a constant 0 clock without
      `performance`; it starts empty and falls back to `Date.now()`
      [src/game/frameErrors.ts]
- [x] [Review][Patch] Formatting an unprintable error could throw out of the
      guards; it falls back to "unprintable error" [src/game/frameErrors.ts]
- [x] [Review][Patch] A failure about a tower replaced while the answer was
      out landed in the new tower's freshly cleared crash ring; it is dropped
      [src/game/trafficHud.ts]
- [x] [Review][Patch] A chip failure no longer failed a screenshot capture,
      and the method's doc claimed every refresh draws; the tooling awaits
      `refreshTraffic`, which rejects, and the doc says when it settles
      [src/game/trafficHud.ts, src/main.ts]
- [x] [Review][Patch] The "no error logged" test could pass vacuously inside
      the old throttle's first window, a failed draw had no test, and the
      real-engine case never ticked, so the WASM parity run never attached the
      engine; all three fixed [src/game/trafficHud*.test.ts]
- [x] [Review][Patch] The chip's hysteresis carried from one tower to a newly
      loaded one (pre-existing, within 0.03 of a band edge); `adoptSim`
      resets it on a different tower [src/main.ts]
- [x] [Review][Patch] Hot path F1, always-`patch`: the parking seed line this
      PR rewrote walks the rooms on every rendered frame (`beginFrame` in
      `towerFrame.ts` reads `sim.congestion()`) and every chip refresh; it
      reads a per-revision ramp index (`rampUnits`)
      [src/engine/tower/rooms.ts, src/engine/tower/routing.ts]
- [x] [Review][Patch] Hot path F3: the congestion map's shaft loops tested
      each span floor against the skip list, bypassing the revision-keyed
      stop cache; they walk `tower.stopsOf(t)` [src/engine/sim/congestion.ts]
- [x] [Review][Patch] The parking seed change had no test; `rampUnits` has
      order, cache, bulldoze and live-state tests, the stop lists a stale-cache
      test that kills a revision-blind cache, and a 24-hour digest of the
      congestion map, its attribution, the parking set and the hotspot is
      identical to `main` on the large tower, `split-tower-4` and
      `sixseven_2` (scratch run)
- [x] [Review][Patch] Story: AC 5's PR order, the agreed boundaries
      (`engineWiring.ts`, `main.ts`), a merge note for the `engineWiring.ts`
      conflict with #1290, the #1237 status line, AC 7's measured cost, and
      `functionalParkingSet`'s doc naming its per-frame caller
- [x] [Review][Defer] Hot path F2, F4, F5, F6: the build's own room walk,
      the flood's tuple and string key per step, the build repeated within one
      frame (render, chip, the mobile editor's diagnostics) and its per-build
      allocations, including an attribution map two callers drop; deferred by
      reference to #338 (its memo answers all four), with the detail added to
      its body
- [x] [Review][Defer] The Rust twin of F3 (`build_spatial_congestion` tests
      each span floor with `stops_at`), hourly today and per UI tick once
      slice 7 answers the chip; A43 in #1158. Its parking flood is A14
- [x] [Review][Dismiss] `roomUnits` was already imported in `routing.ts`;
      nothing else reads the chip's tier or text within a frame (grep); the
      port reads `app.sim` through its getter, so no swap lands between the
      tower and the port, and a load builds a new `Simulation`; a port that
      throws as it is asked never reaches `inOrder`, so it cannot invalidate
      an answer in flight; `pgRefreshUi`'s one caller awaits `page.evaluate`;
      `engineWiring.test.ts` already pins a `runFrame` throw reaching
      `frameErrors` through the guard; the repository runs Vitest 4

**Cost (AC 7, cloud bench, exploratory, two runs, each the median of 7
rounds).** One `peakCongestionHotspot` answer through `TsSim` costs 0.44 ms
before and 0.13 to 0.14 ms after on the large tower, 0.88 to 0.95 before and
0.62 to 0.64 ms after on `split-tower-4`, and 0.51 before and 0.38 ms after
on `sixseven_2`. The render's own `congestion()` read moves the same way
(0.42 to 0.43 before and 0.14 after, 0.85 to 1.01 before and 0.63 to 0.69
after, 0.52 before and 0.37 after), and it runs every frame, so most of the
saving lands there. The whole build gets about 3x cheaper on the large tower
(no ramps) and about 1.3 to 1.5x on the other two; the room walk inside it
is unchanged (#338). The PR body and #338's row quote the same two runs;
each hot-path record carries its own rerun.

### Review Findings (4e-1, round 2: `/gds-code-review`, four layers on 4b2ab681)

- [x] [Review][Patch] The two sources shared one five-entry ring, so a chip
      failure repeating every two seconds pushed a frame guard's root cause
      out of the crash report within ten seconds; a source that keeps failing
      replaces its own oldest entry first. This fixes the eviction across
      sources only: one source failing alone keeps its five newest entries,
      as before [src/game/frameErrors.ts]
- [x] [Review][Patch] The tooling method and the frame loop's function were
      both `updateTraffic`, but only the method rejects; the method is
      `refreshTraffic()` [src/main.ts, scripts/]
- [x] [Review][Patch] `refreshTraffic` rejected on a failure about a
      replaced tower while it dropped a success about one; it drops both
      [src/game/trafficHud.ts]
- [x] [Review][Patch] `console.error` sat outside the log's never-throw
      guarantee (a console wrapper that throws); it is guarded and the ring
      entry still lands [src/game/frameErrors.ts]
- [x] [Review][Patch] A newly adopted tower's first failure inside the old
      tower's two-second window, and a failure after the tooling's stepped
      clock restarts from 0, were both swallowed; the window holds only while
      the ring keeps the source's entry and the clock has not gone back
      [src/game/frameErrors.ts]
- [x] [Review][Patch] Tests: the basement test passed with or without the
      guard it named (replaced by an express shaft whose skip list leaves two
      floors untouched, against a cold load), no test held `stopsOf` to the
      old span filter (now on every transport of `split-tower-4`), the
      `rampUnits` cache test changed the unit count at every step (a remove
      and a rebuild before one read now), the drawing tests went through the
      catch-all, and a spy leaked between tests; the new caches had no merge
      or load test (`merge.test.ts` adds, rebuilds and removes a ramp and
      drops a stop across two merges; `rooms.test.ts` loads one cold)
      [src/engine/sim/congestionStops.test.ts, src/engine/tower/rooms.test.ts,
      src/wasmhost/merge.test.ts, src/game/*.test.ts]
- [x] [Review][Patch] `rampUnits` keyed its own copy of the unit array,
      length and revision; it keys on the `roomUnits` list, so the two never
      disagree [src/engine/tower/rooms.ts]
- [x] [Review][Patch] Wording: "settled" for the drop rule (a newer failure
      or a skipped answer also settles), the boundaries' line count (one line
      fewer net), AC 5's reason, AC 6's exception for the tier reset, the
      timings in the #338 row, and the #371 row's seam
- [x] [Review][Defer] `inOrder` holds back no question while one is out, so a
      port slower than the UI tick piles up builds (not reachable on
      `TsSim`); folded into #1263's row for the worker host, with the note
      for slice 7 in Dev Notes
- [x] [Review][Defer] Two more callers of the congestion build, the desktop
      hover card (up to two builds per pointer move) and the hourly churn
      note (one build per sold condo vacated for congestion), and a caution
      for #338's memo key (the churn note reads the map inside the hourly
      pass, between vacates); added to #338's row and body. The
      `renderSim.ts` line that calls the map memoized is the Rendering
      lane's file, so #338 fixes it with the memo
- [x] [Review][Defer] (accepted by the owner) The Acceptance Auditor holds
      that the chip's room walk per UI tick (F2, F5's repeat) is
      always-`patch` under section 7, since 4e-1 rewrites that call; the
      same call reaches the flood (F4) and the per-build allocations (F6),
      so the question names the whole congestion build the chip asks for.
      It went to the owner (accept the deferral to #338 in the owner's own
      words, quoted on the PR, or fix #338 first). Deferred to #338: the
      owner (maniator) accepted it on 2026-10-27 at 11:20 UTC in this
      story's project thread, on the decision card that asked "Accept
      deferring the traffic chip's congestion build to #338?", choosing
      "Accept the deferral to #338" (card
      cmsg_01BVeca2nMyie8SiSsA47YddFND7RBLBAyuGa3pP2gMs6z); quoted on the PR
- [x] [Review][Dismiss] The merge keeps unit objects by id and writes their
      state in place, so cached ramps read live state there too (now pinned
      by the merge test); the backlog edits land with the PR; a draw that
      throws reached the frame guard before as well; the closure in
      `stops.some` measured the same as a plain loop (2.72 against 2.88 us on
      `split-tower-4`); the screenshot builders swap `g.sim` directly, so the
      tier reset never fires in the tooling and the gallery is unaffected

Hot-Path Auditor, round 2: both round 1 fixes hold with identical 24-hour
digests on the three towers; no new cost; no always-`patch` at this commit
beyond the owner question above. Visits per build drop from 46,718 to 3,365
on the large tower and from 33,303 to 5,703 on `split-tower-4`.

### Review Findings (4e-1, round 3: `/bmad-code-review`, the confirming pass, four layers on 6e54b8b6)

Round 3 covered the full diff against `main`, round 2's engine fixes
included (`rampUnits` keyed on the `roomUnits` list, the merge, load and stop
tests), with the Hot-Path Auditor rerunning the digests and visit counts.

- [x] [Review][Patch] The ring told its sources apart by the message text,
      so a frame failure whose message began with `[traffic] ` counted as the
      chip's: the frame guard's window never held for it and the chip's
      failures could evict it as their own. Each entry's source is kept
      beside it (a `WeakMap`), with a test [src/game/frameErrors.ts]
- [x] [Review][Patch] The story checked off the owner question as a closed
      decision; it is a pending `patch` (above)
- [x] [Review][Patch] The PR body said round 2's record covers the head; it
      covers 4b2ab681 and its fixes were checked on the rebased head; round
      3's record covers the head
- [x] [Review][Patch] The tier reset in `adoptSim`, the one difference a
      player could see, had no test; `adoptSimTraffic.test.ts` calls the
      real method and pins the reset on another tower and the kept tier on
      an undo or redo restore [src/game/adoptSimTraffic.test.ts]
- [x] [Review][Patch] Tests: the stop list check compared `stopsOf` with the
      same `stopsAt` filter it is built from (now the span less its skipped
      floors, on a fixture asserted to hold express shafts, stairs and
      escalators, with the clock copy explained), and the second merge passed
      a fixed `mealOverlayRevision` [src/engine/sim/congestionStops.test.ts,
      src/wasmhost/merge.test.ts]
- [x] [Review][Patch] Docs: the ring's doc and the crash-report field named
      only the frame guard; the guard's comment left out "per source"; the
      chip's header left out the microtask and the tier reset; `inOrder` and
      the chip read as if they reorder answers (they never draw an older
      answer after a newer one, and draw every answer only on a port that
      answers in order); the `rampUnits` doc, its HP-8 row and the record
      did not name where the cache resets (a loaded tower starts empty; the
      merge drops the rooms list); the error formatter's name read
      like Vitest's `describe`; slice 2's OK for the `main.ts` order; AC 7's
      timings; #338's row named the old per-frame caller; rewrapped lines
- [x] [Review][Patch] From the Rust bare-step lane's note after this round:
      the WASM hosts' merge keeps the unit array and takes the engine's
      revision, which counts from the engine's own load, so a merge can land
      on a revision the rooms list was kept at while the units changed. On
      the base `main` the parking seed walked `tower.units` and never saw
      that; through `rampUnits` it shares the rooms list's exposure. PR
      #1325 (issue #1253, on `main` at b7ebe830) added `forgetUnitLists`,
      which the merge calls when the revision or the units moved, and
      `rampUnits` follows on its identity check; 4e-1, rebased onto it, adds
      a merge test that rebuilds a ramp at the held revision
      [src/engine/tower/rooms.ts, src/wasmhost/merge.test.ts]
- [x] [Review][Defer] On an asynchronous port, the tooling's refresh can
      settle without drawing when a newer frame-loop ask overtakes it (even
      one that failed, whose failure goes to the frame loop's log), and a
      failure that lands after a newer ask settled is dropped without a
      trace; added to #1263's row and issue beside the back-pressure cap
- [x] [Review][Dismiss] No caller of the old tooling name is left in `src`,
      `scripts`, `e2e` or `docs` (grep; the two integration tests mock the
      module's `updateTraffic`, the frame loop's function, which kept its
      name); the frame loop's call drops a promise that never rejects, and
      lint has no floating-promise rule; the entry's text repeats the
      message before the stack, the crash report's format since before this
      PR, which 4e-1 keeps; the chip cells show the old tower's reading
      until the next UI tick, 160 ms at most, as before; `noteFrameError`
      walks a ring of at most five entries, on failure paths only (Hot-Path
      Auditor N6)

Hot-Path Auditor, round 3: every round 1 and round 2 fix holds at 6e54b8b6,
with identical 24-hour digests and visit counts; the round 3 code adds no
work that grows with the tower and drops no cache; a ring fuzz (4.5M calls)
never lost a source's last entry to the other source. The only open
always-`patch` item is the owner question above. The merge item above came
in after the auditor's run, from another lane's review, so the rebased head
gets its own confirming pass.

### Review Findings (4e-1, round 4: `/gds-code-review`, the confirming pass, four layers on 8829bb21)

Round 4 covered the full diff against main 035231a6 after the rebase onto
PR #1325. The Edge Case Hunter found nothing; the Hot-Path Auditor found no
new cost and confirmed `rampUnits` follows the merge's drop.

- [x] [Review][Patch] The hold on the PR and the owner's card credited the
      saving to the room walk and quoted only the large tower's 3x; the
      whole build gets about 3x cheaper there and about 1.3 to 1.5x on
      `split-tower-4` and `sixseven_2`, and the walk inside it is unchanged.
      The PR's hold is reworded and the card reposted with the correction
- [x] [Review][Patch] Round 3's hot-path record was not on the PR; it is
      posted beside round 4's
- [x] [Review][Patch] `noteFrameError` promised never to throw while its
      clock and date reads sat outside its guards; its body runs inside one
      `try`, with a test [src/game/frameErrors.ts]
- [x] [Review][Patch] `adoptSimTraffic.test.ts` loaded `main.ts`, which
      boots the game at module scope; the test stubs the boot
      [src/game/adoptSimTraffic.test.ts]
- [x] [Review][Patch] `inOrder` had no test for a draw that throws; one
      pins that it counts as settled, so an older answer landing after it is
      dropped [src/simport/latest.test.ts]
- [x] [Review][Patch] Docs and rows: `GameApp.refreshTraffic`'s doc (a
      dropped failure settles quietly), the throttle's doc ("an entry from
      that source"), the crash-report entry's doc (both sources), the `ramps`
      cache declared beside its siblings, AC 6's opening, the cost figures
      (before and after named), #338's Fix sentence pointing at its
      correction plus the `roomAt` key note, #1263's row and issue wording,
      #371's history note and issue, the #1290 merge notes (the conflicts
      are the `MAX_FRAME_ERRORS` constant beside `commitAfter` and the
      backlog's #1158 row; `main.ts` merges clean), the PR body's story
      pointer, PR #1325 and issue #1253 named apart, three "X, not Y"
      phrasings, rewrapped lines
- [x] [Review][Dismiss] `roomUnits` filters by kind only, so a ramp under
      construction is in the list and its state is read live; the second
      pass over a shaft's stops measured the same as one loop (round 2,
      N1); `stopsAt` applies only the span and `skipFloors`
      (`transport.ts`), so the span less its skipped floors is the rule,
      and the 24-hour digests are in every record; the untested kind compare
      in `unitsMoved` and the argument spread in `mergeById` are PR #1325's
      and older merge code outside this diff (passed to the coordinator)

Hot-Path Auditor, round 4: digests identical to main 035231a6 on the three
towers; visits per build 46,718 to 3,365 (large), 33,303 to 5,703
(`split-tower-4`), 23,154 to 3,737 (`sixseven_2`); zero `stopsAt` calls per
build; two merge probes (a ramp turned into a space in place at a held
revision, and a merge that moved nothing) behave. The only open
always-`patch` item is still the owner question.

### Review Findings (4e-1, Codex on 9f265ccd)

- [x] [Review][Patch] The real-engine test in `trafficHudPort.test.ts`
      skipped a rejected office placement and never checked the lobby,
      floors or served floors, against AGENTS.md's fixture rule; every
      placement now asserts `ok`, the office count is pinned and the bank's
      stops and the served floors are checked before the tick
- [x] [Review][Defer] The chip's congestion build per UI tick: the same
      item as round 2's owner question, deferred to #338 with the owner's
      acceptance (2026-10-27, 11:20 UTC, quoted on the PR)

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
through a `latest()` token so an answer overtaken by a newer ask is dropped,
or, for a panel whose drawing carries state from one answer to the next (the
traffic chip), an `inOrder()` token that draws every answer in ask order.
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

### As built (4e-1)

- `updateTraffic(app)` is async: it asks `peakCongestionHotspot` and draws
  the answer about the tower it asked about, and resolves either way. The
  chip's hysteresis steps from one answer to the next, so it uses `inOrder`
  (`latest.ts`) rather than `latest`, which the cards use and which draws
  only the newest: `inOrder` never draws an older answer after a newer one,
  and on a port that answers in order (`TsSim`) it draws every answer, so a
  stepped clock that asks several times before the answers land still sees
  each one. An answer that lands after a newer question has settled (drawn,
  failed, or dropped as stale) is dropped. `inOrder` does not hold back new
  questions while one is out, so a worker port slower than the UI tick needs
  back-pressure first (see Dev Notes, "For slice 7 and the worker host").
- A failed answer, a port that throws as it is asked, or a failed draw goes
  to `noteFrameError` (`src/game/frameErrors.ts`), the frame guard's own
  log, tagged `[traffic]` and throttled to one entry per two seconds per
  source, so a failure that repeats at ~6 Hz reaches neither the console nor
  the crash report at that rate, and the chip's failures never hide the
  frame guard's. A failure about a tower that was replaced while the answer
  was out is dropped. The frame loop's call is unchanged: the promise never
  rejects.
- `GameApp.refreshTraffic()` (renamed from `updateTraffic()`, so the
  rejecting refresh never shares a name with the frame loop's) returns
  `refreshTraffic(app)`, the same refresh without the catch, which settles
  quietly on a failure about a replaced tower; the screenshot tooling
  (`pgRefreshUi`, the features scene's jam loop) awaits it: a capture never
  reads the chip one answer behind, and a failure stops the capture instead
  of passing silently.
- `TsSim` computes the answer as it is asked, so the chip still draws in a
  microtask of the same UI tick and reads the same as before, apart from the
  tier reset on another tower (AC 6).
- The congestion map is rebuilt once per rendered frame (`beginFrame` in
  `towerFrame.ts` reads `sim.congestion()`) and once per chip refresh. Two of
  its costs drop with identical results: the parking flood fill seeds from
  `rampUnits`, a ramp list kept per `roomUnits` list (O(ramps) per build
  instead of every unit; a loaded tower starts empty, and the WASM merge's
  `forgetUnitLists` drops the rooms list), and the shaft loops walk
  `tower.stopsOf(t)`, the revision-keyed stop cache, instead of testing each
  floor of the span against the skip list. The rest of the build (its room
  walk, the flood's allocations, the repeat in one frame, the attribution
  map) is #338's memo.
- The frame error log keeps each entry's source in a `WeakMap` beside the
  entry, so an error's own text cannot change its source. It keeps a source's window only while the ring still holds
  an entry from that source and the clock has not gone back, so a newly
  adopted tower (whose ring `adoptSim` empties) and the screenshot tooling's
  stepped clock (which starts again from 0) log their first failure at once.

### For slice 7 and the worker host

- **Back-pressure.** `inOrder` sends a question every UI tick whether or not
  earlier ones are out. On `TsSim` (and a main-thread `RustSim`) the answer
  lands in the same task, so nothing piles up; under the stepped screenshot
  clock several asks are out within one task and each is drawn in turn,
  which the gallery's hysteresis depends on. A port slower than the UI tick
  would queue a full congestion build per tick, keep a replaced tower alive
  until its asks settle, and draw the backlog in a burst. Before a worker
  port carries the chip, cap the asks still out per app (never a strict one
  in flight, for the stepped clock's sake) and test a port that never
  settles, and check that the tooling's own ask is drawn or rejects (a
  newer ask can overtake it there): #1263's row has the detail.
- **The Rust answer's cost.** When slice 7 answers `peakCongestionHotspot`
  from Rust, the build runs per UI tick in Rust, where today it runs hourly
  and per panel query. Its twins of what 4e-1 fixed in TypeScript are still
  open: the shaft loops test each span floor with `stops_at` (A43 in
  #1158), the parking seed walks every room and hashes per tile (A14 in
  #1158), the room passes are #1237's, and `served_floors()` clones its set
  (#859). Measure the Rust chip answer per UI tick on the
  large tower before slice 7 routes the chip to it.

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
- 4e-1: the traffic chip on the port, drawing every answer in order, with
  failures in the frame guard's log per source; the screenshot tooling awaits
  a refresh that rejects on failure. Two congestion-map costs drop with
  identical results (the ramp index, the cached stop lists). Review round 1
  (`/gds-code-review`, four layers): 12 patch findings fixed, 2 deferred by
  reference (#338, #1158), the rest dismissed (see its findings above). The
  chip's tier reset on a newly loaded tower only matters within 0.03 of a
  band edge, which no player would notice, so 4e-1 stays internal-only (no
  version bump).
- 4e-1 (PR #1329) review round 2 (`/gds-code-review`, four layers on
  4b2ab681): 8 patch groups fixed, the back-pressure defer folded into
  #1263, two more callers and a key caution added to #338, the owner
  question pending (the chip's congestion build, section 7). Gates on the
  rebased branch (main d6a16855, engine rebuilt): typecheck, lint,
  `npm test` (6,657 passed, 15 skipped), the WASM parity projects with
  `VC_REQUIRE_WASM=1` (6,204 passed, 39 skipped), build.
- 4e-1 review round 3 (`/bmad-code-review`, the confirming pass, four layers
  on the full diff at 6e54b8b6): 6 patch groups fixed (the ring's sources,
  the pending owner item, the PR body's record claim, the tier reset test,
  two tests, docs), plus a merge test for the ramp index at a repeated
  revision (the merge's drop came with PR #1325), the tooling's
  settle-without-drawing case on an asynchronous port added to #1263, the
  rest dismissed (see its findings).
- 4e-1 rebased onto main 035231a6 (PR #1325's `structureRuns` and
  `forgetUnitLists` beside `rampUnits` in `rooms.ts`, both sides' merge
  tests kept). Gates on the rebased head, engine rebuilt: typecheck, lint,
  `npm test` (6,680 passed, 15 skipped), the WASM parity projects with
  `VC_REQUIRE_WASM=1` (6,229 passed, 39 skipped; a first run alongside the
  round 4 benchmarks had one failure its truncated log did not name, and the
  rerun on the same tree passed), build. Review round 4 (`/gds-code-review`,
  the confirming pass, four layers on 8829bb21): 6 patch groups fixed (the
  owner card and the PR's hold reworded to the whole build and its measured
  saving, round 3's record posted, `noteFrameError` guarded whole, the
  `adoptSim` test's boot stubbed, an `inOrder` test for a draw that throws,
  docs and rows), the rest dismissed; the Edge Case Hunter found nothing and
  the Hot-Path Auditor no new cost. Rebased onto main 1dc1eabc (PR #1333:
  end-to-end tests and docs only) before the push. Codex on 9f265ccd: the
  traffic test's fixture now asserts its placements and served floors. The
  owner accepted deferring the chip's congestion build to #338 on
  2026-10-27 at 11:20 UTC (the decision card in this story's project
  thread).

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
- 4e-1: `src/game/trafficHud.ts`, `src/game/frameErrors.ts` (new),
  `src/game/engineWiring.ts` (the guard calls `noteFrameError`),
  `src/main.ts` (the tooling method `refreshTraffic`, the throttle field
  goes, `adoptSim` resets the chip's tier; one line fewer),
  `src/simport/latest.ts` (`inOrder`, `inOrderPer`),
  `src/engine/tower/rooms.ts` (`rampUnits`), `src/engine/tower/routing.ts`
  (`functionalParkingSet` seeds from it), `src/engine/sim/congestion.ts`
  (the shaft loops read `stopsOf`), `scripts/screenshot-page-ops.ts`,
  `scripts/scenes/features.ts`; tests `src/game/trafficHud.test.ts`,
  `src/game/trafficHudPort.test.ts` (new), `src/game/frameErrors.test.ts`
  (new), `src/game/adoptSimTraffic.test.ts` (new),
  `src/game/engineWiring.test.ts`, `src/simport/latest.test.ts`,
  `src/engine/tower/rooms.test.ts`, `src/engine/sim/congestionStops.test.ts`
  (new), `src/wasmhost/merge.test.ts`; `docs/performance/hot-path-review.md`
  (the HP-8 row for `rampUnits`),
  `_bmad-output/implementation-artifacts/backlog.md` (the #338, #1262,
  #1158, #1263 and #371 rows)
