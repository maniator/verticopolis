---
title: 'Preserve the latest WASM host failure'
type: bugfix
created: '2026-10-16'
status: in-progress
baseline_commit: 8f3a14353487427760ae32a8247ce42632ddb8e0
context: []
---

# Intent

Issue #1059 reports that the bounded host error list hides later failures.
Keep the first 50 history entries, a nullable latest error and an omitted
entry counter. Both hosts use one recorder. Recovery keeps the history for
this host session, and another host starts empty. Every failure still goes
to the console. This is internal status plumbing, with no gameplay change.

The owner authorized implementation in the migration request. The diagnostic
consumer described in #1059 is absent from current main. Its integration
depends on #963 and must remain explicit until that work is available.

## Boundaries

Preserve fallback and strict-build behavior, engine contracts and save bytes.
Do not change performance code, rendering, version files or the #963 design.
Do not clear history on tower swaps, since status spans the host session.

## Code map and execution

- [x] `src/wasmhost/hostErrors.ts`: define status fields and bounded recording.
- [x] `src/wasmhost/startWasmHost.ts`: expose fields and record every failure.
- [x] `src/wasmhost/workerController.ts`: use the same recorder.
- [x] `src/wasmhost/hostErrors.test.ts`: pin overflow and host isolation.
- [x] Host controller tests: pin the 51st error, recovery and recurrence.
- [ ] Review and run quality gates before pushing.
- [ ] Integrate the #963 consumer when its existing implementation is available.

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
the production build. Run bmad-code-review over this diff with this spec;
resolve patch findings and mirror deferred findings to GitHub and backlog.

## Spec change log

- Initial bounded prerequisite scope records the missing #963 consumer.
