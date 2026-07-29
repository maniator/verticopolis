---
baseline_commit: 8a86a8b9c9d39b16288075c396f1e748bfd3d0e1
---

# Story 699.1: Transport-aware congestion gripe copy

Status: done

<!-- Story keyed to GitHub issue #699; no epic (issue-driven fix, party-ratified 2026-07-29). -->

## Story

As a player whose offices are served only by stairs,
I want the congestion gripe to name the transport that is actually crowded and a remedy that applies to it,
so that I am never told to "add cars" on a floor no elevator stops at.

## Background (from the #699 investigation)

The reporter's save has two standard elevators, both with `skipFloors: [2,3,4,5]`,
so floors 2-5 (about 700 office workers) board only three stair columns. The
congestion model is transport-neutral by design (stairs carry 8/trip,
`TRANSPORT_CAPACITY` in `src/engine/facilityCaps.ts`), so the crowding is real
and correct. The bug is copy-level: the inspector's "Main gripe" line always says
"crowded elevators. Add cars or a parallel shaft to this block."
(`src/game/gripeCopy.ts:21`), and the condo buy-back toast says "the crowded
elevators will wear them down too until you add cars"
(`src/engine/sim/churn.ts:104`). `src/engine/types.ts:137-140` already documents
the rule the vacate-toast copy follows: congestion capacity counts every
transport kind, "so the copy must not single out elevators."

Party ruling (memlog 2026-07-29): copy becomes serving-aware via one shared
engine classifier; stair crowding stays in the model (the balance lever until
#384 willingness enforcement lands); scope capped at the three strings below.

## Acceptance Criteria

1. A shared, DOM-free engine helper classifies the passenger transports serving a
   floor: iterate `sim.tower.transports`, exclude `isStaffOnlyTransport` kinds,
   include only those where `sim.tower.stopsAt(t, floor)` is true (this honors
   `skipFloors`; never test only `bottom`/`top` spans). It reports whether any
   passenger elevator stops there and which walkway kinds (stairs / escalator)
   do. It lives in `src/engine/sim/` (churn.ts must reach it; `src/engine/` stays
   DOM-free) and both copy sites consume it so they can never disagree.
2. Inspector "Main gripe" congestion line (`gripeLineText`, `src/game/gripeCopy.ts`):
   - Floor served by at least one stopping passenger elevator (standard or
     express; service never counts): keep today's line, "crowded elevators. Add
     cars or a parallel shaft to this block."
   - Walkways only, stairs only: "crowded stairs. Add another stair column, or
     give this floor an elevator stop."
   - Walkways only, escalators only: "crowded escalators. Add another escalator,
     or give this floor an elevator stop."
   - Walkways only, both kinds: "crowded stairs and escalators. Add more of
     them, or give this floor an elevator stop."
   - Defensive fallback (empty classification; unreachable in practice because
     the congestion gripe only fires on served floors): "overcrowded vertical
     transport. Add capacity to this block."
3. Condo buy-back toast (`src/engine/sim/churn.ts:104`) uses the same
   classification for its `reason === "congestion"` note:
   - Elevator-served: keep " A new owner will buy in, but the crowded elevators
     will wear them down too until you add cars."
   - Walkway-only: " A new owner will buy in, but the crowded stairs will wear
     them down too until you add capacity." (name escalators / both kinds the
     same way as AC2; same fallback rule).
4. The HUD stat tooltip in `src/index.html` reads "Vertical transport traffic /
   congestion" instead of "Elevator traffic / congestion" (title attribute only;
   no visual/screenshot drift).
5. No engine math changes: congestion values, `TRANSPORT_CAPACITY`, and gripe
   attribution (`dominantGripe` / `vacateCause`) are untouched. Stairs keep
   crowding; #384 stays the balance follow-up.
6. Regression tests (shift-left rule: pin the failure at the cheapest tier):
   - Stairs-only floor with congestion gripe gets the stairs wording (the #699
     repro shape: offices on a floor whose only serving transports are stair
     flights).
   - Elevator-served floor keeps the elevator wording.
   - An elevator spanning the floor but with the floor in `skipFloors` does NOT
     count as serving: wording stays stairs (the exact #699 seam).
   - A service elevator stopping at the floor does not flip wording to
     elevators.
   - Fixtures assert every construction step (`expect(r.ok)`).
7. `package.json` version bumped to 2.4.1 with lockfile in lockstep (use
   `npm version patch`): player-noticeable fix-only change.
8. Quality gates green: `npm run typecheck`, `npm run lint`, `npm test`,
   `npm run build`. Then `/gds-code-review` in the same session; every `patch`
   finding fixed, every `defer` recorded in the backlog.

## Tasks / Subtasks

- [x] Task 1: Engine classifier (AC: 1)
  - [x] Add a helper in `src/engine/sim/gripe.ts` (e.g.
        `congestedTransportsAt(sim, floor)` returning
        `{ elevator: boolean; stairs: boolean; escalator: boolean }`), routed
        through `sim.tower.stopsAt` and `isStaffOnlyTransport` /
        `isElevatorKind` from `../facilities`.
- [x] Task 2: Inspector copy (AC: 2)
  - [x] Replace the static `GRIPE_TEXT.congestion` entry with a
        `congestionGripeText(sim, u)` resolver in `src/game/gripeCopy.ts`
        (mirror the existing `noiseGripeText` pattern: keep it out of the bare
        table so a lookup can never return the wrong advice).
- [x] Task 3: Churn toast (AC: 3)
  - [x] Branch the buy-back note in `src/engine/sim/churn.ts` on the classifier.
- [x] Task 4: HUD tooltip (AC: 4)
- [x] Task 5: Tests (AC: 6) in
      `src/tests/integration/dominantGripe.integration.test.ts` (inspector line;
      existing fixture patterns live here) plus a churn-toast case where the
      existing churn/moveIn tests live.
- [x] Task 6: Version bump + gates + review (AC: 7, 8)

### Review Findings (gds-code-review, 2026-07-29)

Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor (all completed; the
Auditor verified every AC's strings word for word).

- [x] [Review][Patch] Doc comment overclaimed "never per tick" for the classifier
  (buy-back vacates run during ticks) [src/engine/sim/gripe.ts] - reworded to
  "never inside a per-tick per-unit loop".
- [x] [Review][Patch] Transport-neutral fallback string was untested dead code
  [src/game/gripeCopy.ts] - added a defensive test hitting the fallback via a
  transportless floor.
- [x] [Review][Patch] Churn-toast test lacked the re-sell-branch precondition
  (magic rent 160,000 with nothing pinning the gate verdict)
  [src/tests/integration/moveInGateLegibility.integration.test.ts] - added an
  explicit wouldEvictFreshTenant(...) === false assert.
- [x] [Review][Patch] Churn-toast fixture laid lobby/floor slabs unasserted
  [src/tests/integration/moveInGateLegibility.integration.test.ts] - added
  slab-count asserts (servedTower style; per-place asserts would trip on seed
  tiles).
- [x] [Review][Patch] One "X, not Y" construction in a new test comment
  [src/tests/integration/congestionGripeCopy.integration.test.ts] - reworded.
- [x] [Review][Defer] Classifier names kinds stopping at the floor, not the
  BINDING shaft: elevator wording can prescribe a partially wrong lever when a
  cross-loaded stair link binds the floor's reading, and gap-split floors count
  shafts the tenant's segment cannot reach [src/engine/sim/gripe.ts] - deferred,
  scope-capped by the party ruling; curated backlog row
  congestion-gripe-binding-shaft, mirror issue #701.

Dismissed (3): classifier-ignores-operational-state (refuted: Transport has no
build state; transports are instant-built), v1-scalar noun looseness (never
worse than the pre-fix always-elevators copy; folded into the #701 notes), test
location deviation (file-size guard split, already recorded above).

## Dev Notes

- `gripeLineText(sim, u, gripe, unmetCov?)` already receives `sim` and `u`, so
  the congestion branch can resolve per-floor copy without signature changes.
- `wontLeaseText` passes `cong = 0` to `dominantGripe`, so the congestion gripe
  never surfaces on the empty-unit "Won't lease" path; no changes needed there.
- churn.ts is `src/engine/`: keep it DOM-free (string logic only, already is).
- The classifier is called from the inspector render path and the (rare)
  buy-back toast, never per-tick per-unit; a single pass over
  `sim.tower.transports` is fine (matches how `spatialCongestionByFloor`
  scans). Do not add nested full-collection scans on per-tick paths.
- Copy rules: American English, no em-dashes, no "X, not Y" pattern, plain
  human wording. En-dash ranges allowed.
- Canon guardrails: do NOT touch `TRANSPORT_CAPACITY`, pooling, spans, or
  anything in `facilityCaps.ts`. Express elevators count as passenger elevators
  (they stop at lobbies only; `stopsAt` already encodes that). Service
  elevators are staff-only and never serve tenants.
- Test fixture shape for the #699 seam: build a lobby, floors, offices, a stair
  chain to the office floor, and a standard elevator spanning past the floor
  with the floor pushed into `skipFloors`; assert `expect(r.ok)` on every
  placement. See `dominantGripe.integration.test.ts` for the served/congestion
  plumbing (it passes `cong` explicitly, e.g. `dominantGripe(sim, office, true, 2)`).

### Project Structure Notes

- Engine copy strings already live in `src/engine/types.ts`
  (`VACATE_REASON_TEXT`); the new churn branch stays in churn.ts next to its
  existing note strings. UI copy stays in `src/game/gripeCopy.ts`. No new files
  beyond the classifier addition to `src/engine/sim/gripe.ts`.

### Project Context Rules

- TypeScript + Excalibur.js + Vite; deterministic headless-testable sim; Vitest.
- `src/engine/` stays free of DOM/rendering.
- Shift-left: regression test pins the failure and the shift into/out of it.
- Version bump: patch (player-noticeable fix-only), lockfile in lockstep.
- Deep review: `/gds-code-review` in the same session, before/immediately after
  the PR. Fix `patch` findings; `defer` findings go to the backlog with a GH
  issue per the mirror rule.
- Merge commits only; commit/push on the designated branch
  `claude/verticopolis-issue-699-bcf3rj`.

### References

- [Source: src/game/gripeCopy.ts#L20-L25 (GRIPE_TEXT.congestion)]
- [Source: src/engine/sim/churn.ts#L97-L106 (buy-back note)]
- [Source: src/engine/types.ts#L137-L151 (transport-neutral copy rule)]
- [Source: src/engine/sim/congestion.ts#L137-L222 (spatialCongestionByFloor)]
- [Source: src/engine/tower/transport.ts#L433-L436 (stopsAt honors skipFloors)]
- [Source: src/engine/facilityCaps.ts#L9-L15 (TRANSPORT_CAPACITY)]
- [Source: src/index.html#L117 (HUD tooltip)]
- [Source: _bmad-output/party-mode/memories/installed/.memlog.md (ruling 2026-07-29)]
- [Source: GitHub issue maniator/verticopolis#699 + attached save new-area-center.vctower]

## Dev Agent Record

### Agent Model Used

claude-fable-5

### Debug Log References

### Completion Notes List

- Red-green: 6 new tests written first and confirmed failing on the old copy,
  then the implementation turned them green with zero regressions (3321 passed).
- Classifier `servingTransportKindsAt` landed in `src/engine/sim/gripe.ts`;
  both copy sites route through it. No engine math changed.
- Canon constraints surfaced by the red phase and encoded in fixtures:
  service elevators unlock at 2 stars, escalators at 3 stars, and Classic
  refuses escalators on office floors (that case runs in Modern).
- The new describe pushed dominantGripe.integration.test.ts over the 500-line
  file-size guard, so it lives in its own file
  (congestionGripeCopy.integration.test.ts), mirroring the moveInGateLegibility
  split precedent.
- Version 2.4.0 -> 2.4.1 via npm version patch (lockfile in lockstep).
- Gates: typecheck, lint, test, build all green.

### File List

- src/engine/sim/gripe.ts (classifier)
- src/game/gripeCopy.ts (congestionGripeText resolver)
- src/engine/sim/churn.ts (congestionChurnNote)
- src/index.html (HUD tooltip title)
- src/tests/integration/congestionGripeCopy.integration.test.ts (new)
- src/tests/integration/moveInGateLegibility.integration.test.ts (churn toast case)
- package.json, package-lock.json (2.4.1)
- _bmad-output/implementation-artifacts/699-1-transport-aware-congestion-gripe.md (this story)
