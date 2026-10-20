# Worker host benchmark (npm run perf:worker)

> **Snapshot, measured 2026-10-20T12:52:52.145Z to 2026-10-20T15:01:53.116Z on commit `e25ec01` (app 2.34.1), dirty tree.** Live numbers: re-run `npm run perf:worker` (src/tests/perfWorker/, its arithmetic pinned by src/tests/perfWorker/analysis.test.ts). Validation passed.

- Engine package: verticopolis_engine_bg.wasm `8d34b471c4502e23`, verticopolis_engine.js `e1c99c1a7c69fdd8`; source hash `b2786beb447604a5b9fafa6a4947221038247b73efe0cde1589845e1cbf329a1`
- Machine: AMD Ryzen 5 5600X 6-Core Processor             , 12 CPUs, 31.9 GiB, win32 10.0.26200; Node v22.22.0; Playwright 1.61.1; browser 149.0.7827.55
- Renderer: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver); cross-origin isolated: true; frames at a 1280x720 CSS viewport
- 10 repetitions of ts, wasm, wasm-frame, wasm-worker, each in a fresh browser process, order rotated by repetition; throttles 1x, 4x
- Scenarios: small (729 population, `8018a9e05910`), medium (3240 population, `159b444c6a65`), large (17322 population, `e0db69ea4891`)
- Download (production build, Brotli 11): engine worker chunk 2.6 KiB (8.3 KiB raw); engine package (WASM modes) 324.7 KiB (1.39 MiB raw); all other JavaScript 358.8 KiB

Medians with their 95% order-statistic interval. Ratios are paired by repetition (mode over the column's reference); a verdict needs six pairs and an interval clear of a 5% band. `wasm-worker / wasm-frame` compares two hosts with the same sync changes, so it is the worker placement alone; `wasm-frame / wasm` is the sync changes alone. Ratios against TypeScript are in ratios.csv. A ratio marked with `(k zero)` dropped k repetitions where the reference was 0.

## startup

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| - | 1x | cold start to mode ready (ms) | 378 [374, 396] | 416 [408, 424] | 415 [411, 420] | 406 [405, 431] | 0.91x [0.88, 0.95] lower | 1.00x [0.97, 1.04] equivalent | 0.98x [0.96, 1.03] equivalent | 0.99x [0.97, 1.03] equivalent |
| - | 1x | warm start to mode ready (ms) | 381 [376, 397] | 279 [274, 288] | 283 [275, 290] | 288 [283, 294] | 1.37x [1.35, 1.42] higher | 1.01x [0.98, 1.04] equivalent | 1.03x [1.00, 1.08] inconclusive | 1.01x [1.00, 1.05] inconclusive |
| - | 4x | cold start to mode ready (ms) | 980 [967, 1002] | 1083 [1081, 1112] | 1099 [1080, 1119] | 1039 [1016, 1094] | 0.90x [0.89, 0.92] lower | 1.01x [0.98, 1.03] equivalent | 0.96x [0.94, 0.99] inconclusive | 0.94x [0.92, 1.01] inconclusive |
| - | 1x | bytes before mode ready (cold) (bytes) | 301.3 KiB [301.3 KiB, 301.3 KiB] | 625.9 KiB [625.9 KiB, 625.9 KiB] | 625.9 KiB [625.9 KiB, 625.9 KiB] | 628.6 KiB [628.6 KiB, 628.6 KiB] | 0.48x [0.48, 0.48] lower | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |

## raw

| scenario | throttle | metric | ts | wasm | ts / wasm |
|---|---|---|---|---|---|
| small | 1x | bare engine, 720 steps (ms) | 131 [128, 135] | 80.8 [79.7, 96.8] | 1.60x [1.32, 1.64] higher |
| small | 4x | bare engine, 720 steps (ms) | 756 [748, 764] | 505 [497, 513] | 1.50x [1.46, 1.54] higher |
| medium | 1x | bare engine, 720 steps (ms) | 771 [766, 801] | 393 [388, 410] | 1.98x [1.95, 2.03] higher |
| medium | 4x | bare engine, 720 steps (ms) | 4777 [4753, 4839] | 2491 [2477, 2549] | 1.91x [1.88, 1.95] higher |
| large | 1x | bare engine, 720 steps (ms) | 732 [696, 815] | 832 [810, 855] | 0.88x [0.85, 0.96] inconclusive |
| large | 4x | bare engine, 720 steps (ms) | 4785 [4656, 5297] | 5289 [5228, 5555] | 0.90x [0.87, 0.94] lower |

## hosted

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 1x | wall time, 720 steps (ms) | 135 [132, 151] | 478 [468, 490] | 329 [324, 335] | 336 [332, 344] | 0.28x [0.28, 0.29] lower | 0.69x [0.68, 0.70] lower | 0.70x [0.69, 0.73] lower | 1.02x [1.00, 1.05] equivalent |
| small | 1x | main-thread time, 720 steps (ms) | 135 [132, 151] | 477 [468, 490] | 329 [324, 334] | 176 [174, 180] | 0.28x [0.28, 0.29] lower | 0.69x [0.68, 0.70] lower | 0.37x [0.36, 0.38] lower | 0.54x [0.52, 0.55] lower |
| small | 1x | main-thread time per batch, p95 (ms) | 1.76 [1.68, 1.81] | 10.6 [10.2, 11.0] | 9.58 [9.36, 10.0] | 6.43 [6.29, 6.72] | 0.17x [0.16, 0.17] lower | 0.91x [0.86, 0.97] inconclusive | 0.61x [0.58, 0.66] lower | 0.66x [0.65, 0.69] lower |
| small | 1x | main-thread time per batch, max (ms) | 3.80 [3.62, 4.23] | 19.0 [17.8, 19.3] | 12.6 [12.2, 13.3] | 8.91 [8.62, 9.36] | 0.20x [0.19, 0.22] lower | 0.68x [0.64, 0.75] lower | 0.47x [0.45, 0.50] lower | 0.70x [0.67, 0.74] lower |
| small | 4x | wall time, 720 steps (ms) | 751 [746, 753] | 2577 [2563, 2596] | 1934 [1881, 1958] | 1207 [1193, 1212] | 0.29x [0.29, 0.29] lower | 0.75x [0.72, 0.76] lower | 0.47x [0.46, 0.47] lower | 0.63x [0.61, 0.64] lower |
| small | 4x | main-thread time, 720 steps (ms) | 750 [744, 753] | 2576 [2561, 2595] | 1933 [1879, 1956] | 1028 [1014, 1031] | 0.29x [0.29, 0.29] lower | 0.75x [0.72, 0.76] lower | 0.40x [0.39, 0.40] lower | 0.53x [0.52, 0.55] lower |
| small | 4x | main-thread time per batch, p95 (ms) | 8.40 [8.36, 8.62] | 58.5 [57.8, 59.2] | 56.0 [55.4, 56.9] | 36.3 [36.2, 36.8] | 0.14x [0.14, 0.15] lower | 0.96x [0.93, 0.98] inconclusive | 0.62x [0.61, 0.63] lower | 0.65x [0.64, 0.67] lower |
| small | 4x | main-thread time per batch, max (ms) | 16.4 [15.8, 17.0] | 73.7 [72.9, 75.4] | 71.7 [69.6, 73.3] | 50.5 [48.8, 54.5] | 0.22x [0.20, 0.23] lower | 0.96x [0.89, 1.01] inconclusive | 0.69x [0.65, 0.73] lower | 0.71x [0.69, 0.76] lower |
| medium | 1x | wall time, 720 steps (ms) | 777 [764, 883] | 2297 [2251, 2429] | 1597 [1589, 1731] | 1646 [1611, 1761] | 0.34x [0.33, 0.37] lower | 0.70x [0.66, 0.77] lower | 0.71x [0.67, 0.77] lower | 1.03x [0.93, 1.10] inconclusive |
| medium | 1x | main-thread time, 720 steps (ms) | 777 [764, 883] | 2296 [2251, 2429] | 1597 [1588, 1731] | 893 [867, 953] | 0.34x [0.33, 0.37] lower | 0.70x [0.66, 0.77] lower | 0.39x [0.36, 0.42] lower | 0.56x [0.50, 0.60] lower |
| medium | 1x | main-thread time per batch, p95 (ms) | 8.88 [8.37, 10.5] | 51.4 [50.2, 53.0] | 47.9 [46.8, 54.0] | 31.4 [30.8, 36.0] | 0.17x [0.16, 0.20] lower | 0.93x [0.89, 1.06] inconclusive | 0.61x [0.59, 0.70] lower | 0.67x [0.58, 0.75] lower |
| medium | 1x | main-thread time per batch, max (ms) | 37.9 [37.5, 39.4] | 112 [111, 147] | 67.3 [64.8, 71.0] | 43.0 [41.4, 48.6] | 0.33x [0.27, 0.35] lower | 0.59x [0.48, 0.61] lower | 0.38x [0.37, 0.41] lower | 0.65x [0.61, 0.75] lower |
| medium | 4x | wall time, 720 steps (ms) | 4731 [4691, 4832] | 14068 [14043, 14095] | 9750 [9661, 9805] | 6600 [6553, 6626] | 0.34x [0.33, 0.34] lower | 0.69x [0.69, 0.70] lower | 0.47x [0.46, 0.47] lower | 0.68x [0.67, 0.68] lower |
| medium | 4x | main-thread time, 720 steps (ms) | 4730 [4689, 4831] | 14066 [14041, 14091] | 9748 [9659, 9802] | 5669 [5627, 5752] | 0.34x [0.33, 0.34] lower | 0.69x [0.69, 0.70] lower | 0.40x [0.40, 0.41] lower | 0.58x [0.57, 0.59] lower |
| medium | 4x | main-thread time per batch, p95 (ms) | 49.7 [48.9, 51.5] | 319 [315, 322] | 292 [287, 293] | 200 [195, 206] | 0.16x [0.15, 0.16] lower | 0.92x [0.89, 0.93] lower | 0.63x [0.60, 0.65] lower | 0.69x [0.67, 0.71] lower |
| medium | 4x | main-thread time per batch, max (ms) | 199 [196, 209] | 707 [695, 717] | 400 [387, 409] | 255 [250, 259] | 0.28x [0.26, 0.31] lower | 0.57x [0.54, 0.59] lower | 0.36x [0.35, 0.38] lower | 0.64x [0.62, 0.66] lower |
| large | 1x | wall time, 720 steps (ms) | 765 [747, 825] | 7106 [7030, 7267] | 4738 [4627, 4813] | 4820 [4716, 4906] | 0.11x [0.10, 0.12] lower | 0.67x [0.65, 0.67] lower | 0.67x [0.66, 0.68] lower | 1.02x [0.99, 1.04] equivalent |
| large | 1x | main-thread time, 720 steps (ms) | 765 [747, 824] | 7105 [7029, 7266] | 4737 [4627, 4812] | 2839 [2773, 2925] | 0.11x [0.10, 0.12] lower | 0.67x [0.65, 0.67] lower | 0.40x [0.39, 0.40] lower | 0.60x [0.58, 0.62] lower |
| large | 1x | main-thread time per batch, p95 (ms) | 11.4 [10.6, 11.7] | 169 [164, 172] | 150 [146, 153] | 103 [102, 107] | 0.07x [0.06, 0.07] lower | 0.91x [0.87, 0.92] lower | 0.62x [0.60, 0.65] lower | 0.69x [0.68, 0.72] lower |
| large | 1x | main-thread time per batch, max (ms) | 33.0 [32.1, 33.8] | 221 [198, 264] | 191 [176, 211] | 128 [125, 148] | 0.15x [0.12, 0.17] lower | 0.89x [0.68, 0.94] lower | 0.60x [0.52, 0.67] lower | 0.70x [0.62, 0.76] lower |
| large | 4x | wall time, 720 steps (ms) | 4805 [4682, 5022] | 42149 [41844, 42573] | 29658 [29359, 29772] | 19818 [19651, 20010] | 0.11x [0.11, 0.12] lower | 0.70x [0.70, 0.71] lower | 0.47x [0.47, 0.47] lower | 0.67x [0.66, 0.68] lower |
| large | 4x | main-thread time, 720 steps (ms) | 4803 [4681, 5019] | 42144 [41840, 42569] | 29656 [29356, 29766] | 17368 [17215, 17618] | 0.11x [0.11, 0.12] lower | 0.70x [0.70, 0.71] lower | 0.41x [0.41, 0.42] lower | 0.59x [0.58, 0.60] lower |
| large | 4x | main-thread time per batch, p95 (ms) | 59.1 [57.7, 62.3] | 1023 [1018, 1029] | 950 [945, 959] | 634 [632, 643] | 0.06x [0.06, 0.06] lower | 0.93x [0.92, 0.94] lower | 0.62x [0.62, 0.63] lower | 0.67x [0.66, 0.69] lower |
| large | 4x | main-thread time per batch, max (ms) | 170 [161, 171] | 1149 [1126, 1164] | 1097 [1081, 1107] | 755 [743, 768] | 0.15x [0.14, 0.16] lower | 0.95x [0.94, 0.99] inconclusive | 0.66x [0.64, 0.68] lower | 0.69x [0.68, 0.71] lower |

## frames

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 1x | mean FPS (fps) | 13.3 [13.2, 13.3] | 13.0 [12.9, 13.0] | 13.0 [13.0, 13.2] | 13.2 [13.1, 13.3] | 1.02x [1.02, 1.03] equivalent | 1.01x [0.99, 1.02] equivalent | 1.02x [1.01, 1.03] equivalent | 1.01x [1.01, 1.02] equivalent |
| small | 1x | 1% low FPS (fps) | 10.0 [10.0, 10.9] | 10.0 [10.0, 10.0] | 10.0 [8.57, 10.0] | 10.0 [10.0, 10.0] | 1.00x [1.00, 1.09] inconclusive | 1.00x [0.86, 1.00] inconclusive | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.17] inconclusive |
| small | 1x | frame time p95 (ms) | 83.3 [83.3, 83.3] | 83.3 [83.3, 83.3] | 83.3 [83.3, 83.3] | 83.3 [83.3, 83.3] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| small | 1x | frame time p99 (ms) | 83.4 [83.3, 100.0] | 100.0 [100.0, 100.0] | 100.0 [100.0, 100.0] | 100.0 [83.8, 100] | 0.83x [0.83, 1.00] inconclusive | 1.00x [1.00, 1.00] equivalent | 1.00x [0.84, 1.00] inconclusive | 1.00x [0.84, 1.00] inconclusive |
| small | 1x | sim minutes per second (min/s) | 106 [105, 107] | 104 [103, 104] | 104 [104, 105] | 98.4 [97.5, 98.9] | 1.02x [1.02, 1.03] equivalent | 1.01x [0.99, 1.02] equivalent | 0.95x [0.94, 0.95] inconclusive | 0.94x [0.93, 0.95] inconclusive |
| small | 1x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |  |  |  |  |
| small | 1x | main-thread blocking (long tasks past 50 ms) (ms) | 4942 [4893, 5032] | 5175 [5118, 5216] | 5124 [4999, 5176] | 4754 [4700, 4822] | 0.96x [0.94, 0.97] inconclusive | 0.99x [0.97, 1.01] equivalent | 0.92x [0.90, 0.93] lower | 0.93x [0.91, 0.94] lower |
| small | 1x | command to visible frame, median (ms) | 9.88 [9.55, 10.7] | 10.6 [9.34, 11.7] | 10.5 [9.84, 11.9] | 81.0 [77.8, 85.4] | 0.96x [0.80, 1.06] inconclusive | 1.01x [0.93, 1.13] inconclusive | 7.78x [6.82, 8.70] higher | 7.71x [6.54, 8.45] higher |
| small | 1x | command to visible frame, p95 (ms) | 15.1 [13.9, 16.0] | 15.6 [14.6, 18.3] | 15.5 [14.6, 19.4] | 92.8 [90.6, 94.3] | 1.00x [0.75, 1.06] inconclusive | 0.99x [0.83, 1.27] inconclusive | 5.86x [5.07, 6.36] higher | 5.93x [4.68, 6.45] higher |
| small | 4x | mean FPS (fps) | 7.45 [7.37, 7.51] | 6.88 [6.86, 6.90] | 7.04 [7.01, 7.04] | 7.42 [7.38, 7.44] | 1.08x [1.07, 1.09] higher | 1.02x [1.02, 1.03] equivalent | 1.08x [1.07, 1.09] higher | 1.05x [1.05, 1.06] inconclusive |
| small | 4x | 1% low FPS (fps) | 5.45 [5.00, 6.00] | 4.62 [4.62, 5.00] | 4.00 [3.75, 4.00] | 5.00 [5.00, 5.45] | 1.18x [1.08, 1.20] higher | 0.84x [0.80, 0.87] lower | 1.08x [1.00, 1.18] inconclusive | 1.29x [1.25, 1.36] higher |
| small | 4x | frame time p95 (ms) | 167 [167, 167] | 198 [197, 200] | 190 [183, 200] | 183 [183, 183] | 0.84x [0.83, 0.84] lower | 0.96x [0.92, 1.01] inconclusive | 0.93x [0.92, 0.93] lower | 0.95x [0.92, 1.00] inconclusive |
| small | 4x | frame time p99 (ms) | 167 [167, 182] | 216 [200, 217] | 200 [200, 216] | 183 [183, 198] | 0.83x [0.77, 0.84] lower | 0.96x [0.92, 1.08] inconclusive | 0.92x [0.85, 0.99] inconclusive | 0.92x [0.85, 0.99] inconclusive |
| small | 4x | sim minutes per second (min/s) | 59.6 [58.9, 60.1] | 55.0 [54.9, 55.2] | 56.3 [56.1, 56.3] | 51.9 [51.6, 52.1] | 1.08x [1.07, 1.09] higher | 1.02x [1.02, 1.03] equivalent | 0.94x [0.93, 0.95] inconclusive | 0.92x [0.92, 0.93] lower |
| small | 4x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 2.00 [0.00, 3.00] | 1.00 [1.00, 2.00] | 0.00 [0.00, 0.00] | 0.00x [0.00, 0.00] lower (2 zero) | 0.50x [0.25, 2.00] inconclusive (2 zero) | 0.00x [0.00, 0.00] lower (2 zero) | 0.00x [0.00, 0.00] lower |
| small | 4x | main-thread blocking (long tasks past 50 ms) (ms) | 9323 [9281, 9410] | 9774 [9754, 9810] | 9669 [9641, 9707] | 8715 [8687, 8737] | 0.95x [0.95, 0.96] inconclusive | 0.99x [0.99, 0.99] equivalent | 0.89x [0.89, 0.89] lower | 0.90x [0.90, 0.91] lower |
| small | 4x | command to visible frame, median (ms) | 63.9 [60.8, 66.3] | 67.9 [64.7, 72.2] | 63.1 [59.1, 64.5] | 185 [183, 187] | 0.92x [0.84, 1.01] inconclusive | 0.92x [0.86, 0.99] inconclusive | 2.71x [2.58, 2.85] higher | 2.94x [2.80, 3.24] higher |
| small | 4x | command to visible frame, p95 (ms) | 87.1 [75.4, 90.2] | 84.2 [81.6, 85.4] | 134 [89.1, 137] | 217 [216, 222] | 1.04x [0.89, 1.07] inconclusive | 1.57x [1.05, 1.66] inconclusive | 2.62x [2.54, 2.66] higher | 1.66x [1.59, 2.49] higher |
| medium | 1x | mean FPS (fps) | 12.2 [12.1, 12.3] | 10.8 [10.7, 10.9] | 11.4 [11.1, 11.4] | 12.0 [11.9, 12.1] | 1.13x [1.12, 1.14] higher | 1.05x [1.04, 1.06] inconclusive | 1.11x [1.10, 1.12] higher | 1.05x [1.05, 1.09] inconclusive |
| medium | 1x | 1% low FPS (fps) | 8.57 [8.57, 10.0] | 6.33 [6.00, 6.67] | 6.67 [6.00, 7.50] | 6.67 [6.67, 8.57] | 1.43x [1.29, 1.50] higher | 1.00x [1.00, 1.25] inconclusive | 1.11x [1.00, 1.29] inconclusive | 1.06x [1.00, 1.14] inconclusive |
| medium | 1x | frame time p95 (ms) | 100.0 [100.0, 100] | 133 [117, 133] | 117 [117, 117] | 117 [117, 117] | 0.75x [0.75, 0.86] lower | 0.88x [0.88, 1.00] inconclusive | 0.88x [0.87, 1.00] inconclusive | 1.00x [1.00, 1.00] equivalent |
| medium | 1x | frame time p99 (ms) | 103 [100, 117] | 140 [133, 150] | 133 [133, 138] | 127 [117, 133] | 0.75x [0.73, 0.83] lower | 0.99x [0.95, 1.04] equivalent | 0.90x [0.83, 0.96] inconclusive | 0.93x [0.87, 1.00] inconclusive |
| medium | 1x | sim minutes per second (min/s) | 97.7 [96.9, 98.3] | 86.1 [85.6, 86.8] | 91.1 [88.9, 91.5] | 88.2 [87.9, 89.2] | 1.13x [1.12, 1.14] higher | 1.05x [1.04, 1.06] inconclusive | 1.02x [1.01, 1.03] equivalent | 0.97x [0.96, 1.00] equivalent |
| medium | 1x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |  |  |  |  |
| medium | 1x | main-thread blocking (long tasks past 50 ms) (ms) | 5755 [5697, 5822] | 6861 [6741, 6928] | 6365 [6334, 6588] | 4984 [4913, 5027] | 0.84x [0.83, 0.85] lower | 0.93x [0.92, 0.95] lower | 0.73x [0.72, 0.74] lower | 0.78x [0.75, 0.79] lower |
| medium | 1x | command to visible frame, median (ms) | 19.7 [16.4, 20.7] | 27.0 [24.5, 29.7] | 25.6 [22.7, 27.7] | 94.2 [92.5, 94.7] | 0.71x [0.62, 0.85] lower | 0.93x [0.87, 1.02] inconclusive | 3.48x [3.15, 3.97] higher | 3.62x [3.39, 4.26] higher |
| medium | 1x | command to visible frame, p95 (ms) | 32.7 [30.4, 34.5] | 59.9 [46.4, 68.0] | 43.5 [37.5, 63.4] | 131 [120, 146] | 0.54x [0.47, 0.68] lower | 0.78x [0.62, 1.16] inconclusive | 2.36x [1.87, 2.66] higher | 2.93x [2.31, 3.59] higher |
| medium | 4x | mean FPS (fps) | 6.00 [5.92, 6.04] | 4.51 [4.43, 4.55] | 4.94 [4.92, 4.97] | 5.79 [5.71, 5.87] | 1.33x [1.31, 1.36] higher | 1.10x [1.08, 1.12] higher | 1.28x [1.27, 1.33] higher | 1.17x [1.16, 1.18] higher |
| medium | 4x | 1% low FPS (fps) | 3.64 [3.53, 3.75] | 2.07 [2.00, 2.07] | 2.22 [2.14, 2.31] | 2.31 [2.22, 2.40] | 1.79x [1.71, 1.88] higher | 1.07x [1.00, 1.12] inconclusive | 1.12x [1.08, 1.16] higher | 1.08x [1.00, 1.12] inconclusive |
| medium | 4x | frame time p95 (ms) | 246 [233, 250] | 433 [433, 450] | 417 [417, 417] | 367 [362, 378] | 0.56x [0.54, 0.58] lower | 0.95x [0.93, 0.96] inconclusive | 0.85x [0.81, 0.87] lower | 0.88x [0.87, 0.91] lower |
| medium | 4x | frame time p99 (ms) | 267 [252, 268] | 472 [461, 489] | 440 [433, 454] | 413 [402, 435] | 0.55x [0.54, 0.58] lower | 0.94x [0.89, 1.00] inconclusive | 0.87x [0.84, 0.92] lower | 0.94x [0.86, 1.00] inconclusive |
| medium | 4x | sim minutes per second (min/s) | 45.6 [45.0, 46.6] | 32.1 [31.6, 32.8] | 36.6 [36.1, 36.9] | 38.1 [37.9, 38.9] | 1.42x [1.39, 1.46] higher | 1.14x [1.11, 1.17] higher | 1.20x [1.15, 1.22] higher | 1.05x [1.03, 1.07] inconclusive |
| medium | 4x | frames over 200 ms (clamped) (count) | 16.5 [15.0, 18.0] | 29.0 [28.0, 31.0] | 24.0 [23.0, 27.0] | 15.0 [14.0, 19.0] | 0.56x [0.48, 0.68] lower | 0.82x [0.75, 0.93] lower | 0.52x [0.44, 0.66] lower | 0.62x [0.57, 0.79] lower |
| medium | 4x | main-thread blocking (long tasks past 50 ms) (ms) | 10497 [10431, 10506] | 11637 [11560, 11703] | 11310 [11250, 11519] | 9655 [9613, 9724] | 0.90x [0.90, 0.91] lower | 0.97x [0.97, 1.00] equivalent | 0.83x [0.82, 0.84] lower | 0.85x [0.83, 0.86] lower |
| medium | 4x | command to visible frame, median (ms) | 85.8 [72.3, 97.5] | 113 [104, 128] | 110 [97.5, 121] | 211 [179, 228] | 0.75x [0.57, 0.83] lower | 0.94x [0.85, 1.03] inconclusive | 1.82x [1.63, 2.15] higher | 1.89x [1.80, 2.24] higher |
| medium | 4x | command to visible frame, p95 (ms) | 163 [159, 166] | 362 [237, 376] | 324 [220, 345] | 353 [328, 436] | 0.45x [0.44, 0.67] lower | 0.90x [0.85, 1.23] inconclusive | 1.23x [0.96, 1.46] inconclusive | 1.28x [1.02, 1.58] inconclusive |
| large | 1x | mean FPS (fps) | 14.2 [14.1, 14.3] | 9.40 [9.31, 9.46] | 10.9 [10.8, 11.0] | 12.4 [12.3, 12.4] | 1.52x [1.50, 1.53] higher | 1.15x [1.14, 1.18] higher | 1.32x [1.30, 1.33] higher | 1.14x [1.12, 1.15] higher |
| large | 1x | 1% low FPS (fps) | 10.0 [9.23, 10.0] | 3.53 [3.16, 4.00] | 3.64 [3.33, 3.75] | 4.29 [4.00, 4.62] | 2.83x [2.50, 2.92] higher | 1.03x [0.94, 1.13] inconclusive | 1.21x [1.00, 1.31] inconclusive | 1.14x [1.07, 1.29] higher |
| large | 1x | frame time p95 (ms) | 83.3 [83.3, 83.3] | 233 [217, 233] | 217 [217, 217] | 179 [167, 183] | 0.36x [0.36, 0.38] lower | 0.93x [0.93, 1.00] inconclusive | 0.77x [0.71, 0.85] lower | 0.83x [0.77, 0.85] lower |
| large | 1x | frame time p99 (ms) | 100.0 [100.0, 100] | 265 [250, 270] | 239 [233, 256] | 205 [200, 219] | 0.38x [0.37, 0.40] lower | 0.91x [0.89, 1.04] inconclusive | 0.78x [0.75, 0.88] lower | 0.85x [0.80, 0.97] inconclusive |
| large | 1x | sim minutes per second (min/s) | 114 [113, 115] | 75.2 [74.5, 75.7] | 85.0 [83.8, 85.5] | 79.9 [79.7, 80.4] | 1.51x [1.50, 1.53] higher | 1.13x [1.12, 1.14] higher | 1.07x [1.06, 1.08] higher | 0.94x [0.93, 0.96] inconclusive |
| large | 1x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 18.0 [17.0, 18.0] | 12.5 [11.0, 14.0] | 2.00 [1.00, 4.00] | 0.00x [0.00, 0.00] lower | 0.70x [0.61, 0.78] lower | 0.11x [0.06, 0.22] lower | 0.16x [0.09, 0.31] lower |
| large | 1x | main-thread blocking (long tasks past 50 ms) (ms) | 4222 [4133, 4308] | 7933 [7815, 8047] | 6755 [6692, 6899] | 4165 [4125, 4235] | 0.53x [0.52, 0.54] lower | 0.86x [0.84, 0.86] lower | 0.53x [0.52, 0.54] lower | 0.62x [0.61, 0.63] lower |
| large | 1x | command to visible frame, median (ms) | 11.1 [10.6, 11.6] | 28.7 [27.7, 31.9] | 17.8 [14.8, 19.5] | 76.1 [75.4, 79.1] | 0.38x [0.35, 0.40] lower | 0.62x [0.49, 0.68] lower | 2.63x [2.39, 2.80] higher | 4.41x [3.84, 5.09] higher |
| large | 1x | command to visible frame, p95 (ms) | 20.0 [16.3, 23.6] | 88.7 [77.7, 168] | 160 [79.9, 171] | 261 [218, 268] | 0.22x [0.10, 0.29] lower | 1.85x [0.76, 2.20] inconclusive | 2.57x [1.52, 3.52] higher | 1.69x [1.50, 2.79] higher |
| large | 4x | mean FPS (fps) | 6.18 [6.05, 6.25] | 3.34 [3.22, 3.53] | 3.17 [3.16, 3.24] | 4.78 [4.71, 4.90] | 1.85x [1.75, 1.89] higher | 0.95x [0.91, 0.99] inconclusive | 1.42x [1.38, 1.52] higher | 1.51x [1.47, 1.54] higher |
| large | 4x | 1% low FPS (fps) | 3.33 [3.33, 3.53] | 0.86 [0.83, 0.87] | 0.92 [0.91, 0.94] | 1.20 [1.18, 1.22] | 3.89x [3.83, 4.12] higher | 1.08x [1.05, 1.11] inconclusive | 1.42x [1.38, 1.46] higher | 1.30x [1.25, 1.35] higher |
| large | 4x | frame time p95 (ms) | 283 [272, 283] | 1117 [1108, 1143] | 1071 [1067, 1077] | 756 [750, 767] | 0.25x [0.24, 0.25] lower | 0.96x [0.93, 0.97] inconclusive | 0.68x [0.65, 0.69] lower | 0.71x [0.69, 0.71] lower |
| large | 4x | frame time p99 (ms) | 285 [283, 300] | 1158 [1142, 1191] | 1083 [1067, 1100] | 801 [792, 822] | 0.25x [0.24, 0.26] lower | 0.93x [0.91, 0.96] inconclusive | 0.69x [0.67, 0.72] lower | 0.74x [0.72, 0.77] lower |
| large | 4x | sim minutes per second (min/s) | 46.8 [45.8, 47.3] | 17.9 [17.3, 18.2] | 24.1 [24.0, 24.5] | 31.0 [30.8, 31.6] | 2.61x [2.51, 2.74] higher | 1.35x [1.32, 1.40] higher | 1.74x [1.70, 1.82] higher | 1.29x [1.26, 1.31] higher |
| large | 4x | frames over 200 ms (clamped) (count) | 17.0 [16.0, 17.0] | 33.0 [32.0, 36.0] | 17.0 [17.0, 18.0] | 17.0 [17.0, 17.0] | 0.51x [0.47, 0.53] lower | 0.52x [0.47, 0.56] lower | 0.52x [0.47, 0.53] lower | 0.97x [0.94, 1.00] inconclusive |
| large | 4x | main-thread blocking (long tasks past 50 ms) (ms) | 10329 [10264, 10406] | 12733 [12524, 12839] | 13101 [13005, 13230] | 10220 [10187, 10282] | 0.81x [0.80, 0.83] lower | 1.03x [1.01, 1.04] equivalent | 0.81x [0.79, 0.82] lower | 0.78x [0.77, 0.79] lower |
| large | 4x | command to visible frame, median (ms) | 86.4 [74.6, 93.6] | 174 [162, 193] | 129 [103, 203] | 188 [181, 192] | 0.46x [0.43, 0.48] lower | 0.79x [0.56, 1.09] inconclusive | 1.04x [0.94, 1.13] inconclusive | 1.45x [0.94, 1.85] inconclusive |
| large | 4x | command to visible frame, p95 (ms) | 201 [196, 204] | 1029 [239, 1073] | 822 [628, 1001] | 572 [557, 845] | 0.20x [0.18, 0.85] lower | 0.93x [0.63, 4.19] inconclusive | 0.57x [0.52, 3.54] inconclusive | 0.85x [0.55, 0.92] lower |

## memory

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 1x | main-thread JS heap (bytes) | 47.34 MiB [46.60 MiB, 47.34 MiB] | 46.56 MiB [46.55 MiB, 46.58 MiB] | 46.48 MiB [46.47 MiB, 47.20 MiB] | 46.46 MiB [46.45 MiB, 46.50 MiB] | 1.02x [1.00, 1.02] equivalent | 1.00x [1.00, 1.01] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [0.98, 1.00] equivalent |
| small | 1x | JS heaps + WASM memory (main and worker) (bytes) | 47.34 MiB [46.60 MiB, 47.34 MiB] | 55.00 MiB [54.98 MiB, 55.02 MiB] | 54.92 MiB [54.91 MiB, 55.64 MiB] | 55.41 MiB [55.40 MiB, 55.45 MiB] | 0.86x [0.85, 0.86] lower | 1.00x [1.00, 1.01] equivalent | 1.01x [1.01, 1.01] equivalent | 1.01x [1.00, 1.01] equivalent |
| small | 1x | browser process PSS (bytes) | n/a | n/a | n/a | n/a |  |  |  |  |
| medium | 1x | main-thread JS heap (bytes) | 59.28 MiB [59.27 MiB, 60.07 MiB] | 59.24 MiB [58.54 MiB, 59.25 MiB] | 59.17 MiB [59.16 MiB, 59.18 MiB] | 59.71 MiB [59.37 MiB, 59.73 MiB] | 1.01x [1.00, 1.01] equivalent | 1.00x [1.00, 1.01] equivalent | 1.01x [1.00, 1.02] equivalent | 1.01x [1.00, 1.01] equivalent |
| medium | 1x | JS heaps + WASM memory (main and worker) (bytes) | 59.28 MiB [59.27 MiB, 60.07 MiB] | 96.43 MiB [95.73 MiB, 96.44 MiB] | 96.35 MiB [96.34 MiB, 96.37 MiB] | 97.42 MiB [97.07 MiB, 97.44 MiB] | 0.62x [0.61, 0.62] lower | 1.00x [1.00, 1.01] equivalent | 1.01x [1.01, 1.02] equivalent | 1.01x [1.01, 1.01] equivalent |
| medium | 1x | browser process PSS (bytes) | n/a | n/a | n/a | n/a |  |  |  |  |
| large | 1x | main-thread JS heap (bytes) | 74.67 MiB [74.65 MiB, 74.68 MiB] | 74.53 MiB [74.49 MiB, 74.56 MiB] | 74.43 MiB [74.42 MiB, 74.48 MiB] | 76.47 MiB [76.46 MiB, 76.52 MiB] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.03x [1.03, 1.03] equivalent | 1.03x [1.03, 1.03] equivalent |
| large | 1x | JS heaps + WASM memory (main and worker) (bytes) | 74.67 MiB [74.65 MiB, 74.68 MiB] | 202.84 MiB [202.81 MiB, 202.87 MiB] | 202.75 MiB [202.74 MiB, 202.79 MiB] | 205.30 MiB [205.28 MiB, 205.34 MiB] | 0.37x [0.37, 0.37] lower | 1.00x [1.00, 1.00] equivalent | 1.01x [1.01, 1.01] equivalent | 1.01x [1.01, 1.01] equivalent |
| large | 1x | browser process PSS (bytes) | n/a | n/a | n/a | n/a |  |  |  |  |

## traffic

| scenario | throttle | metric | wasm-worker | wasm-worker / wasm |
|---|---|---|---|---|
| small | 1x | worker replies per second (frames) (1/s) | 13.2 [13.1, 13.3] |  |
| small | 1x | messages per second, both ways (frames) (1/s) | 27.4 [27.2, 27.5] |  |
| small | 1x | bytes received per second (frames) (bytes/s) | 1.95 MiB [1.91 MiB, 1.96 MiB] |  |
| small | 1x | reply apply time per second (frames) (ms/s) | 14.5 [14.1, 14.6] |  |
| small | 1x | command to ack, median (frames) (ms) | 73.2 [72.2, 74.0] |  |
| small | 1x | frame view bytes per reply (hosted) (bytes) | 118.7 KiB [118.7 KiB, 118.7 KiB] |  |
| small | 1x | full-save bytes per merge (hosted) (bytes) | 235.2 KiB [235.2 KiB, 235.2 KiB] |  |
| small | 1x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| small | 1x | worker engine time, 720 steps (hosted) (ms) | 147 [144, 151] |  |
| small | 1x | main-thread merge time, 720 steps (hosted) (ms) | 146 [144, 150] |  |
| small | 4x | worker replies per second (frames) (1/s) | 7.42 [7.38, 7.44] |  |
| small | 4x | messages per second, both ways (frames) (1/s) | 15.8 [15.7, 15.8] |  |
| small | 4x | bytes received per second (frames) (bytes/s) | 1.13 MiB [1.12 MiB, 1.13 MiB] |  |
| small | 4x | reply apply time per second (frames) (ms/s) | 40.4 [39.6, 41.3] |  |
| small | 4x | command to ack, median (frames) (ms) | 127 [124, 130] |  |
| small | 4x | frame view bytes per reply (hosted) (bytes) | 118.7 KiB [118.7 KiB, 118.7 KiB] |  |
| small | 4x | full-save bytes per merge (hosted) (bytes) | 235.2 KiB [235.2 KiB, 235.2 KiB] |  |
| small | 4x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| small | 4x | worker engine time, 720 steps (hosted) (ms) | 143 [142, 152] |  |
| small | 4x | main-thread merge time, 720 steps (hosted) (ms) | 847 [835, 853] |  |
| medium | 1x | worker replies per second (frames) (1/s) | 12.0 [11.9, 12.1] |  |
| medium | 1x | messages per second, both ways (frames) (1/s) | 24.8 [24.7, 25.1] |  |
| medium | 1x | bytes received per second (frames) (bytes/s) | 8.94 MiB [8.91 MiB, 9.08 MiB] |  |
| medium | 1x | reply apply time per second (frames) (ms/s) | 60.9 [59.7, 63.0] |  |
| medium | 1x | command to ack, median (frames) (ms) | 71.3 [69.9, 72.0] |  |
| medium | 1x | frame view bytes per reply (hosted) (bytes) | 585.2 KiB [585.2 KiB, 585.2 KiB] |  |
| medium | 1x | full-save bytes per merge (hosted) (bytes) | 1.29 MiB [1.29 MiB, 1.29 MiB] |  |
| medium | 1x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| medium | 1x | worker engine time, 720 steps (hosted) (ms) | 715 [709, 775] |  |
| medium | 1x | main-thread merge time, 720 steps (hosted) (ms) | 743 [717, 791] |  |
| medium | 4x | worker replies per second (frames) (1/s) | 5.73 [5.61, 5.80] |  |
| medium | 4x | messages per second, both ways (frames) (1/s) | 12.4 [12.2, 12.5] |  |
| medium | 4x | bytes received per second (frames) (bytes/s) | 4.18 MiB [4.10 MiB, 4.27 MiB] |  |
| medium | 4x | reply apply time per second (frames) (ms/s) | 159 [154, 161] |  |
| medium | 4x | command to ack, median (frames) (ms) | 116 [113, 118] |  |
| medium | 4x | frame view bytes per reply (hosted) (bytes) | 585.2 KiB [585.2 KiB, 585.2 KiB] |  |
| medium | 4x | full-save bytes per merge (hosted) (bytes) | 1.29 MiB [1.29 MiB, 1.29 MiB] |  |
| medium | 4x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| medium | 4x | worker engine time, 720 steps (hosted) (ms) | 802 [772, 810] |  |
| medium | 4x | main-thread merge time, 720 steps (hosted) (ms) | 4669 [4639, 4747] |  |
| large | 1x | worker replies per second (frames) (1/s) | 11.0 [11.0, 11.0] |  |
| large | 1x | messages per second, both ways (frames) (1/s) | 23.0 [22.9, 23.1] |  |
| large | 1x | bytes received per second (frames) (bytes/s) | 29.01 MiB [28.78 MiB, 29.54 MiB] |  |
| large | 1x | reply apply time per second (frames) (ms/s) | 169 [164, 172] |  |
| large | 1x | command to ack, median (frames) (ms) | 65.6 [64.5, 66.9] |  |
| large | 1x | frame view bytes per reply (hosted) (bytes) | 2.00 MiB [2.00 MiB, 2.00 MiB] |  |
| large | 1x | full-save bytes per merge (hosted) (bytes) | 4.49 MiB [4.49 MiB, 4.49 MiB] |  |
| large | 1x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| large | 1x | worker engine time, 720 steps (hosted) (ms) | 1862 [1817, 1883] |  |
| large | 1x | main-thread merge time, 720 steps (hosted) (ms) | 2457 [2397, 2535] |  |
| large | 4x | worker replies per second (frames) (1/s) | 4.65 [4.57, 4.79] |  |
| large | 4x | messages per second, both ways (frames) (1/s) | 10.2 [10.1, 10.6] |  |
| large | 4x | bytes received per second (frames) (bytes/s) | 12.05 MiB [12.02 MiB, 12.30 MiB] |  |
| large | 4x | reply apply time per second (frames) (ms/s) | 392 [384, 396] |  |
| large | 4x | command to ack, median (frames) (ms) | 129 [115, 138] |  |
| large | 4x | frame view bytes per reply (hosted) (bytes) | 2.00 MiB [2.00 MiB, 2.00 MiB] |  |
| large | 4x | full-save bytes per merge (hosted) (bytes) | 4.49 MiB [4.49 MiB, 4.49 MiB] |  |
| large | 4x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| large | 4x | worker engine time, 720 steps (hosted) (ms) | 2189 [2154, 2267] |  |
| large | 4x | main-thread merge time, 720 steps (hosted) (ms) | 15105 [14959, 15257] |  |

## Offline restart

- ts: ts online, ts offline
- wasm: wasm online, wasm offline
- wasm-frame: wasm-frame online, wasm-frame offline
- wasm-worker: wasm-worker online, wasm-worker offline

## Validation

- no errors
- warning: the working tree had uncommitted changes; the folder is marked -dirty

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
