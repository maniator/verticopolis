# Worker host benchmark (npm run perf:worker)

> **Snapshot, measured 2026-10-20T15:05:20.467Z to 2026-10-20T17:14:28.757Z on commit `a53e877` (app 2.35.0).** Live numbers: re-run `npm run perf:worker` (src/tests/perfWorker/, its arithmetic pinned by src/tests/perfWorker/analysis.test.ts). Validation passed.

- Engine package: verticopolis_engine_bg.wasm `eaa090d9157556d4`, verticopolis_engine.js `a015dd2f2484ebe8`; source hash `ef3616e64f111fc4959bb25266f4209d71350ba360b8cc98a6549cf1d56e41ff`
- Machine: AMD Ryzen 5 5600X 6-Core Processor             , 12 CPUs, 31.9 GiB, win32 10.0.26200; Node v22.22.0; Playwright 1.61.1; browser 149.0.7827.55
- Renderer: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver); cross-origin isolated: true; frames at a 1280x720 CSS viewport
- 10 repetitions of ts, wasm, wasm-frame, wasm-worker, each in a fresh browser process, order rotated by repetition; throttles 1x, 4x
- Scenarios: small (729 population, `8018a9e05910`), medium (3240 population, `159b444c6a65`), large (17322 population, `e0db69ea4891`)
- Download (production build, Brotli 11): engine worker chunk 2.7 KiB (8.6 KiB raw); engine package (WASM modes) 326.7 KiB (1.40 MiB raw); all other JavaScript 361.1 KiB

Medians with their 95% order-statistic interval. Ratios are paired by repetition (mode over the column's reference); a verdict needs six pairs and an interval clear of a 5% band. `wasm-worker / wasm-frame` compares two hosts with the same sync changes, so it is the worker placement alone; `wasm-frame / wasm` is the sync changes alone. Ratios against TypeScript are in ratios.csv. A ratio marked with `(k zero)` dropped k repetitions where the reference was 0.

## startup

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| - | 1x | cold start to mode ready (ms) | 388 [377, 402] | 412 [403, 421] | 415 [407, 426] | 410 [398, 423] | 0.94x [0.91, 1.00] inconclusive | 1.01x [0.98, 1.04] equivalent | 0.99x [0.98, 1.04] equivalent | 0.99x [0.95, 1.00] equivalent |
| - | 1x | warm start to mode ready (ms) | 380 [374, 389] | 279 [276, 285] | 281 [277, 293] | 284 [283, 297] | 1.36x [1.33, 1.39] higher | 1.00x [0.99, 1.05] inconclusive | 1.03x [1.01, 1.06] inconclusive | 1.02x [1.00, 1.06] inconclusive |
| - | 4x | cold start to mode ready (ms) | 986 [976, 997] | 1098 [1082, 1118] | 1089 [1081, 1120] | 1021 [1014, 1177] | 0.90x [0.88, 0.91] lower | 0.99x [0.97, 1.02] equivalent | 0.94x [0.91, 1.08] inconclusive | 0.94x [0.92, 1.07] inconclusive |
| - | 1x | bytes before mode ready (cold) (bytes) | 302.9 KiB [302.9 KiB, 302.9 KiB] | 629.7 KiB [629.7 KiB, 629.7 KiB] | 629.7 KiB [629.7 KiB, 629.7 KiB] | 632.4 KiB [632.4 KiB, 632.4 KiB] | 0.48x [0.48, 0.48] lower | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |

## raw

| scenario | throttle | metric | ts | wasm | ts / wasm |
|---|---|---|---|---|---|
| small | 1x | bare engine, 720 steps (ms) | 129 [126, 134] | 80.2 [78.0, 90.6] | 1.61x [1.42, 1.70] higher |
| small | 4x | bare engine, 720 steps (ms) | 758 [747, 768] | 508 [505, 513] | 1.50x [1.47, 1.53] higher |
| medium | 1x | bare engine, 720 steps (ms) | 768 [759, 794] | 390 [389, 400] | 1.96x [1.92, 2.03] higher |
| medium | 4x | bare engine, 720 steps (ms) | 4783 [4713, 4813] | 2502 [2478, 2616] | 1.90x [1.83, 1.93] higher |
| large | 1x | bare engine, 720 steps (ms) | 703 [696, 776] | 847 [809, 924] | 0.84x [0.75, 0.94] lower |
| large | 4x | bare engine, 720 steps (ms) | 4734 [4656, 4912] | 5264 [5213, 5303] | 0.90x [0.88, 0.95] lower |

## hosted

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 1x | wall time, 720 steps (ms) | 135 [132, 139] | 486 [480, 512] | 337 [330, 353] | 340 [334, 380] | 0.27x [0.27, 0.29] lower | 0.69x [0.67, 0.73] lower | 0.70x [0.66, 0.71] lower | 1.01x [0.95, 1.12] inconclusive |
| small | 1x | main-thread time, 720 steps (ms) | 134 [132, 138] | 485 [480, 512] | 336 [330, 353] | 179 [176, 195] | 0.27x [0.27, 0.29] lower | 0.69x [0.67, 0.73] lower | 0.37x [0.35, 0.37] lower | 0.54x [0.50, 0.58] lower |
| small | 1x | main-thread time per batch, p95 (ms) | 1.70 [1.60, 1.75] | 10.8 [10.2, 11.6] | 9.65 [9.35, 10.4] | 6.42 [6.32, 7.79] | 0.16x [0.14, 0.17] lower | 0.89x [0.87, 0.99] inconclusive | 0.60x [0.56, 0.62] lower | 0.67x [0.63, 0.81] lower |
| small | 1x | main-thread time per batch, max (ms) | 3.68 [3.64, 3.80] | 18.4 [16.6, 19.1] | 14.3 [12.1, 17.0] | 9.72 [8.81, 11.3] | 0.21x [0.19, 0.22] lower | 0.79x [0.63, 1.01] inconclusive | 0.52x [0.48, 0.66] lower | 0.70x [0.51, 0.80] lower |
| small | 4x | wall time, 720 steps (ms) | 756 [753, 758] | 2615 [2571, 2632] | 1928 [1919, 1945] | 1226 [1219, 1240] | 0.29x [0.29, 0.29] lower | 0.74x [0.73, 0.75] lower | 0.47x [0.47, 0.48] lower | 0.64x [0.63, 0.64] lower |
| small | 4x | main-thread time, 720 steps (ms) | 755 [751, 758] | 2613 [2569, 2630] | 1927 [1917, 1944] | 1043 [1027, 1053] | 0.29x [0.29, 0.29] lower | 0.74x [0.73, 0.75] lower | 0.40x [0.40, 0.41] lower | 0.54x [0.53, 0.55] lower |
| small | 4x | main-thread time per batch, p95 (ms) | 8.57 [8.41, 8.58] | 58.9 [58.6, 59.1] | 56.1 [54.7, 56.6] | 36.5 [35.8, 37.2] | 0.15x [0.14, 0.15] lower | 0.95x [0.93, 0.96] inconclusive | 0.62x [0.61, 0.63] lower | 0.66x [0.63, 0.67] lower |
| small | 4x | main-thread time per batch, max (ms) | 16.6 [16.0, 16.9] | 73.3 [72.3, 74.2] | 70.3 [68.9, 71.9] | 54.9 [53.1, 56.8] | 0.23x [0.21, 0.24] lower | 0.95x [0.91, 0.99] inconclusive | 0.75x [0.72, 0.76] lower | 0.78x [0.75, 0.81] lower |
| medium | 1x | wall time, 720 steps (ms) | 775 [761, 798] | 2302 [2263, 2464] | 1600 [1583, 1622] | 1659 [1620, 1776] | 0.34x [0.31, 0.35] lower | 0.69x [0.66, 0.71] lower | 0.72x [0.66, 0.75] lower | 1.03x [1.00, 1.11] inconclusive |
| medium | 1x | main-thread time, 720 steps (ms) | 775 [760, 797] | 2302 [2263, 2463] | 1599 [1583, 1622] | 895 [869, 962] | 0.34x [0.31, 0.35] lower | 0.69x [0.66, 0.71] lower | 0.38x [0.36, 0.41] lower | 0.55x [0.54, 0.61] lower |
| medium | 1x | main-thread time per batch, p95 (ms) | 8.62 [8.24, 9.28] | 51.5 [50.2, 53.7] | 47.4 [47.0, 48.4] | 32.2 [31.1, 35.6] | 0.17x [0.16, 0.18] lower | 0.92x [0.90, 0.95] inconclusive | 0.62x [0.59, 0.68] lower | 0.67x [0.63, 0.75] lower |
| medium | 1x | main-thread time per batch, max (ms) | 37.6 [37.2, 38.0] | 112 [110, 120] | 67.4 [65.4, 69.4] | 43.0 [41.0, 52.0] | 0.33x [0.31, 0.34] lower | 0.59x [0.58, 0.62] lower | 0.38x [0.37, 0.44] lower | 0.65x [0.60, 0.76] lower |
| medium | 4x | wall time, 720 steps (ms) | 4795 [4682, 4833] | 14159 [14124, 14253] | 9791 [9726, 9836] | 6526 [6471, 6654] | 0.34x [0.33, 0.34] lower | 0.69x [0.69, 0.70] lower | 0.46x [0.46, 0.47] lower | 0.67x [0.66, 0.68] lower |
| medium | 4x | main-thread time, 720 steps (ms) | 4794 [4681, 4831] | 14155 [14120, 14251] | 9789 [9724, 9834] | 5620 [5570, 5722] | 0.34x [0.33, 0.34] lower | 0.69x [0.69, 0.70] lower | 0.40x [0.39, 0.41] lower | 0.58x [0.57, 0.58] lower |
| medium | 4x | main-thread time per batch, p95 (ms) | 51.4 [48.8, 52.1] | 316 [313, 321] | 291 [287, 296] | 196 [194, 206] | 0.16x [0.15, 0.17] lower | 0.92x [0.90, 0.94] lower | 0.62x [0.61, 0.65] lower | 0.68x [0.67, 0.70] lower |
| medium | 4x | main-thread time per batch, max (ms) | 208 [198, 219] | 706 [688, 713] | 404 [397, 410] | 256 [240, 264] | 0.30x [0.28, 0.31] lower | 0.58x [0.56, 0.59] lower | 0.37x [0.34, 0.38] lower | 0.64x [0.59, 0.65] lower |
| large | 1x | wall time, 720 steps (ms) | 758 [749, 929] | 7128 [6999, 7289] | 4768 [4610, 5027] | 4910 [4773, 4969] | 0.11x [0.10, 0.13] lower | 0.67x [0.64, 0.71] lower | 0.69x [0.67, 0.70] lower | 1.02x [0.97, 1.07] inconclusive |
| large | 1x | main-thread time, 720 steps (ms) | 758 [748, 928] | 7127 [6998, 7288] | 4767 [4610, 5026] | 2928 [2820, 2955] | 0.11x [0.10, 0.13] lower | 0.67x [0.64, 0.71] lower | 0.41x [0.40, 0.42] lower | 0.61x [0.57, 0.64] lower |
| large | 1x | main-thread time per batch, p95 (ms) | 11.4 [10.8, 12.2] | 167 [165, 172] | 149 [145, 157] | 107 [104, 111] | 0.07x [0.06, 0.07] lower | 0.90x [0.88, 0.94] lower | 0.64x [0.63, 0.65] lower | 0.70x [0.68, 0.72] lower |
| large | 1x | main-thread time per batch, max (ms) | 32.4 [31.0, 34.9] | 218 [199, 230] | 195 [177, 223] | 149 [134, 175] | 0.15x [0.14, 0.17] lower | 0.88x [0.81, 1.13] inconclusive | 0.67x [0.63, 0.81] lower | 0.74x [0.60, 0.99] inconclusive |
| large | 4x | wall time, 720 steps (ms) | 4763 [4691, 4956] | 41983 [41875, 42235] | 29586 [29330, 29673] | 19819 [19697, 19853] | 0.11x [0.11, 0.12] lower | 0.70x [0.69, 0.71] lower | 0.47x [0.47, 0.47] lower | 0.67x [0.67, 0.68] lower |
| large | 4x | main-thread time, 720 steps (ms) | 4762 [4689, 4954] | 41979 [41871, 42231] | 29582 [29326, 29670] | 17385 [17255, 17472] | 0.11x [0.11, 0.12] lower | 0.70x [0.69, 0.71] lower | 0.41x [0.41, 0.42] lower | 0.59x [0.58, 0.60] lower |
| large | 4x | main-thread time per batch, p95 (ms) | 58.7 [58.1, 62.4] | 1020 [1017, 1024] | 949 [939, 960] | 633 [628, 638] | 0.06x [0.06, 0.06] lower | 0.93x [0.92, 0.94] lower | 0.62x [0.61, 0.62] lower | 0.67x [0.66, 0.68] lower |
| large | 4x | main-thread time per batch, max (ms) | 170 [165, 175] | 1148 [1123, 1163] | 1090 [1074, 1106] | 758 [742, 772] | 0.15x [0.14, 0.15] lower | 0.94x [0.92, 0.98] inconclusive | 0.66x [0.64, 0.69] lower | 0.70x [0.69, 0.71] lower |

## frames

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 1x | mean FPS (fps) | 13.3 [13.2, 13.4] | 12.9 [12.9, 13.0] | 13.1 [13.0, 13.1] | 13.2 [13.2, 13.2] | 1.03x [1.02, 1.04] equivalent | 1.01x [1.01, 1.02] equivalent | 1.02x [1.01, 1.03] equivalent | 1.01x [1.00, 1.01] equivalent |
| small | 1x | 1% low FPS (fps) | 10.9 [10.0, 12.0] | 10.0 [10.0, 10.0] | 10.0 [10.0, 10.0] | 10.0 [10.0, 10.0] | 1.09x [1.00, 1.20] inconclusive | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| small | 1x | frame time p95 (ms) | 83.3 [83.3, 83.3] | 83.3 [83.3, 83.3] | 83.3 [83.3, 83.3] | 83.3 [83.3, 83.3] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| small | 1x | frame time p99 (ms) | 83.3 [83.3, 100.0] | 100.0 [100.0, 100.0] | 100.0 [84.0, 100.0] | 100.0 [100.0, 100.0] | 0.83x [0.83, 1.00] inconclusive | 1.00x [0.84, 1.00] inconclusive | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.19] inconclusive |
| small | 1x | sim minutes per second (min/s) | 107 [106, 107] | 103 [103, 104] | 105 [104, 105] | 97.8 [97.6, 97.9] | 1.03x [1.02, 1.04] equivalent | 1.01x [1.01, 1.02] equivalent | 0.94x [0.94, 0.95] inconclusive | 0.93x [0.93, 0.94] lower |
| small | 1x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |  |  |  |  |
| small | 1x | main-thread blocking (long tasks past 50 ms) (ms) | 4908 [4851, 4980] | 5209 [5179, 5261] | 5101 [5045, 5145] | 4785 [4777, 4802] | 0.94x [0.93, 0.96] inconclusive | 0.98x [0.96, 0.99] equivalent | 0.92x [0.90, 0.93] lower | 0.94x [0.93, 0.96] inconclusive |
| small | 1x | command to visible frame, median (ms) | 10.7 [9.69, 11.3] | 10.7 [9.05, 12.2] | 10.4 [8.58, 10.9] | 83.8 [81.4, 85.1] | 0.93x [0.86, 1.13] inconclusive | 0.98x [0.84, 1.09] inconclusive | 7.63x [6.94, 8.70] higher | 7.98x [7.45, 9.83] higher |
| small | 1x | command to visible frame, p95 (ms) | 15.2 [14.3, 16.9] | 16.9 [14.6, 18.7] | 16.0 [15.2, 17.2] | 93.1 [92.0, 97.2] | 0.95x [0.77, 1.04] inconclusive | 0.95x [0.84, 1.13] inconclusive | 5.65x [4.92, 6.26] higher | 5.81x [5.63, 6.28] higher |
| small | 4x | mean FPS (fps) | 7.46 [7.39, 7.51] | 6.84 [6.81, 6.85] | 7.03 [6.98, 7.05] | 7.39 [7.37, 7.42] | 1.09x [1.08, 1.10] higher | 1.03x [1.02, 1.03] equivalent | 1.08x [1.08, 1.08] higher | 1.05x [1.05, 1.06] inconclusive |
| small | 4x | 1% low FPS (fps) | 5.45 [5.45, 6.00] | 4.62 [4.62, 4.62] | 4.00 [4.00, 4.00] | 5.00 [5.00, 5.00] | 1.18x [1.18, 1.30] higher | 0.87x [0.87, 0.87] lower | 1.08x [1.08, 1.08] higher | 1.25x [1.17, 1.25] higher |
| small | 4x | frame time p95 (ms) | 167 [167, 167] | 200 [200, 200] | 196 [196, 200] | 183 [183, 183] | 0.83x [0.83, 0.83] lower | 0.99x [0.98, 1.00] equivalent | 0.92x [0.92, 0.92] lower | 0.93x [0.92, 0.94] lower |
| small | 4x | frame time p99 (ms) | 167 [167, 181] | 216 [200, 217] | 208 [200, 216] | 198 [183, 200] | 0.77x [0.77, 0.84] lower | 1.00x [0.92, 1.00] inconclusive | 0.92x [0.85, 0.99] inconclusive | 0.92x [0.92, 0.99] inconclusive |
| small | 4x | sim minutes per second (min/s) | 59.7 [59.1, 60.1] | 54.7 [54.5, 54.8] | 56.3 [55.9, 56.4] | 51.6 [51.5, 51.9] | 1.09x [1.08, 1.10] higher | 1.03x [1.02, 1.03] equivalent | 0.94x [0.94, 0.95] lower | 0.92x [0.92, 0.92] lower |
| small | 4x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 2.00 [1.00, 4.00] | 1.50 [1.00, 2.00] | 0.00 [0.00, 0.00] | 0.00x [0.00, 0.00] lower | 0.58x [0.50, 1.50] inconclusive | 0.00x [0.00, 0.00] lower | 0.00x [0.00, 0.00] lower |
| small | 4x | main-thread blocking (long tasks past 50 ms) (ms) | 9308 [9286, 9346] | 9806 [9783, 9847] | 9661 [9612, 9690] | 8701 [8672, 8729] | 0.95x [0.95, 0.95] inconclusive | 0.98x [0.98, 0.99] equivalent | 0.89x [0.88, 0.89] lower | 0.90x [0.90, 0.90] lower |
| small | 4x | command to visible frame, median (ms) | 63.9 [59.8, 65.9] | 65.4 [64.1, 68.8] | 60.4 [58.4, 63.6] | 185 [183, 189] | 0.97x [0.95, 0.99] inconclusive | 0.92x [0.90, 0.99] inconclusive | 2.81x [2.72, 2.93] higher | 3.03x [2.93, 3.16] higher |
| small | 4x | command to visible frame, p95 (ms) | 80.6 [73.9, 88.8] | 89.2 [82.6, 106] | 131 [96.3, 135] | 218 [206, 239] | 0.86x [0.82, 1.01] inconclusive | 1.37x [1.06, 1.62] higher | 2.46x [2.24, 2.67] higher | 1.67x [1.54, 2.26] higher |
| medium | 1x | mean FPS (fps) | 12.2 [12.1, 12.2] | 10.8 [10.7, 10.8] | 11.4 [11.3, 11.5] | 11.9 [11.9, 12.0] | 1.13x [1.12, 1.14] higher | 1.05x [1.05, 1.08] inconclusive | 1.11x [1.09, 1.12] higher | 1.05x [1.03, 1.06] inconclusive |
| medium | 1x | 1% low FPS (fps) | 8.57 [8.57, 8.57] | 6.00 [6.00, 6.67] | 6.67 [6.67, 7.50] | 7.08 [6.67, 7.50] | 1.43x [1.29, 1.43] higher | 1.12x [1.00, 1.25] inconclusive | 1.12x [1.00, 1.25] inconclusive | 1.00x [0.89, 1.12] inconclusive |
| medium | 1x | frame time p95 (ms) | 100.0 [100.0, 100] | 133 [117, 133] | 117 [117, 117] | 117 [117, 117] | 0.75x [0.75, 0.86] lower | 0.88x [0.88, 1.00] inconclusive | 0.88x [0.87, 1.00] inconclusive | 1.00x [1.00, 1.00] equivalent |
| medium | 1x | frame time p99 (ms) | 103 [100, 117] | 150 [133, 150] | 133 [133, 138] | 133 [133, 133] | 0.70x [0.67, 0.88] lower | 0.89x [0.89, 1.04] inconclusive | 0.89x [0.89, 1.00] inconclusive | 1.00x [0.96, 1.00] equivalent |
| medium | 1x | sim minutes per second (min/s) | 97.6 [96.6, 97.9] | 86.5 [85.6, 86.7] | 91.2 [90.5, 92.0] | 87.9 [87.4, 88.8] | 1.13x [1.12, 1.14] higher | 1.05x [1.05, 1.08] inconclusive | 1.02x [1.01, 1.03] equivalent | 0.97x [0.95, 0.98] equivalent |
| medium | 1x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |  |  |  |  |
| medium | 1x | main-thread blocking (long tasks past 50 ms) (ms) | 5768 [5721, 5847] | 6830 [6773, 6928] | 6375 [6297, 6431] | 4974 [4907, 5039] | 0.85x [0.83, 0.85] lower | 0.93x [0.91, 0.94] lower | 0.72x [0.72, 0.74] lower | 0.78x [0.77, 0.80] lower |
| medium | 1x | command to visible frame, median (ms) | 19.4 [16.9, 22.1] | 27.5 [25.1, 30.4] | 25.2 [23.6, 27.7] | 91.9 [86.3, 93.9] | 0.74x [0.59, 0.78] lower | 0.93x [0.83, 1.10] inconclusive | 3.39x [2.86, 3.56] higher | 3.65x [3.06, 3.85] higher |
| medium | 1x | command to visible frame, p95 (ms) | 30.0 [28.3, 34.4] | 58.5 [49.2, 65.3] | 44.4 [33.1, 58.4] | 120 [116, 131] | 0.53x [0.50, 0.57] lower | 0.79x [0.51, 1.04] inconclusive | 2.01x [1.79, 2.52] higher | 2.82x [2.08, 3.53] higher |
| medium | 4x | mean FPS (fps) | 6.00 [5.94, 6.10] | 4.57 [4.54, 4.65] | 4.94 [4.88, 5.01] | 5.79 [5.73, 5.88] | 1.31x [1.27, 1.34] higher | 1.08x [1.07, 1.10] higher | 1.27x [1.24, 1.28] higher | 1.17x [1.16, 1.19] higher |
| medium | 4x | 1% low FPS (fps) | 3.75 [3.53, 3.75] | 2.07 [2.07, 2.14] | 2.18 [2.07, 2.31] | 2.31 [2.22, 2.40] | 1.75x [1.71, 1.81] higher | 1.04x [1.00, 1.11] inconclusive | 1.10x [1.07, 1.12] higher | 1.04x [1.00, 1.12] inconclusive |
| medium | 4x | frame time p95 (ms) | 242 [233, 250] | 433 [433, 433] | 417 [417, 427] | 372 [350, 379] | 0.56x [0.54, 0.58] lower | 0.96x [0.94, 0.98] inconclusive | 0.86x [0.81, 0.88] lower | 0.89x [0.84, 0.91] lower |
| medium | 4x | frame time p99 (ms) | 267 [267, 268] | 472 [455, 477] | 450 [421, 467] | 405 [402, 421] | 0.57x [0.55, 0.59] lower | 0.96x [0.92, 1.00] inconclusive | 0.86x [0.85, 0.89] lower | 0.90x [0.88, 0.96] inconclusive |
| medium | 4x | sim minutes per second (min/s) | 45.9 [44.1, 46.7] | 33.5 [32.5, 33.9] | 36.8 [36.3, 37.1] | 38.3 [37.6, 39.5] | 1.37x [1.31, 1.44] higher | 1.10x [1.08, 1.12] higher | 1.16x [1.13, 1.18] higher | 1.04x [1.02, 1.06] inconclusive |
| medium | 4x | frames over 200 ms (clamped) (count) | 16.5 [15.0, 19.0] | 28.5 [26.0, 29.0] | 25.0 [24.0, 27.0] | 17.0 [14.0, 18.0] | 0.60x [0.50, 0.68] lower | 0.89x [0.86, 1.00] inconclusive | 0.59x [0.48, 0.69] lower | 0.63x [0.56, 0.75] lower |
| medium | 4x | main-thread blocking (long tasks past 50 ms) (ms) | 10486 [10381, 10543] | 11593 [11469, 11737] | 11331 [11215, 11506] | 9691 [9624, 9732] | 0.91x [0.88, 0.92] lower | 0.98x [0.96, 1.00] equivalent | 0.83x [0.83, 0.85] lower | 0.85x [0.84, 0.86] lower |
| medium | 4x | command to visible frame, median (ms) | 79.1 [66.4, 89.8] | 107 [98.4, 135] | 86.1 [74.0, 111] | 222 [173, 226] | 0.68x [0.54, 0.84] lower | 0.74x [0.64, 1.16] inconclusive | 1.65x [1.62, 2.27] higher | 2.43x [2.00, 2.89] higher |
| medium | 4x | command to visible frame, p95 (ms) | 161 [133, 167] | 248 [229, 360] | 238 [220, 341] | 363 [329, 426] | 0.53x [0.44, 0.69] lower | 0.92x [0.66, 1.48] inconclusive | 1.28x [0.96, 1.73] inconclusive | 1.50x [0.90, 1.94] inconclusive |
| large | 1x | mean FPS (fps) | 14.2 [14.1, 14.3] | 9.36 [9.30, 9.43] | 10.8 [10.7, 10.9] | 12.4 [12.3, 12.4] | 1.52x [1.51, 1.52] higher | 1.15x [1.14, 1.16] higher | 1.32x [1.31, 1.34] higher | 1.15x [1.14, 1.17] higher |
| large | 1x | 1% low FPS (fps) | 9.23 [8.57, 10.0] | 3.43 [3.16, 3.53] | 3.75 [3.16, 3.75] | 4.29 [4.00, 4.62] | 2.62x [2.43, 3.17] higher | 1.06x [1.00, 1.13] inconclusive | 1.30x [1.14, 1.33] higher | 1.22x [1.14, 1.31] higher |
| large | 1x | frame time p95 (ms) | 83.3 [83.3, 89.2] | 233 [232, 233] | 217 [217, 217] | 182 [167, 183] | 0.36x [0.36, 0.38] lower | 0.93x [0.86, 0.94] lower | 0.78x [0.71, 0.79] lower | 0.83x [0.77, 0.85] lower |
| large | 1x | frame time p99 (ms) | 100.0 [100.0, 114] | 260 [250, 267] | 248 [240, 263] | 202 [200, 217] | 0.38x [0.37, 0.44] lower | 0.96x [0.93, 1.00] inconclusive | 0.79x [0.77, 0.84] lower | 0.83x [0.77, 0.88] lower |
| large | 1x | sim minutes per second (min/s) | 113 [113, 114] | 74.9 [74.4, 75.4] | 83.8 [83.1, 85.2] | 80.3 [79.8, 80.4] | 1.52x [1.51, 1.52] higher | 1.12x [1.10, 1.15] higher | 1.07x [1.06, 1.08] higher | 0.95x [0.94, 0.97] inconclusive |
| large | 1x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 18.5 [17.0, 19.0] | 11.5 [10.0, 15.0] | 2.00 [1.00, 4.00] | 0.00x [0.00, 0.00] lower | 0.64x [0.53, 0.82] lower | 0.11x [0.06, 0.21] lower | 0.17x [0.10, 0.36] lower |
| large | 1x | main-thread blocking (long tasks past 50 ms) (ms) | 4239 [4180, 4332] | 7987 [7930, 8071] | 6838 [6767, 6918] | 4162 [4150, 4243] | 0.53x [0.53, 0.54] lower | 0.85x [0.85, 0.87] lower | 0.52x [0.50, 0.53] lower | 0.61x [0.59, 0.62] lower |
| large | 1x | command to visible frame, median (ms) | 11.2 [10.6, 12.5] | 29.3 [28.5, 31.7] | 18.1 [16.1, 21.6] | 75.2 [74.3, 78.8] | 0.38x [0.36, 0.40] lower | 0.62x [0.50, 0.76] lower | 2.55x [2.37, 2.80] higher | 4.12x [3.49, 4.66] higher |
| large | 1x | command to visible frame, p95 (ms) | 17.5 [15.2, 23.5] | 90.9 [82.5, 164] | 125 [77.6, 167] | 260 [214, 272] | 0.18x [0.10, 0.27] lower | 1.00x [0.69, 1.90] inconclusive | 2.58x [1.37, 3.08] higher | 1.84x [1.55, 3.37] higher |
| large | 4x | mean FPS (fps) | 6.14 [6.04, 6.24] | 3.30 [3.23, 3.46] | 3.16 [3.14, 3.26] | 4.86 [4.71, 4.95] | 1.84x [1.78, 1.94] higher | 0.96x [0.93, 1.00] inconclusive | 1.46x [1.42, 1.50] higher | 1.52x [1.50, 1.56] higher |
| large | 4x | 1% low FPS (fps) | 3.53 [3.33, 3.53] | 0.86 [0.85, 0.87] | 0.92 [0.91, 0.92] | 1.18 [1.11, 1.25] | 4.09x [3.83, 4.18] higher | 1.08x [1.06, 1.09] higher | 1.37x [1.31, 1.46] higher | 1.28x [1.22, 1.35] higher |
| large | 4x | frame time p95 (ms) | 283 [274, 283] | 1119 [1112, 1133] | 1067 [1058, 1083] | 755 [742, 758] | 0.25x [0.24, 0.25] lower | 0.95x [0.93, 0.96] inconclusive | 0.67x [0.66, 0.68] lower | 0.71x [0.69, 0.71] lower |
| large | 4x | frame time p99 (ms) | 283 [283, 285] | 1158 [1150, 1167] | 1083 [1075, 1083] | 822 [800, 843] | 0.25x [0.24, 0.25] lower | 0.93x [0.93, 0.94] lower | 0.71x [0.69, 0.73] lower | 0.76x [0.74, 0.78] lower |
| large | 4x | sim minutes per second (min/s) | 46.4 [45.7, 47.3] | 17.6 [17.3, 18.4] | 24.0 [23.8, 24.8] | 31.1 [30.8, 31.3] | 2.63x [2.52, 2.72] higher | 1.38x [1.29, 1.41] higher | 1.76x [1.70, 1.80] higher | 1.29x [1.25, 1.31] higher |
| large | 4x | frames over 200 ms (clamped) (count) | 17.0 [16.0, 17.0] | 33.0 [32.0, 36.0] | 17.0 [17.0, 18.0] | 17.0 [16.0, 17.0] | 0.50x [0.46, 0.53] lower | 0.52x [0.47, 0.53] lower | 0.49x [0.45, 0.53] lower | 0.97x [0.94, 1.00] inconclusive |
| large | 4x | main-thread blocking (long tasks past 50 ms) (ms) | 10357 [10268, 10410] | 12791 [12648, 13113] | 13075 [12966, 13219] | 10215 [10123, 10259] | 0.81x [0.79, 0.82] lower | 1.02x [0.99, 1.04] equivalent | 0.80x [0.77, 0.81] lower | 0.78x [0.77, 0.79] lower |
| large | 4x | command to visible frame, median (ms) | 91.0 [72.7, 92.1] | 166 [157, 193] | 128 [127, 205] | 185 [161, 188] | 0.54x [0.36, 0.58] lower | 0.79x [0.75, 1.42] inconclusive | 1.10x [0.97, 1.17] inconclusive | 1.42x [0.79, 1.46] inconclusive |
| large | 4x | command to visible frame, p95 (ms) | 201 [195, 205] | 651 [256, 1048] | 641 [591, 990] | 555 [416, 603] | 0.31x [0.19, 0.80] lower | 0.95x [0.61, 3.87] inconclusive | 0.66x [0.52, 2.19] inconclusive | 0.71x [0.56, 0.94] lower |

## memory

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 1x | main-thread JS heap (bytes) | 47.35 MiB [46.61 MiB, 47.38 MiB] | 46.57 MiB [46.57 MiB, 46.61 MiB] | 46.50 MiB [46.50 MiB, 46.53 MiB] | 46.49 MiB [46.48 MiB, 46.50 MiB] | 1.02x [1.00, 1.02] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| small | 1x | JS heaps + WASM memory (main and worker) (bytes) | 47.35 MiB [46.61 MiB, 47.38 MiB] | 55.01 MiB [55.01 MiB, 55.05 MiB] | 54.94 MiB [54.93 MiB, 54.97 MiB] | 55.44 MiB [55.43 MiB, 55.45 MiB] | 0.86x [0.85, 0.86] lower | 1.00x [1.00, 1.00] equivalent | 1.01x [1.01, 1.01] equivalent | 1.01x [1.01, 1.01] equivalent |
| small | 1x | browser process PSS (bytes) | n/a | n/a | n/a | n/a |  |  |  |  |
| medium | 1x | main-thread JS heap (bytes) | 59.28 MiB [58.89 MiB, 59.30 MiB] | 59.26 MiB [58.58 MiB, 59.29 MiB] | 59.17 MiB [58.45 MiB, 59.20 MiB] | 59.76 MiB [59.74 MiB, 59.79 MiB] | 1.00x [1.00, 1.01] equivalent | 1.00x [0.99, 1.00] equivalent | 1.01x [1.01, 1.02] equivalent | 1.01x [1.01, 1.02] equivalent |
| medium | 1x | JS heaps + WASM memory (main and worker) (bytes) | 59.28 MiB [58.89 MiB, 59.30 MiB] | 96.45 MiB [95.76 MiB, 96.48 MiB] | 96.36 MiB [95.64 MiB, 96.39 MiB] | 97.47 MiB [97.45 MiB, 97.49 MiB] | 0.61x [0.61, 0.62] lower | 1.00x [0.99, 1.00] equivalent | 1.01x [1.01, 1.02] equivalent | 1.01x [1.01, 1.02] equivalent |
| medium | 1x | browser process PSS (bytes) | n/a | n/a | n/a | n/a |  |  |  |  |
| large | 1x | main-thread JS heap (bytes) | 74.70 MiB [74.68 MiB, 74.73 MiB] | 74.57 MiB [74.55 MiB, 74.60 MiB] | 74.49 MiB [74.47 MiB, 74.52 MiB] | 76.50 MiB [76.48 MiB, 76.52 MiB] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.03x [1.03, 1.03] equivalent | 1.03x [1.03, 1.03] equivalent |
| large | 1x | JS heaps + WASM memory (main and worker) (bytes) | 74.70 MiB [74.68 MiB, 74.73 MiB] | 202.88 MiB [202.86 MiB, 202.91 MiB] | 202.80 MiB [202.79 MiB, 202.83 MiB] | 205.33 MiB [205.30 MiB, 205.35 MiB] | 0.37x [0.37, 0.37] lower | 1.00x [1.00, 1.00] equivalent | 1.01x [1.01, 1.01] equivalent | 1.01x [1.01, 1.01] equivalent |
| large | 1x | browser process PSS (bytes) | n/a | n/a | n/a | n/a |  |  |  |  |

## traffic

| scenario | throttle | metric | wasm-worker | wasm-worker / wasm |
|---|---|---|---|---|
| small | 1x | worker replies per second (frames) (1/s) | 13.2 [13.2, 13.2] |  |
| small | 1x | messages per second, both ways (frames) (1/s) | 27.3 [27.2, 27.4] |  |
| small | 1x | bytes received per second (frames) (bytes/s) | 1.95 MiB [1.94 MiB, 1.97 MiB] |  |
| small | 1x | reply apply time per second (frames) (ms/s) | 14.7 [14.5, 14.8] |  |
| small | 1x | command to ack, median (frames) (ms) | 73.3 [72.7, 73.6] |  |
| small | 1x | frame view bytes per reply (hosted) (bytes) | 118.7 KiB [118.7 KiB, 118.7 KiB] |  |
| small | 1x | full-save bytes per merge (hosted) (bytes) | 235.8 KiB [235.8 KiB, 235.8 KiB] |  |
| small | 1x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| small | 1x | worker engine time, 720 steps (hosted) (ms) | 147 [144, 171] |  |
| small | 1x | main-thread merge time, 720 steps (hosted) (ms) | 148 [145, 161] |  |
| small | 4x | worker replies per second (frames) (1/s) | 7.39 [7.37, 7.42] |  |
| small | 4x | messages per second, both ways (frames) (1/s) | 15.7 [15.7, 15.8] |  |
| small | 4x | bytes received per second (frames) (bytes/s) | 1.13 MiB [1.11 MiB, 1.13 MiB] |  |
| small | 4x | reply apply time per second (frames) (ms/s) | 42.0 [41.4, 44.4] |  |
| small | 4x | command to ack, median (frames) (ms) | 128 [124, 129] |  |
| small | 4x | frame view bytes per reply (hosted) (bytes) | 118.7 KiB [118.7 KiB, 118.7 KiB] |  |
| small | 4x | full-save bytes per merge (hosted) (bytes) | 235.8 KiB [235.8 KiB, 235.8 KiB] |  |
| small | 4x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| small | 4x | worker engine time, 720 steps (hosted) (ms) | 145 [144, 148] |  |
| small | 4x | main-thread merge time, 720 steps (hosted) (ms) | 861 [846, 876] |  |
| medium | 1x | worker replies per second (frames) (1/s) | 11.9 [11.9, 12.0] |  |
| medium | 1x | messages per second, both ways (frames) (1/s) | 24.8 [24.6, 25.0] |  |
| medium | 1x | bytes received per second (frames) (bytes/s) | 8.89 MiB [8.79 MiB, 8.98 MiB] |  |
| medium | 1x | reply apply time per second (frames) (ms/s) | 62.6 [60.7, 63.2] |  |
| medium | 1x | command to ack, median (frames) (ms) | 71.1 [70.4, 72.9] |  |
| medium | 1x | frame view bytes per reply (hosted) (bytes) | 585.2 KiB [585.2 KiB, 585.2 KiB] |  |
| medium | 1x | full-save bytes per merge (hosted) (bytes) | 1.29 MiB [1.29 MiB, 1.29 MiB] |  |
| medium | 1x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| medium | 1x | worker engine time, 720 steps (hosted) (ms) | 725 [712, 778] |  |
| medium | 1x | main-thread merge time, 720 steps (hosted) (ms) | 737 [716, 798] |  |
| medium | 4x | worker replies per second (frames) (1/s) | 5.73 [5.66, 5.88] |  |
| medium | 4x | messages per second, both ways (frames) (1/s) | 12.4 [12.3, 12.7] |  |
| medium | 4x | bytes received per second (frames) (bytes/s) | 4.20 MiB [4.16 MiB, 4.22 MiB] |  |
| medium | 4x | reply apply time per second (frames) (ms/s) | 159 [157, 161] |  |
| medium | 4x | command to ack, median (frames) (ms) | 118 [115, 119] |  |
| medium | 4x | frame view bytes per reply (hosted) (bytes) | 585.2 KiB [585.2 KiB, 585.2 KiB] |  |
| medium | 4x | full-save bytes per merge (hosted) (bytes) | 1.29 MiB [1.29 MiB, 1.29 MiB] |  |
| medium | 4x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| medium | 4x | worker engine time, 720 steps (hosted) (ms) | 804 [783, 830] |  |
| medium | 4x | main-thread merge time, 720 steps (hosted) (ms) | 4619 [4585, 4694] |  |
| large | 1x | worker replies per second (frames) (1/s) | 11.0 [11.0, 11.1] |  |
| large | 1x | messages per second, both ways (frames) (1/s) | 23.1 [22.9, 23.2] |  |
| large | 1x | bytes received per second (frames) (bytes/s) | 29.16 MiB [28.48 MiB, 29.27 MiB] |  |
| large | 1x | reply apply time per second (frames) (ms/s) | 170 [166, 172] |  |
| large | 1x | command to ack, median (frames) (ms) | 65.2 [63.8, 69.7] |  |
| large | 1x | frame view bytes per reply (hosted) (bytes) | 2.00 MiB [2.00 MiB, 2.00 MiB] |  |
| large | 1x | full-save bytes per merge (hosted) (bytes) | 4.49 MiB [4.49 MiB, 4.49 MiB] |  |
| large | 1x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| large | 1x | worker engine time, 720 steps (hosted) (ms) | 1880 [1835, 1942] |  |
| large | 1x | main-thread merge time, 720 steps (hosted) (ms) | 2544 [2437, 2574] |  |
| large | 4x | worker replies per second (frames) (1/s) | 4.70 [4.64, 4.82] |  |
| large | 4x | messages per second, both ways (frames) (1/s) | 10.3 [10.2, 10.6] |  |
| large | 4x | bytes received per second (frames) (bytes/s) | 12.00 MiB [11.73 MiB, 12.35 MiB] |  |
| large | 4x | reply apply time per second (frames) (ms/s) | 387 [382, 395] |  |
| large | 4x | command to ack, median (frames) (ms) | 124 [108, 134] |  |
| large | 4x | frame view bytes per reply (hosted) (bytes) | 2.00 MiB [2.00 MiB, 2.00 MiB] |  |
| large | 4x | full-save bytes per merge (hosted) (bytes) | 4.49 MiB [4.49 MiB, 4.49 MiB] |  |
| large | 4x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| large | 4x | worker engine time, 720 steps (hosted) (ms) | 2195 [2113, 2262] |  |
| large | 4x | main-thread merge time, 720 steps (hosted) (ms) | 15074 [14957, 15189] |  |

## read model

Measured once per scenario on the TypeScript engine in Node (see the limitations). Shares are of the whole save in JSON characters. A merge is counted where the worker host merges; "changed" is units present in both saves whose records differ, as a share of the units present and as counts; "outside the frame" counts the changed units with at least one changed field the frame view's unit record does not carry. Merges are by reason (hour pass, revision or both).

| scenario | save | units | top-level keys | unit kinds | merges | share of units changed per merge, median / max | units changed per merge, median / mean / max | units touched per merge, median / mean / max | changed outside the frame, median / mean / max | unit fields changed | top-level keys changed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| small | 109,161 chars | 2,240 | units 99.0%, log 0.3%, transports 0.2%, events 0.05%, 22 more 0.1% | floor (1,960) 79.0%, office (104) 9.0%, lobby (140) 5.4%, condo (35) 3.5%, 1 more 0.05% | 24 (24 hour) | 1.5% / 6.3% | 34 / 43.7 / 140 | 34 / 43.7 / 140 | 34 / 38.1 / 140 | occupants, patronageToday, patronageYest, pendingIncome, profitToday, profitYest, satisfaction, state | events, ledger, minutes, money, seed, transports, units |
| medium | 648,859 chars | 12,062 | units 96.7%, excavated 1.5%, ledger 1.1%, transports 0.6%, 22 more 0.05% | floor (10,129) 70.1%, office (379) 7.6%, lobby (830) 5.7%, condo (215) 4.1%, 13 more 7.3% | 24 (24 hour) | 0.1% / 2.1% | 17 / 56.3 / 258 | 17 / 56.3 / 258 | 13 / 15.2 / 126 | occupants, patronageToday, patronageYest, pendingIncome, profitToday, profitYest, satisfaction, state | events, ledger, log, minutes, money, seed, transports, units |
| large | 2,157,388 chars | 43,358 | units 99.9%, transports 0.03%, log 0.01%, milestones <0.01%, 22 more <0.01% | floor (40,083) 84.3%, office (2,886) 12.8%, lobby (375) 0.7%, recycling (9) 0.03%, 4 more 0.02% | 24 (24 hour) | <0.01% / 6.7% | 0.5 / 673.9 / 2,888 | 0.5 / 673.9 / 2,888 | 0 / 553.5 / 2,886 | occupants, satisfaction, state, vacateAt, vacateReason | events, ledger, log, minutes, money, seed, transports, units |

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
- The read model section is measured in Node on the TypeScript engine, not in the browser: each scenario loads its save fresh, as the timed hosted run does after its throwaway warm-up, then runs the hosted rows' 720 steps in batches of 4, and a merge is counted after each batch where the worker host merges by its own rule (the hour-pass counter or the tower revision moved). The merges a host forces after a stale reply or for a settle are left out. Sizes are JSON characters of each value. The WASM engine reaches the same end state (the hosted end-state digests), but its intermediate saves were not compared.
- Audio was not started in these frames (measured in perf:compare). The coalesced and worker hosts are experimental and opt-in; the shipped default is unchanged.
