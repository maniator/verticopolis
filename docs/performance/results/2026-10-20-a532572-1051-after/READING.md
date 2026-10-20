# #1051 before/after reading

**Snapshot of two runs: `perf:compare`, 10 repetitions each, on the owner's desktop (NafRogRig) with GPU Chromium on the RTX 3060, on 2026-10-20. BEFORE is `main` at `06a6dcb` (17:20Z to 18:55Z, folder `../2026-10-20-06a6dcb-1051-before`); AFTER is `a532572`, the measured commit of PR #1139 (18:55Z to 20:28Z, this folder).** Neither run refreshes. The live numbers come from re-running `npm run perf:compare`, whose definitions are pinned by the tests in `src/tests/perfCompare`. `NOTES.md` is the PC session's record of both runs; this file says how to read them. Every figure below is copied from the two `report.md` or `metrics.csv` files, or from `docs/performance/benchmark-protocol.md`. This file adds no measure of its own: where it compares two copied figures, it says against what.

## What this pair shows

The pair is the evidence for PR #1139 as an optimization of the Rust engine: the same harness, machine, browser and renderer, before and after the change. It is not the cross-engine acceptance of #1051, and #1051 stays open.

- **Bare WASM engine: faster in every row.** On all four scenario and throttle rows the AFTER interval of the median lies wholly below the BEFORE interval, for the total and for the step p99.
- **TypeScript, the drift control, held still.** TypeScript runs the same code in both runs. On every row its BEFORE and AFTER medians, bare and hosted, are within the protocol's 5% control band of each other (section 6.2 of `docs/performance/benchmark-protocol.md`), so the machine did not drift measurably between the runs.
- **Hosted WASM improved only a little and still fails.** The app's main-thread WASM host is still slower than TypeScript on every row. Its time is now mostly host-side sync, which this PR does not touch.
- **Frame pacing still fails.** On medium, the WASM app's frame time p99 and 1% low FPS remain worse than TypeScript's.

## Bare engine, 720 steps, median [95% interval of the median], ms

| Scenario | CPU | Engine | Before (`06a6dcb`) | After (`a532572`) |
| --- | --- | --- | --- | --- |
| medium | 1x | WASM | 393 [391, 527] | 222 [220, 302] |
| medium | 1x | TypeScript | 767 [757, 793] | 779 [757, 900] |
| medium | 4x | WASM | 2,479 [2,468, 2,509] | 1,477 [1,426, 1,481] |
| medium | 4x | TypeScript | 4,789 [4,745, 4,940] | 4,704 [4,657, 4,877] |
| large | 1x | WASM | 822 [817, 835] | 296 [292, 299] |
| large | 1x | TypeScript (inflated, see below) | 1,441 [1,428, 1,669] | 1,438 [1,422, 1,444] |
| large | 4x | WASM | 5,236 [5,176, 5,272] | 1,944 [1,912, 1,958] |
| large | 4x | TypeScript (inflated, see below) | 9,379 [9,318, 9,413] | 9,408 [9,310, 9,481] |

Bare step p99, ms: WASM medium 1x 4.49 [4.25, 6.42] to 1.72 [1.67, 2.39], medium 4x 30.0 [29.6, 30.4] to 11.4 [11.2, 11.7], large 1x 11.5 [11.3, 11.6] to 2.88 [2.81, 2.95], large 4x 77.6 [77.0, 78.4] to 19.0 [18.8, 19.4]. TypeScript's p99 intervals overlap between the runs on every row.

Medium is the one valid cross-engine row (see the bias below). There the AFTER report gives WASM over TypeScript, paired: 0.29x (0.25 to 0.40) at 1x and 0.31x (0.29 to 0.32) at 4x, against 0.52x (0.49 to 0.69) and 0.52x (0.51 to 0.52) in BEFORE.

## Engine as the app hosts it (main-thread WASM host), 720 steps, ms

| Scenario | CPU | Engine | Before | After |
| --- | --- | --- | --- | --- |
| medium | 1x | WASM | 2,341 [2,308, 2,511] | 2,128 [2,091, 2,263] |
| medium | 1x | TypeScript | 818 [804, 942] | 818 [804, 867] |
| medium | 4x | WASM | 13,878 [13,807, 13,901] | 12,872 [12,812, 13,040] |
| medium | 4x | TypeScript | 4,707 [4,645, 4,812] | 4,758 [4,682, 4,844] |
| large | 1x | WASM | 7,623 [7,490, 7,951] | 7,047 [6,825, 7,214] |
| large | 1x | TypeScript | 1,374 [1,364, 1,394] | 1,377 [1,349, 1,392] |
| large | 4x | WASM | 46,318 [46,229, 46,670] | 42,789 [42,644, 43,040] |
| large | 4x | TypeScript | 9,272 [9,229, 9,321] | 9,264 [9,172, 9,303] |

Medium hosted WASM over TypeScript, paired: 2.85x (2.48 to 3.10) BEFORE and 2.58x (2.49 to 2.73) AFTER at 1x; 2.94x (2.89 to 2.99) and 2.72x (2.65 to 2.75) at 4x. The attribution pass shows why the gain is small: on large at 1x the engine's tick fell from 13.6% to 4.8% of hosted time, and host JS sync now takes 74.6%. Closing that gap is the sync work (#1068 and the worker host), not the engine. #1101, merged after both runs, changed the main-thread host, so these hosted rows describe the host as it was at `06a6dcb`.

## Frames (audio off), medium, WASM over TypeScript

| CPU | Metric | Before: TS, WASM, ratio | After: TS, WASM, ratio |
| --- | --- | --- | --- |
| 1x | frame time p99 | 29.30, 45.27 ms, 1.56x (1.53 to 1.90) | 29.09, 44.79 ms, 1.54x (1.52 to 1.76) |
| 1x | 1% low FPS | 33.56, 16.21 fps, 0.48x (0.45 to 0.51) | 33.65, 18.37 fps, 0.55x (0.51 to 0.57) |
| 4x | frame time p99 | 176, 390 ms, 2.19x (2.11 to 2.37) | 177, 355 ms, 2.01x (2.00 to 2.08) |
| 4x | 1% low FPS | 5.41, 2.26 fps, 0.43x (0.39 to 0.47) | 5.41, 2.49 fps, 0.47x (0.43 to 0.53) |

The frame rows run the main-thread WASM host, so they fail for the same reason the hosted rows do.

## Read this first

- **Cross-engine ratios on the large tower are invalid in both runs.** At `06a6dcb` and `a532572`, `perf:compare` times large in a page that already ran medium, and the TypeScript engine runs slower there (most likely JIT state; the protocol leaves the cause open). Section 4 of `docs/performance/benchmark-protocol.md` records the size from the BEFORE run: TypeScript's bare large time is 1,441 ms here against 705 ms in a page of its own with `perf:worker`, and WASM is not affected. So every WASM over TypeScript ratio on large (bare, hosted and frames) is biased toward WASM. #1162 records the bias and #1164 fixed it on `main`. Within-engine before/after rows are valid, because both runs carry the same bias with the same harness (`git diff 06a6dcb a532572 -- src/tests scripts` is empty).
- **#1051's bare-engine criterion is not claimed here.** Its large-tower comparison against TypeScript is a fresh-page `perf:compare` run on `main` at `9cd44d1` (the merge of #1139) with #1164's harness, queued for the PC.
- **#1051's hosted throughput criterion fails**, and so does frame pacing. #1051 stays open for them.
- **Where it ran.** Both runs ran on the owner's PC (Windows 11, Ryzen 5 5600X, RTX 3060) with Playwright's full Chromium 149.0.7827.55, headless, rendering on the GPU: the Environment table's WebGL renderer row names the RTX 3060, and `preflight.txt` checked three launches before each run. Two Limitations lines in both reports said otherwise ("headless Chromium in a container" and "a software WebGL rasterizer"); they were fixed text in the harness at these commits, and both reports now carry corrected lines marked as edited after generation. `results.json` keeps the generated text.
- **No `gpuVerified` field.** Both commits predate #1124 (the working-tree record) and #1125 (the renderer check that records `gpuVerified`), so `results.json` has neither. The GPU evidence is the preflight and the renderer row; the clean tree is `results.json`'s `dirty: false` and the PC session's `git status --porcelain` in `NOTES.md`. `perf:before-after` would refuse these folders for that reason, which is one more reason the pair is read from the reports here and not through that tool.
- The BEFORE report's Environment row names public `main` as `06a6dcb`; the AFTER report names `c12bc1b`, the `main` of the hour it ran. AFTER measured `a532572` itself, a branch of `06a6dcb` that changes only `engine-rs`. Both trees were clean (`dirty: false`), and the engine package hashes match the expected ones (`ef3616e6…` and `87617ea9…`).
- `NOTES.md` was written on the PC before this commit; its line that nothing was committed or pushed was true then.
- PR #1139's later commits add tests, comments and merges of `main` to `a532572`. Its own engine code compiles to the same code section as its third commit, and a paired cloud timing of that commit against `a532572` put every interval across zero (see the PR). `main` at `9cd44d1` also carries other PRs' engine changes (#1101's attach-time commute seeding and #1157's identity record), which is one reason the fresh-page run measures `main` itself.
