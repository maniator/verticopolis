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
- Banded ladders are the sanctioned idiom and stay: a tail-chained 2-3 band ladder with short branches is not churned, even where it technically nests.
- No eslint config change in this PR; `no-nested-ternary` stays off in `eslint.config.js`.
- The 500-line file-size guard (`src/tests/fileSize.guard.test.ts`) holds: `src/engine/sim/serialization.ts` sits at exactly 500 lines, so edits there must not grow the file, and every other touched file stays at or under the ceiling.
- American English, no em-dashes in new prose, comments only where the code cannot say it.

## Non-goals

- No repo-wide `no-nested-ternary` ban. Recorded as an open question below for the owner.
- No sweep of the sanctioned ladder sites, and no drive-by cleanups (shared helpers across files, comment rewrites, style normalization) beyond the qualifying sites.
- No change to `src/tests/fileSize.ratchet.txt`.

## Success signal

A reader opening any formerly qualifying site sees the structure the logic always had: a switch or lookup for a dispatch, an if/else for a guard, a named helper for a message picker. `git diff` against `main` shows no string or number changed, all four gates are green, and the remaining nested ternaries are exactly the sanctioned banded ladders the audit lists as "stay".

## Assumptions

- The eslint `no-nested-ternary` rule run is the authoritative site list; it reported 84 occurrences on this branch (the brief said 83; the branch point differs by one).

## Open questions

- Enable `no-nested-ternary` in `eslint.config.js` and sweep the remaining ladder sites (~83 total)? Owner call; this PR deliberately leaves the rule off and the ladders alone.
