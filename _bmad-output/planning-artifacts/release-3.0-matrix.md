# 3.0 web release matrix

> **Snapshot of 2026-10-20 at 12:15 UTC, against `main` at `7d02f27` (app
> 2.35.0). Not live.** It started from `main` at `8f3a143` and was revised the
> same day after the plan's adversarial review and the owner's decisions
> (plan section 12), then brought up to that hour's PR state: #1062, #1087,
> #1088 and #1091 merged; #1089, #1092 and #1093 open as drafts. The live
> copy is the release matrix tracking issue, a sub-issue of #945, created
> when the plan is approved; until then #945 and the PRs below are the live
> source. Threads edit the live copy in place at each milestone; after this
> PR merges, this file no longer changes. Plan:
> `release-3.0-web-plan-2026-10-20.md`.

"Changes the key" marks work that moves the replay window's key (plan 4.2),
so it lands before the freeze; Phase C ends when none of it is open.

Labels: "now" is GitHub on 2026-10-20; "plan" is the backlog row after this
plan's PR merges (the label follows the row on `main`). Gate rows marked
"proposed" in the plan were approved in principle under OD-7 and bind only
when the owner approves the reconciled plan at the final review; until then
#945's text holds. The plan's own choices are listed in plan section 12.

## Gate rows (#945)

| Row | State | Blocking work |
| --- | --- | --- |
| Conformance | Not met | B4 (#865) |
| Dual run | Not met | B5 (#867) |
| Seeded replay | Instrument incomplete (B2's slice 1 merged in #1087); window not started | B2's remaining slices (#1085; slice 2a in #1089) with the freeze guard, B4, then the freeze on `main` (OD-3) |
| Analytics | Unverified | A1's follow-ups (#1090, #1086; deploy and observability unconfirmed), X1 (#879, #873) or exceptions |
| Unit and integration | Passing in CI with named exclusions since #1062; not yet required | The owner makes both `test-wasm-parity` checks required on `main` (#1082; #1091 pinned their names); A5 removes the named exclusions |
| End to end | Not met | A3 (#874); the cue-timing spec in A5 and A6 (OD-7) |
| Authority | Not met | A6 (#954, #1064, #1065, #1066), UI1 (#921, #926 items 1 to 4) |
| Saves | Unverified | A2 (#902), A6 (#1066), B6 (S12 and the audit) or exceptions |
| Performance (provisional) | Not met as last measured | B3a (#1093), B3, PF1 to PF5, A5; OD-4: every speed metric's upper bound within a capped noise tolerance, at 1x and 4x |
| Reliability (provisional) | Instrument merged (#1088), deploy and observability unconfirmed; no eligible sessions | #1090 (the eligibility split), A3, A4's stages (OD-1); A6 (#954) and stage 3, since eligible sessions start at S9 on a build without the size gate; 1,000 eligible sessions and the observation period (OD-2) |
| Rollback | Not started | Release lane (X2), on the switchable build (OD-5) |
| Deployment | Partial | B0 (#1047), C1 (#985 criteria 5 and 7), A1's deploy confirmed |
| Version identity | Not met | C2 (#963) |
| Source of truth | At the flip | Release lane (X3), with 3.0.0's compatibility policy (OD-6) |
| Coverage | Holding | Recheck on the candidate |
| Sign-off | Owner only | Everything above |

## Work items

| ID | Work | Issue / PR | Gate rows | Lane | Depends on | Changes the key | Label now → plan | State 2026-10-20 | Next step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | Reliability signal: engine, fallback reason, size gate flag, latch-off, divergence count, arm and stage; governed definition with the split into early telemetry and eligible sessions, per-arm crash rates, and the exact bound computed in the tested script (OD-2); data map (A1 creates it); #841 check | #1081 (PR #1088); #1090 (the eligibility split); #1086 (deferred deploy-race codes) | Reliability, Analytics, Deployment | WS-A | none (runtime reasons with A3) | no | P1; P1; P2 | `engine_status` merged (`c4dfe11`), shipping approved by the owner; deploy and observability not yet confirmed; no eligible sessions, and none can count before S9 and stage 3 | Confirm the event arrives from production; #1090; `arm` and `size_gated` come with A4, `divergence_reports` with A3 |
| A2 | S5: a booking survives attach in both engines; S4's booking-case test (#874 stays open until it merges); its PR opens the exception register with the rollback loss | #902 | Saves | WS-A | A3 (the owner's 2026-10-16 order); B1 merged (parity setup files) | yes | P2 → P1 | Draft PR #1092; three WASM parity failures to settle from evidence (the owner, 2026-10-20) | Fix the failures in the code or the test setup; merge after A3 |
| A3 | S4: runtime fallback; engine refusals of commands the instance accepted reported; last error kept | #874, #1059 (#1020 if same code) | End to end, Reliability | WS-A | B1 merged (done) | yes (binding) | P2 → P1; P3 → P1; P3 | Boot fallback only | Now: #874 with the recovered #1059 work |
| A4 | The staged cohort: stages 1 to 3 (10%, 25%, 50%), the bucket draw with its read-back check, the config module, the `arm` and `stage` fields, the size gate (off at stage 3), stop signals, help sentence | new issue on approval (OD-1, plan 4.1) | Reliability | WS-A; its fields, each stage and each drop-back on the owner's approval | A1; stage 1: stage 0, A3 with its forced-trap spec, A2; stage 3: A5 and a protocol run passing M2 to M6 at 1x and 4x | no | new → P1 | Decided as stages; not built | Spec after A3 |
| A5 | S6: getters, result shapes, per-step sync and hourly merge removed (design A or B from RUN-0b by a rule written first, OD-9 (ii)); cue-timing test, and #965 if that test fails | #868 | Authority, Performance, Unit and integration | WS-A | RUN-0b (design input); lane order after A2 | yes | P2 → P1 | Partial | The design rule now, committed before RUN-0b; the code after A2 |
| A6 | S9: the engine answers; then D5 items, each in a focused PR; build rolls; #965 if its cue test is the first to fail | #954, #1064, #1065, #1066, #1067 | Authority, Saves | WS-A | A3, A5; A7 for #1066's `.TDT` half only (OD-8) | yes | P1; P2 → P1 (x3); P3 | Absent; earlier work lost | After A5 |
| A7 | TDT prerequisites of #1066's `.TDT` half; first, the list of real-save inputs | #885, #886, #887, #920 | Saves, Authority | WS-A (the owner supplies the saves A7's list names) | OD-8 (a), decided | yes (`engine-rs/src/tdt`) | P2 → P1; P2 → P1; P3 → P1; P3 → P1 | Open | The real-save list in Phase A; the rest between A3 and A6 |
| B0 | #985 criterion 5 design repair | PR #1047 | Deployment | WS-B | this plan's PR merged first (it carries the #1046 row) | no | P1 (#985) | Repair pushed; reviews and a CI timeout open | Push, drop #1047's copy of the #1046 row, address and resolve the 9 Codex threads and Copilot's open thread, ask the owner |
| B1 | S3: vitest on WASM in CI, commute fix | PR #1062 (#878); PR #1091 (#1082) | Unit and integration | WS-B | none | yes (before the window) | P1 | #1062 merged (`6157bff`): CI runs `test-wasm-parity` for `unitWasm` and `integrationWasm` on every PR; #1091 merged, pinning both check names | The owner makes both checks required on `main` (#1082) |
| B2 | Differential upgrade, PR corpus, run hygiene, the key script, the freeze guard as a required check (OD-3), rehearsal window | #1085; PR #1087 (slice 1); PR #1089 (slice 2a) | Seeded replay | WS-B | none; B4 adds the reasons after it | yes (the differential) | P1 | Slice 1 merged (`3143f93`): events hash, hourly checkpoints, money, log and save detail; #1089 (slice 2a) in draft, retargeted to `main`; rehearsal and window not started | Finish #1089 and the remaining #1085 slices (WASM execution, refusal comparisons, seed coverage, counting-window protections); the window starts only on frozen, verified candidate inputs |
| B3a | Windows harness build fix for both harnesses (`perfWorker` and `perfCompare`), extracted from #1068 | PR #1093 | Performance | WS-B | OD-9 (i), decided | no | n/a (no issue yet) → P1 | Draft PR: tested on Linux, CI and review pending; the Windows build is unproven until a run on the owner's PC | Merge once CI and review pass; a real Windows check in RUN-0a or RUN-0b; #1068's hold unchanged |
| B3 | #880, protocol doc with the OD-4 rule, gate orientation, A/A mode (δ, ε, their caps and the exit to the owner), shipping-host cost split and churn | new issue on approval, #880 | Performance | WS-B | B3a | yes (#880, `packageHash.ts`) | new → P1; P3 → P1 (#880) | Not started | Draft PR on `main` after B3a |
| B4 | S11: refusal reasons pinned; reasons in the differential | #865 | Conformance, Seeded replay | WS-B | B2 | yes | P3 → P1 | Absent | After B3 |
| B5 | S8: the step driver in the engine | #867 | Dual run | WS-B | B1; A2 (`fixedStep.ts`); A5's cue test (`frameLoop.ts`) | yes | P2 → P1 | Absent | After B4 |
| B6 | S12 fixed or excepted; the Saves-row audit | #858, #856 | Saves | WS-B | A2 (`load.rs`) | yes | P3 | Open | After B5, before the freeze |
| B7 | #1068 CI repair under the hold | PR #1068 (#1045) | none | WS-B | B3a | n/a (held) | P2 | Red since #1060; owner hold | Tier entries, merge `main`; no merge (D2) |
| PF1 | Protocol runs RUN-0a (now), RUN-0b, RUN-1 to RUN-3 | B3's issue | Performance | A local session the coordinator schedules (PC measurement; no implementation thread runs it) | RUN-0b on B3 and A5's design rule | no | n/a | Not run | RUN-0a now |
| PF2 | Edit scene for the shipping host (M8) | new issue on approval | Performance | WS-P | B3 | no | new → P1 | Not started | After B3 |
| PF3 | The rest of the `perf:worker` cost split, then the bare-step gap; borrowed views if profiling picks them | #1048, #1051, #859 | Performance | WS-P | RUN-0a; B3 for code work; #1048 before #1051 (the owner's 2026-10-16 order) | #1051 and #859 yes; #1048 no | P2 → P1 (#1048); P2 → P1; P3 | #1048 partly landed (#1056); #1051 claim retired; #859 recovered patch | After B3: #1048's remainder; #1051 starts by checking the flat TypeScript curve |
| PF4 | WASM perf baseline in CI with M7's A/A-calibrated tolerances; startup accounting; the cold-start split; TDT package cost | #900, #983, #1005, #932 | Performance | WS-P | A5 (#900); C1 (`scripts/wasm-build.ts`) for #932 | #932 yes; the rest no | P3 → P1; P3; P3 → P1; P3 → P1 | Recovered patch (#983, #1005) | Apply `perf-startup.patch`; #1005's fetch and compile split first, for PF5 |
| PF5 | The cold-start fix (M5) | new issue on approval | Performance | WS-P | #1005; RUN-0b confirms the gap | if it touches the key's inputs | new → P1 | Not started; M5 fails as last measured | After #1005; before the freeze if it changes the key, before RUN-3 in any case |
| C1 | Engine-set check at boot; size budget and old-cache cleanup | #985 | Deployment | WS-C | B0 approved; A3 (S16 depends on S4) | yes (`wasm-build.ts`, `engineAssets.ts`) | P1 | Criteria 1 to 4 and 6 on `main` | After approval |
| C2 | About and diagnostics identity | #963 | Version identity | WS-C | C1 | yes (identity export) | P1 | Absent; earlier work lost | Re-implement before the freeze |
| C3 | Shell precache integrity | #1046 | Deployment (adjacent) | WS-C | A1 signal data | no | P3 (gated) | Design open question | Wait for the signal |
| UI1 | The UI reads the engine catalog | #921, #926 | Authority | WS-D | A5; for `src/render`, only until the stack parks at its next PR boundary (plan 9.5) | yes (catalog exports) | P1; P2 → P1 | #921 part 1 merged | After A5 |
| RS1 | Rendering stack | PR #817 (#812), PR #831 (#813), PR #1039 (#915) | none | WS-R | a spare thread after WS-P and WS-C while WS-D waits for S6, or after WS-D; parks at a PR boundary when WS-D needs `src/render`; no merge between a protocol run's scheduling and its commit | no | P1; P2; P3 | Open; #1039 conflicts with its base | Stack order, versions per plan 9.7 |
| X1 | Analytics close-out | #879, #873 | Analytics | Release | S1 (done) | #879 yes | P3; P2 | Open | Fix or exception register; engine-side changes (#879's pins in `gameplay.rs`) before the freeze; #873's analytics half before the candidate deploy (a tail path) |
| X2 | Rollback rehearsal, including a deploy rollback to the last release before #902 | #945 | Rollback | Release | the switchable build (OD-5), candidate | no | n/a | Not started | Script at Phase D |
| X3 | Flip PR edits: CLAUDE.md source of truth, CONTRIBUTING build line and 3.0.0's compatibility policy (OD-6), `engineChoice.ts`, gallery and baselines from the WASM engine (#878), the exception register (`release-3.0-exception-register.md`, opened by A2's PR) attached | #945 | Source of truth, Sign-off | Release | everything | no | P1 | n/a | Owner approval |

## Held, after the flip, or out of path

| Issue | Why |
| --- | --- |
| #1045 (via #1068), #1049, #1050, #1053, #1071, #1058 | Worker host: a measurement placement until after the flip (AD-7) |
| #908, #919, #966, #980, #1057 | After the flip or at retirement |
| #893 | Crate publish for a second frontend, after the flip at P2 (OD-6 (b)); 3.0.0's major bump rests on CLAUDE.md's versioning rule |
| #883, #884 | TDT lock hardening, after the flip; #885, #886, #887 and #920 moved onto the path (A7) |
| #1020, #1021 | Latent host edges and the rest of #923; taken only where a lane touches the same code |

## Shared files (plan 9.5)

| Files | First | Then |
| --- | --- | --- |
| `src/wasmhost/wasmHost.ts`, `telemetry.ts`, `engine-rs/src/wasm.rs`, `engine-rs/src/crowd/mod.rs`, `src/engine/Crowd.ts`, `src/dualrun/binding.ts`, `engine.d.ts`, `src/tests/parity/*`, `vite.config.ts`, `.github/workflows/test.yml` (all in #1062) | WS-B (B1) | WS-A (each A-step PR in lane order while it is open: A3, then A2's parity setup); WS-C for the Workbox block in `vite.config.ts`. After B1 merges, other lanes add binding exports in their own PRs (WS-B's B5, WS-C's S17 identity export, WS-D's catalog exports, WS-P's #932 feature split) and merge after any open A-step PR on the same file |
| `src/wasmhost/workerApply.ts`, `workerCore.ts`, `workerHost.ts`, `workerProtocol.ts` | WS-B (B1) | WS-P (#1048's cost split); B7 keeps #1068 rebased over it under the hold |
| `src/wasmhost/merge.ts`, `engine-rs/src/load.rs`, `services.rs`, `sim.rs`, `src/engine/sim/*`, `src/engine/serializedGame.ts` | WS-A (A2) | WS-B (B5's `fixedStep.ts`, B6's `load.rs`) after A2 merges |
| `src/wasmhost/startWasmHost.ts`, `workerController.ts`, `hostErrors.ts`, `engineBoot.ts`, `engineChoice.ts`, `src/bootstrap.ts` | WS-A (A1, A3, A4) | WS-C (C1's boot check) after A3 merges; the release lane at the flip. #1062 also touches `startWasmHost.test.ts` and `src/wasmhost/fakeEngine.fixture.ts`, which A1 and A3 edit too: B1 merges first, and A1 and A3 rebase over it |
| `src/analytics*`, the data map | WS-A | The release lane (X1, #873) |
| `src/ui/templates/helpContent.ts` | WS-A (A4's cohort sentence) | WS-C (C2's About changes) |
| A4's cohort config module (the stage share and the size gate's threshold) | WS-A (A4) | The release lane at the flip |
| `engine-rs/src/bin/fuzz.rs`, `scripts/fuzz-compare.ts`, `engine-fuzz.yml`, the `conformance/` corpus | WS-B (B2, B4) | |
| `src/game/frameLoop.ts` | WS-A (A5's cue-timing test, and #965 if that test fails) | WS-B (B5); A6's #965, if A6's test is the first to fail, rebases over B5 |
| `engine-rs/src/clock.rs` | WS-B (B5) | |
| `src/tests/perfWorker/*`, `src/tests/perfCompare/*`, `scripts/perf-*.ts`, `src/wasmhost/packageHash.ts` | WS-B (B3a, then B3) | WS-P |
| `engine-rs/src/tower_query.rs`, `tower_routing.rs` (#859) | WS-P (lands before the freeze) | |
| `src/render/**`, sprites | WS-R, until WS-D needs these files | WS-D (#921 parts 2b and 2c, and their `src/render` lint rule). WS-D waits only until the stack parks: when it needs `src/render`, the stack parks at its next PR boundary (the coordinator's call) unless its open PR is ready to merge, and later stack PRs rebase over WS-D |
| `src/ui/**`, `src/game/**` catalog reads | WS-D | |
| The About and Diagnostics UI (#963); `src/build/workboxGlob.ts`, `scripts/verify-precache.ts` (#985 criteria 5 and 7) | WS-C | |
| `scripts/wasm-build.ts`, `src/wasmhost/engineAssets.ts`, `src/wasmhost/enginePackageNames.ts` | WS-C (C1) | WS-P (#932's feature split) |
| `_bmad-output/planning-artifacts/release-3.0-exception-register.md` | WS-A (A2's PR opens it) | After A2 merges, each lane that adds an entry (B6 for S12, A6 for #1067, the release lane for S14); the release lane attaches it at the sign-off |

Shared by every lane and held by none: the locks (`conformance/expected.json`,
`catalog-digests.json` and the rest), regenerated on rebase and never merged
by hand; the gallery, refreshed through the drift check's `commit-on-approval`
job on the PR that changes pixels or in the pinned Playwright image; the
visual baselines, through `update-visual-baselines.yml` or the pinned image
(never a host browser); `src/dualrun/exportTiers.ts`, where each lane adds
the tier entries for its own exports in the same PR; `engine-rs/src/lib.rs`
and `engine-rs/Cargo.toml`, where each lane adds its own lines and keeps the
other lane's on rebase; the `package.json` version, per plan 9.7 rule 7; and
`backlog.md`, where each PR edits only its own rows.

## Counting windows

| Window | Started | Key | Nights or sessions | Resets |
| --- | --- | --- | --- | --- |
| Seeded replay (rehearsal) | not started | n/a | 0 | n/a |
| Seeded replay (counting) | not started | the key of plan 4.2 | 0 of 14 | none yet |
| Reliability, early telemetry | not started: the instrument merged (#1088), deploy and observability unconfirmed | build, stage and arm | 0 | n/a |
| Reliability, eligible sessions | not started | builds with S9 (#954) and without the size gate (stage 3 on), by build, stage and arm | 0 of 1,000 | n/a |
| Observation period (the tail) | not started | the candidate deploy and later deploys that keep the key and the tail's paths | 0 (at least 14 nights, and 100 eligible sessions as proposed) | a merge to the tail's paths (a tail fix included) or a new key restarts it, unless the owner waives (plan 4.1) |

The replay ledger (one line per night: date, key, run link, result) lives in
the live matrix issue.
