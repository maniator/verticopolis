# 3.0 web release matrix

> **Snapshot of 2026-10-20 against `main` at `8f3a143` (app 2.35.0), revised
> the same day after the plan's adversarial review. Not live.** The live copy
> is the release matrix tracking issue, a sub-issue of #945, created when the
> plan is approved; until then #945 and the PRs below are the live source.
> Threads edit the live copy in place at each milestone. This file changes
> only when the plan does. Plan: `release-3.0-web-plan-2026-10-20.md`.

"Changes the key" marks work that moves the replay window's key (plan 4.2),
so it lands before the freeze; Phase C ends when none of it is open.

Labels: "now" is GitHub on 2026-10-20; "plan" is the backlog row after this
plan's PR merges (the label follows the row on `main`). Gate rows marked
"proposed" in the plan bind only after the owner approves OD-7; until then
#945's text holds.

## Gate rows (#945)

| Row | State | Blocking work |
| --- | --- | --- |
| Conformance | Not met | B4 (#865) |
| Dual run | Not met | B5 (#867) |
| Seeded replay | Instrument incomplete; window not started | B2, B4, then the freeze (OD-3) |
| Analytics | Unverified | A1, X1 (#879, #873) or exceptions |
| Unit and integration | Not met | B1 (#1062); A5 removes the named exclusions |
| End to end | Not met | A3 (#874); the cue-timing spec in A5 and A6 if OD-7 adds it |
| Authority | Not met | A6 (#954, #1064, #1065, #1066), UI1 (#921, #926 items 1 to 4) |
| Saves | Unverified | A2 (#902), A6 (#1066), B6 (S12 and the audit) or exceptions |
| Performance (provisional) | Not met as last measured | B3, PF1 to PF4, A5; OD-4 |
| Reliability (provisional) | Not startable | A1, A3, A4; OD-1, OD-2 |
| Rollback | Not started | Release lane (X2), OD-5 |
| Deployment | Partial | B0, C1 (#985 criteria 5 and 7), A1 |
| Version identity | Not met | C2 (#963) |
| Source of truth | At the flip | Release lane (X3) |
| Coverage | Holding | Recheck on the candidate |
| Sign-off | Owner only | Everything above |

## Work items

| ID | Work | Issue / PR | Gate rows | Lane | Depends on | Changes the key | Label now → plan | State 2026-10-20 | Next step |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | Reliability signal: engine, fallback reason, size gate flag, latch-off, divergence count, arm; governed definition; data map; #841 check | new issue on approval (S16's signal half) | Reliability, Analytics, Deployment | WS-A | none (runtime reasons with A3) | no | new → P1 | Not started | Spec, then draft PR |
| A2 | S5: a booking survives attach in both engines | #902 | Saves | WS-A | A3 (the owner's 2026-10-16 order); B1 merged (parity setup files) | yes | P2 → P1 | Recovered patch, no PR | Apply `wasm-authority.patch` on `8f3a143`, merge `main`, draft PR early; merge after A3 |
| A3 | S4: runtime fallback; engine refusals of commands the instance accepted reported; last error kept | #874, #1059 (#1020 if same code) | End to end, Reliability | WS-A | B1 merged | yes (binding) | P2 → P1; P3 → P1; P3 | Boot fallback only | After B1 merges |
| A4 | Engine cohort release | OD-1 | Reliability | Owner, then WS-A | A1, A3, A2 | no | n/a | Owner decision | Owner |
| A5 | S6: getters, result shapes, per-step sync and hourly merge removed (design per OD-9); cue-timing test | #868 | Authority, Performance, Unit and integration | WS-A | RUN-0b (design input); lane order after A3 | yes | P2 → P1 | Partial | After A3 |
| A6 | S9: the engine answers; D5 items; build rolls; #965 if a cue test fails | #954, #1064, #1065, #1066, #1067 | Authority, Saves | WS-A | A3, A5; A7 for #1066's `.TDT` half only (OD-8) | yes | P1; P2 → P1 (x3); P3 | Absent; earlier work lost | After A5 |
| A7 | TDT prerequisites of #1066's `.TDT` half | #885, #886, #887, #920 | Saves, Authority | WS-A (the owner supplies #885's real saves) | OD-8 | yes (`engine-rs/src/tdt`) | P2 → P1; P2 → P1; P3 → P1; P3 → P1 | Open | Owner decision OD-8 |
| B0 | #985 criterion 5 design repair | PR #1047 | Deployment | WS-B | none | no | P1 (#985) | Repair in `wasm-offline.patch` | Push, address and resolve the 9 Codex threads and Copilot's open thread, ask the owner |
| B1 | S3: vitest on WASM in CI, commute fix | PR #1062 (#878) | Unit and integration | WS-B | none | yes (before the window) | P1 | Open, 234 behind, green before #1060 only | Take over, apply `wasm-conformance.patch` on its head, merge `main` |
| B2 | Differential upgrade, PR corpus, run hygiene, rehearsal window | new issue on approval | Seeded replay | WS-B | none; B4 adds the reasons after it | yes (the differential) | new → P1 | Not started | Once B1 is up for review |
| B3 | Windows harness build fix, #880, protocol doc, gate orientation, A/A mode, shipping-host cost split | new issue on approval, #880 | Performance | WS-B | OD-9 (i) | yes (#880, `packageHash.ts`) | new → P1; P3 → P1 (#880) | Build fix in `perf-worker-1068.patch` | Draft PR on `main` |
| B4 | S11: refusal reasons pinned; reasons in the differential | #865 | Conformance, Seeded replay | WS-B | B2 | yes | P3 → P1 | Absent | After B3 |
| B5 | S8: the step driver in the engine | #867 | Dual run | WS-B | B1; A2 (`fixedStep.ts`); A5's cue test (`frameLoop.ts`) | yes | P2 → P1 | Absent | After B4 |
| B6 | S12 fixed or excepted; the Saves-row audit | #858, #856 | Saves | WS-B | A2 (`load.rs`) | yes | P3 | Open | After B5, before the freeze |
| B7 | #1068 CI repair under the hold | PR #1068 (#1045) | none | WS-B | B3 | n/a (held) | P2 | Red since #1060; owner hold | Tier entries, merge `main`; no merge (D2) |
| PF1 | Protocol runs RUN-0a (now), RUN-0b, RUN-1 to RUN-3 | B3's issue | Performance | WS-P with a local session | RUN-0b on B3 | no | n/a | Not run | RUN-0a now |
| PF2 | Edit scene for the shipping host (M8) | new issue on approval | Performance | WS-P | B3 | no | new → P1 | Not started | After B3 |
| PF3 | The rest of the `perf:worker` cost split, then the bare-step gap; borrowed views if profiling picks them | #1048, #1051, #859 | Performance | WS-P | RUN-0a; B3 for code work; #1048 before #1051 (the owner's 2026-10-16 order) | #1051 and #859 yes; #1048 no | P2 → P1 (#1048); P2 → P1; P3 | #1048 partly landed (#1056); #1051 claim retired; #859 recovered patch | After B3: #1048's remainder; #1051 starts by checking the flat TypeScript curve |
| PF4 | WASM perf baseline in CI; startup accounting; TDT package cost | #900, #983, #1005, #932 | Performance | WS-P | A5 (#900) | #932 yes; the rest no | P3 → P1; P3; P3; P3 → P1 | Recovered patch (#983, #1005) | Apply `perf-startup.patch` |
| C1 | Engine-set check at boot; size budget and old-cache cleanup | #985 | Deployment | WS-C | B0 approved; A3 (S16 depends on S4) | yes (`wasm-build.ts`, `engineAssets.ts`) | P1 | Criteria 1 to 4 and 6 on `main` | After approval |
| C2 | About and diagnostics identity | #963 | Version identity | WS-C | C1 | yes (identity export) | P1 | Absent; earlier work lost | Re-implement before the freeze |
| C3 | Shell precache integrity | #1046 | Deployment (adjacent) | WS-C | A1 signal data | no | P3 (gated) | Design open question | Wait for the signal |
| UI1 | The UI reads the engine catalog | #921, #926 | Authority | WS-D | A5; WS-R for `src/render` | yes (catalog exports) | P1; P2 → P1 | #921 part 1 merged | After A5 |
| RS1 | Rendering stack | PR #817 (#812), PR #831 (#813), PR #1039 (#915) | none | WS-R | a spare thread after WS-P and WS-C while WS-D waits for S6, or after WS-D | no | P1; P2; P3 | Open; #1039 conflicts with its base | Stack order, versions per plan 9.7 |
| X1 | Analytics close-out | #879, #873 | Analytics | Release | S1 (done) | #879 yes | P3; P2 | Open | Fix or exception register; engine-side changes (#879's pins in `gameplay.rs`) before the freeze |
| X2 | Rollback rehearsal, including a deploy rollback to the last release before #902 | #945 | Rollback | Release | OD-5, candidate | no | n/a | Not started | Script at Phase D |
| X3 | Flip PR edits: CLAUDE.md source of truth, CONTRIBUTING build line, `engineChoice.ts`, gallery and baselines from the WASM engine (#878), exception register | #945 | Source of truth, Sign-off | Release | everything | no | P1 | n/a | Owner approval |

## Held, after the flip, or out of path

| Issue | Why |
| --- | --- |
| #1045 (via #1068), #1049, #1050, #1053, #1071, #1058 | Worker host: a measurement placement until after the flip (AD-7) |
| #908, #919, #966, #980, #1057 | After the flip or at retirement |
| #893 | Crate publish for a second frontend; cutover decision 4 leans on it (OD-6) |
| #883, #884 | TDT lock hardening, after the flip; #885, #886, #887 and #920 moved onto the path (A7) |
| #1020, #1021 | Latent host edges and the rest of #923; taken only where a lane touches the same code |

## Shared files (plan 9.5)

| Files | First | Then |
| --- | --- | --- |
| `src/wasmhost/wasmHost.ts`, `telemetry.ts`, `engine-rs/src/wasm.rs`, `engine-rs/src/crowd/mod.rs`, `src/engine/Crowd.ts`, `src/dualrun/binding.ts`, `engine.d.ts`, `src/tests/parity/*`, `vite.config.ts`, `.github/workflows/test.yml` (all in #1062) | WS-B (B1) | WS-A (A2's parity setup, then each A-step PR while it is open); WS-C for the Workbox block in `vite.config.ts`. After B1 merges, other lanes add binding exports in their own PRs (WS-B's B5, WS-C's S17 identity export, WS-D's catalog exports, WS-P's #932 feature split) and merge after any open A-step PR on the same file |
| `src/wasmhost/workerApply.ts`, `workerCore.ts`, `workerHost.ts`, `workerProtocol.ts` | WS-B (B1, then B7) | |
| `src/wasmhost/merge.ts`, `engine-rs/src/load.rs`, `services.rs`, `sim.rs`, `src/engine/sim/*`, `src/engine/serializedGame.ts` | WS-A (A2) | WS-B (B5's `fixedStep.ts`, B6's `load.rs`) after A2 merges |
| `src/wasmhost/startWasmHost.ts`, `workerController.ts`, `hostErrors.ts`, `engineBoot.ts`, `engineChoice.ts`, `src/bootstrap.ts` | WS-A (A1, A3, A4) | WS-C (C1's boot check) after A3 merges; the release lane at the flip. #1062 touches only `startWasmHost.test.ts`, which A3 rebases over |
| `src/analytics*`, the data map | WS-A | The release lane (X1, #873) |
| `src/ui/templates/helpContent.ts` | WS-A (A4's cohort sentence) | WS-C (C2's About changes) |
| `engine-rs/src/bin/fuzz.rs`, `scripts/fuzz-compare.ts`, `engine-fuzz.yml`, the `conformance/` corpus | WS-B (B2, B4) | |
| `src/game/frameLoop.ts` | WS-A (A5's cue-timing test, and #965 if that test fails) | WS-B (B5); A6's #965, if A6's test is the first to fail, rebases over B5 |
| `engine-rs/src/clock.rs` | WS-B (B5) | |
| `src/tests/perfWorker/*`, `src/tests/perfCompare/*`, `scripts/perf-*.ts`, `src/wasmhost/packageHash.ts` | WS-B (B3) | WS-P |
| `engine-rs/src/tower_query.rs`, `tower_routing.rs` (#859) | WS-P (lands before the freeze) | |
| `src/render/**`, sprites | WS-R | WS-D (#921 parts 2b and 2c, and their `src/render` lint rule) after the stack merges or parks |
| `src/ui/**`, `src/game/**` catalog reads | WS-D | |
| The About and Diagnostics UI (#963); `src/build/workboxGlob.ts`, `scripts/verify-precache.ts` (#985 criteria 5 and 7) | WS-C | |
| `scripts/wasm-build.ts`, `src/wasmhost/engineAssets.ts`, `src/wasmhost/enginePackageNames.ts` | WS-C (C1) | WS-P (#932's feature split) |

Shared by every lane and held by none: the locks (`conformance/expected.json`,
`catalog-digests.json` and the rest), regenerated on rebase and never merged
by hand; the gallery and the visual baselines, refreshed only through the
drift check's approval job on the PR that changes pixels; `src/dualrun/exportTiers.ts`, where each lane adds
the tier entries for its own exports in the same PR; `engine-rs/src/lib.rs`
and `engine-rs/Cargo.toml`, where each lane adds its own lines and keeps the
other lane's on rebase; the `package.json` version, per plan 9.7 rule 7; and
`backlog.md`, where each PR edits only its own rows.

## Counting windows

| Window | Started | Key | Nights or sessions | Resets |
| --- | --- | --- | --- | --- |
| Seeded replay (rehearsal) | not started | n/a | 0 | n/a |
| Seeded replay (counting) | not started | the key of plan 4.2 | 0 of 14 | none yet |
| Reliability | not started | build and arm | 0 | n/a |
| Reliability tail | not started | the candidate deploy | 0 | a host-path change after the deploy, or a new key, restarts it (plan 4.1) |

The replay ledger (one line per night: date, key, run link, result) lives in
the live matrix issue.
