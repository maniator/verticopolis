---
title: Preserve commute samples across WASM host handoff
type: bugfix
created: 2026-10-16
status: done
baseline_commit: 300c7d9c47347976f2c54797428ee06d487cd76f
context: []
---

<frozen-after-approval reason="Owner explicitly authorized fixing the existing PR and its review feedback">

## Intent

PR #1062 adds commute-stress readouts to both WASM hosts, but transfers them only at full merges. Completed trips between merges disappear when TypeScript resumes. Preserve the latest samples belonging to the state returned to TypeScript, including replacement of old averages and removal of obsolete floors.

## Boundaries & Constraints

Always preserve deterministic gameplay, serialized saves, and one delivery per gameplay event. Keep the existing worker fallback contract: steps no fresh reply confirmed return to TypeScript, with their telemetry withheld. Use an engine-owned revision to avoid serializing an unchanged map on every frame. The revision is transient and never enters a save or conformance hash.

The scope is #1062 and #878. Performance profiling, worker-transfer optimization, release version changes, the default-engine flip and rendering are outside this fix.

## I/O & Edge-Case Matrix

| State | Expected behavior |
| --- | --- |
| Main host steps before an hourly merge | Changed commute rows reach the read model |
| Main host detaches before a pending frame flush | Latest engine rows transfer before freeing |
| Worker fresh reply has no full merge | Changed rows reach the read model |
| Worker stale reply includes new samples | Hold rows until a fresh reply confirms the corresponding state |
| Detach before worker confirms a step | Retain the prior confirmed rows and roll back the clock |
| Changed rows remove a floor | Replace the map, clearing the obsolete entry |
| Malformed rows | Reject before applying state; teardown still releases the host |

</frozen-after-approval>

## Code Map

- `engine-rs/src/crowd/mod.rs`: accumulator and transient sample revision.
- `engine-rs/src/wasm.rs`, `src/dualrun/engine.d.ts`, `src/dualrun/binding.ts`: revision query contract.
- `src/wasmhost/wasmHost.ts`: main-thread synchronization and teardown.
- `src/wasmhost/workerCore.ts`, `workerProtocol.ts`, `workerHost.ts`: changed rows and stale-reply handoff.
- Host fixture and unit suites: deterministic timing regressions.

## Tasks & Acceptance

- [x] Expose a sample revision without changing gameplay or saves.
- [x] Sync changed rows on main-thread frames and teardown.
- [x] Carry changed rows in worker replies and retain stale rows until fresh state applies.
- [x] Cover replacement, removal, stale replies, detach, event deduplication and save stability.
- [x] Run applicable TypeScript, Rust, WASM, codec and parity gates (results in the story's 2026-10-20 run; `npm run wasm:build` ran first, and there is no separate codec gate in `package.json`: the codec differential runs inside `test:wasm`).
- [x] Run the complete `gds-code-review` layered review and triage (2026-10-20: Blind Hunter, Edge Case Hunter and Acceptance Auditor; patches applied, deferrals in backlog rows #1082 to #1084).

Given completed trips since the previous merge, when a confirmed host state returns to TypeScript, then its commute rows match that state and the serialized save remains unchanged by telemetry transfer.

Given a stale worker reply, when detaching before a fresh reply, then its rows are withheld alongside its unconfirmed steps and events.

## Verification

Targeted host tests, typecheck, lint, npm test, build, native Rust tests and clippy, WASM build, test:wasm and both parity projects. Record unavailable gates precisely. No heavy fuzz volume is added to PR CI.

## Spec Change Log

- 2026-10-16: Resume authorized #1062 takeover. Earlier bot-reported commit 47974ae is unavailable through the repository API (422); no follow-up PR exists in the matching PR search. Reconstructed the bounded fix in the existing PR worktree.
- 2026-10-20: The WS-B evidence thread took the PR over. The recovered patch was applied on 300c7d9 and `main` merged. Beyond the spec: the two commute reads joined the export tier table, the reply watchdog moved from `workerHost.ts` to `workerApply.ts` (the file was at the 500-line ceiling), and two guards pin the parity exclusions and the CI job. The `fingerprint` helper was split out of `wasmHostSetup.ts` for the same reason, earlier in the PR.
