# M4 long-task ε from `perf:worker` A/A passes

> **Snapshot of A/A passes started 2026-11-03T20:58:05.697Z to 2026-11-03T22:08:57.233Z, commit 5cec61d; computed 2026-11-03T22:26:38.782Z.** The live number comes from `npm run perf:calibrate` (src/tests/perfWorker/calibrateM4.ts, pinned by calibrateM4.test.ts) run on the folders listed below; this file never refreshes. Provisional: M1, M2, M3 and M5 need `perf:compare` A/A passes and are not in this report, and nothing here sets a tolerance until the owner adopts the numbers (OD-4).

**M4 is not adoptable yet.** See the problems below.

Problems:

- 0 usable A/A passes of ts; this calibration asks for at least 5 per engine
- M4: the candidate 270 ms is above its cap 50 ms; add repetitions or remove the noise source and calibrate again

There are no passes of one engine, so no guarantee can be stated.

| Family | Kind | Candidate | Cap | Leave-one-out (informational) | Largest pass values |
| --- | --- | --- | --- | --- | --- |
| M4 | ε | 270.0 ms | 50.0 ms | 1 of 5 | 270.0 ms, 243.0 ms, 200.0 ms |

Scope: the large scenario's "main-thread blocking (long tasks past 50 ms)" at 1x and 4x, paired by repetition (slot wasm minus slot ts). Each pass's value is the larger upper bound of the two throttles, and a throttle with fewer than 10 paired repetitions leaves its pass without a value, which leaves M4 without a candidate. The folders are `--aa ts` and `--aa wasm` passes of the main-thread hosts, so 4x throttles the engine as well as the page.

## What the passes share

- Provenance: commit 5cec61d18ee4f3c5446b390a27ecaa4e0970dd16, engine build 70e0046aa86f4b8911646c18df527914ce6737f9baaf63cea50b16d91ab1b473 (not a condition on the verdict run)
- Machine: cpuModel AMD Ryzen 5 5600X 6-Core Processor             ; logicalCpus 12; totalMemoryBytes 34246979584; os win32 10.0.26200; kernel 10.0.26200; arch x64; node v22.22.0; rust rustc 1.97.0 (2d8144b78 2026-07-07); playwright 1.61.1
- Browser: executable C:\Users\nafta\AppData\Local\ms-playwright\chromium-1228\chrome-win64\chrome.exe, channel default, switches none, version 149.0.7827.55, renderer ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)

## M4 passes used

| Folder | Engine | Commit | Started | Reps | results.json SHA-256 (canonical) |
| --- | --- | --- | --- | --- | --- |
| docs/performance/results/2026-11-03-5cec61d-run-aa-wasm-worker-1280x720-1 | wasm | 5cec61d18ee4f3c5446b390a27ecaa4e0970dd16 | 2026-11-03T20:58:05.697Z | 10 | a10ff64d43b70ed84f4f4c8c6f32688c6d2cf717c75c0b16824717facf49e83f |
| docs/performance/results/2026-11-03-5cec61d-run-aa-wasm-worker-1280x720-2 | wasm | 5cec61d18ee4f3c5446b390a27ecaa4e0970dd16 | 2026-11-03T21:16:18.951Z | 10 | cc8143281debbbcce178443c3054e1d0b9c1448315c46ab67e30f5d6e6513a73 |
| docs/performance/results/2026-11-03-5cec61d-run-aa-wasm-worker-1280x720-3 | wasm | 5cec61d18ee4f3c5446b390a27ecaa4e0970dd16 | 2026-11-03T21:33:50.862Z | 10 | 5bf695dad6d71ed76ca23e10da454ad461fb938e18ec4750a6c44e0a2d5bf2a4 |
| docs/performance/results/2026-11-03-5cec61d-run-aa-wasm-worker-1280x720-4 | wasm | 5cec61d18ee4f3c5446b390a27ecaa4e0970dd16 | 2026-11-03T21:51:24.548Z | 10 | ea65441804396288b04247c078608f61cd3196dd061f26d14c8316d471429be8 |
| docs/performance/results/2026-11-03-5cec61d-run-aa-wasm-worker-1280x720-5 | wasm | 5cec61d18ee4f3c5446b390a27ecaa4e0970dd16 | 2026-11-03T22:08:57.233Z | 10 | c50e5f08849a841d53e190065b21759035023e742ea593cef6b274dae0907227 |
