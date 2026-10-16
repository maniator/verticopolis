# Worker host benchmark (npm run perf:worker)

> **Snapshot, measured 2026-10-15T16:45:08.445Z to 2026-10-15T18:33:19.384Z on commit `e25ec01` (app 2.34.1).** Live numbers: re-run `npm run perf:worker` (src/tests/perfWorker/, its arithmetic pinned by src/tests/perfWorker/analysis.test.ts). Validation passed.

- Engine package: verticopolis_engine_bg.wasm `8d34b471c4502e23`, verticopolis_engine.js `e1c99c1a7c69fdd8`; source hash `b2786beb447604a5b9fafa6a4947221038247b73efe0cde1589845e1cbf329a1`
- Machine: AMD Ryzen 5 5600X 6-Core Processor             , 12 CPUs, 31.9 GiB, win32 10.0.26200; Node v22.22.0; Playwright 1.61.1; browser 149.0.7827.55
- Renderer: ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11); cross-origin isolated: true; frames at a 640x360 CSS viewport
- 10 repetitions of ts, wasm, wasm-frame, wasm-worker, each in a fresh browser process, order rotated by repetition; throttles 1x, 4x
- Scenarios: small (729 population, `8018a9e05910`), medium (3240 population, `159b444c6a65`), large (17322 population, `e0db69ea4891`)
- Download (production build, Brotli 11): engine worker chunk 2.6 KiB (8.3 KiB raw); engine package (WASM modes) 324.7 KiB (1.39 MiB raw); all other JavaScript 358.8 KiB

Medians with their 95% order-statistic interval. Ratios are paired by repetition (mode over the column's reference); a verdict needs six pairs and an interval clear of a 5% band. `wasm-worker / wasm-frame` compares two hosts with the same sync changes, so it is the worker placement alone; `wasm-frame / wasm` is the sync changes alone. Ratios against TypeScript are in ratios.csv. A ratio marked with `(k zero)` dropped k repetitions where the reference was 0.

## startup

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| - | 1x | cold start to mode ready (ms) | 521 [488, 550] | 594 [547, 645] | 600 [538, 642] | 542 [535, 588] | 0.88x [0.81, 0.94] lower | 0.99x [0.91, 1.04] inconclusive | 0.93x [0.84, 0.98] inconclusive | 0.94x [0.86, 1.00] inconclusive |
| - | 1x | warm start to mode ready (ms) | 154 [151, 158] | 155 [150, 166] | 152 [145, 159] | 159 [155, 177] | 1.00x [0.93, 1.04] inconclusive | 1.00x [0.88, 1.05] inconclusive | 1.02x [0.95, 1.13] inconclusive | 1.06x [0.98, 1.11] inconclusive |
| - | 4x | cold start to mode ready (ms) | 820 [812, 844] | 944 [933, 981] | 943 [934, 951] | 874 [862, 910] | 0.87x [0.84, 0.89] lower | 1.00x [0.96, 1.01] equivalent | 0.92x [0.90, 0.96] inconclusive | 0.92x [0.92, 0.96] inconclusive |
| - | 1x | bytes before mode ready (cold) (bytes) | 301.3 KiB [301.3 KiB, 301.3 KiB] | 628.2 KiB [628.2 KiB, 628.2 KiB] | 628.2 KiB [628.2 KiB, 628.2 KiB] | 630.9 KiB [630.9 KiB, 630.9 KiB] | 0.48x [0.48, 0.48] lower | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |

## raw

| scenario | throttle | metric | ts | wasm | ts / wasm |
|---|---|---|---|---|---|
| small | 1x | bare engine, 720 steps (ms) | 110 [108, 115] | 76.5 [75.7, 77.5] | 1.43x [1.39, 1.49] higher |
| small | 4x | bare engine, 720 steps (ms) | 621 [501, 698] | 337 [331, 343] | 1.85x [1.44, 2.10] higher |
| medium | 1x | bare engine, 720 steps (ms) | 685 [678, 694] | 382 [379, 386] | 1.79x [1.76, 1.83] higher |
| medium | 4x | bare engine, 720 steps (ms) | 3033 [2992, 3081] | 1751 [1713, 1766] | 1.74x [1.72, 1.76] higher |
| large | 1x | bare engine, 720 steps (ms) | 705 [694, 733] | 806 [791, 830] | 0.87x [0.84, 0.92] lower |
| large | 4x | bare engine, 720 steps (ms) | 3016 [3004, 3192] | 3653 [3616, 3811] | 0.83x [0.81, 0.87] lower |

## hosted

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 1x | wall time, 720 steps (ms) | 104 [102, 115] | 414 [412, 423] | 295 [292, 301] | 307 [303, 348] | 0.25x [0.24, 0.28] lower | 0.71x [0.70, 0.74] lower | 0.74x [0.72, 0.84] lower | 1.04x [1.04, 1.18] inconclusive |
| small | 1x | main-thread time, 720 steps (ms) | 104 [102, 115] | 414 [412, 423] | 295 [291, 301] | 159 [157, 182] | 0.25x [0.24, 0.28] lower | 0.71x [0.70, 0.74] lower | 0.38x [0.37, 0.44] lower | 0.54x [0.54, 0.61] lower |
| small | 1x | main-thread time per batch, p95 (ms) | 1.20 [1.18, 1.56] | 9.30 [9.05, 9.53] | 8.19 [8.07, 8.70] | 5.65 [5.55, 6.08] | 0.13x [0.13, 0.17] lower | 0.87x [0.86, 0.98] inconclusive | 0.61x [0.59, 0.65] lower | 0.68x [0.64, 0.74] lower |
| small | 1x | main-thread time per batch, max (ms) | 3.10 [3.03, 3.30] | 12.3 [12.2, 12.6] | 11.7 [10.9, 11.9] | 8.10 [7.71, 10.4] | 0.25x [0.24, 0.27] lower | 0.94x [0.89, 0.97] inconclusive | 0.66x [0.62, 0.88] lower | 0.71x [0.65, 0.95] lower |
| small | 4x | wall time, 720 steps (ms) | 508 [499, 533] | 1782 [1773, 2002] | 1386 [1335, 1538] | 814 [803, 866] | 0.28x [0.26, 0.31] lower | 0.75x [0.69, 0.86] lower | 0.45x [0.40, 0.49] lower | 0.58x [0.53, 0.65] lower |
| small | 4x | main-thread time, 720 steps (ms) | 507 [498, 532] | 1781 [1772, 2000] | 1384 [1334, 1537] | 652 [642, 697] | 0.28x [0.26, 0.31] lower | 0.75x [0.69, 0.86] lower | 0.36x [0.32, 0.39] lower | 0.47x [0.43, 0.52] lower |
| small | 4x | main-thread time per batch, p95 (ms) | 5.68 [5.65, 6.08] | 38.5 [37.2, 41.6] | 37.5 [36.4, 40.1] | 22.8 [22.5, 24.3] | 0.15x [0.14, 0.16] lower | 0.96x [0.90, 1.05] inconclusive | 0.59x [0.55, 0.64] lower | 0.61x [0.56, 0.67] lower |
| small | 4x | main-thread time per batch, max (ms) | 11.1 [10.7, 12.6] | 82.4 [69.3, 88.2] | 67.9 [52.3, 101] | 34.4 [30.5, 41.4] | 0.13x [0.12, 0.19] lower | 0.84x [0.61, 1.31] inconclusive | 0.43x [0.35, 0.66] lower | 0.50x [0.33, 0.81] lower |
| medium | 1x | wall time, 720 steps (ms) | 696 [690, 708] | 2124 [2115, 2158] | 1478 [1470, 1511] | 1507 [1501, 1520] | 0.33x [0.32, 0.33] lower | 0.70x [0.69, 0.72] lower | 0.71x [0.70, 0.71] lower | 1.02x [1.00, 1.03] equivalent |
| medium | 1x | main-thread time, 720 steps (ms) | 696 [690, 708] | 2123 [2115, 2157] | 1477 [1470, 1511] | 797 [794, 800] | 0.33x [0.32, 0.33] lower | 0.70x [0.69, 0.72] lower | 0.37x [0.37, 0.38] lower | 0.54x [0.53, 0.54] lower |
| medium | 1x | main-thread time per batch, p95 (ms) | 7.28 [7.23, 7.33] | 46.8 [46.4, 47.0] | 43.5 [43.4, 44.5] | 27.1 [26.8, 27.6] | 0.16x [0.15, 0.16] lower | 0.93x [0.92, 0.95] inconclusive | 0.58x [0.57, 0.59] lower | 0.62x [0.61, 0.63] lower |
| medium | 1x | main-thread time per batch, max (ms) | 32.8 [32.5, 33.6] | 104 [103, 105] | 60.6 [60.2, 61.1] | 37.5 [37.2, 37.7] | 0.32x [0.31, 0.33] lower | 0.58x [0.58, 0.59] lower | 0.36x [0.35, 0.37] lower | 0.62x [0.61, 0.62] lower |
| medium | 4x | wall time, 720 steps (ms) | 3069 [3006, 3152] | 9278 [9262, 9335] | 6419 [6394, 6468] | 4195 [4125, 4231] | 0.33x [0.32, 0.34] lower | 0.69x [0.68, 0.70] lower | 0.45x [0.45, 0.46] lower | 0.65x [0.64, 0.66] lower |
| medium | 4x | main-thread time, 720 steps (ms) | 3068 [3005, 3151] | 9276 [9259, 9334] | 6417 [6392, 6466] | 3413 [3372, 3444] | 0.33x [0.32, 0.34] lower | 0.69x [0.68, 0.70] lower | 0.37x [0.36, 0.37] lower | 0.53x [0.52, 0.54] lower |
| medium | 4x | main-thread time per batch, p95 (ms) | 32.4 [31.6, 34.6] | 202 [200, 204] | 185 [183, 187] | 118 [115, 120] | 0.16x [0.16, 0.17] lower | 0.92x [0.91, 0.93] lower | 0.58x [0.57, 0.60] lower | 0.63x [0.62, 0.64] lower |
| medium | 4x | main-thread time per batch, max (ms) | 126 [123, 136] | 447 [444, 449] | 258 [254, 259] | 150 [149, 150] | 0.28x [0.28, 0.30] lower | 0.58x [0.57, 0.58] lower | 0.34x [0.33, 0.34] lower | 0.58x [0.57, 0.59] lower |
| large | 1x | wall time, 720 steps (ms) | 693 [689, 756] | 6568 [6488, 6658] | 4455 [4413, 4594] | 4506 [4479, 4718] | 0.11x [0.10, 0.12] lower | 0.68x [0.67, 0.70] lower | 0.69x [0.68, 0.70] lower | 1.01x [0.98, 1.06] inconclusive |
| large | 1x | main-thread time, 720 steps (ms) | 693 [689, 756] | 6567 [6487, 6657] | 4455 [4412, 4594] | 2592 [2569, 2664] | 0.11x [0.10, 0.12] lower | 0.68x [0.67, 0.70] lower | 0.39x [0.39, 0.40] lower | 0.58x [0.56, 0.60] lower |
| large | 1x | main-thread time per batch, p95 (ms) | 9.26 [9.01, 9.87] | 152 [150, 154] | 141 [139, 141] | 93.2 [92.7, 97.9] | 0.06x [0.06, 0.06] lower | 0.92x [0.90, 0.93] lower | 0.62x [0.60, 0.63] lower | 0.67x [0.66, 0.70] lower |
| large | 1x | main-thread time per batch, max (ms) | 26.8 [26.5, 27.6] | 178 [176, 185] | 165 [163, 184] | 112 [110, 116] | 0.15x [0.15, 0.15] lower | 0.93x [0.90, 1.05] inconclusive | 0.63x [0.61, 0.65] lower | 0.67x [0.61, 0.69] lower |
| large | 4x | wall time, 720 steps (ms) | 3085 [3060, 3160] | 28690 [28587, 28799] | 19532 [19438, 20091] | 13037 [12967, 13138] | 0.11x [0.11, 0.11] lower | 0.68x [0.67, 0.70] lower | 0.45x [0.45, 0.46] lower | 0.67x [0.65, 0.67] lower |
| large | 4x | main-thread time, 720 steps (ms) | 3084 [3059, 3158] | 28686 [28584, 28796] | 19529 [19435, 20089] | 10979 [10894, 11097] | 0.11x [0.11, 0.11] lower | 0.68x [0.67, 0.70] lower | 0.38x [0.38, 0.39] lower | 0.56x [0.55, 0.57] lower |
| large | 4x | main-thread time per batch, p95 (ms) | 38.6 [38.0, 39.4] | 658 [656, 665] | 606 [596, 615] | 397 [389, 404] | 0.06x [0.06, 0.06] lower | 0.92x [0.90, 0.93] lower | 0.60x [0.59, 0.61] lower | 0.66x [0.64, 0.67] lower |
| large | 4x | main-thread time per batch, max (ms) | 108 [106, 113] | 760 [751, 787] | 715 [697, 746] | 473 [467, 482] | 0.14x [0.14, 0.15] lower | 0.94x [0.91, 0.97] inconclusive | 0.62x [0.60, 0.65] lower | 0.66x [0.63, 0.67] lower |

## frames

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 1x | mean FPS (fps) | 69.3 [69.3, 69.4] | 69.3 [69.2, 69.4] | 69.3 [69.1, 69.4] | 69.2 [69.1, 69.4] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| small | 1x | 1% low FPS (fps) | 64.0 [63.5, 64.3] | 64.1 [64.0, 64.4] | 64.2 [63.9, 64.6] | 64.2 [63.8, 64.6] | 1.00x [0.99, 1.01] equivalent | 1.00x [0.99, 1.01] equivalent | 1.00x [0.99, 1.01] equivalent | 0.99x [0.99, 1.01] equivalent |
| small | 1x | frame time p95 (ms) | 15.0 [15.0, 15.0] | 15.0 [15.0, 15.0] | 15.0 [15.0, 15.0] | 15.0 [15.0, 15.0] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| small | 1x | frame time p99 (ms) | 15.4 [15.3, 15.5] | 15.4 [15.3, 15.5] | 15.4 [15.3, 15.5] | 15.4 [15.2, 15.5] | 1.00x [1.00, 1.00] equivalent | 1.00x [0.99, 1.01] equivalent | 1.00x [0.99, 1.01] equivalent | 1.00x [0.98, 1.02] equivalent |
| small | 1x | sim minutes per second (min/s) | 120 [120, 120] | 120 [120, 120] | 120 [120, 120] | 120 [120, 120] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| small | 1x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |  |  |  |  |
| small | 1x | main-thread blocking (long tasks past 50 ms) (ms) | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |  |  |  |  |
| small | 1x | command to visible frame, median (ms) | 12.1 [10.9, 13.1] | 13.1 [9.49, 13.4] | 12.1 [11.8, 13.0] | 18.3 [15.9, 22.0] | 0.99x [0.88, 1.15] inconclusive | 0.98x [0.88, 1.25] inconclusive | 1.41x [1.24, 2.31] higher | 1.53x [1.25, 1.85] higher |
| small | 1x | command to visible frame, p95 (ms) | 15.0 [14.3, 15.5] | 15.2 [14.5, 15.6] | 14.8 [14.4, 15.6] | 28.4 [26.1, 29.6] | 1.01x [0.92, 1.02] inconclusive | 0.97x [0.93, 1.05] inconclusive | 1.89x [1.68, 2.00] higher | 1.83x [1.72, 2.04] higher |
| small | 4x | mean FPS (fps) | 62.2 [61.9, 62.3] | 56.8 [56.5, 57.4] | 57.6 [57.1, 57.8] | 60.7 [60.1, 61.2] | 1.09x [1.09, 1.10] higher | 1.01x [1.00, 1.02] equivalent | 1.07x [1.06, 1.08] higher | 1.06x [1.05, 1.06] inconclusive |
| small | 4x | 1% low FPS (fps) | 25.8 [25.2, 27.5] | 18.5 [18.0, 20.6] | 20.5 [19.8, 21.3] | 21.7 [20.8, 22.5] | 1.37x [1.18, 1.53] higher | 1.09x [0.99, 1.18] inconclusive | 1.15x [1.01, 1.25] inconclusive | 1.07x [0.99, 1.09] inconclusive |
| small | 4x | frame time p95 (ms) | 29.5 [29.5, 29.5] | 30.0 [30.0, 30.0] | 30.0 [30.0, 30.0] | 29.7 [29.6, 30.0] | 0.98x [0.98, 0.98] equivalent | 1.00x [1.00, 1.00] equivalent | 0.99x [0.98, 1.00] equivalent | 0.99x [0.98, 1.00] equivalent |
| small | 4x | frame time p99 (ms) | 30.0 [30.0, 30.1] | 44.8 [44.5, 45.0] | 44.8 [44.5, 45.0] | 43.9 [43.5, 44.2] | 0.67x [0.67, 0.67] lower | 1.00x [0.99, 1.01] equivalent | 0.98x [0.97, 0.99] equivalent | 0.98x [0.97, 0.99] equivalent |
| small | 4x | sim minutes per second (min/s) | 120 [120, 120] | 120 [120, 120] | 120 [120, 120] | 120 [120, 120] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| small | 4x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |  |  |  |  |
| small | 4x | main-thread blocking (long tasks past 50 ms) (ms) | 0.00 [0.00, 0.00] | 25.0 [8.00, 44.0] | 7.50 [3.00, 22.0] | 0.00 [0.00, 0.00] | 0.00x [0.00, 0.00] lower | 0.46x [0.06, 2.00] inconclusive | 0.00x [0.00, 0.00] lower | 0.00x [0.00, 0.00] lower (1 zero) |
| small | 4x | command to visible frame, median (ms) | 14.4 [13.5, 14.8] | 14.3 [13.9, 14.9] | 14.7 [13.5, 15.2] | 26.3 [21.6, 27.8] | 1.00x [0.98, 1.03] equivalent | 1.03x [0.95, 1.05] equivalent | 1.80x [1.56, 1.97] higher | 1.78x [1.52, 1.90] higher |
| small | 4x | command to visible frame, p95 (ms) | 27.5 [24.5, 29.6] | 33.3 [30.3, 35.5] | 30.4 [27.9, 31.9] | 38.8 [34.5, 42.7] | 0.82x [0.74, 0.93] lower | 0.91x [0.84, 1.00] inconclusive | 1.18x [1.09, 1.24] higher | 1.35x [1.14, 1.40] higher |
| medium | 1x | mean FPS (fps) | 69.0 [68.9, 69.1] | 64.2 [64.0, 64.4] | 64.7 [64.6, 64.9] | 67.6 [67.5, 67.7] | 1.07x [1.07, 1.08] higher | 1.01x [1.01, 1.01] equivalent | 1.05x [1.05, 1.06] inconclusive | 1.04x [1.04, 1.05] equivalent |
| medium | 1x | 1% low FPS (fps) | 59.3 [58.7, 64.4] | 22.2 [21.6, 22.4] | 22.3 [22.2, 22.4] | 30.6 [29.3, 32.0] | 2.67x [2.63, 2.99] higher | 1.00x [0.99, 1.04] equivalent | 1.37x [1.31, 1.54] higher | 1.38x [1.32, 1.43] higher |
| medium | 1x | frame time p95 (ms) | 15.0 [15.0, 15.0] | 15.4 [15.3, 15.5] | 15.2 [15.1, 15.5] | 15.0 [15.0, 15.1] | 0.98x [0.97, 0.98] equivalent | 0.99x [0.97, 1.01] equivalent | 0.98x [0.97, 0.99] equivalent | 0.99x [0.97, 1.00] equivalent |
| medium | 1x | frame time p99 (ms) | 15.4 [15.3, 15.5] | 44.5 [44.5, 45.0] | 44.5 [44.4, 44.8] | 29.5 [29.5, 29.5] | 0.35x [0.34, 0.35] lower | 1.00x [0.99, 1.01] equivalent | 0.66x [0.66, 0.66] lower | 0.66x [0.66, 0.67] lower |
| medium | 1x | sim minutes per second (min/s) | 120 [120, 120] | 120 [120, 120] | 120 [120, 120] | 120 [120, 120] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| medium | 1x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |  |  |  |  |
| medium | 1x | main-thread blocking (long tasks past 50 ms) (ms) | 0.00 [0.00, 0.00] | 14.5 [10.0, 47.0] | 4.00 [1.00, 6.00] | 0.00 [0.00, 0.00] | 0.00x [0.00, 0.00] lower | 0.23x [0.02, 0.60] lower | 0.00x [0.00, 0.00] lower | 0.00x [0.00, 0.00] lower |
| medium | 1x | command to visible frame, median (ms) | 12.0 [11.6, 12.8] | 13.1 [12.1, 47.8] | 15.9 [12.0, 35.4] | 60.0 [20.1, 67.7] | 0.92x [0.24, 1.02] inconclusive | 1.00x [0.36, 1.84] inconclusive | 4.16x [1.03, 5.20] inconclusive | 2.43x [1.39, 5.06] higher |
| medium | 1x | command to visible frame, p95 (ms) | 22.3 [21.0, 23.3] | 22.3 [19.6, 62.7] | 38.9 [21.8, 58.1] | 73.4 [35.6, 81.2] | 0.92x [0.37, 1.11] inconclusive | 1.02x [0.42, 2.84] inconclusive | 2.48x [0.98, 3.99] inconclusive | 1.53x [1.20, 3.18] higher |
| medium | 4x | mean FPS (fps) | 25.7 [25.1, 26.6] | 11.7 [11.1, 12.0] | 15.6 [14.6, 16.1] | 18.8 [18.2, 19.3] | 2.16x [2.14, 2.40] higher | 1.32x [1.29, 1.42] higher | 1.59x [1.56, 1.67] higher | 1.22x [1.14, 1.26] higher |
| medium | 4x | 1% low FPS (fps) | 8.39 [8.07, 8.44] | 3.57 [3.37, 3.75] | 3.99 [3.87, 4.10] | 4.52 [4.48, 4.63] | 2.30x [2.23, 2.48] higher | 1.12x [1.07, 1.22] higher | 1.26x [1.21, 1.34] higher | 1.15x [1.07, 1.24] higher |
| medium | 4x | frame time p95 (ms) | 103 [103, 104] | 237 [223, 237] | 208 [207, 208] | 174 [163, 181] | 0.44x [0.43, 0.46] lower | 0.88x [0.87, 0.93] lower | 0.74x [0.69, 0.77] lower | 0.84x [0.78, 0.87] lower |
| medium | 4x | frame time p99 (ms) | 117 [105, 118] | 256 [250, 267] | 236 [223, 237] | 207 [206, 212] | 0.45x [0.42, 0.47] lower | 0.90x [0.87, 0.96] inconclusive | 0.82x [0.78, 0.83] lower | 0.89x [0.87, 0.93] lower |
| medium | 4x | sim minutes per second (min/s) | 113 [111, 113] | 76.3 [75.0, 76.5] | 83.7 [82.1, 86.3] | 107 [107, 107] | 1.48x [1.46, 1.50] higher | 1.11x [1.08, 1.13] higher | 1.41x [1.40, 1.43] higher | 1.28x [1.24, 1.31] higher |
| medium | 4x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 19.0 [19.0, 20.0] | 18.0 [16.0, 20.0] | 4.50 [4.00, 7.00] | 0.00x [0.00, 0.00] lower | 0.92x [0.85, 1.05] inconclusive | 0.24x [0.21, 0.37] lower | 0.27x [0.21, 0.44] lower |
| medium | 4x | main-thread blocking (long tasks past 50 ms) (ms) | 3344 [3176, 3465] | 7210 [7108, 7329] | 5930 [5874, 6153] | 3404 [3283, 3567] | 0.47x [0.44, 0.48] lower | 0.82x [0.81, 0.86] lower | 0.47x [0.45, 0.48] lower | 0.56x [0.54, 0.59] lower |
| medium | 4x | command to visible frame, median (ms) | 56.5 [50.1, 76.4] | 74.1 [66.2, 79.2] | 71.8 [49.4, 84.9] | 78.9 [61.7, 87.0] | 0.76x [0.64, 0.98] inconclusive | 0.95x [0.67, 1.25] inconclusive | 1.10x [0.84, 1.19] inconclusive | 1.14x [0.92, 1.46] inconclusive |
| medium | 4x | command to visible frame, p95 (ms) | 101 [91.9, 104] | 167 [147, 223] | 136 [93.1, 213] | 129 [107, 252] | 0.59x [0.46, 0.68] lower | 0.78x [0.47, 1.45] inconclusive | 0.72x [0.49, 1.71] inconclusive | 1.03x [0.72, 1.19] inconclusive |
| large | 1x | mean FPS (fps) | 69.2 [69.1, 69.4] | 45.5 [45.1, 46.4] | 51.6 [50.6, 51.8] | 58.6 [58.5, 58.9] | 1.52x [1.49, 1.53] higher | 1.13x [1.12, 1.14] higher | 1.29x [1.26, 1.30] higher | 1.14x [1.13, 1.16] higher |
| large | 1x | 1% low FPS (fps) | 54.7 [54.2, 59.5] | 6.81 [6.70, 6.99] | 7.22 [6.76, 7.33] | 9.82 [9.64, 10.0] | 8.11x [7.75, 9.23] higher | 1.04x [1.00, 1.09] inconclusive | 1.44x [1.43, 1.48] higher | 1.38x [1.31, 1.47] higher |
| large | 1x | frame time p95 (ms) | 15.0 [15.0, 15.0] | 44.7 [44.4, 45.0] | 29.4 [29.0, 29.7] | 15.3 [15.2, 15.5] | 0.34x [0.33, 0.34] lower | 0.66x [0.65, 0.66] lower | 0.34x [0.34, 0.35] lower | 0.52x [0.51, 0.53] lower |
| large | 1x | frame time p99 (ms) | 15.5 [15.3, 15.5] | 135 [134, 148] | 134 [134, 134] | 89.2 [89.1, 89.4] | 0.11x [0.10, 0.12] lower | 0.99x [0.91, 1.00] inconclusive | 0.66x [0.60, 0.66] lower | 0.67x [0.66, 0.67] lower |
| large | 1x | sim minutes per second (min/s) | 120 [120, 120] | 120 [120, 120] | 120 [120, 120] | 120 [120, 120] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| large | 1x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |  |  |  |  |
| large | 1x | main-thread blocking (long tasks past 50 ms) (ms) | 0.00 [0.00, 0.00] | 2826 [2790, 2892] | 2682 [2654, 2779] | 1295 [1269, 1326] | 0.00x [0.00, 0.00] lower | 0.95x [0.94, 0.98] inconclusive | 0.46x [0.44, 0.47] lower | 0.48x [0.46, 0.49] lower |
| large | 1x | command to visible frame, median (ms) | 13.3 [12.2, 14.4] | 20.0 [16.0, 23.7] | 10.1 [7.91, 11.9] | 51.9 [17.4, 139] | 0.64x [0.53, 0.83] lower | 0.48x [0.37, 0.65] lower | 2.45x [0.92, 6.48] inconclusive | 4.68x [1.80, 14.09] higher |
| large | 1x | command to visible frame, p95 (ms) | 15.7 [14.8, 16.5] | 36.5 [32.3, 42.0] | 22.9 [17.4, 25.8] | 148 [28.0, 154] | 0.45x [0.36, 0.48] lower | 0.61x [0.49, 0.79] lower | 3.80x [0.89, 4.39] inconclusive | 6.14x [1.64, 8.01] higher |
| large | 4x | mean FPS (fps) | 53.2 [51.3, 53.6] | 4.92 [4.90, 4.98] | 9.48 [9.06, 9.73] | 23.8 [22.9, 24.0] | 10.74x [10.43, 10.90] higher | 1.91x [1.83, 1.99] higher | 4.81x [4.61, 4.94] higher | 2.51x [2.45, 2.65] higher |
| large | 4x | 1% low FPS (fps) | 9.52 [9.01, 9.67] | 1.38 [1.32, 1.39] | 1.52 [1.48, 1.55] | 2.03 [1.96, 2.09] | 6.91x [6.60, 7.25] higher | 1.11x [1.07, 1.14] higher | 1.49x [1.41, 1.52] higher | 1.31x [1.27, 1.40] higher |
| large | 4x | frame time p95 (ms) | 43.6 [30.9, 44.0] | 685 [682, 695] | 618 [607, 634] | 90.3 [89.3, 104] | 0.06x [0.05, 0.06] lower | 0.90x [0.88, 0.93] lower | 0.13x [0.13, 0.15] lower | 0.15x [0.14, 0.17] lower |
| large | 4x | frame time p99 (ms) | 91.9 [89.4, 103] | 714 [710, 722] | 638 [633, 645] | 449 [443, 473] | 0.13x [0.13, 0.14] lower | 0.89x [0.88, 0.90] lower | 0.62x [0.61, 0.66] lower | 0.70x [0.69, 0.73] lower |
| large | 4x | sim minutes per second (min/s) | 120 [120, 120] | 39.4 [39.2, 39.9] | 53.4 [52.7, 54.0] | 62.6 [62.2, 63.1] | 3.04x [3.01, 3.06] higher | 1.35x [1.34, 1.38] higher | 1.58x [1.57, 1.61] higher | 1.17x [1.16, 1.19] higher |
| large | 4x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 12.0 [11.0, 13.0] | 14.0 [13.0, 14.0] | 16.0 [15.0, 16.0] | 0.00x [0.00, 0.00] lower | 1.17x [1.00, 1.27] inconclusive | 1.33x [1.23, 1.45] higher | 1.14x [1.14, 1.23] higher |
| large | 4x | main-thread blocking (long tasks past 50 ms) (ms) | 770 [730, 850] | 11411 [11222, 11470] | 9162 [9100, 9381] | 5982 [5888, 6070] | 0.07x [0.06, 0.08] lower | 0.81x [0.80, 0.82] lower | 0.53x [0.51, 0.54] lower | 0.65x [0.63, 0.66] lower |
| large | 4x | command to visible frame, median (ms) | 14.5 [12.6, 18.1] | 136 [128, 140] | 63.8 [59.2, 73.3] | 34.6 [33.5, 36.8] | 0.11x [0.09, 0.13] lower | 0.48x [0.45, 0.54] lower | 0.26x [0.24, 0.28] lower | 0.54x [0.44, 0.59] lower |
| large | 4x | command to visible frame, p95 (ms) | 28.9 [26.3, 73.6] | 197 [193, 369] | 125 [114, 300] | 401 [220, 577] | 0.14x [0.08, 0.35] lower | 0.61x [0.32, 1.51] inconclusive | 2.08x [0.61, 2.99] inconclusive | 2.19x [1.56, 4.79] higher |

## memory

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 1x | main-thread JS heap (bytes) | 46.69 MiB [46.66 MiB, 47.08 MiB] | 47.18 MiB [47.17 MiB, 47.20 MiB] | 47.12 MiB [47.09 MiB, 47.13 MiB] | 47.09 MiB [47.07 MiB, 47.11 MiB] | 0.99x [0.99, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| small | 1x | JS heaps + WASM memory (main and worker) (bytes) | 46.69 MiB [46.66 MiB, 47.08 MiB] | 55.62 MiB [55.61 MiB, 55.63 MiB] | 55.56 MiB [55.53 MiB, 55.56 MiB] | 56.03 MiB [56.02 MiB, 56.05 MiB] | 0.84x [0.84, 0.85] lower | 1.00x [1.00, 1.00] equivalent | 1.01x [1.01, 1.01] equivalent | 1.01x [1.01, 1.01] equivalent |
| small | 1x | browser process PSS (bytes) | n/a | n/a | n/a | n/a |  |  |  |  |
| medium | 1x | main-thread JS heap (bytes) | 59.10 MiB [59.09 MiB, 60.27 MiB] | 59.89 MiB [59.88 MiB, 59.93 MiB] | 59.86 MiB [59.86 MiB, 59.88 MiB] | 60.42 MiB [60.41 MiB, 60.43 MiB] | 0.99x [0.99, 1.01] equivalent | 1.00x [1.00, 1.00] equivalent | 1.01x [1.01, 1.01] equivalent | 1.01x [1.01, 1.01] equivalent |
| medium | 1x | JS heaps + WASM memory (main and worker) (bytes) | 59.10 MiB [59.09 MiB, 60.27 MiB] | 97.08 MiB [97.06 MiB, 97.12 MiB] | 97.05 MiB [97.04 MiB, 97.06 MiB] | 98.13 MiB [98.12 MiB, 98.14 MiB] | 0.61x [0.61, 0.62] lower | 1.00x [1.00, 1.00] equivalent | 1.01x [1.01, 1.01] equivalent | 1.01x [1.01, 1.01] equivalent |
| medium | 1x | browser process PSS (bytes) | n/a | n/a | n/a | n/a |  |  |  |  |
| large | 1x | main-thread JS heap (bytes) | 74.28 MiB [74.26 MiB, 74.30 MiB] | 74.53 MiB [74.11 MiB, 74.98 MiB] | 74.87 MiB [74.04 MiB, 74.91 MiB] | 76.87 MiB [76.05 MiB, 76.90 MiB] | 1.00x [0.99, 1.00] equivalent | 1.00x [0.99, 1.01] equivalent | 1.03x [1.01, 1.04] equivalent | 1.03x [1.02, 1.04] equivalent |
| large | 1x | JS heaps + WASM memory (main and worker) (bytes) | 74.28 MiB [74.26 MiB, 74.30 MiB] | 202.85 MiB [202.42 MiB, 203.29 MiB] | 203.18 MiB [202.35 MiB, 203.22 MiB] | 205.70 MiB [204.88 MiB, 205.73 MiB] | 0.37x [0.36, 0.37] lower | 1.00x [1.00, 1.00] equivalent | 1.01x [1.01, 1.02] equivalent | 1.01x [1.01, 1.02] equivalent |
| large | 1x | browser process PSS (bytes) | n/a | n/a | n/a | n/a |  |  |  |  |

## traffic

| scenario | throttle | metric | wasm-worker | wasm-worker / wasm |
|---|---|---|---|---|
| small | 1x | worker replies per second (frames) (1/s) | 60.4 [60.3, 60.5] |  |
| small | 1x | messages per second, both ways (frames) (1/s) | 122 [121, 122] |  |
| small | 1x | bytes received per second (frames) (bytes/s) | 7.58 MiB [7.57 MiB, 7.59 MiB] |  |
| small | 1x | reply apply time per second (frames) (ms/s) | 18.8 [18.6, 19.2] |  |
| small | 1x | command to ack, median (frames) (ms) | 3.53 [0.99, 8.25] |  |
| small | 1x | frame view bytes per reply (hosted) (bytes) | 118.7 KiB [118.7 KiB, 118.7 KiB] |  |
| small | 1x | full-save bytes per merge (hosted) (bytes) | 235.2 KiB [235.2 KiB, 235.2 KiB] |  |
| small | 1x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| small | 1x | worker engine time, 720 steps (hosted) (ms) | 136 [135, 153] |  |
| small | 1x | main-thread merge time, 720 steps (hosted) (ms) | 132 [131, 150] |  |
| small | 4x | worker replies per second (frames) (1/s) | 53.9 [53.6, 54.0] |  |
| small | 4x | messages per second, both ways (frames) (1/s) | 109 [108, 109] |  |
| small | 4x | bytes received per second (frames) (bytes/s) | 6.78 MiB [6.75 MiB, 6.80 MiB] |  |
| small | 4x | reply apply time per second (frames) (ms/s) | 79.2 [78.4, 79.6] |  |
| small | 4x | command to ack, median (frames) (ms) | 7.33 [3.14, 11.4] |  |
| small | 4x | frame view bytes per reply (hosted) (bytes) | 118.7 KiB [118.7 KiB, 118.7 KiB] |  |
| small | 4x | full-save bytes per merge (hosted) (bytes) | 235.2 KiB [235.2 KiB, 235.2 KiB] |  |
| small | 4x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| small | 4x | worker engine time, 720 steps (hosted) (ms) | 135 [133, 140] |  |
| small | 4x | main-thread merge time, 720 steps (hosted) (ms) | 531 [526, 573] |  |
| medium | 1x | worker replies per second (frames) (1/s) | 56.2 [56.1, 56.4] |  |
| medium | 1x | messages per second, both ways (frames) (1/s) | 113 [113, 114] |  |
| medium | 1x | bytes received per second (frames) (bytes/s) | 35.59 MiB [34.80 MiB, 36.04 MiB] |  |
| medium | 1x | reply apply time per second (frames) (ms/s) | 106 [103, 108] |  |
| medium | 1x | command to ack, median (frames) (ms) | 22.4 [8.05, 26.6] |  |
| medium | 1x | frame view bytes per reply (hosted) (bytes) | 585.2 KiB [585.2 KiB, 585.2 KiB] |  |
| medium | 1x | full-save bytes per merge (hosted) (bytes) | 1.29 MiB [1.29 MiB, 1.29 MiB] |  |
| medium | 1x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| medium | 1x | worker engine time, 720 steps (hosted) (ms) | 693 [686, 698] |  |
| medium | 1x | main-thread merge time, 720 steps (hosted) (ms) | 640 [640, 643] |  |
| medium | 4x | worker replies per second (frames) (1/s) | 17.1 [16.4, 17.5] |  |
| medium | 4x | messages per second, both ways (frames) (1/s) | 35.1 [33.7, 35.9] |  |
| medium | 4x | bytes received per second (frames) (bytes/s) | 12.00 MiB [11.60 MiB, 12.38 MiB] |  |
| medium | 4x | reply apply time per second (frames) (ms/s) | 278 [274, 283] |  |
| medium | 4x | command to ack, median (frames) (ms) | 20.3 [16.7, 22.6] |  |
| medium | 4x | frame view bytes per reply (hosted) (bytes) | 585.2 KiB [585.2 KiB, 585.2 KiB] |  |
| medium | 4x | full-save bytes per merge (hosted) (bytes) | 1.29 MiB [1.29 MiB, 1.29 MiB] |  |
| medium | 4x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| medium | 4x | worker engine time, 720 steps (hosted) (ms) | 708 [703, 713] |  |
| medium | 4x | main-thread merge time, 720 steps (hosted) (ms) | 2748 [2720, 2779] |  |
| large | 1x | worker replies per second (frames) (1/s) | 44.6 [44.1, 45.1] |  |
| large | 1x | messages per second, both ways (frames) (1/s) | 90.2 [89.3, 91.1] |  |
| large | 1x | bytes received per second (frames) (bytes/s) | 99.86 MiB [99.25 MiB, 100.87 MiB] |  |
| large | 1x | reply apply time per second (frames) (ms/s) | 285 [278, 299] |  |
| large | 1x | command to ack, median (frames) (ms) | 16.1 [6.18, 44.3] |  |
| large | 1x | frame view bytes per reply (hosted) (bytes) | 2.00 MiB [2.00 MiB, 2.00 MiB] |  |
| large | 1x | full-save bytes per merge (hosted) (bytes) | 4.49 MiB [4.49 MiB, 4.49 MiB] |  |
| large | 1x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| large | 1x | worker engine time, 720 steps (hosted) (ms) | 1812 [1793, 1962] |  |
| large | 1x | main-thread merge time, 720 steps (hosted) (ms) | 2213 [2197, 2275] |  |
| large | 4x | worker replies per second (frames) (1/s) | 21.4 [20.7, 21.7] |  |
| large | 4x | messages per second, both ways (frames) (1/s) | 43.8 [42.4, 44.5] |  |
| large | 4x | bytes received per second (frames) (bytes/s) | 48.01 MiB [46.30 MiB, 48.49 MiB] |  |
| large | 4x | reply apply time per second (frames) (ms/s) | 612 [605, 627] |  |
| large | 4x | command to ack, median (frames) (ms) | 12.9 [12.5, 13.3] |  |
| large | 4x | frame view bytes per reply (hosted) (bytes) | 2.00 MiB [2.00 MiB, 2.00 MiB] |  |
| large | 4x | full-save bytes per merge (hosted) (bytes) | 4.49 MiB [4.49 MiB, 4.49 MiB] |  |
| large | 4x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| large | 4x | worker engine time, 720 steps (hosted) (ms) | 1856 [1838, 1886] |  |
| large | 4x | main-thread merge time, 720 steps (hosted) (ms) | 9423 [9324, 9503] |  |

## Offline restart

- ts: ts online, ts offline
- wasm: wasm online, wasm offline
- wasm-frame: wasm-frame online, wasm-frame offline
- wasm-worker: wasm-worker online, wasm-worker offline

## Validation

- no errors

## Limitations

- One machine, headless Chromium in a container, software WebGL (see the renderer line): render cost dominates every frame, so the FPS rows say more about how much main-thread time each host leaves the renderer than about GPU-backed frame rates.
- CPU throttling is DevTools emulation of the renderer process. The engine worker runs in the same renderer process, so the 4x rows slow it too; whether emulation throttles a worker thread exactly as it throttles the main thread was not measured.
- Hosted rows run 720 steps of 2 minutes in batches of 4 (the frame loop's cap is 4) with no rendering. Wall time includes the worker host's wait for each reply; main-thread time counts the steps, the flushes and the time applying replies, and leaves the worker's own time out (reported apart). The browser's unpacking of each reply (the structured clone of its strings, the full save's included) runs on the main thread before the host sees the reply and is not in the hosted main-thread rows; the frames rows (frame times, long tasks) include it.
- The worker host keeps one batch in flight. A frame that finds a batch still out takes no steps (the frame loop banks its minutes under the 30-minute cap), so on a tower the engine cannot step in real time the worker host simulates fewer minutes per second rather than queueing work; the sim-minutes-per-second row shows it.
- Command latency times a tower rename (relayed by every host, read by nothing in the simulation) from the call to the clock inside the first frame callback that runs once the engine's answer is in the read model. The main-thread hosts answer in the call, so their figure is the wait for the next frame callback. One command is in flight at a time, one per second. A negative sample fails validation.
- Memory is measured after 30 steps on a freshly loaded page, after a forced GC. The harness keeps the scenario saves it loads from in the page for every mode (the same text in every mode's JS heap rows); its own stashed start and end saves are dropped before the read. WASM linear memory only grows, so it is a high-water mark that includes the boot tower. The worker's JS heap is read through the DevTools target protocol; when that is unavailable the combined row has no worker sample. Process PSS sums the browser's processes (Linux).
- Frames render at a 640x360 CSS viewport (the default, a common phone size), smaller than perf:compare's 1280x720: on the 4-CPU container with software WebGL the harness was built on, a 1280x720 frame took about 250 ms, past Excalibur's 200 ms clamp, so at that size the modes simulated almost nothing in their frames. A frame longer than 200 ms is handed 1 ms of game time, so rows with clamped frames understate the simulation work; the clamped-frame row counts them.
- Message sizes are counted on the way in (frame views, full saves, events, log and pending text at two bytes a character); the way out (steps and commands, a few numbers each) is not measured, so as not to serialize every message twice on the measured thread.
- The serialize and deserialize halves of the full save are split only on the worker host (the worker's reply time includes the serialize, the main thread's merge time the parse and merge). The main-thread hosts' read-model sync is split in perf:compare's attribution pass.
- Throttles run in a fixed order (1x then 4x) in each process. The mode order rotates by repetition (10 repetitions over 4 modes: modes first between 2 and 3 times). The throttled cold start throttles before the navigation and again at commit; its CPU probe runs after startup, so a throttle gap at navigation would not show.
- Audio was not started in these frames (measured in perf:compare). The coalesced and worker hosts are experimental and opt-in; the shipped default is unchanged.
