# Interaction benchmark, 156d4bee against b66159d4

**Snapshot of 2026-11-04, not refreshing.** One run of `npm run perf:interaction` (see [interaction-benchmark.md](../interaction-benchmark.md)); run it again for current figures. It is not a gate. The raw `results.json`, the full `report.md` and the run log are in the project's shared folder (`interaction-156d4bee-vs-b66159d4-report.md`, `-results.json`, `interaction-run-log.txt`), not in the repo.

- Arm A: 2.78.11 at `156d4bee`. Arm B: 2.78.12 at `b66159d4`. Both are tooling builds from their own worktrees.
- Large tower (43,358 units), 6 paired repetitions at 1x and 4x CPU throttle, 20 s per phase with one autosave in the middle, a fresh Chrome 156 per arm, arms alternating.
- Machine: Windows PC, Ryzen 5 5600X, RTX 3060 through ANGLE (D3D11).
- Every arm ran clean: 0 page errors and 0 frame errors.

## Top numbers

Medians over the 6 pairs. Frame p99 is in ms, long tasks in ms per second of the phase. "B vs A" is the paired ratio for frame p99 (below 1 is shorter frames) and the paired difference for long tasks (negative is less blocking); the interval is the 95% interval.

| CPU | Phase   | Frame p99 A | Frame p99 B | B vs A                  | Long tasks A | Long tasks B | B minus A                |
| --- | ------- | ----------- | ----------- | ----------------------- | ------------ | ------------ | ------------------------ |
| 1x  | pan     | 15.5        | 15.5        | x0.999 (0.998 to 1.000) | 14.1         | 13.7         | -0.3 (-3.3 to 0.3)       |
| 1x  | panels  | 15.6        | 15.6        | x0.999 (0.997 to 1.003) | 32.6         | 32.9         | -0.5 (-3.9 to 4.1)       |
| 1x  | build   | 161.3       | 161.0       | x1.000 (0.917 to 1.091) | 255.3        | 253.3        | -4.6 (-13.3 to 19.4)     |
| 4x  | idle    | 164.7       | 142.6       | x0.872 (0.761 to 0.903) | 395.2        | 260.5        | -136.1 (-158.4 to -72.8) |
| 4x  | pan     | 135.0       | 117.0       | x0.889 (0.708 to 0.984) | 486.1        | 364.1        | -122.0 (-162.2 to -85.6) |
| 4x  | zoom    | 102.1       | 82.5        | x0.807 (0.725 to 0.868) | 331.0        | 201.8        | -122.0 (-167.4 to -96.1) |
| 4x  | panels  | 286.8       | 319.2       | x1.088 (0.623 to 1.420) | 414.3        | 283.2        | -112.9 (-141.4 to -75.2) |
| 4x  | build   | 1011.3      | 1017.3      | x0.997 (0.948 to 1.178) | 868.5        | 845.0        | -18.1 (-31.7 to -4.2)    |
| 4x  | inspect | 103.2       | 89.1        | x0.861 (0.773 to 1.141) | 326.3        | 190.6        | -148.6 (-169.5 to -72.0) |

## What it shows

- At 1x the two builds are the same on every metric in every phase: frame p95, p99, 1% low, long tasks and input delay all sit inside the noise. The one clear 1x difference is input to the next frame p99 while panning, 3.5 ms lower in B (interval -5.1 to -2.1).
- At 4x throttle, B blocks the main thread less in every phase (long tasks 113 to 149 ms per second lower in idle, pan, zoom, panels and inspect; 18 ms lower in build), and its frame p99 is shorter in idle, pan and zoom (x0.81 to x0.89, intervals below 1).
- Build at 4x is dominated by the work of the interaction itself (frame p99 about 1 s) and shows no clear frame-time change. In panels, frame p95 is shorter in B (x0.824, 0.718 to 0.980) while frame p99 shows no clear change (x1.088, 0.623 to 1.420).
- Adverse result: at 4x in the panels phase B has more slow clicks and keys per minute (72.3 in A, 78.3 in B, +6.2 per minute, interval 0.9 to 9.3, which excludes zero). The pan phase leans the same way at 4x (+6.1 per minute, interval -0.0 to 11.9). Everywhere else slow clicks and keys are level, and the p98 and worst delay of a slow click are no worse in B.
- Not shown: anything about the engine's step cost, startup or memory (other benchmarks cover those), or a different tower size.
