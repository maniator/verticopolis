---
title: 'Preserve the latest WASM host failure'
type: bugfix
created: '2026-10-16'
status: in-review
baseline_commit: 8f3a14353487427760ae32a8247ce42632ddb8e0
context: []
---

# Intent

Issue #1059 reports that the bounded host error list hides later failures.
Keep the first 50 history entries, a nullable latest error and an omitted
entry counter. Both hosts use one recorder. Recovery keeps the history for
this host session, and another host starts empty. Every failure goes to the
console. That is a change for the main-thread host, which used to stop
logging once its list held 50 errors; the worker host already logged every
one. No path calls the recorder once per frame or tick: a refusal, a detach
that throws and a worker restart each happen at most once per tower, and the
worker host's command refusals stop at `MAX_ERRORS_PER_TOWER` (20) per tower
in `workerCore.ts`, logged before this change too. So the console gains at
most a few lines per tower. This is internal status plumbing, with no
gameplay change.

The owner authorized implementation in the migration request. The diagnostic
consumer described in #1059 is absent from current main. Its integration
depends on #963 and must remain explicit until that work is available.

## Boundaries

Preserve fallback and strict-build behavior, engine contracts and save bytes.
Do not change performance code, rendering, version files or the #963 design.
Do not clear history on tower swaps, since status spans the host session.

## Code map and execution

- [x] `src/wasmhost/hostErrors.ts`: define status fields, the exported
  `HOST_ERROR_HISTORY` limit and bounded recording.
- [x] `src/wasmhost/startWasmHost.ts`: expose fields and record every failure.
- [x] `src/wasmhost/workerController.ts`: use the same recorder.
- [x] `src/wasmhost/hostErrors.test.ts`: pin overflow and recurrence.
- [x] Host controller tests: pin the 51st error, recovery and recurrence,
  the empty initial fields, and two `startWasmHost` handles with separate
  statuses.
- [x] `src/bootstrap.ts`: both first-tower stops (the main-thread host's and
  the worker host's) read `lastError`, pinned in `bootstrapEngine.test.ts`
  with a full list. `scripts/screenshot-engine.ts` names a refusal by
  `lastError` too. These were the readers of the list's last entry on main.
- [x] Review: `/bmad-code-review` and `/gds-code-review` (below), both, as
  the plan asks of a recovered patch, and every patch finding fixed.
- [x] Quality gates before pushing (typecheck, lint, `npm test`, build and
  `test:wasm`; the only failures are the container-only ones that need a
  real `node_modules`).
- [ ] Help's Diagnostics (#963, not on main) reads `lastError` when it lands;
  the note is on #963's backlog row.

## Acceptance

- Given an empty host status, when no failure has occurred, then the latest
  error is null and the omitted count is zero.
- Given 50 recorded errors, when the 51st occurs, then history remains at
  50 entries, the latest field names the 51st and the omitted count is one.
- Given an overflowing history, when a tower recovers and a later tower
  fails, then the latest failure and omitted count advance without losing
  the existing history.
- Given two host sessions, when one fails, then the other remains empty.
- Given #963 diagnostics, when error history has overflowed, then fallback
  diagnostics read the latest field. This acceptance remains dependency-blocked.

## Verification

Run targeted unit tests, typecheck, lint, the full Tier-1 suite, coverage and
the production build. Run `/bmad-code-review` and `/gds-code-review` over
this diff with this spec; resolve patch findings and mirror deferred
findings to GitHub and backlog.

## Merge

This lands in its own pull request, ahead of #874. The 3.0 web release
plan's A3 row (#1080, merged) pairs the two, but the owner's handoff on #874
(2026-10-16) asks for #874 alone in a focused pull request, so #874 builds
on this branch and goes up separately. It closes #1059: the issue's test (a
host that records 51 errors reports the 51st) is met for both hosts. The
Diagnostics half waits on #963, whose backlog row carries it. #1080
restores a `wasm-host-last-error` row as open and says #1059 lands with
#874; whichever of the two lands second marks the row done with `—` in the
GH column and records the split.

## Review record

`/bmad-code-review`, 2026-10-20, on the diff `origin/main..a052b8b`.

Fixed (patch):

- The worker host's first-tower stop in `bootstrap.ts` still read the
  list's last entry, as did `scripts/screenshot-engine.ts`; both read
  `lastError` now (Acceptance Auditor 1 and 2, Blind Hunter 8, Edge Case
  Hunter).
- The note on #963's row called `lastError` the fallback reason. The code
  is `lastFallback.reason`, and `lastError` is the message only while the
  tower is in fallback (Blind Hunter 1, Acceptance Auditor 7).
- The spec hid that the main-thread host now logs every error; the intent
  says so now, with why it cannot flood the console (Blind Hunter 2,
  Acceptance Auditor 9).
- `droppedErrors` counts the error `lastError` still holds, and `lastError`
  equals the list's last entry until it fills; the field docs say both
  (Blind Hunter 3). The `HostFallback` doc pointed at `errors` for a message
  that can be dropped there (Edge Case Hunter).
- The isolation and empty-status criteria were pinned only by object
  literals. The host tests now check the initial fields of both hosts and
  start two `startWasmHost` handles (Blind Hunter 5, Acceptance Auditor 6).
- The worker overflow test now checks `hosted`, the list length, its first
  entry and the log count after the recurrence (Blind Hunter 6).
- The two hosts recorded and logged in opposite orders; both record first
  (Blind Hunter 7).
- The limit is the exported `HOST_ERROR_HISTORY`, used by the tests
  (Blind Hunter 10).
- The worker leak test's refusal now carries the private text in
  `lastError`, which the boot reads, so the existing check that no relay
  call contains it covers the new field (Blind Hunter 9).
- The checklist had review ticked during the review (Blind Hunter 12,
  Acceptance Auditor 9).

Deferred: the perf harness detects a new host error by the list's length
(`src/tests/perfCompare/`), which stops growing at 50. Row
`perf-harness-host-error-count`, #1095 (Edge Case Hunter, Acceptance
Auditor 10).

Dismissed:

- The boot test's state (51 errors before the first tower) cannot happen
  at boot (Blind Hunter 4). It pins which field the boot reads; a full list
  is the only way to tell `lastError` from the list's last entry.
- Marking #1081's row done here is unrelated bookkeeping (Blind Hunter 11).
  The backlog's step 3 asks the next session that touches the file to true
  up a row whose issue closed first; #1081 closed on 2026-10-20 with
  PR #1088, whose body records the owner's approval.
- `src/dualrun/dualRun.ts` caps its own list without a `lastError`. The
  issue names two hosts, and the dual-run relay is a test harness.
- Review routing (Acceptance Auditor 3): `/gds-code-review` runs as well.
  The A3 scope (Acceptance Auditor 4) is settled under Merge above. The
  commit message wording (Acceptance Auditor 8) is fixed by reshaping the
  branch before review.

`/gds-code-review`, 2026-10-20, on the diff `origin/main...7a76371`.

Fixed (patch):

- The worker host's `kill` recorded the cause and then let the tower go, so
  a detach that threw replaced the cause as `lastError`. It lets go first
  now, and a test fires a worker crash with a detach that throws (Edge Case
  Hunter 1, Blind Hunter 11). The test fails on the old order.
- The comment that recording first protects against a throwing logger
  overstated it; it says only that both hosts record before logging (Edge
  Case Hunter 4, Blind Hunter 15).
- The `lastError` doc put the boundary at "while `errors` has room"; it is
  "while `droppedErrors` is 0" (Blind Hunter 8).
- The two-host test's `not.toBe` could not fail. It now fails the second
  host and checks that the first host's status is unchanged (Blind Hunter
  10).
- The #963 note claimed `lastFallback` for both hosts, hard-coded 50 and
  stated no requirement or test. It now names the main-thread host, points
  to #1086 for the worker host's codes, and asks for a UI test with a full
  list, and the PR comments the handover on #963 (Blind Hunter 2, 4 and 9,
  Acceptance Auditor).
- The #1095 row said the cap started with #1059 (both hosts already capped
  at 50 on main), left out `src/tests/perfWorker/pageWorker.ts`, and gave a
  fix that counts errors without naming the new one. It sat outside the
  curated table, where the mirror guard does not read it. All four are
  fixed, and the issue body matches the row (Blind Hunter 6, Edge Case
  Hunter 3, Acceptance Auditor).
- This spec ticked the review box before the gds record existed, missed
  the worker host's command refusals in the console bound, overstated it as
  "does not grow without limit", and used the "X, not Y" pattern once
  (Blind Hunter 3, 5, 7 and 14, Acceptance Auditor).

Dismissed:

- Pairing `lastError` with `lastFallback` in a `lastFallbackMessage` field
  (Blind Hunter 1). `HostFallback` is codes only so that it can go to
  telemetry without a message, and the field docs say `lastError` is the
  latest error of any kind. #963's note says when it is the fallback's
  message.
- A respawn that fails after `stop()` still records its error (Edge Case
  Hunter 5). That is accurate history for a status that stays readable
  after `stop()`, and the path predates #1059.
- A post failure in `workerHost.ts` records the cause and then the generic
  "could not post the tower to the worker", which becomes `lastError` (Edge
  Case Hunter 6). The cause is recorded and logged just before it, and
  `workerHost.ts` is out of scope here (#1068 rewrites it).
- `as never` casts in the worker tests (Blind Hunter 12) match the file's
  existing fixtures.
- Falling back to the list's last entry in the screenshot script (Blind
  Hunter 13): `lastError` is set by every recorded error, so the list
  cannot have an entry while it is null. The script has no tests, as
  before (Acceptance Auditor).
- An `await` before the worker overflow test's final count (Blind Hunter
  11): the failing attach records synchronously inside `adoptSim`.
- Separate PR from #874 (Acceptance Auditor, for the owner): settled under
  Merge above, and the PR body says so.

## Spec change log

- Initial bounded prerequisite scope records the missing #963 consumer.
- 2026-10-20 (WS-A, A3 of the 3.0 web release plan): recovered from the
  Codex worktree and applied unchanged at its base (the patch's two
  planning-doc hunks left out; #1080 replaces them), then main merged in.
  A1 (#1088) had added `fallbacks` and `lastFallback` to `WasmHostStatus`,
  so the merge keeps both sets of fields. The three readers on main that
  read the list's last entry (the boot's first-tower stops for the
  main-thread and worker hosts in `bootstrap.ts`, and the screenshot
  tooling's refusal message) now read `lastError`.
- 2026-10-20, independent review (the release's go or no-go reviewer, on
  6e34744): CONDITIONAL GO, with the takeover note on #1059 as the
  condition. Its wording fixes are in: the `lastError` field doc names the
  worker host's kill order, and this spec names both review skills, the
  merged plan and the three readers.
