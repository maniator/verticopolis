# M4 long-task tolerance from five A/A passes, 2026-11-03

**Snapshot of 2026-11-03 (20:58Z to 22:26Z), not refreshing.** Five `npm run perf:worker -- --aa wasm --reps 10 --scenarios large --viewport 1280x720` passes on commit `5cec61d` (app 2.78.8) on the owner's PC, then `npm run perf:calibrate` over them for the M4 long-task tolerance in the benchmark protocol (section 6.1, OD-4). Live numbers come from re-running those commands. Raw data (the five pass folders and the calibration): the folders named `2026-11-03-5cec61d-run-aa-wasm-worker-*` in [verticopolis-benchmarks](https://github.com/maniator/verticopolis-benchmarks/tree/main/results) (private repository).

- Both slots ran the WASM main-thread host (A/A), so every difference is noise. Only `--aa wasm` ran, since the TypeScript engine is not a shipped slot. Full Chromium 149 on the RTX 3060, High performance power plan, ChatGPT and Chrome closed; idle CPU before the queue was 14 to 25%. No pass was rerun to improve a result; one early attempt with the apps still open was stopped and discarded.

## Top numbers

| Pass | 4x blocking difference, median [95% interval] | Pass value (upper bound) |
| ---- | --------------------------------------------- | ------------------------ |
| 1    | -31.5 [-202, 243] ms                          | 243 ms                   |
| 2    | +34.5 [-183, 84] ms                           | 84 ms                    |
| 3    | -144 [-381, 71] ms                            | 71 ms                    |
| 4    | -27.5 [-90, 200] ms                           | 200 ms                   |
| 5    | -29.5 [-99, 270] ms                           | 270 ms                   |

At 1x the long-task difference was exactly 0 ms in every repetition (mean 67.4 to 67.6 FPS, frame p99 about 29 ms). At 4x both slots block for about 2.4 s per run (mean FPS about 38.5, 1% low about 5.8).

## What it shows

- The M4 candidate is 270 ms against a 50 ms cap, so it is **not adoptable**. The spread is all at 4x, where the paired difference changes sign from pass to pass: noise of the throttled host, not an engine difference.
- `perf:calibrate` also reports 0 usable TypeScript passes, and the protocol's 5% limit would need 20 passes per engine (five give 1 in 6). No tolerance is set.
