# #1051 large-tower fresh-page reading

**Snapshot of one run: `perf:compare --scenarios large --throttles 1,4 --reps 10` on the owner's desktop (NafRogRig) with GPU Chromium on the RTX 3060, 2026-10-21 03:59Z to 04:53Z, on `main` at `9cd44d1` (after #1139, with #1164's fresh-page harness; engine sources hash `af82ce94…`).** It does not refresh. The live numbers come from re-running `npm run perf:compare`, whose definitions are pinned by the tests in `src/tests/perfCompare`. `NOTES.md` is the PC session's record of the run and `report.md` the harness's own output; this file says how to read them. Every figure below is copied from `report.md` or `NOTES.md`, or from the `a532572` reading where it says so, and this file adds no measure of its own.

## What this run answers

The `a532572` after pass (`../2026-10-20-a532572-1051-after`, see its `READING.md`) left the large-tower comparison open, because both passes carried the page-reuse bias of #1162 on large. This run uses a fresh page per measurement, so it is the fair large-tower read.

- **Bare engine, large: WASM faster than TypeScript at both throttles.** Total for the fixed duration, WASM over TypeScript, paired with a 95% interval: 0.43x (0.41 to 0.53) at 1x (309 against 726 ms) and 0.41x (0.39 to 0.42) at 4x (1,975 against 4,846 ms). Every bare step row (median, p95, p99) also reads "wasm faster".
- **The bias is gone.** TypeScript's large median of 726 ms sits near the fresh-page references in `NOTES.md` (705 and 703 ms), where the in-page runs read 1,441 and 1,438 ms (the `a532572` reading).
- **Validation passed**, with 68 warnings about frames over 200 ms that the game clamps (listed at the top of `report.md`), and the Node conformance outcome check on large is the same for both engines.

## What it leaves open

- **Hosted throughput still fails.** As the app hosts it, the WASM engine takes 8.00x (7.79 to 8.28) TypeScript's time at 1x and 8.00x (7.96 to 8.10) at 4x. Host JS sync is 72.3% of the WASM host's time at 1x and 72.0% at 4x, and the engine's own tick 5.3% and 5.5%.
- **Loading a save** is slower on WASM: 2.18x at 1x and 1.69x at 4x for the instance from save.

#1051 stays open for the hosted criterion; the bare criterion on the large tower holds on this run.
