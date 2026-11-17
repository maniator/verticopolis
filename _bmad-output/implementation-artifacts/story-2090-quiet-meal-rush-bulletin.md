# Story 2090: Keep the Bulletin for news the player can act on

Status: review

Issue: [#2090](https://github.com/maniator/verticopolis/issues/2090) (P2, 4.x).
Source: player feedback on Reddit, 2026-11-13.

## Story

As a player running a busy tower,
I want the Bulletin and the status bar to keep showing rent, maintenance,
warnings and events instead of a breakfast, lunch and dinner line every day,
so that the messages I can act on are the ones I see.

## Decision

The issue left three options open. The plan takes option 1: the game stops
writing the meal rush lines altogether. The owner picked it on a decision card
in the project thread (2026-11-17, "Remove all three").

Why option 1:

- **1994 had none.** SimTower's only message line was the Info Bar, and it
  never announced a meal (project memory "bulletin-and-tower-history", the
  1994 manual digest). Classic gets closer to the original.
- **Nothing is lost.** The slow lunch clock is already explained in the game,
  in the **Steady clock** note of Settings (`src/ui/templates/settings.ts`),
  and in Help (`tower/clock.mdx`, `your-towers/settings.mdx`). The rushes
  themselves are described in `tower/people.mdx` "The rushes".
- **Less work per frame.** The frame loop drops three `decideMealRush` calls
  and a generation read every frame. Nothing gets slower.
- **No save change.** Option 2 (once per tower, ever) needs a saved latch,
  which is a save-format change for a flavor line.

Option 3 of the issue (actionable notices stand out) is already true and
needs no code: maintenance, rent and lease lines are `LogKind::Money`
(`engine-rs/src/economy/upkeep.rs`, `engine-rs/src/economy.rs`), drawn gold
in the Bulletin (`.log-line.money`); warnings are `bad` (red) and toast. What
buried them was the volume of `info` lines, which this story removes.

## Acceptance Criteria

1. A tower with 30 or more tenants that runs through 07:00, 12:00 and 18:00,
   with the breathing clock on, writes no "Breakfast rush!", "Lunch rush!" or
   "Dinner rush!" line to its log, Bulletin or status bar.
2. The frame loop writes nothing to the engine log on its own (no
   `enginePort.logLine` call from `runFrame`), so the newest Bulletin line
   stays the engine's last line (rent, maintenance, a warning).
3. The meal rush latch (`lastMealRushDay`) and the decision module
   (`src/game/mealRush.ts`) are gone, with every reference (app field, tower
   swap reset, screenshot settle helper, fixtures, tests).
4. Engine money lines are unchanged: maintenance and rent still log as
   `money` (existing Rust tests keep passing; no engine diff).
5. Saves and old towers are unaffected: a saved log that already holds rush
   lines loads and shows them as before (no save-format change).
6. Help says the Bulletin carries money, warnings and events, and that the
   rushes are shown by the clock and the crowds rather than announced.
7. Analytics: the data map and the dashboard tile that read the Bulletin
   (`bulletin_read_back`) note that the Bulletin stopped carrying the meal
   rush lines from the release after 4.11.1, so read-back counts on either
   side are not compared as like for like.
8. A change note (`app: patch`, `crate: none`) with a Player line.

## Tasks / Subtasks

- [x] Remove `emitMealRushes` and its call, and the `minutesBeforeTicks` read
      in `runFrame` (AC 1, 2) in `src/game/frameLoop.ts`.
- [x] Delete `src/game/mealRush.ts` and `src/game/mealRush.test.ts` (AC 3).
- [x] Remove `lastMealRushDay` from `GameApp` (`src/main.ts`), the reset in
      `src/game/towerFollow.ts`, `src/game/frameLoop.fixture.ts`,
      `scripts/screenshot-engine.ts`, and update
      `src/game/followSwapTraffic.test.ts` (AC 3).
- [x] Replace the `emitMealRushes` tests in `src/game/frameLoop.test.ts`
      with a regression test: a frame that crosses noon with 30+ tenants and
      the breathing clock on calls `enginePort.logLine` zero times (AC 1, 2).
      It must fail against today's code.
- [x] Help: `tower/map-and-windows.mdx` "The Bulletin" and `tower/people.mdx`
      "The rushes" (AC 6).
- [x] Analytics docs: `docs/analytics-data-map.md` row `bulletin_read_back`,
      `docs/analytics-measurement-status.md` row 26, and the tile description
      in `scripts/posthog-dashboard.mjs` (AC 7).
- [x] `.changes/claude-project-thread-cpnawx.md` (AC 8).
- [x] Quality gates; `/gds-code-review` (frame loop is gameplay presentation
      and a hot path); hot-path record (section 6 of
      `docs/performance/hot-path-review.md`) on the PR.

## Dev Notes

- `emitMealRushes` (`src/game/frameLoop.ts`) is UI flavor written into the
  engine log ring through `enginePort.logLine(text, info)`. It is the only
  per-frame log writer in the TypeScript. The engine's own log (`sim.emit`)
  is untouched; no engine change, no conformance or golden movement.
- `minutesBeforeTicks` in `runFrame` exists only for the meal rush judgment
  (comment at its definition says so). It reads `enginePort.generation()`
  every frame; removing it removes a binding call per frame.
- The status bar's news cell (`src/ui/statusBar.ts`) shows the batch's
  newest line, so a rush line at 07:00 replaced the rent or maintenance line
  there. After the change it keeps the engine's line.
- Screenshot settle (`scripts/screenshot-engine.ts` `pgSettle`) carries the
  latch across a settle; drop that field. A scene that ran past a meal hour
  with 30+ tenants could have shown a rush line; the drift check decides.
- Preserve: the breathing clock (`advance(..., steadyClock, ...)`) is
  unchanged; only the bulletin lines go.

### Project Context Rules

- Unit tests mock the engine port (`vi.fn`) and assert the calls made.
- No guard tests. No em-dashes. American English. Merge commits only.
- Help and analytics updated in the same PR; nothing slower; a regression
  test that runs in required CI.

### References

- Issue #2090; `src/game/frameLoop.ts` `emitMealRushes`; `src/ui/uiStatus.ts`
  `renderLog`; `engine-rs/src/sim.rs` `LogKind`; help
  `tower/map-and-windows.mdx#the-bulletin`, `tower/clock.mdx`.

## Dev Agent Record

### Agent Model Used

Claude Code (thread session for #2090).

### Debug Log References

- Regression test checked against `main`: with the old `frameLoop.ts` and
  `mealRush.ts` restored, "writes no meal rush line when a busy tower's frame
  runs through breakfast, lunch and dinner" fails (three `logLine` calls).
- Full suite locally: 8,426 passed; the one failure (a finished backlog row
  must carry the GH placeholder) was fixed in the next commit.

### Completion Notes List

- The frame loop writes nothing to the log; `emitMealRushes`,
  `src/game/mealRush.ts`, the `lastMealRushDay` latch and the per-frame
  `generation()` read are gone.
- `calendarOf` (`src/simport/headerClock.ts`) lost its only production caller
  with `emitMealRushes`; it is deleted, and its two tests now check the header
  directly (independent review round 1).
- Help, analytics notes and the backlog row (done, GH placeholder; #2090
  closes on merge) updated. No engine, save or catalog change.
- Review: `/gds-code-review` round 1 (two patch findings fixed) and the
  independent review round 1 (three patch findings fixed) on PR #2423.

### File List

- `src/game/frameLoop.ts` (modified)
- `src/game/mealRush.ts`, `src/game/mealRush.test.ts` (deleted)
- `src/main.ts`, `src/game/towerFollow.ts`, `scripts/screenshot-engine.ts` (modified)
- `src/simport/headerClock.ts` (modified: `calendarOf` removed)
- `src/game/frameLoop.test.ts`, `src/game/frameLoop.fixture.ts`,
  `src/game/frameLoop.dialogHold.test.ts`, `src/game/followSwapTraffic.test.ts`,
  `src/simport/headerClock.test.ts`,
  `src/tests/integration/portReads.integration.test.ts`,
  `src/tests/integration/towerCongratsDialogs.integration.test.ts` (modified)
- `help-site/src/content/docs/tower/map-and-windows.mdx`,
  `help-site/src/content/docs/tower/people.mdx` (modified)
- `docs/analytics-data-map.md`, `docs/analytics-measurement-status.md`,
  `scripts/posthog-dashboard.mjs` (modified)
- `_bmad-output/implementation-artifacts/backlog.md` (modified)
- `.changes/claude-project-thread-cpnawx.md` (new)
- `_bmad-output/implementation-artifacts/story-2090-quiet-meal-rush-bulletin.md` (new)
