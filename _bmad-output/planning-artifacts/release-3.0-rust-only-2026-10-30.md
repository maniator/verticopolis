# Plan: Rust is the only engine

> **Snapshot of 2026-10-30, written against main at 9472005 (app 2.64.1) and
> updated the same day. It does not refresh.** Owner direction (Naftali,
> 2026-10-30): the Rust engine is the only engine players run, the Settings
> engine choice goes, and the TypeScript engine code is deleted afterwards. It
> ships as normal 2.x releases (PR 1 is #1512: app 2.66.0, engine crate 1.0.0).
> 3.0.0 is reserved for confirmed Classic and .TDT parity and is not tagged
> from this work. #945 stays open as the owner's gate. Live state is in
> #1104 and the PRs.

## Two jobs, not one


1. **Nobody runs the TypeScript engine.** The wasm-only build already exists (`VC_ENGINE=wasm`, `__WASM_ONLY__`): no TypeScript step loop, no fallback, Settings engine choice hidden. CI already builds it (test.yml canary). Making it the shipped build is a small change.
2. **The TypeScript engine code is deleted** (`src/engine/`, 22.6k lines of source, 52 engine tests, 182 other test files import it, plus the read-model merge the UI still reads). This is the facade program in `story-engine-retire-typescript.md`. It is weeks of work and is not needed for job 1.

Recommendation: do job 1 before 3.0, job 2 after, as quiet internal releases. Players cannot tell the difference.

## What goes in job 1 (before 3.0)

- `ts` as an engine choice, `?engine=` links, the `vc.engine` stored value, and the Settings engine row (nothing replaces it).
- The staged cohort: `src/engineCohort/` (about 3.5k lines with tests), the stage constant, the size gate (built, off), and the cohort fields in `engine_status`.
- The TypeScript boot path and the fallback after a refused or failed engine load (`typescriptBoot`, the `!wasmOnly` paths, the runtime restore-point/adopt machinery in the retirement story's #1101 list).
- Dual run and the old measurement hosts as player-reachable options.
- Cohort reports in `scripts/` and the PostHog report/dashboard queries that read cohort fields. Reliability counts stay: `engine_status`, the crash marker and attempt/engaged rows keep telling us how many sessions fail. Dropping the `ts` and `ts-fallback` values is a data-map change, so the old values stay readable for history.

What stays for now: the TypeScript `Simulation` as the UI's read model, the TypeScript catalog tables, the conformance runner's TypeScript side, the shared catalog lock. These go with job 2.

## If WASM fails to load

There is no TypeScript to fall back to, so the failure must be survivable on its own terms:

- Today's wasm-only behavior: the game stops cleanly, names the reason (package mismatch, cache corruption, engine trap) and offers a reload. A trap reloads the game (#1422).
- Kept as it is (owner, 2026-10-30: "failure screen is fine"): the stop screen with its reason, Reload and Repair engine files. It has no save export; the saves stay in the browser's storage as last written. A save export on it is optional follow-up work, not part of this plan. The PWA integrity rule stays: a mismatched binary never runs.
- The unclean-loads-then-TypeScript rule (N=2) has no effect in the wasm-only build: a second crash in a tab stops the game instead.
- 2026 browsers all ship WebAssembly, so the realistic cases are an enterprise policy, a stale or corrupt cache, or a memory-starved phone, not "old browsers".

## Saves

- Rust already loads every save version, runs the migrations and writes saves; the `.vctower` container and slot storage stay in TypeScript (they load without the engine).
- Before the flip, PR 1 must prove it: every legacy save fixture and the nine real SimTower `.TDT` files load in a wasm-only build with the same results, and round-trips are byte-identical where they are bytes. Any save the Rust loader refuses blocks the flip.
- No format change, no save version bump.

## Order of PRs

0. #1508 and #1509 merged first; #1510 and #1511 are open and take later versions (their crate numbers sit below 1.0.0 and must be re-bumped).
1. **#1512: ship the wasm-only build.** Every deploy builds with `VC_ENGINE=wasm`; the Settings engine section, its tests and screenshot helpers are deleted; the Help tip is rewritten; engine crate 1.0.0 and app 2.66.0. The PostHog finding (2026-10-30 06:10 UTC) cleared the Rust boot: main's selectEngine sent 10.3% of 1,000 local draws to Rust and every one booted Rust, so the zero-Rust cohort looks like chance, not a defect.
2. **Dropped.** The existing stop screen stays (see above).
3. **Remove the staged cohort** (`src/engineCohort/` policy and config, its reports and tests, the `engine_status` cohort fields and the Help privacy text about the engine test). Own thread, stacked on #1512. Screenshots rule applies. Closes #1197, #1289, #1251 and #1350 and finishes their backlog rows.
4. **Docs.** This PR: README, CONTRIBUTING, ARCHITECTURE, the engine README, CLAUDE.md and AGENTS.md rewritten for Rust-only; dated "superseded" banners on the release plan, exception register, matrix and priorities, which stay as snapshots. Settles #1112 and #1107 as moot.
5. Job 2, after 3.0: the facade slices, then deleting `src/engine/` behind the retirement story's gates (the sprite gallery and preview pages read the Rust catalog first). Closes the fallback and save-codec issues (#1127 to #1129, #1147, #1148, #1150, #1282, #1498, #1301, #1336, #1057, #1106).

Each PR gets the `/bmad-code-review` pass (the cohort and boot work is plumbing; any engine-data or save-fidelity change gets `/gds-code-review`). Versions: these ship as 2.x releases, each taking the next free number; 3.0.0 is reserved for confirmed Classic and .TDT parity.

## What you will notice as a player

Almost nothing: Settings loses the engine row and, in the rare failure case, the screen is plainer than before. The 2.66.0 player note says "The game runs a little faster." and nothing more about the engine; there is no engine notice beyond the failure screen.

## Gates and approvals that stay yours

- This plan reverses the owner's 2026-10-28 hold ("remove TypeScript after we see it is not needed as a fallback") and replaces the 300 and 1,000 session standards, on his 2026-10-30 direction. Setting the exceptions in the #945 register and publishing 3.0.0 stay his; he armed auto-merge on #1512, which is the deploy.
- The speed line rests on the 2026-10-28 PC run (Leg A on main 3694715: hosted Rust at 0.14x to 0.38x of TypeScript time; cold ready 20 to 25% slower; memory 1.79x on the medium tower and 1.16x on the large). The owner accepts it as proof; the line says nothing about cold start or memory.
- Closing out the cohort drops the TypeScript arm that gave us a side-by-side failure rate. From then on the evidence is the absolute failure rate on Rust. I would keep `engine_status` as is and add no new analytics fields.
