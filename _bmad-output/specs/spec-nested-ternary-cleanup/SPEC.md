---
id: SPEC-nested-ternary-cleanup
companions:
  - ./audit.md
  - ../../project-context.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only; consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Nested-Ternary Cleanup

## Why

An audit with `npx eslint src api --rule '{"no-nested-ternary": "error"}'` finds 84 nested-ternary occurrences across 46 files. The owner flagged one (a dispatch table crammed into a ternary, since fixed on another branch) and forked off this cleanup. The agreed assessment: most occurrences are the benign flat "banded else-if ladder" idiom (tier verdicts in `src/game/facilityDiagnostics.ts` around lines 117-125, the message pickers in `src/ui/placement.ts`) and stay as written; the weird ones (dispatch tables, inside-out nesting, heavy prose ladders) get rewritten into the form they wanted to be.

## Capabilities

- **CAP-1**
  - **intent:** Every nested-ternary site in `src` and `api` is audited against a written rubric, so "weird" versus "sanctioned ladder" is a recorded judgment, not vibes.
  - **success:** The companion `audit.md` lists every distinct nested-ternary expression from the eslint audit with a verdict (fix or stay) and a one-line reason citing the rubric clause. Every occurrence from the eslint run is accounted for.

- **CAP-2**
  - **intent:** The qualifying sites read straight afterward: a tag dispatch is a switch or lookup map, an inside-out ternary is an if/else, and a heavy prose ladder is a small named helper with early returns.
  - **success:** Each site marked "fix" in `audit.md` no longer trips `no-nested-ternary`, and the replacement matches the file's existing style. Rerunning the audit rule shows only "stay" sites remaining.

- **CAP-3**
  - **intent:** The refactor is invisible to players and to every test: same strings, same numbers, same branch outcomes, same evaluation order for anything effectful (RNG draws included).
  - **success:** All four quality gates pass with no test edits beyond the refactored files themselves, and no player-facing string or numeric constant differs from `main`. No version bump (players notice nothing).

## Constraints

- Behavior-preserving refactor only: no logic changes, no altered strings, numbers, or branch conditions, and no change to the order effectful expressions run in.
- Owner decision (2026-08-06): `no-nested-ternary` is enabled as an error in `eslint.config.js` and every remaining ladder site is swept, with zero inline disables. This retires the earlier sanctioned-ladder carve-out and brings the eslint config change into scope; round one's carve-out text is preserved in the audit for the record.
- The 500-line file-size guard (`src/tests/fileSize.guard.test.ts`) holds: ceiling-adjacent files (`serialization.ts`, `EconomySystem.ts`, `facilityDiagnostics.ts`, `towerInputCamera.ts`, `uiElevatorSchedule.ts`) must stay at or under 500 lines, trimming or extracting where an if/else rewrite would cross it.
- American English, no em-dashes in new prose, comments only where the code cannot say it.

## Non-goals

- No behavior changes of any kind, and no cleanups beyond what the sweep itself requires.
- No change to `src/tests/fileSize.ratchet.txt`.

## Success signal

A reader opening any formerly qualifying site sees the structure the logic always had: a switch or lookup for a dispatch, an if/else for a guard, a named helper for a message picker. `git diff` against `main` shows no string or number changed, all four gates are green (lint now enforcing `no-nested-ternary`), and `npx eslint src api` reports zero nested-ternary occurrences.

## Assumptions

- The eslint `no-nested-ternary` rule run is the authoritative site list; it reported 84 occurrences on this branch (the brief said 83; the branch point differs by one).

## Open questions

- None. The round-one open question (enable the rule and sweep the ladders?) was answered by the owner on 2026-08-06: yes to both, in the strongest form. Round two implements it.
