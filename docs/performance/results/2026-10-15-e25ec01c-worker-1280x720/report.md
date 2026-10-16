# Worker host benchmark (npm run perf:worker)

> **Snapshot, measured 2026-10-15T14:55:35.169Z to 2026-10-15T16:44:27.523Z on commit `e25ec01` (app 2.34.1).** Live numbers: re-run `npm run perf:worker` (src/tests/perfWorker/, its arithmetic pinned by src/tests/perfWorker/analysis.test.ts). Validation passed.

- Engine package: verticopolis_engine_bg.wasm `8d34b471c4502e23`, verticopolis_engine.js `e1c99c1a7c69fdd8`; source hash `b2786beb447604a5b9fafa6a4947221038247b73efe0cde1589845e1cbf329a1`
- Machine: AMD Ryzen 5 5600X 6-Core Processor             , 12 CPUs, 31.9 GiB, win32 10.0.26200; Node v22.22.0; Playwright 1.61.1; browser 149.0.7827.55
- Renderer: ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11); cross-origin isolated: true; frames at a 1280x720 CSS viewport
- 10 repetitions of ts, wasm, wasm-frame, wasm-worker, each in a fresh browser process, order rotated by repetition; throttles 1x, 4x
- Scenarios: small (729 population, `8018a9e05910`), medium (3240 population, `159b444c6a65`), large (17322 population, `e0db69ea4891`)
- Download (production build, Brotli 11): engine worker chunk 2.6 KiB (8.3 KiB raw); engine package (WASM modes) 324.7 KiB (1.39 MiB raw); all other JavaScript 358.8 KiB

Medians with their 95% order-statistic interval. Ratios are paired by repetition (mode over the column's reference); a verdict needs six pairs and an interval clear of a 5% band. `wasm-worker / wasm-frame` compares two hosts with the same sync changes, so it is the worker placement alone; `wasm-frame / wasm` is the sync changes alone. Ratios against TypeScript are in ratios.csv. A ratio marked with `(k zero)` dropped k repetitions where the reference was 0.

## startup

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| - | 1x | cold start to mode ready (ms) | 485 [478, 566] | 606 [561, 641] | 577 [542, 606] | 603 [542, 625] | 0.80x [0.78, 1.01] inconclusive | 0.94x [0.89, 1.05] inconclusive | 0.98x [0.91, 1.11] inconclusive | 1.03x [0.99, 1.06] inconclusive |
| - | 1x | warm start to mode ready (ms) | 152 [148, 163] | 153 [147, 160] | 153 [144, 163] | 157 [153, 165] | 1.00x [0.94, 1.04] inconclusive | 1.00x [0.94, 1.08] inconclusive | 1.03x [0.98, 1.09] inconclusive | 1.03x [0.98, 1.08] inconclusive |
| - | 4x | cold start to mode ready (ms) | 840 [830, 860] | 954 [942, 1036] | 946 [939, 995] | 873 [867, 891] | 0.89x [0.82, 0.90] lower | 1.00x [0.98, 1.05] inconclusive | 0.92x [0.90, 0.92] lower | 0.92x [0.87, 0.94] lower |
| - | 1x | bytes before mode ready (cold) (bytes) | 301.3 KiB [301.3 KiB, 301.3 KiB] | 628.2 KiB [628.2 KiB, 628.2 KiB] | 628.2 KiB [628.2 KiB, 628.2 KiB] | 630.9 KiB [630.9 KiB, 630.9 KiB] | 0.48x [0.48, 0.48] lower | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |

## raw

| scenario | throttle | metric | ts | wasm | ts / wasm |
|---|---|---|---|---|---|
| small | 1x | bare engine, 720 steps (ms) | 107 [103, 110] | 75.7 [74.5, 76.3] | 1.42x [1.36, 1.47] higher |
| small | 4x | bare engine, 720 steps (ms) | 602 [505, 744] | 341 [335, 401] | 1.59x [1.47, 2.18] higher |
| medium | 1x | bare engine, 720 steps (ms) | 690 [684, 692] | 387 [381, 395] | 1.77x [1.73, 1.81] higher |
| medium | 4x | bare engine, 720 steps (ms) | 3045 [3014, 3095] | 1763 [1709, 1788] | 1.74x [1.69, 1.79] higher |
| large | 1x | bare engine, 720 steps (ms) | 702 [670, 734] | 830 [786, 971] | 0.83x [0.69, 0.89] lower |
| large | 4x | bare engine, 720 steps (ms) | 3050 [2944, 3176] | 3632 [3583, 3808] | 0.82x [0.79, 0.88] lower |

## hosted

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 1x | wall time, 720 steps (ms) | 103 [102, 108] | 414 [409, 426] | 295 [292, 324] | 308 [304, 320] | 0.25x [0.24, 0.26] lower | 0.72x [0.70, 0.77] lower | 0.75x [0.73, 0.78] lower | 1.04x [0.97, 1.08] inconclusive |
| small | 1x | main-thread time, 720 steps (ms) | 102 [102, 107] | 414 [409, 426] | 295 [292, 324] | 160 [157, 166] | 0.25x [0.24, 0.26] lower | 0.72x [0.70, 0.77] lower | 0.39x [0.37, 0.40] lower | 0.54x [0.50, 0.56] lower |
| small | 1x | main-thread time per batch, p95 (ms) | 1.21 [1.18, 1.27] | 9.23 [9.00, 9.58] | 8.22 [8.15, 9.14] | 5.77 [5.59, 5.98] | 0.13x [0.12, 0.14] lower | 0.91x [0.87, 0.97] inconclusive | 0.62x [0.59, 0.65] lower | 0.69x [0.63, 0.72] lower |
| small | 1x | main-thread time per batch, max (ms) | 3.07 [3.03, 3.12] | 12.3 [12.0, 12.4] | 11.7 [11.3, 13.0] | 8.02 [7.60, 8.75] | 0.25x [0.24, 0.26] lower | 0.96x [0.92, 1.06] inconclusive | 0.66x [0.62, 0.72] lower | 0.68x [0.65, 0.76] lower |
| small | 4x | wall time, 720 steps (ms) | 502 [497, 524] | 1763 [1687, 1985] | 1336 [1216, 1504] | 832 [801, 924] | 0.29x [0.26, 0.30] lower | 0.75x [0.64, 0.89] lower | 0.47x [0.44, 0.51] lower | 0.63x [0.57, 0.72] lower |
| small | 4x | main-thread time, 720 steps (ms) | 502 [496, 523] | 1762 [1686, 1983] | 1334 [1215, 1502] | 667 [641, 738] | 0.29x [0.26, 0.30] lower | 0.75x [0.64, 0.89] lower | 0.38x [0.35, 0.41] lower | 0.50x [0.46, 0.58] lower |
| small | 4x | main-thread time per batch, p95 (ms) | 5.68 [5.65, 5.86] | 38.0 [37.2, 43.6] | 36.0 [34.0, 41.2] | 23.5 [21.5, 25.9] | 0.15x [0.13, 0.16] lower | 0.94x [0.85, 1.03] inconclusive | 0.60x [0.55, 0.66] lower | 0.64x [0.58, 0.71] lower |
| small | 4x | main-thread time per batch, max (ms) | 10.9 [10.5, 11.5] | 48.7 [46.9, 89.8] | 51.8 [43.4, 111] | 34.8 [33.6, 42.2] | 0.23x [0.12, 0.24] lower | 1.04x [0.61, 2.33] inconclusive | 0.70x [0.47, 0.76] lower | 0.67x [0.30, 0.89] lower |
| medium | 1x | wall time, 720 steps (ms) | 690 [688, 707] | 2154 [2125, 2198] | 1490 [1479, 1558] | 1515 [1494, 1586] | 0.32x [0.31, 0.33] lower | 0.69x [0.68, 0.71] lower | 0.70x [0.69, 0.75] lower | 1.01x [0.98, 1.03] equivalent |
| medium | 1x | main-thread time, 720 steps (ms) | 690 [688, 707] | 2154 [2125, 2198] | 1489 [1479, 1557] | 803 [793, 825] | 0.32x [0.31, 0.33] lower | 0.69x [0.68, 0.71] lower | 0.37x [0.37, 0.38] lower | 0.53x [0.52, 0.54] lower |
| medium | 1x | main-thread time per batch, p95 (ms) | 7.20 [7.11, 7.37] | 47.6 [46.8, 48.4] | 43.9 [43.7, 44.8] | 27.2 [26.7, 28.1] | 0.15x [0.15, 0.15] lower | 0.92x [0.92, 0.95] lower | 0.57x [0.56, 0.59] lower | 0.61x [0.60, 0.63] lower |
| medium | 1x | main-thread time per batch, max (ms) | 32.9 [32.5, 33.8] | 104 [104, 106] | 61.2 [60.5, 64.1] | 37.7 [37.3, 40.4] | 0.32x [0.31, 0.32] lower | 0.59x [0.57, 0.62] lower | 0.36x [0.36, 0.39] lower | 0.62x [0.58, 0.65] lower |
| medium | 4x | wall time, 720 steps (ms) | 3064 [3047, 3090] | 9432 [9265, 9571] | 6450 [6402, 6862] | 4177 [4131, 4439] | 0.33x [0.32, 0.33] lower | 0.69x [0.68, 0.71] lower | 0.45x [0.44, 0.48] lower | 0.65x [0.63, 0.65] lower |
| medium | 4x | main-thread time, 720 steps (ms) | 3063 [3046, 3089] | 9429 [9264, 9569] | 6448 [6401, 6861] | 3418 [3383, 3652] | 0.33x [0.32, 0.33] lower | 0.69x [0.68, 0.71] lower | 0.37x [0.36, 0.39] lower | 0.53x [0.52, 0.53] lower |
| medium | 4x | main-thread time per batch, p95 (ms) | 32.0 [31.6, 33.3] | 205 [201, 210] | 187 [184, 194] | 117 [115, 119] | 0.16x [0.15, 0.16] lower | 0.92x [0.89, 0.95] lower | 0.58x [0.55, 0.59] lower | 0.63x [0.61, 0.63] lower |
| medium | 4x | main-thread time per batch, max (ms) | 130 [125, 143] | 453 [447, 476] | 260 [255, 267] | 151 [149, 180] | 0.28x [0.26, 0.32] lower | 0.57x [0.55, 0.58] lower | 0.34x [0.31, 0.39] lower | 0.59x [0.58, 0.63] lower |
| large | 1x | wall time, 720 steps (ms) | 692 [687, 756] | 6785 [6498, 6938] | 4519 [4401, 4652] | 4510 [4464, 4852] | 0.10x [0.10, 0.11] lower | 0.67x [0.65, 0.68] lower | 0.69x [0.66, 0.70] lower | 1.01x [0.97, 1.06] inconclusive |
| large | 1x | main-thread time, 720 steps (ms) | 692 [687, 755] | 6784 [6497, 6937] | 4519 [4401, 4652] | 2585 [2565, 2645] | 0.10x [0.10, 0.11] lower | 0.67x [0.65, 0.68] lower | 0.38x [0.37, 0.40] lower | 0.57x [0.56, 0.59] lower |
| large | 1x | main-thread time per batch, p95 (ms) | 9.07 [8.97, 9.68] | 154 [152, 158] | 140 [139, 143] | 93.3 [92.1, 96.3] | 0.06x [0.06, 0.06] lower | 0.92x [0.90, 0.92] lower | 0.61x [0.59, 0.62] lower | 0.66x [0.65, 0.68] lower |
| large | 1x | main-thread time per batch, max (ms) | 26.9 [26.2, 27.6] | 181 [175, 195] | 168 [165, 193] | 112 [110, 114] | 0.15x [0.14, 0.16] lower | 0.92x [0.88, 1.05] inconclusive | 0.61x [0.58, 0.64] lower | 0.66x [0.61, 0.68] lower |
| large | 4x | wall time, 720 steps (ms) | 3107 [2913, 3193] | 29427 [28525, 30885] | 19929 [19323, 20939] | 13173 [12954, 13644] | 0.10x [0.10, 0.11] lower | 0.68x [0.67, 0.69] lower | 0.45x [0.44, 0.45] lower | 0.66x [0.63, 0.67] lower |
| large | 4x | main-thread time, 720 steps (ms) | 3106 [2912, 3192] | 29423 [28521, 30881] | 19926 [19320, 20936] | 11068 [10919, 11185] | 0.10x [0.10, 0.11] lower | 0.68x [0.67, 0.69] lower | 0.38x [0.36, 0.38] lower | 0.56x [0.53, 0.56] lower |
| large | 4x | main-thread time per batch, p95 (ms) | 37.8 [36.2, 39.5] | 659 [652, 683] | 611 [605, 638] | 399 [392, 408] | 0.06x [0.05, 0.06] lower | 0.93x [0.91, 0.94] lower | 0.60x [0.58, 0.62] lower | 0.65x [0.62, 0.66] lower |
| large | 4x | main-thread time per batch, max (ms) | 106 [102, 113] | 788 [753, 831] | 723 [703, 865] | 468 [461, 498] | 0.14x [0.13, 0.14] lower | 0.94x [0.91, 1.04] inconclusive | 0.62x [0.57, 0.65] lower | 0.65x [0.60, 0.67] lower |

## frames

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 1x | mean FPS (fps) | 69.4 [69.3, 69.7] | 69.3 [69.2, 75.1] | 69.3 [69.1, 75.1] | 69.3 [69.2, 69.5] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| small | 1x | 1% low FPS (fps) | 64.0 [63.7, 64.4] | 64.3 [64.1, 74.1] | 64.3 [64.0, 74.6] | 64.2 [63.5, 64.8] | 0.99x [0.98, 1.00] equivalent | 1.00x [1.00, 1.01] equivalent | 1.00x [0.99, 1.00] equivalent | 1.00x [0.99, 1.01] equivalent |
| small | 1x | frame time p95 (ms) | 15.0 [15.0, 15.0] | 15.0 [13.4, 15.0] | 15.0 [13.4, 15.0] | 15.0 [15.0, 15.0] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| small | 1x | frame time p99 (ms) | 15.4 [15.3, 15.5] | 15.4 [13.4, 15.5] | 15.4 [13.4, 15.5] | 15.4 [15.2, 15.5] | 1.00x [0.99, 1.01] equivalent | 1.00x [0.99, 1.01] equivalent | 1.00x [0.99, 1.01] equivalent | 1.00x [0.98, 1.01] equivalent |
| small | 1x | sim minutes per second (min/s) | 120 [120, 120] | 120 [120, 120] | 120 [120, 120] | 120 [120, 120] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| small | 1x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |  |  |  |  |
| small | 1x | main-thread blocking (long tasks past 50 ms) (ms) | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |  |  |  |  |
| small | 1x | command to visible frame, median (ms) | 12.6 [12.4, 13.5] | 12.5 [10.8, 13.1] | 12.3 [10.9, 13.4] | 17.6 [16.4, 22.5] | 1.00x [0.94, 1.18] inconclusive | 0.99x [0.90, 1.07] inconclusive | 1.37x [1.29, 1.86] higher | 1.44x [1.28, 1.74] higher |
| small | 1x | command to visible frame, p95 (ms) | 15.4 [14.4, 17.4] | 15.2 [14.4, 15.9] | 14.6 [14.1, 15.5] | 28.4 [26.6, 29.3] | 0.97x [0.94, 1.13] inconclusive | 0.98x [0.90, 1.01] inconclusive | 1.88x [1.69, 1.98] higher | 1.89x [1.77, 2.06] higher |
| small | 4x | mean FPS (fps) | 57.8 [57.2, 58.5] | 51.1 [49.5, 51.9] | 52.2 [51.6, 53.0] | 55.4 [53.7, 56.2] | 1.13x [1.08, 1.18] higher | 1.01x [0.97, 1.08] inconclusive | 1.08x [1.01, 1.13] inconclusive | 1.06x [1.05, 1.07] inconclusive |
| small | 4x | 1% low FPS (fps) | 22.4 [22.2, 22.5] | 15.1 [12.8, 16.3] | 16.3 [15.3, 16.8] | 18.7 [15.5, 19.9] | 1.44x [1.33, 1.76] higher | 1.03x [0.93, 1.31] inconclusive | 1.24x [1.00, 1.39] inconclusive | 1.16x [1.04, 1.26] inconclusive |
| small | 4x | frame time p95 (ms) | 30.0 [30.0, 30.0] | 44.1 [40.0, 44.3] | 41.6 [30.5, 44.0] | 30.0 [30.0, 30.3] | 0.68x [0.68, 0.75] lower | 0.98x [0.69, 1.00] inconclusive | 0.68x [0.68, 0.76] lower | 0.76x [0.68, 0.98] inconclusive |
| small | 4x | frame time p99 (ms) | 44.0 [33.3, 44.5] | 46.8 [45.1, 59.7] | 47.4 [45.0, 53.3] | 45.0 [44.6, 53.3] | 0.94x [0.67, 0.98] inconclusive | 1.02x [0.75, 1.07] inconclusive | 0.99x [0.75, 1.00] inconclusive | 0.97x [0.93, 1.00] inconclusive |
| small | 4x | sim minutes per second (min/s) | 120 [120, 120] | 120 [120, 120] | 120 [120, 120] | 120 [120, 120] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| small | 4x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |  |  |  |  |
| small | 4x | main-thread blocking (long tasks past 50 ms) (ms) | 0.00 [0.00, 0.00] | 103 [90.0, 221] | 78.0 [61.0, 118] | 0.00 [0.00, 0.00] | 0.00x [0.00, 0.00] lower | 0.76x [0.26, 1.12] inconclusive | 0.00x [0.00, 0.00] lower | 0.00x [0.00, 0.00] lower |
| small | 4x | command to visible frame, median (ms) | 14.3 [13.9, 18.0] | 15.0 [14.6, 16.5] | 15.7 [14.4, 17.6] | 27.1 [26.1, 28.5] | 0.96x [0.91, 1.29] inconclusive | 1.01x [0.95, 1.17] inconclusive | 1.78x [1.66, 1.94] higher | 1.75x [1.51, 1.86] higher |
| small | 4x | command to visible frame, p95 (ms) | 31.7 [29.6, 34.7] | 36.0 [28.7, 37.9] | 31.9 [29.1, 36.7] | 56.0 [51.7, 72.5] | 0.97x [0.83, 1.15] inconclusive | 1.05x [0.80, 1.14] inconclusive | 1.85x [1.32, 1.99] higher | 1.72x [1.60, 1.98] higher |
| medium | 1x | mean FPS (fps) | 68.9 [68.6, 69.0] | 63.7 [63.5, 68.7] | 64.2 [64.0, 68.4] | 67.1 [66.9, 67.4] | 1.08x [1.07, 1.09] higher | 1.01x [1.00, 1.01] equivalent | 1.05x [1.04, 1.06] inconclusive | 1.05x [1.03, 1.05] inconclusive |
| medium | 1x | 1% low FPS (fps) | 58.9 [54.2, 64.3] | 21.4 [20.8, 22.2] | 21.5 [21.3, 22.2] | 29.1 [27.7, 29.2] | 2.75x [2.53, 2.88] higher | 1.00x [0.96, 1.04] equivalent | 1.36x [1.31, 1.38] higher | 1.33x [1.24, 1.37] higher |
| medium | 1x | frame time p95 (ms) | 15.0 [15.0, 15.0] | 15.6 [15.5, 26.6] | 15.5 [15.1, 15.5] | 15.1 [15.0, 15.1] | 0.96x [0.52, 0.97] inconclusive | 1.00x [0.53, 1.00] inconclusive | 0.97x [0.52, 0.97] inconclusive | 0.97x [0.97, 1.00] equivalent |
| medium | 1x | frame time p99 (ms) | 15.5 [15.4, 15.5] | 44.7 [40.0, 45.0] | 44.6 [40.0, 45.0] | 29.6 [29.5, 30.0] | 0.35x [0.34, 0.39] lower | 1.00x [0.99, 1.01] equivalent | 0.66x [0.66, 0.67] lower | 0.66x [0.66, 0.67] lower |
| medium | 1x | sim minutes per second (min/s) | 120 [120, 120] | 120 [120, 120] | 120 [120, 120] | 120 [120, 120] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| medium | 1x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |  |  |  |  |
| medium | 1x | main-thread blocking (long tasks past 50 ms) (ms) | 0.00 [0.00, 0.00] | 23.0 [14.0, 28.0] | 18.0 [7.00, 28.0] | 0.00 [0.00, 0.00] | 0.00x [0.00, 0.00] lower | 0.83x [0.29, 1.50] inconclusive | 0.00x [0.00, 0.00] lower | 0.00x [0.00, 0.00] lower |
| medium | 1x | command to visible frame, median (ms) | 12.8 [12.0, 13.6] | 16.0 [12.4, 23.0] | 12.5 [11.0, 17.7] | 67.9 [63.3, 70.3] | 0.82x [0.51, 1.02] inconclusive | 0.82x [0.61, 1.43] inconclusive | 3.87x [2.79, 5.39] higher | 5.23x [2.67, 6.26] higher |
| medium | 1x | command to visible frame, p95 (ms) | 22.3 [20.5, 23.9] | 37.3 [20.8, 57.0] | 22.4 [17.6, 53.1] | 75.8 [72.6, 79.2] | 0.67x [0.39, 1.15] inconclusive | 0.81x [0.41, 0.96] inconclusive | 2.21x [1.38, 3.75] higher | 3.34x [1.58, 4.50] higher |
| medium | 4x | mean FPS (fps) | 19.0 [18.5, 19.5] | 9.70 [9.04, 9.95] | 13.2 [12.7, 13.5] | 15.1 [14.2, 15.5] | 1.97x [1.88, 2.07] higher | 1.36x [1.28, 1.45] higher | 1.56x [1.44, 1.64] higher | 1.14x [1.12, 1.16] higher |
| medium | 4x | 1% low FPS (fps) | 7.96 [7.49, 8.36] | 3.22 [3.13, 3.40] | 3.62 [3.41, 3.94] | 4.43 [3.75, 4.54] | 2.43x [2.20, 2.59] higher | 1.13x [1.06, 1.20] higher | 1.31x [1.18, 1.40] higher | 1.15x [1.05, 1.28] inconclusive |
| medium | 4x | frame time p95 (ms) | 105 [104, 118] | 247 [237, 253] | 222 [208, 222] | 191 [179, 192] | 0.44x [0.42, 0.48] lower | 0.91x [0.85, 0.94] lower | 0.78x [0.73, 0.81] lower | 0.86x [0.85, 0.92] lower |
| medium | 4x | frame time p99 (ms) | 119 [118, 121] | 278 [258, 290] | 250 [237, 267] | 208 [207, 222] | 0.43x [0.42, 0.46] lower | 0.91x [0.84, 0.95] lower | 0.76x [0.74, 0.88] lower | 0.87x [0.82, 0.93] lower |
| medium | 4x | sim minutes per second (min/s) | 108 [106, 108] | 72.8 [70.5, 73.3] | 80.8 [80.4, 81.6] | 99.1 [95.8, 100] | 1.48x [1.47, 1.51] higher | 1.11x [1.10, 1.14] higher | 1.36x [1.31, 1.40] higher | 1.23x [1.19, 1.23] higher |
| medium | 4x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 18.0 [18.0, 19.0] | 20.0 [19.0, 20.0] | 6.00 [4.00, 8.00] | 0.00x [0.00, 0.00] lower | 1.06x [1.05, 1.11] higher | 0.32x [0.22, 0.42] lower | 0.30x [0.21, 0.40] lower |
| medium | 4x | main-thread blocking (long tasks past 50 ms) (ms) | 4245 [4232, 4490] | 7838 [7696, 8138] | 6469 [6328, 6623] | 3835 [3749, 4002] | 0.54x [0.53, 0.56] lower | 0.83x [0.79, 0.86] lower | 0.49x [0.47, 0.50] lower | 0.59x [0.59, 0.62] lower |
| medium | 4x | command to visible frame, median (ms) | 75.0 [71.2, 85.5] | 85.9 [78.2, 96.8] | 85.8 [82.2, 89.8] | 90.0 [78.3, 122] | 0.87x [0.79, 1.05] inconclusive | 0.99x [0.87, 1.16] inconclusive | 1.11x [0.80, 1.38] inconclusive | 1.05x [0.90, 1.56] inconclusive |
| medium | 4x | command to visible frame, p95 (ms) | 110 [107, 116] | 175 [123, 237] | 138 [104, 213] | 183 [171, 267] | 0.64x [0.46, 0.87] lower | 0.80x [0.45, 1.16] inconclusive | 1.20x [0.72, 1.55] inconclusive | 1.30x [0.81, 2.82] inconclusive |
| large | 1x | mean FPS (fps) | 69.1 [68.8, 69.2] | 45.1 [43.9, 45.8] | 50.7 [50.5, 51.0] | 58.2 [58.1, 58.7] | 1.54x [1.52, 1.62] higher | 1.13x [1.11, 1.16] higher | 1.30x [1.28, 1.36] higher | 1.15x [1.14, 1.17] higher |
| large | 1x | 1% low FPS (fps) | 48.7 [47.0, 54.2] | 6.75 [6.71, 7.09] | 7.04 [6.41, 7.13] | 9.41 [8.98, 9.78] | 7.22x [7.01, 7.77] higher | 1.04x [0.97, 1.06] inconclusive | 1.38x [1.33, 1.42] higher | 1.36x [1.28, 1.46] higher |
| large | 1x | frame time p95 (ms) | 15.0 [15.0, 15.0] | 45.0 [44.5, 53.2] | 30.0 [29.5, 30.0] | 15.3 [15.2, 15.5] | 0.33x [0.28, 0.34] lower | 0.67x [0.56, 0.67] lower | 0.34x [0.29, 0.34] lower | 0.51x [0.51, 0.52] lower |
| large | 1x | frame time p99 (ms) | 15.5 [15.4, 15.5] | 141 [134, 148] | 134 [134, 135] | 89.5 [89.0, 89.7] | 0.11x [0.10, 0.12] lower | 0.99x [0.90, 1.00] inconclusive | 0.65x [0.60, 0.67] lower | 0.67x [0.66, 0.67] lower |
| large | 1x | sim minutes per second (min/s) | 120 [120, 120] | 120 [120, 120] | 120 [120, 120] | 120 [120, 120] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| large | 1x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |  |  |  |  |
| large | 1x | main-thread blocking (long tasks past 50 ms) (ms) | 0.00 [0.00, 0.00] | 2833 [2796, 2980] | 2754 [2720, 2877] | 1317 [1281, 1341] | 0.00x [0.00, 0.00] lower | 0.97x [0.95, 0.99] equivalent | 0.46x [0.44, 0.47] lower | 0.47x [0.45, 0.48] lower |
| large | 1x | command to visible frame, median (ms) | 13.7 [11.4, 14.0] | 22.8 [20.9, 24.9] | 11.2 [9.62, 12.7] | 138 [18.6, 142] | 0.58x [0.50, 0.65] lower | 0.49x [0.38, 0.52] lower | 5.83x [0.74, 6.60] inconclusive | 11.89x [1.93, 13.77] higher |
| large | 1x | command to visible frame, p95 (ms) | 16.6 [15.6, 17.5] | 36.3 [32.4, 39.3] | 23.4 [19.5, 27.7] | 151 [29.8, 156] | 0.46x [0.40, 0.51] lower | 0.65x [0.54, 0.76] lower | 4.01x [0.82, 4.66] inconclusive | 6.47x [1.10, 7.99] higher |
| large | 4x | mean FPS (fps) | 41.8 [39.7, 44.1] | 4.65 [4.42, 4.84] | 7.73 [6.99, 8.19] | 18.9 [17.7, 19.3] | 9.13x [8.52, 9.49] higher | 1.66x [1.52, 1.71] higher | 3.99x [3.83, 4.13] higher | 2.44x [2.30, 2.61] higher |
| large | 4x | 1% low FPS (fps) | 8.49 [8.29, 8.60] | 1.34 [1.28, 1.38] | 1.47 [1.38, 1.51] | 1.93 [1.89, 1.99] | 6.35x [6.07, 6.61] higher | 1.09x [1.03, 1.13] inconclusive | 1.45x [1.34, 1.49] higher | 1.28x [1.25, 1.41] higher |
| large | 4x | frame time p95 (ms) | 58.9 [51.5, 59.6] | 705 [688, 725] | 636 [622, 645] | 401 [390, 415] | 0.08x [0.07, 0.09] lower | 0.90x [0.88, 0.92] lower | 0.57x [0.56, 0.59] lower | 0.64x [0.61, 0.65] lower |
| large | 4x | frame time p99 (ms) | 105 [104, 107] | 732 [716, 765] | 653 [647, 674] | 480 [464, 489] | 0.14x [0.14, 0.15] lower | 0.90x [0.88, 0.93] lower | 0.66x [0.64, 0.68] lower | 0.73x [0.71, 0.75] lower |
| large | 4x | sim minutes per second (min/s) | 120 [120, 120] | 37.2 [35.2, 38.7] | 51.3 [50.3, 53.1] | 61.8 [61.6, 63.3] | 3.22x [3.10, 3.41] higher | 1.38x [1.36, 1.39] higher | 1.66x [1.61, 1.72] higher | 1.21x [1.16, 1.25] higher |
| large | 4x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 14.0 [12.0, 15.0] | 13.0 [13.0, 13.0] | 16.0 [15.0, 16.0] | 0.00x [0.00, 0.00] lower | 0.93x [0.81, 1.08] inconclusive | 1.14x [1.00, 1.33] inconclusive | 1.23x [1.15, 1.23] higher |
| large | 4x | main-thread blocking (long tasks past 50 ms) (ms) | 1279 [1164, 1338] | 11511 [11443, 11915] | 9631 [9412, 10046] | 6272 [5997, 6341] | 0.11x [0.10, 0.12] lower | 0.84x [0.81, 0.87] lower | 0.55x [0.52, 0.55] lower | 0.63x [0.63, 0.67] lower |
| large | 4x | command to visible frame, median (ms) | 22.2 [17.7, 31.8] | 145 [137, 148] | 70.8 [65.7, 97.3] | 43.1 [42.1, 49.5] | 0.16x [0.13, 0.22] lower | 0.51x [0.44, 0.66] lower | 0.31x [0.28, 0.34] lower | 0.60x [0.49, 0.69] lower |
| large | 4x | command to visible frame, p95 (ms) | 51.3 [44.7, 61.3] | 213 [199, 706] | 236 [136, 325] | 208 [144, 239] | 0.21x [0.07, 0.30] lower | 0.67x [0.41, 1.60] inconclusive | 0.96x [0.30, 1.13] inconclusive | 0.77x [0.41, 1.54] inconclusive |

## memory

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 1x | main-thread JS heap (bytes) | 47.41 MiB [47.38 MiB, 47.48 MiB] | 47.42 MiB [47.35 MiB, 47.43 MiB] | 47.30 MiB [47.25 MiB, 47.33 MiB] | 47.30 MiB [47.22 MiB, 47.33 MiB] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| small | 1x | JS heaps + WASM memory (main and worker) (bytes) | 47.41 MiB [47.38 MiB, 47.48 MiB] | 55.86 MiB [55.79 MiB, 55.87 MiB] | 55.74 MiB [55.69 MiB, 55.76 MiB] | 56.25 MiB [56.17 MiB, 56.28 MiB] | 0.85x [0.85, 0.85] lower | 1.00x [1.00, 1.00] equivalent | 1.01x [1.01, 1.01] equivalent | 1.01x [1.01, 1.01] equivalent |
| small | 1x | browser process PSS (bytes) | n/a | n/a | n/a | n/a |  |  |  |  |
| medium | 1x | main-thread JS heap (bytes) | 59.12 MiB [58.76 MiB, 59.45 MiB] | 58.74 MiB [58.40 MiB, 59.06 MiB] | 59.03 MiB [59.01 MiB, 59.05 MiB] | 58.94 MiB [58.91 MiB, 59.57 MiB] | 1.01x [0.99, 1.02] equivalent | 1.01x [1.00, 1.01] equivalent | 1.01x [1.00, 1.02] equivalent | 1.00x [1.00, 1.01] equivalent |
| medium | 1x | JS heaps + WASM memory (main and worker) (bytes) | 59.12 MiB [58.76 MiB, 59.45 MiB] | 95.92 MiB [95.58 MiB, 96.25 MiB] | 96.22 MiB [96.20 MiB, 96.24 MiB] | 96.64 MiB [96.62 MiB, 97.28 MiB] | 0.62x [0.61, 0.62] lower | 1.00x [1.00, 1.01] equivalent | 1.01x [1.00, 1.02] equivalent | 1.01x [1.00, 1.01] equivalent |
| medium | 1x | browser process PSS (bytes) | n/a | n/a | n/a | n/a |  |  |  |  |
| large | 1x | main-thread JS heap (bytes) | 74.54 MiB [73.98 MiB, 74.55 MiB] | 74.40 MiB [74.39 MiB, 74.52 MiB] | 74.32 MiB [74.30 MiB, 74.32 MiB] | 76.35 MiB [75.78 MiB, 76.36 MiB] | 1.00x [0.99, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.03x [1.02, 1.03] equivalent | 1.03x [1.02, 1.03] equivalent |
| large | 1x | JS heaps + WASM memory (main and worker) (bytes) | 74.54 MiB [73.98 MiB, 74.55 MiB] | 202.72 MiB [202.70 MiB, 202.83 MiB] | 202.63 MiB [202.61 MiB, 202.64 MiB] | 205.17 MiB [204.61 MiB, 205.18 MiB] | 0.37x [0.36, 0.37] lower | 1.00x [1.00, 1.00] equivalent | 1.01x [1.01, 1.01] equivalent | 1.01x [1.01, 1.01] equivalent |
| large | 1x | browser process PSS (bytes) | n/a | n/a | n/a | n/a |  |  |  |  |

## traffic

| scenario | throttle | metric | wasm-worker | wasm-worker / wasm |
|---|---|---|---|---|
| small | 1x | worker replies per second (frames) (1/s) | 60.5 [60.3, 60.8] |  |
| small | 1x | messages per second, both ways (frames) (1/s) | 122 [122, 122] |  |
| small | 1x | bytes received per second (frames) (bytes/s) | 7.59 MiB [7.58 MiB, 7.63 MiB] |  |
| small | 1x | reply apply time per second (frames) (ms/s) | 19.1 [18.8, 19.3] |  |
| small | 1x | command to ack, median (frames) (ms) | 3.35 [0.31, 9.47] |  |
| small | 1x | frame view bytes per reply (hosted) (bytes) | 118.7 KiB [118.7 KiB, 118.7 KiB] |  |
| small | 1x | full-save bytes per merge (hosted) (bytes) | 235.2 KiB [235.2 KiB, 235.2 KiB] |  |
| small | 1x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| small | 1x | worker engine time, 720 steps (hosted) (ms) | 137 [134, 142] |  |
| small | 1x | main-thread merge time, 720 steps (hosted) (ms) | 134 [131, 139] |  |
| small | 4x | worker replies per second (frames) (1/s) | 50.1 [48.2, 50.6] |  |
| small | 4x | messages per second, both ways (frames) (1/s) | 101 [97.4, 102] |  |
| small | 4x | bytes received per second (frames) (bytes/s) | 6.32 MiB [6.09 MiB, 6.39 MiB] |  |
| small | 4x | reply apply time per second (frames) (ms/s) | 78.6 [77.4, 79.2] |  |
| small | 4x | command to ack, median (frames) (ms) | 12.0 [9.92, 13.7] |  |
| small | 4x | frame view bytes per reply (hosted) (bytes) | 118.7 KiB [118.7 KiB, 118.7 KiB] |  |
| small | 4x | full-save bytes per merge (hosted) (bytes) | 235.2 KiB [235.2 KiB, 235.2 KiB] |  |
| small | 4x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| small | 4x | worker engine time, 720 steps (hosted) (ms) | 137 [133, 149] |  |
| small | 4x | main-thread merge time, 720 steps (hosted) (ms) | 546 [521, 600] |  |
| medium | 1x | worker replies per second (frames) (1/s) | 56.1 [55.9, 56.3] |  |
| medium | 1x | messages per second, both ways (frames) (1/s) | 113 [113, 114] |  |
| medium | 1x | bytes received per second (frames) (bytes/s) | 35.68 MiB [35.27 MiB, 35.93 MiB] |  |
| medium | 1x | reply apply time per second (frames) (ms/s) | 109 [107, 111] |  |
| medium | 1x | command to ack, median (frames) (ms) | 27.7 [21.7, 29.4] |  |
| medium | 1x | frame view bytes per reply (hosted) (bytes) | 585.2 KiB [585.2 KiB, 585.2 KiB] |  |
| medium | 1x | full-save bytes per merge (hosted) (bytes) | 1.29 MiB [1.29 MiB, 1.29 MiB] |  |
| medium | 1x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| medium | 1x | worker engine time, 720 steps (hosted) (ms) | 692 [681, 725] |  |
| medium | 1x | main-thread merge time, 720 steps (hosted) (ms) | 647 [638, 663] |  |
| medium | 4x | worker replies per second (frames) (1/s) | 14.2 [13.2, 14.5] |  |
| medium | 4x | messages per second, both ways (frames) (1/s) | 29.4 [27.3, 30.0] |  |
| medium | 4x | bytes received per second (frames) (bytes/s) | 10.45 MiB [9.73 MiB, 10.62 MiB] |  |
| medium | 4x | reply apply time per second (frames) (ms/s) | 260 [249, 270] |  |
| medium | 4x | command to ack, median (frames) (ms) | 35.2 [27.0, 43.3] |  |
| medium | 4x | frame view bytes per reply (hosted) (bytes) | 585.2 KiB [585.2 KiB, 585.2 KiB] |  |
| medium | 4x | full-save bytes per merge (hosted) (bytes) | 1.29 MiB [1.29 MiB, 1.29 MiB] |  |
| medium | 4x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| medium | 4x | worker engine time, 720 steps (hosted) (ms) | 708 [701, 756] |  |
| medium | 4x | main-thread merge time, 720 steps (hosted) (ms) | 2757 [2740, 2955] |  |
| large | 1x | worker replies per second (frames) (1/s) | 44.2 [43.6, 45.2] |  |
| large | 1x | messages per second, both ways (frames) (1/s) | 89.4 [88.2, 91.3] |  |
| large | 1x | bytes received per second (frames) (bytes/s) | 99.81 MiB [98.76 MiB, 100.71 MiB] |  |
| large | 1x | reply apply time per second (frames) (ms/s) | 290 [279, 303] |  |
| large | 1x | command to ack, median (frames) (ms) | 40.6 [8.25, 43.2] |  |
| large | 1x | frame view bytes per reply (hosted) (bytes) | 2.00 MiB [2.00 MiB, 2.00 MiB] |  |
| large | 1x | full-save bytes per merge (hosted) (bytes) | 4.49 MiB [4.49 MiB, 4.49 MiB] |  |
| large | 1x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| large | 1x | worker engine time, 720 steps (hosted) (ms) | 1837 [1807, 2153] |  |
| large | 1x | main-thread merge time, 720 steps (hosted) (ms) | 2207 [2194, 2257] |  |
| large | 4x | worker replies per second (frames) (1/s) | 16.8 [15.4, 17.1] |  |
| large | 4x | messages per second, both ways (frames) (1/s) | 34.6 [31.8, 35.3] |  |
| large | 4x | bytes received per second (frames) (bytes/s) | 38.57 MiB [35.88 MiB, 38.93 MiB] |  |
| large | 4x | reply apply time per second (frames) (ms/s) | 571 [567, 590] |  |
| large | 4x | command to ack, median (frames) (ms) | 16.8 [15.9, 18.9] |  |
| large | 4x | frame view bytes per reply (hosted) (bytes) | 2.00 MiB [2.00 MiB, 2.00 MiB] |  |
| large | 4x | full-save bytes per merge (hosted) (bytes) | 4.49 MiB [4.49 MiB, 4.49 MiB] |  |
| large | 4x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| large | 4x | worker engine time, 720 steps (hosted) (ms) | 1876 [1833, 2190] |  |
| large | 4x | main-thread merge time, 720 steps (hosted) (ms) | 9457 [9387, 9569] |  |

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
- Frames render at a 1280x720 CSS viewport (set with --viewport). A frame longer than 200 ms is handed 1 ms of game time, so rows with clamped frames understate the simulation work; the clamped-frame row counts them.
- Message sizes are counted on the way in (frame views, full saves, events, log and pending text at two bytes a character); the way out (steps and commands, a few numbers each) is not measured, so as not to serialize every message twice on the measured thread.
- The serialize and deserialize halves of the full save are split only on the worker host (the worker's reply time includes the serialize, the main thread's merge time the parse and merge). The main-thread hosts' read-model sync is split in perf:compare's attribution pass.
- Throttles run in a fixed order (1x then 4x) in each process. The mode order rotates by repetition (10 repetitions over 4 modes: modes first between 2 and 3 times). The throttled cold start throttles before the navigation and again at commit; its CPU probe runs after startup, so a throttle gap at navigation would not show.
- Audio was not started in these frames (measured in perf:compare). The coalesced and worker hosts are experimental and opt-in; the shipped default is unchanged.
