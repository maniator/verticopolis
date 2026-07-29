---
baseline_commit: fff6370d24ea7e5874a85b445dff10cf6d7c499a
---

# Story 701.1: Congestion copy names the binding shaft

Status: done

<!-- Story keyed to GitHub issue #701 (follow-up to #699/#700); party-ratified 2026-07-29. -->

## Story

As a player whose floor reads congested through a cross-loaded stair link while a
healthy elevator also stops there,
I want the congestion gripe to name the shaft that actually binds the reading,
so that the advice pulls a lever that moves the number instead of "add cars" on
an elevator with room to spare.

## Background

#700 (v2.4.1) made the congestion copy serving-aware: `servingTransportKindsAt`
reports which passenger kinds stop at the floor, and any stopping elevator wins
the wording. But the v2 model (`spatialCongestionByFloor`) sets a floor's
reading to its WORST serving shaft, with load accumulated across every floor
that shaft serves. A floor served by a healthy elevator plus a stair link that
also carries a stairs-only neighbor can read congested through the stairs while
the copy says "crowded elevators. Add cars", a lever that only partially moves
that floor's number.

Party ruling (memlog 2026-07-29, second session): the copy names the BINDING
shaft's kind, read from the model's own attribution. The segment facet of #701
is dissolved by construction: the copy relays whatever attribution the model
carries, so segment honesty arrives if and when the model itself goes
segment-aware (a model story, not copy work). #701 closes fully with this PR.

Technical facts the design leans on:

- `spatialCongestionByFloor` is NOT memoized; every caller rebuilds it. The
  internals (shaftsByFloor, loadByShaft, the per-floor max) can be refactored
  into one builder that also emits attribution, with the existing function kept
  as a thin projection. Ratios must stay byte-identical (golden masters).
- The capacity-proportional split makes near-exact ties the DEFAULT: every
  shaft serving exactly the same floor set lands on mathematically equal
  ratios (floating error aside). A naive argmax would flip wording on float
  noise and build order.
- v1 (`simModel !== "v2"`) has one global scalar and no per-shaft attribution.

## Acceptance Criteria

1. Refactor `spatialCongestionByFloor` (`src/engine/sim/congestion.ts`) so one
   internal builder produces both the per-floor ratio map AND a per-floor
   binding attribution; the exported `spatialCongestionByFloor` remains a thin
   projection with byte-identical ratios (no math change; the existing
   congestion tests and golden masters stay green untouched).
2. A new engine read (in `congestion.ts` or `sim/gripe.ts`) resolves the
   binding transport classification for a floor:
   - v2 with a map entry: the kind class of the worst serving shaft, with the
     tie rule below.
   - Tie rule: a walkway (stairs/escalator) flips the wording only when its
     congestion is STRICTLY worse than every serving elevator's by more than
     1e-9; otherwise elevators win (preserves v2.4.1 behavior on evenly loaded
     mixed floors, and wording can never depend on build order or float noise).
   - Two walkway kinds within 1e-9 of each other (and no elevator, or both
     strictly above every elevator): the combined "stairs and escalators"
     class, preserving the v2.4.1 combined wording.
   - v1, or a floor with no map entry (unpopulated, defensive): fall back to
     the v2.4.1 kinds classification (`servingTransportKindsAt`).
   - Staff-only shafts never participate (they are already outside the model's
     shaftsByFloor).
3. Inspector congestion line (`congestionGripeText`, `src/game/gripeCopy.ts`)
   keys on the binding class:
   - Binding elevators: unchanged, "crowded elevators. Add cars or a parallel
     shaft to this block."
   - Binding stairs, no elevator stops at the floor: unchanged v2.4.1 line,
     "crowded stairs. Add another stair column, or give this floor an elevator
     stop." (same preservation for escalators-only and the combined line).
   - Binding stairs while an elevator DOES stop at the floor (the new case):
     "crowded stairs. They also carry floors no elevator stops at; give those
     floors an elevator stop, or add another stair column."
   - Escalator variant: "crowded escalators. They also carry floors no
     elevator stops at; give those floors an elevator stop, or add another
     escalator."
   - Combined variant: "crowded stairs and escalators. They also carry floors
     no elevator stops at; give those floors an elevator stop, or add more of
     them."
   - Empty classification: unchanged neutral fallback.
4. Churn buy-back note (`congestionChurnNote`, `src/engine/sim/churn.ts`) keys
   its noun on the same binding class (noun from the class, "add cars" only
   when elevators bind, "add capacity" otherwise). Same fallback rules.
5. Regression tests:
   - The #701 repro: floor A served by a standard elevator (floor A only) plus
     a stair link that also serves a populated stairs-only floor B; floor A's
     binding shaft is the stairs (strictly worse), so floor A's copy names the
     stairs with the new mixed-floor remedy, and never "Add cars".
   - Tie stability: the same topology with floor B unpopulated leaves the
     shafts tied, so the elevator wording holds (v2.4.1 behavior preserved).
   - The #699 stairs-only and skip-floors tests keep passing unchanged
     (congestionGripeCopy.integration.test.ts is the net).
   - spatialCongestionByFloor ratios unchanged by the refactor (existing
     traffic/congestion tests are the net; do not weaken them).
   - Fixtures assert every construction step (`expect(r.ok)`).
6. No congestion math changes; `TRANSPORT_CAPACITY`, pooling, spans untouched.
7. Version 2.4.1 -> 2.4.2 via `npm version patch` (lockfile in lockstep).
8. Gates green (typecheck, lint, test, build), then `/gds-code-review` in the
   same session; every `patch` finding fixed, every `defer` recorded in the
   backlog. Backlog row `congestion-gripe-binding-shaft` flips to resolved with
   `GH` cleared to `—` in this PR (the PR closes #701; the mirror test forbids
   a finished row holding a live reference).

## Tasks / Subtasks

- [x] Task 1: Builder refactor (AC: 1)
  - [x] Extract the shared build in `congestion.ts`; keep
        `spatialCongestionByFloor` as a projection; add the attribution output
        (per-floor worst-shaft data sufficient for the tie rule: best elevator
        congestion and best per-walkway-kind congestion, or the shaft list).
- [x] Task 2: Binding classification read (AC: 2)
- [x] Task 3: Inspector copy (AC: 3)
- [x] Task 4: Churn note (AC: 4)
- [x] Task 5: Tests (AC: 5)
- [x] Task 6: Version bump + backlog row + gates + review (AC: 7, 8)

### Review Findings (gds-code-review + Codex, 2026-07-29)

Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor; Codex reviewed the
first pushed snapshot in parallel and converged on the same top findings.

- [x] [Review][Patch] Mixed-floor lines claimed the cross-loading floors have
  no elevator stop, which can be false (a differently-shafted floor still
  cross-loads the walkway) [src/game/gripeCopy.ts] - reworded to "jammed by
  the other floors they serve; give those floors better elevator service",
  which also fixed the ambiguous "add more of them" antecedent.
- [x] [Review][Patch] Combined-walkways class could include a kind still
  inside the elevator tie band near the boundary (Codex P2) -
  [src/engine/sim/gripe.ts] both kinds must now clear the band on their own.
- [x] [Review][Patch] Eager congNote paid a full spatial-map rebuild on every
  congestion vacate (offices/hotels included) though only a bought-back sold
  condo emits it [src/engine/sim/churn.ts] - gated on the entry-knowable
  conditions (condo, everOccupied, market-listed).
- [x] [Review][Patch] Tie test could pass vacuously and the repro's seam
  assert was decorative [congestionGripeCopy.integration.test.ts] - both now
  assert against the attribution map (tie within 1e-9 with attribution
  present; repro gap macroscopic beyond 1e-3).
- [x] [Review][Patch] The walkways+elevator branch was untested - added the
  tied stairs+escalator beside-an-elevator case.
- [x] [Review][Patch] "By construction" comment overclaimed for unclassified
  kinds [src/engine/sim/congestion.ts] - reworded to name the whitelist
  obligation.
- [x] [Review][Patch] "X, not Y" docblock pattern and the churn fixture's
  unasserted floor-2 slab [both test files] - reworded; slab count asserted.

Dismissed (1): missing-import concern (refuted: symbols already imported;
typecheck green). Deferred: none.

## Dev Notes

- Simplest attribution shape that supports the tie rule without exposing shaft
  ids: per floor, the max congestion per kind class
  `{ elevator: number; stairs: number; escalator: number }` (absent kind = 0 /
  -Infinity). The binding read then compares classes with the 1e-9 epsilon.
  This avoids a second pass and keeps ties order-independent by construction.
- Wire the classification through ONE exported function (e.g.
  `bindingTransportClassAt(sim, floor)` in `gripe.ts` calling a new
  `spatialCongestionAttributionByFloor`-style export from `congestion.ts`), so
  gripeCopy.ts and churn.ts stay in lockstep exactly like #700 did with
  `servingTransportKindsAt`. Keep `servingTransportKindsAt` as the fallback
  and for the "does an elevator stop here" remedy flag.
- Hot-path rule: the classification is read on inspector hover and buy-back
  vacate only. It may rebuild the spatial map per call (congestionAt already
  does); never call it inside a per-tick per-unit loop.
- The #700 test files are the regression net: congestionGripeCopy (5 cases)
  and the moveInGateLegibility churn case must pass unchanged.
- Copy rules: American English, no em-dashes, no "X, not Y" emphatic pattern.
- The mixed-floor scenario needs floor B strictly bound to the stairs: floor B
  populated, served only by the stair chain, floor A served by both. Build
  order must not matter (the tie rule guarantees it; the test should still
  build in one fixed order).
- `wontLeaseText` still passes `cong = 0` (congestion tier skipped); no change.

### Project Context Rules

- TypeScript + Excalibur.js + Vite; deterministic headless sim; Vitest.
- `src/engine/` stays DOM-free. Shift-left regression tests with asserted
  fixtures. Merge commits only; designated branch
  `claude/verticopolis-issue-699-bcf3rj` (restarted from main post-#700).
- Deep review: `/gds-code-review` in the same session.

### References

- [Source: src/engine/sim/congestion.ts#L137-L222 (spatialCongestionByFloor)]
- [Source: src/engine/sim/gripe.ts (servingTransportKindsAt, #700)]
- [Source: src/game/gripeCopy.ts (congestionGripeText, #700)]
- [Source: src/engine/sim/churn.ts (congestionChurnNote, #700)]
- [Source: _bmad-output/implementation-artifacts/backlog.md (row congestion-gripe-binding-shaft)]
- [Source: GitHub issues maniator/verticopolis#701, #699; PR #700]
- [Source: _bmad-output/party-mode/memories/installed/.memlog.md (rulings 2026-07-29)]

## Dev Agent Record

### Agent Model Used

claude-fable-5

### Debug Log References

### Completion Notes List

- Red-green: 4 new tests (3 red on the old classifier, 1 tie-stability pin),
  then green with zero regressions (3,326 passed).
- `buildSpatialCongestion` now emits ratios + per-class attribution in one
  pass; `spatialCongestionByFloor` is a thin projection, math untouched.
- `bindingTransportClassAt` implements the party tie rule (1e-9 strict flip);
  falls back to `servingTransportKindsAt` for v1 and missing entries.
- One real seam surfaced by red-green: `vacate()` empties the unit before
  building the toast, which dropped the floor from the attribution map when
  the departing tenant was its last occupant. The note now reads the binding
  class at vacate entry, while the tenant's own load still counts.
- Backlog row congestion-gripe-binding-shaft flipped to resolved, GH cleared
  (this PR closes #701). Version 2.4.1 -> 2.4.2.

### File List

- src/engine/sim/congestion.ts (builder refactor + attribution export)
- src/engine/sim/gripe.ts (bindingTransportClassAt + tie rule)
- src/game/gripeCopy.ts (binding-aware resolver + mixed-floor remedies)
- src/engine/sim/churn.ts (binding-aware note, read before the unit empties)
- src/tests/integration/congestionGripeCopy.integration.test.ts (3 new cases)
- src/tests/integration/moveInGateLegibility.integration.test.ts (1 new case)
- _bmad-output/implementation-artifacts/backlog.md (row resolved)
- package.json, package-lock.json (2.4.2)
- _bmad-output/implementation-artifacts/701-1-congestion-binding-shaft-copy.md
