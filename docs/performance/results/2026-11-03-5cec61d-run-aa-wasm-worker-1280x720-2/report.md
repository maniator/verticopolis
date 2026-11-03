# Worker host A/A pass (npm run perf:worker -- --aa wasm)

> **Snapshot, measured 2026-11-03T21:16:18.951Z to 2026-11-03T21:33:49.281Z on commit `5cec61d` (app 2.78.8).** Live numbers: re-run `npm run perf:worker` (src/tests/perfWorker/, its arithmetic pinned by src/tests/perfWorker/analysis.test.ts). Validation passed.

> **A/A pass.** Both slots ran the WASM main-thread host mode. The "ts" and "wasm" labels below name the two slots, and every ratio is slot "wasm" over slot "ts" (or the reverse where a column says so). This folder is one input to the M4 long-task tolerance in benchmark-protocol.md section 6.1. No tolerance is read off one folder, and there is no verdict: the intervals are the data.

- Working tree: clean (nothing outside docs/performance/results)
- Engine package: verticopolis_engine_bg.wasm `8b8a35d95d785941`, verticopolis_engine.js `c4c29dfd63eec1b0`; source hash `70e0046aa86f4b8911646c18df527914ce6737f9baaf63cea50b16d91ab1b473`
- Machine: AMD Ryzen 5 5600X 6-Core Processor             , 12 CPUs, 31.9 GiB, win32 10.0.26200; Node v22.22.0; Playwright 1.61.1
- Browser: Chromium 149.0.7827.55 (headless, C:\Users\nafta\AppData\Local\ms-playwright\chromium-1228\chrome-win64\chrome.exe)
- Renderer: ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11); cross-origin isolated: true; frames at a 1280x720 CSS viewport
- 10 repetitions of ts, wasm, each in a fresh browser process, order rotated by repetition; throttles 1x, 4x
- Scenarios: large (17314 population, `fe381e36acf1`)
- Download (production build, Brotli 11): engine worker chunk not run (this build has none); engine package (WASM modes) 457.3 KiB (2.06 MiB raw); all other JavaScript 391.0 KiB

Medians with their 95% order-statistic interval. Ratios are paired by repetition (mode over the column's reference); a verdict needs six pairs and an interval clear of a 5% band. `wasm-worker / wasm-frame` compares two hosts with the same sync changes, so it is the worker placement alone; `wasm-frame / wasm` is the sync changes alone. The gate column leads with the gate's orientation; the full set of ratios is in ratios.csv. A ratio marked with `(k zero)` dropped k repetitions where the reference was 0.

## startup

| scenario | throttle | metric | slot wasm / slot ts (rates: ts / wasm) | slot ts | slot wasm |
| --- | --- | --- | --- | --- | --- |
| - | 1x | cold start to mode ready (ms) | 0.99x [0.93, 1.05] | 590 [568, 617] | 602 [557, 620] |
| - | 1x | warm start to mode ready (ms) | 1.06x [1.00, 1.11] | 152 [150, 158] | 160 [157, 169] |
| - | 4x | cold start to mode ready (ms) | 1.03x [0.98, 1.06] | 1101 [1084, 1185] | 1131 [1111, 1196] |
| - | 1x | bytes before mode ready (cold) (bytes) | 1.00x [1.00, 1.00] | 794.1 KiB [794.1 KiB, 794.1 KiB] | 794.1 KiB [794.1 KiB, 794.1 KiB] |

## raw

| scenario | throttle | metric | slot wasm / slot ts (rates: ts / wasm) | slot ts | slot wasm |
| --- | --- | --- | --- | --- | --- |
| large | 1x | bare engine, 720 steps (ms) | 1.00x [0.97, 1.06] | 132 [130, 139] | 134 [130, 140] |
| large | 4x | bare engine, 720 steps (ms) | 1.00x [0.99, 1.06] | 827 [796, 836] | 830 [821, 853] |

## hosted

| scenario | throttle | metric | slot wasm / slot ts (rates: ts / wasm) | slot ts | slot wasm |
| --- | --- | --- | --- | --- | --- |
| large | 1x | wall time, 720 steps (ms) | 0.99x [0.78, 1.05] | 154 [150, 199] | 154 [153, 161] |
| large | 1x | main-thread time, 720 steps (ms) | 0.99x [0.78, 1.05] | 154 [150, 198] | 154 [153, 161] |
| large | 1x | main-thread time per batch, p95 (ms) | 0.97x [0.76, 1.08] | 3.08 [2.82, 3.87] | 3.00 [2.83, 3.23] |
| large | 1x | main-thread time per batch, max (ms) | 0.98x [0.79, 1.16] | 14.7 [14.0, 17.6] | 15.1 [13.9, 16.2] |
| large | 4x | wall time, 720 steps (ms) | 1.01x [0.98, 1.02] | 871 [844, 884] | 874 [868, 890] |
| large | 4x | main-thread time, 720 steps (ms) | 1.01x [0.98, 1.02] | 870 [844, 883] | 874 [867, 890] |
| large | 4x | main-thread time per batch, p95 (ms) | 1.00x [0.95, 1.05] | 17.3 [16.6, 18.1] | 17.4 [16.9, 17.5] |
| large | 4x | main-thread time per batch, max (ms) | 1.01x [0.96, 1.06] | 67.5 [66.0, 70.0] | 68.3 [66.7, 73.1] |

## frames

| scenario | throttle | metric | slot wasm / slot ts (rates: ts / wasm) | slot ts | slot wasm |
| --- | --- | --- | --- | --- | --- |
| large | 1x | mean FPS (fps) | 1.00x [1.00, 1.00] | 67.5 [67.4, 67.6] | 67.6 [67.5, 67.8] |
| large | 1x | 1% low FPS (fps) | 1.02x [0.95, 1.05] | 32.0 [30.6, 32.3] | 32.0 [30.7, 32.3] |
| large | 1x | frame time p95 (ms) | 1.00x [1.00, 1.00] | 15.1 [15.1, 15.1] | 15.1 [15.1, 15.1] |
| large | 1x | frame time p99 (ms) | 0.99x [0.56, 1.01] | 29.1 [28.8, 29.4] | 28.8 [16.4, 29.2] |
| large | 1x | sim minutes per second (min/s) | 1.00x [1.00, 1.00] | 120 [120, 120] | 120 [120, 120] |
| large | 1x | frames over 200 ms (clamped) (count) |  | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| large | 1x | main-thread blocking (long tasks past 50 ms) (ms) | 0.00 [0.00, 0.00], 10 pairs (slot wasm minus slot ts) | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |
| large | 1x | command to visible frame, median (ms) | 1.00x [0.96, 1.10] | 13.9 [13.1, 14.2] | 14.0 [13.6, 14.2] |
| large | 1x | command to visible frame, p95 (ms) | 0.94x [0.73, 1.34] | 15.5 [14.9, 20.3] | 15.1 [14.6, 20.4] |
| large | 4x | mean FPS (fps) | 1.00x [0.98, 1.03] | 38.9 [38.0, 39.1] | 38.7 [38.0, 39.3] |
| large | 4x | 1% low FPS (fps) | 0.99x [0.91, 1.08] | 5.82 [5.57, 5.98] | 5.91 [5.68, 6.06] |
| large | 4x | frame time p95 (ms) | 0.99x [0.92, 1.03] | 80.0 [74.4, 88.1] | 74.9 [74.1, 87.7] |
| large | 4x | frame time p99 (ms) | 1.00x [0.98, 1.07] | 137 [135, 147] | 141 [136, 151] |
| large | 4x | sim minutes per second (min/s) | 1.00x [0.99, 1.01] | 117 [116, 117] | 117 [116, 117] |
| large | 4x | frames over 200 ms (clamped) (count) | 0.00x (7 zero) | 0.00 [0.00, 1.00] | 0.00 [0.00, 1.00] |
| large | 4x | main-thread blocking (long tasks past 50 ms) (ms) | 34.5 [-183, 84.0], 10 pairs (slot wasm minus slot ts) | 2410 [2347, 2442] | 2397 [2326, 2459] |
| large | 4x | command to visible frame, median (ms) | 0.99x [0.81, 1.17] | 18.9 [16.2, 22.8] | 18.7 [17.5, 19.8] |
| large | 4x | command to visible frame, p95 (ms) | 1.01x [0.92, 1.05] | 107 [103, 110] | 107 [96.4, 111] |

## memory

| scenario | throttle | metric | slot wasm / slot ts (rates: ts / wasm) | slot ts | slot wasm |
| --- | --- | --- | --- | --- | --- |
| large | 1x | main-thread JS heap (bytes) | 1.00x [0.99, 1.02] | 67.88 MiB [67.66 MiB, 68.22 MiB] | 67.87 MiB [67.66 MiB, 69.32 MiB] |
| large | 1x | JS heaps + WASM memory (main and worker) (bytes) | 1.00x [1.00, 1.02] | 86.38 MiB [86.16 MiB, 86.72 MiB] | 86.37 MiB [86.16 MiB, 87.82 MiB] |
| large | 1x | browser process PSS (bytes) |  | n/a | n/a |

## Offline restart

- ts: wasm online, wasm offline
- wasm: wasm online, wasm offline

## Validation

- no errors

## Limitations

- An A/A pass: the WASM main-thread host mode ran in both slots. The wasm-frame and wasm-worker modes did not run, so their columns and the comparisons with them are absent. A slot's name is a label, not the mode that ran; each run records both.
- One machine and one headless browser (its name and version are in the Browser row). The renderer line says whether the page used the GPU; a software rasterizer fails validation in a protocol run, because render cost then dominates every frame and the FPS rows say more about the CPU than about GPU-backed frame rates.
- CPU throttling is DevTools emulation of the page's main thread. Chromium refuses it on worker targets and a page-level throttle leaves a dedicated worker nearly unthrottled (probed on Chromium 141: a busy loop took 41 ms at 1x and 44 to 58 ms with the page at 4x, 7 to 41% slower against about 4x on the main thread). So at a throttle above 1x the worker host's main thread ran throttled and its engine thread did not; its rows are marked † and carry an `unthrottled` column in the CSVs. A comparison of the worker host with a main-thread host at that throttle favors the worker. Two runs of the same mode are comparable with each other.
- Hosted rows run 720 steps of 2 minutes in batches of 4 (the frame loop's cap is 4) with no rendering. Wall time includes the worker host's wait for each reply; main-thread time counts the steps, the flushes and the time applying replies, and leaves the worker's own time out (reported apart). The browser's unpacking of each reply (the structured clone of its strings, the full save's included) runs on the main thread before the host sees the reply and is not in the hosted main-thread rows; the frames rows (frame times, long tasks) include it.
- The worker host keeps one batch in flight. A frame that finds a batch still out takes no steps (the frame loop banks its minutes under the 30-minute cap), so on a tower the engine cannot step in real time the worker host simulates fewer minutes per second rather than queueing work; the sim-minutes-per-second row shows it.
- Command latency times a tower rename (relayed by every host, read by nothing in the simulation) from the call to the clock inside the first frame callback that runs once the engine's answer is in the read model. The main-thread hosts answer in the call, so their figure is the wait for the next frame callback. One command is in flight at a time, one per second. A negative sample fails validation.
- Memory is measured after 30 steps on a freshly loaded page, after a forced GC. The harness keeps the scenario saves it loads from in the page for every mode (the same text in every mode's JS heap rows); its own stashed start and end saves are dropped before the read. WASM linear memory only grows, so it is a high-water mark that includes the boot tower. The worker's JS heap is read through the DevTools target protocol; when that is unavailable the combined row has no worker sample. Process PSS sums the browser's processes (Linux).
- Frames render at a 1280x720 CSS viewport (set with --viewport). A frame longer than 200 ms is handed 1 ms of game time, so rows with clamped frames understate the simulation work; the clamped-frame row counts them.
- Message sizes are counted on the way in (frame views, full saves, events, log and pending text at two bytes a character); the way out (steps and commands, a few numbers each) is not measured, so as not to serialize every message twice on the measured thread.
- The serialize and deserialize halves of the full save are split only on the worker host (the worker's reply time includes the serialize, the main thread's merge time the parse and merge). The main-thread hosts' read-model sync is split in perf:compare's attribution pass.
- Throttles run in a fixed order (1x then 4x) in each process. The mode order rotates by repetition (10 repetitions over 2 modes: each mode first 5 time(s)). The throttled cold start throttles before the navigation and again at commit; its CPU probe runs after startup, so a throttle gap at navigation would not show.
- Audio was not started in these frames (measured in perf:compare). The coalesced and worker hosts are experimental and opt-in; the shipped default is unchanged.
- WebGL renderer in these runs: ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11). Frame rates are for this GPU; other GPUs and displays will differ. The simulation-only rows do not depend on rendering.
