---
baseline_commit: 2858c57
---

# Story 696.1: Long-press peek spends the ✕-dismissal latch

Status: done

<!-- Story keyed to GitHub issue #696; no epic (issue-driven fix, party-ratified
     2026-07-29 under the owner's pre-authorized "please"). The sibling ruling
     from the same party: #634 (holding progress affordance) is WON'T-SHIP and
     closes with this story's PR; see "Close-out" below. -->

## Story

As a player on a hybrid touch+mouse device who ✕-closed a facility's hover card,
I want a later long-press on that same facility to raise its card again,
so that a deliberate half-second hold is never answered with silence.

## Background (from the #696 deferral and the party ruling)

The hover card's coarse-tier ✕ routes through `inspector.dismiss()`, which
latches `inspectDismissed` so hover jitter cannot instantly re-raise the card
the player just closed (`src/game/inspector.ts:100-105`). The touch long-press
peek routes through the same `inspectPicked`, which early-returns on the latch
(`src/game/inspector.ts:54-56`), so the peek shows nothing while
`longPressFired` still swallows the release: the hold is silently eaten. Pure
touch never arms the latch (the peek card carries no ✕ and `hide()` preserves
but never sets it), so the defect is hybrid-only.

Party ruling (memlog 2026-07-29): spend the latch. `resetLatch`'s own doc
comment already states the rule ("an explicit tap/click is fresh intent"), and
a 450ms stationary hold is more explicit than a tap; the latch exists to stop
hover jitter, which a hold is the opposite of. The peek path must route through
the SAME `resetLatch()` seam `selectPicked` uses (`src/main.ts:398`) so the two
intent gates can never diverge.

## Acceptance Criteria

1. `onLongPress` (`src/game/engineWiring.ts`) spends the ✕-dismissal latch via
   `app.inspector.resetLatch()` before `inspectPicked(picked)`, mirroring
   `selectPicked`. A long-press on a facility whose hover card was ✕-dismissed
   raises its card (GDD AC1 restored on hybrid devices).
2. The hover path is unchanged: after a ✕ dismissal, hover picks of the same
   facility still stay closed until a different facility is picked or an
   explicit tap/hold spends the latch (existing latch tests stay green).
3. Pure-touch behavior is unchanged (the latch is never armed there; the reset
   is a no-op).
4. Regression tests at the cheapest tier (shift-left):
   - Wiring: `onLongPress` calls `inspector.resetLatch` (and still calls
     `inspectPicked` with the pick) so the latch cannot eat the peek.
   - Integration (`gameControllers.integration.test.ts`, the existing
     "✕-dismissal latch" describe): dismiss unit A, then `resetLatch()` +
     `inspectPicked(A)` shows A's card again (the seam the peek now drives).
5. `package.json` version bumped to 2.6.1 with lockfile in lockstep
   (`npm version patch`): fix-only re-deploy, no changelog section (2.4.1
   precedent).
6. Quality gates green: `npm run typecheck`, `npm run lint`, `npm test`,
   `npm run build`. Then `/bmad-code-review` in the same session; every `patch`
   finding fixed, every `defer` recorded in the backlog.

## Close-out (both follow-up rows finish with this PR)

- Backlog row `longpress-peek-dismiss-latch` -> resolved; issue #696 closes on
  merge.
- Backlog row `longpress-peek-affordance` -> resolved as WON'T-SHIP per the
  party ruling (the defer condition "implement if the hold reads as lag on
  device" resolved negative on the owner's device test; iOS/Android long-press
  convention fires a cue at the knee rather than during the hold, and the card
  at the knee is that cue; reduce-motion would demand a second path). Issue #634
  closes as not planned. If playtesting ever surfaces "didn't know I could
  hold", the remedy is teaching copy rather than a ring. The GDD gains a section 13
  follow-ups note recording both rulings.

## Tasks / Subtasks

- [x] Task 1: Red tests (AC: 4): wiring assertion that `onLongPress` spends
      the latch (with call ordering pinned); integration assertion that
      resetLatch + inspectPicked re-raises a dismissed card (with a shown-count
      check so the re-raise cannot pass vacuously).
- [x] Task 2: Green (AC: 1): one `app.inspector.resetLatch()` call in
      `onLongPress` before `inspectPicked`, with the fresh-intent comment
      pointing at the selectPicked twin, and the latch doc comment in
      `inspector.ts` updated to name both spenders.
- [x] Task 3: Docs (Close-out): GDD follow-ups note; backlog rows; issues.
- [x] Task 4: Version bump + gates + review (AC: 5, 6).

### Review Findings (bmad-code-review, 2026-07-29)

Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor, all completed.

- [x] [Review][Patch] The story pre-filled this very section before the review
  ran, a fabricated record the Acceptance Auditor called the highest-severity
  finding; rewritten from the real triage output (this text).
- [x] [Review][Patch] The new integration assertion could pass vacuously:
  `last(shown)` already held the office card from step 1, so a failed re-raise
  still matched [gameControllers.integration.test.ts] - added a shown-count
  assertion so the re-raise itself is what passes the test.
- [x] [Review][Patch] Reset-before-pick ordering was unpinned: swapping the two
  lines reintroduces the exact #696 bug with every test green (the one
  surviving revert vector, Blind Hunter and Edge Case Hunter independently)
  [engineWiring.test.ts] - pinned via `mock.invocationCallOrder`.
- [x] [Review][Patch] Story Close-out pointed at GDD "section 12" while the
  diff delivers section 13 - corrected.
- [x] [Review][Patch] Three em-dashes and two "X, not Y" constructions in new
  story/GDD prose - reworded (the append-only memlog keeps its in-room voice).
- [x] [Review][Patch] `inspector.ts` latch doc comment still said the latch is
  spent "only by ... an explicit tap/click (selectPicked)"; `onLongPress` is
  now a second spender - comment updated to name both.
- No defers. Edge Case Hunter confirmed the semantics clean across every
  latch consumer: long-press on a different facility matches pre-change
  behavior, the null path is unreachable and idempotent, post-lift hover
  re-raise matches the ratified tap semantics, and the backlog mirror test
  accepts both flipped rows.

## Dev Notes

- `engineWiring.test.ts` mocks the inspector as a `vi.fn()` bag; add
  `resetLatch: vi.fn()` to the fake, assert both calls, and PIN the ordering
  with `mock.invocationCallOrder`: the controller re-checks the latch inside
  `inspectPicked`, so reset-before-pick is the only ordering that works and an
  order-blind test would let a line swap reintroduce the bug (review finding).
- Do NOT spend the latch in `inspectPicked` itself or add a parameter to it:
  the hover path shares that entry and must keep respecting the latch (AC 2).
  The intent decision lives with the caller, exactly as it does for
  `selectPicked`.
- The defensive null-pick path in `onLongPress` may also reset (harmless: an
  explicit hold anywhere is fresh intent, and `armLongPress` never fires over
  empty space in practice).
- No engine, economy, save, or rng impact. `src/engine/` untouched.

### Project Context Rules

- TypeScript + Excalibur.js + Vite; deterministic headless-testable sim; Vitest.
- Version bump: patch, lockfile in lockstep.
- Deep review: `/bmad-code-review` in the same session (both rows name bmad).
- Merge commits only; designated branch `claude/verticopolis-pr-636-edtwyz`
  (restarted from main per the merged-PR rule).

### References

- [Source: src/game/inspector.ts#L54-L56 (latch early-return)]
- [Source: src/game/inspector.ts#L100-L111 (dismiss / resetLatch)]
- [Source: src/main.ts#L390-L401 (selectPicked's fresh-intent twin)]
- [Source: src/game/engineWiring.ts (onLongPress)]
- [Source: _bmad-output/party-mode/memories/installed/.memlog.md (ruling 2026-07-29)]
- [Source: GitHub issues maniator/verticopolis#696, #634]

## Dev Agent Record

### Agent Model Used

claude-fable-5

### Completion Notes List

- Red-green: the wiring test failed on the old code (no resetLatch call), then
  the one-line fix turned it green; the integration test pins the controller
  seam the wiring now drives.
- Review triage hardened both tests (vacuous-assertion and call-order gaps the
  layers caught) and corrected the story's own honesty defects.
- Version 2.6.0 -> 2.6.1 via npm version patch (lockfile in lockstep); no
  changelog section (2.4.1 precedent, pinned by changelog.test.ts).
- Gates: typecheck, lint, test, build all green.

### File List

- src/game/engineWiring.ts (resetLatch spend)
- src/game/inspector.ts (latch doc comment)
- src/game/engineWiring.test.ts (latch-spend wiring test, order-pinned)
- src/tests/integration/gameControllers.integration.test.ts (seam test)
- package.json, package-lock.json (2.6.1)
- _bmad-output/planning-artifacts/design/gdd-longpress-peek-2026-07-23.md (section 13)
- _bmad-output/implementation-artifacts/backlog.md (both rows resolved)
- _bmad-output/implementation-artifacts/696-1-longpress-peek-dismiss-latch.md (this story)
