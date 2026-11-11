# Session B: performance on the 3.0.0 release head, 2026-11-10

**Snapshot of 2026-11-10 (America/New_York), not refreshing.** Live numbers come from `npm run perf:compare` and `npm run perf:worker` ([benchmark-protocol.md](../benchmark-protocol.md)). The raw folders, CSV files, run logs and the CPU-idle notes are in [verticopolis-benchmarks](https://github.com/maniator/verticopolis-benchmarks/tree/main/results) (private repository) under the folders named below, not in this repo.

- Commit `b8f5dec` ("Release 3.0.0", app 3.0.0), clean tree. Engine package hash `5ef88125a6b49938fe8e52d4bd4e30ff3c9bf1533bc45302d8b108eb992f2b15`.
- Machine: Windows 11 build 26200, Ryzen 5 5600X (12 threads), 32 GB, RTX 3060 (ANGLE D3D11), High performance power plan. Playwright's full Chromium 149.0.7827.55, headless, Node 22.22.0. The TypeScript arm is the pinned pre-cutover build `f3304e3` (app 2.77.5), so the arms differ in app code as well as engine.
- 10 repetitions per engine, each in a fresh browser, engine order rotated; towers small (729 people), medium (3,219) and large (17,314); 1x and 4x CPU throttle. Validation passed in every b8f5dec report.
- Machine state: each timed stage started only at 90% idle or better with no installer process (gate 90.9%, M4 91.9%, M5 91.9%). Chrome and the NVIDIA Overlay were open and idle. Windows servicing (`TrustedInstaller`) ran for about two minutes (20:53 to 20:55) during the gate; the owner accepted the gate with that note. No installer process ran during the M4 or M5 runs.

## Gate (`2026-11-10-b8f5dec-gate`, 20:35 to 22:09)

M5, cold start to ready, paired WASM minus TypeScript, median and 95% interval (bar: at most +100 ms at 1x, saved towers the same):

| Start | Paired difference |
| --- | --- |
| cold, 1x | +35.0 ms (10.3 to 119) |
| cold, 4x | +156 ms (116 to 224) |
| saved small tower, 1x | +33.7 ms (24.1 to 54.6) |
| saved medium tower, 1x | +33.9 ms (23.6 to 55.3) |
| saved large tower, 1x | +68.6 ms (46.5 to 97.4) |
| warm, 1x | +23.9 ms (15.9 to 40.7) |

Every median is under +100 ms. Only the unsaved cold start's upper interval edge (119) is above it.

Simulation of 24 in-game hours (720 steps of 2 minutes after 120 warmup steps), engine as the app hosts it, total time TypeScript then WASM:

| Tower | 1x | 4x |
| --- | --- | --- |
| small | 179 to 50.8 ms (0.28x) | 977 to 359 ms (0.37x) |
| medium | 888 to 143 ms (0.16x) | 5,430 to 878 ms (0.16x) |
| large | 955 to 136 ms (0.15x) | 5,981 to 909 ms (0.15x) |

Step p99 at 1x: small 1.01 to 0.235 ms, medium 6.47 to 1.35 ms, large 6.85 to 1.95 ms. The bare engine reads 133 to 39.1 ms (small), 856 to 119 ms (medium) and 871 to 124 ms (large) at 1x.

Frames (15 s window at speed index 3, audio off): mean FPS is level at 1x on all three towers (68.5 and 68.6 small, 66.4 and 68.2 medium, 67.3 and 67.9 large). The 1% low is 33.3 to 50.8 FPS on medium and 30.7 to 34.6 on large; p99 frame time on medium and large falls from about 29.5 to 15.5 ms. At 4x WASM is ahead on every frame row; mean FPS is 40.0 to 45.0 (small), 9.7 to 17.9 (medium) and 20.7 to 41.0 (large).

Memory, JS heap plus WASM linear memory, TypeScript then WASM: 47.7 to 49.1 MiB (small), 60.3 to 81.1 MiB (medium), 79.9 to 92.1 MiB (large). WASM linear memory alone is 2.25, 20.5 and 23.1 MiB. Loading a save (adopt) at 1x takes 8.9 to 13.3 ms, 65 to 96 ms and 77 to 86 ms. Package: the `.wasm` is 2.12 MiB raw, 666 KiB gzip and 476 KiB Brotli; the game files are 5.02 MiB raw and 1.03 MiB Brotli.

## M4 worker run (`2026-11-10-b8f5dec-worker-1280x720`, 22:09 to 23:00)

`npm run perf:worker -- --reps 10 --viewport 1280x720`. Main-thread blocking by long tasks past 50 ms per frames window, TypeScript then WASM, paired difference (WASM minus TypeScript) with its 95% interval:

| Tower | 1x | 4x |
| --- | --- | --- |
| small | 0 and 0 | 553 to 170 ms (-385, -672 to -232) |
| medium | 0 and 0 | 7,987 to 4,440 ms (-3,575, -3,758 to -3,235) |
| large | 0 and 0 | 4,939 to 1,547 ms (-3,359, -3,568 to -3,163) |

M4 binds at 1x, where neither engine produced a long task. The 4x rows are report-only and favor WASM. Validation: no errors.

## M5 small (`2026-11-10-b8f5dec-m5`, 23:01 to 23:32)

`npm run perf:compare -- --reps 10 --scenarios small --throttles 1,4`, validation passed. Cold start to ready, paired difference: 1x +36.2 ms (-11.4 to 63.2), 4x +153 ms (126 to 201). Saved small tower at 1x: +28.6 ms (22.1 to 44.6). Medians: cold ready 454 to 493 ms at 1x and 613 to 777 ms at 4x; warm ready 69.5 to 102 ms; first frame after ready 559 to 580 ms at 1x. This agrees with the gate and is inside the +100 ms bar.

## Supporting runs (earlier SHAs, not the candidate)

- `2026-11-10-f28b520-gate` and its A/A pass `...-gate-aa-wasm-1` (main at app 2.89.0, 10:10 to 13:13): cold start to ready +57.1 ms at 1x (5.3 to 74.3) and +161 ms at 4x; saved towers +38.7, +50.5 and +65.2 ms. The A/A pass read 0.99x (0.88 to 1.09) at 1x and 1.01x at 4x on cold ready.
- `2026-11-10-f28b520-load-memory`: peak WASM memory 2.25, 19.69 and 22.56 MiB for small, medium and large, no trap.
- #1864 M5 pair, small tower, cold start to ready paired difference: before `88804fa1` +35.3 ms at 1x (-11.8 to 115) and +171 ms at 4x; after `4e035e7` +69.8 ms at 1x (39.5 to 139) and +150 ms at 4x (108 to 193). The change shows no measurable gain at 1x (the intervals overlap). The after arm started with 37% idle CPU, so it is noisy.
- `2026-11-10-6a6517a7-gate-RESUMED-NOT-COUNTED`: a gate on 6a6517a7 that was killed once at rep 7 when the agent session restarted and was resumed from its checkpoint. The release driver decided not to count it. A worker run on the same SHA overlapped a software install and was stopped; it has no result.

## Not measured

Process memory (PSS) rows are empty on Windows. The 17,314-person tower is a generated fixture, so no real save of that size was run. Safari was not measured.
