# #1111 M4 A/A passes on the owner's PC, notes

> **Snapshot, measured 2026-11-03 (20:58Z to 22:26Z) on commit `5cec61d` (app 2.78.8).** Live numbers: re-run `npm.cmd run perf:worker -- --aa wasm ...` and `npm.cmd run perf:calibrate`. These are five A/A passes and no verdict: the tolerance is not adopted.

## Command

```powershell
npm.cmd run perf:worker -- --aa wasm --reps 10 --scenarios large --viewport 1280x720 --skip-build --out docs/performance/results/2026-11-03-5cec61d-run-aa-wasm-worker-1280x720-<n>   # n = 1..5
npm.cmd run perf:calibrate -- <the five folders> --out docs/performance/results/2026-11-03-5cec61d-run-aa-wasm-worker-calibration
```

Only `--aa wasm` ran: the TypeScript engine is not a shipped slot, so no `--aa ts` pass was made (coordinator rule: no perf testing of the TS engine).

## Machine state

- Ryzen 5 5600X (6c/12t), 31.9 GiB, Windows 11 Pro 10.0.26200, RTX 3060, Node 22.22.0, rustc 1.97.0, Playwright 1.61.1.
- Browser: full Chromium 149.0.7827.55 via `PW_CHROMIUM_PATH` (headless). Renderer on every folder: ANGLE (NVIDIA RTX 3060, Direct3D11), hardware, no context loss.
- Power plan: High performance (8c5e7fda-...), was already active.
- Before the timed queue the owner allowed closing apps: ChatGPT and Google Chrome were closed. The NVIDIA Overlay and nvcontainer processes were still running (they respawn). Idle total CPU just before the queue: 14, 25 and 16 percent (three 2 s samples), higher than a quiet machine; no local model inference was running.
- Fresh worktree on `origin/main` 5cec61d1, `npm ci`, `npm run wasm:build`; `git status --porcelain` empty before and during the runs. Engine package: wasm `8b8a35d95d785941`, glue `c4c29dfd63eec1b0`, source hash `70e0046a...1abb`.
- Run order: one pass at a time, back to back, nothing else timed.

## Discarded and restarted runs (disclosure)

1. A first attempt at pass 1 was started with ChatGPT and Chrome still running. It was stopped before it finished and its partial output deleted; nothing from it is in the folders.
2. After the apps were closed, pass 1 ran. The loop script's first attempt at pass 2 failed immediately on an argument-passing bug in my wrapper (no measurement taken, no folder kept), then passes 2 to 5 ran with `--skip-build` against the same `dist-perf` build as pass 1.
3. No pass was rerun to improve a result.

## Results

All five folders: Validation passed, 10 pairs at each throttle, clean tree.

| Pass | 1x blocking diff (ms) | 4x blocking diff, median [95% interval] (ms) | pass value (upper bound, larger of 1x/4x) |
| --- | --- | --- | --- |
| 1 | 0 | -31.5 [-202, 243] | 243 |
| 2 | 0 | +34.5 [-183, 84] | 84 |
| 3 | 0 | -144 [-381, 71] | 71 |
| 4 | 0 | -27.5 [-90, 200] | 200 |
| 5 | 0 | -29.5 [-99, 270] | 270 |

- Large tower, 1x: long-task blocking is 0 ms in every rep of both slots; mean FPS 67.4 to 67.6 in both slots; 1% low about 31 to 32 FPS; frame p99 about 29 ms.
- Large tower, 4x: blocking is about 2.4 s per run in both slots; mean FPS about 38.5; 1% low about 5.8 FPS; frame p99 about 135 to 148 ms.
- `perf:calibrate` result: M4 candidate **270 ms against a 50 ms cap: not adoptable**. It also reports 0 usable `ts` passes (not run by design) and says no coverage guarantee can be stated; the protocol's 5 percent limit needs 20 passes per engine (five give 1/6).

## Reading

At 1x the long-task difference is exactly zero, so a tolerance there is not the problem. The whole spread is at 4x, where the CPU throttle makes ~2.4 s of blocking per run and the median paired difference changes sign from pass to pass (the upper bounds range 71 to 270 ms). That is run-to-run noise of the throttled host, not an engine difference (both slots ran the same engine). Per section 6.1 step 4 the coordinator takes a missed cap to the owner after two rounds; the options are more passes, a different statistic, or an M4 row at 1x only. This folder sets no tolerance.
