# Worker host benchmark (npm run perf:worker)

> **Snapshot, measured 2026-10-14T17:22:14.707Z to 2026-10-14T22:09:58.599Z on commit `c80416c` (app 2.32.0).** Live numbers: re-run `npm run perf:worker` (src/tests/perfWorker/, its arithmetic pinned by src/tests/perfWorker/analysis.test.ts). Validation passed.

- Engine package: verticopolis_engine_bg.wasm `b148dcb557d76fe1`, verticopolis_engine.js `6b5269726922535b`; source hash `085a6a024558e70538f8913f101bcd05ca227d5616fd49fd0efad60eaae2d1c3`
- Machine: Intel(R) Xeon(R) Processor @ 2.80GHz, 4 CPUs, 15.7 GiB, Ubuntu 24.04.5 LTS; Node v22.22.0; Playwright 1.61.1; browser 141.0.7390.37
- Renderer: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver); cross-origin isolated: true
- 10 repetitions of ts, wasm, wasm-frame, wasm-worker, each in a fresh browser process, order rotated by repetition; throttles 1x, 4x
- Scenarios: small (729 population, `8018a9e05910`), medium (3240 population, `159b444c6a65`), large (17322 population, `e0db69ea4891`)
- Download (production build, Brotli 11): engine worker chunk 2.6 KiB (8.3 KiB raw); engine package (WASM modes) 324.6 KiB (1.39 MiB raw); all other JavaScript 359.3 KiB

Medians with their 95% order-statistic interval. Ratios are paired by repetition (mode over the column's reference); a verdict needs six pairs and an interval clear of a 5% band. `wasm-worker / wasm-frame` compares two hosts with the same sync changes, so it is the worker placement alone; `wasm-frame / wasm` is the sync changes alone. Ratios against TypeScript are in ratios.csv. A ratio marked with `(k zero)` dropped k repetitions where the reference was 0.

## startup

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| - | 1x | cold start to mode ready (ms) | 961 [907, 1112] | 977 [886, 1111] | 998 [934, 1148] | 989 [959, 1084] | 1.00x [0.87, 1.19] inconclusive | 1.07x [0.95, 1.12] inconclusive | 1.04x [0.96, 1.10] inconclusive | 0.99x [0.95, 1.08] inconclusive |
| - | 1x | warm start to mode ready (ms) | 904 [834, 1015] | 872 [774, 955] | 860 [775, 1057] | 831 [797, 913] | 1.06x [0.96, 1.12] inconclusive | 1.00x [0.88, 1.15] inconclusive | 0.96x [0.91, 1.06] inconclusive | 0.95x [0.85, 1.09] inconclusive |
| - | 4x | cold start to mode ready (ms) | 3048 [2858, 3317] | 3300 [3146, 3737] | 3423 [3107, 3523] | 3131 [2974, 3308] | 0.91x [0.81, 0.99] inconclusive | 1.01x [0.89, 1.10] inconclusive | 0.93x [0.87, 0.98] inconclusive | 0.95x [0.85, 1.02] inconclusive |
| - | 1x | bytes before mode ready (cold) (bytes) | 299.8 KiB [299.8 KiB, 299.8 KiB] | 626.7 KiB [626.7 KiB, 626.7 KiB] | 626.7 KiB [626.7 KiB, 626.7 KiB] | 629.4 KiB [629.4 KiB, 629.4 KiB] | 0.48x [0.48, 0.48] lower | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |

## raw

| scenario | throttle | metric | ts | wasm | ts / wasm |
|---|---|---|---|---|---|
| small | 1x | bare engine, 720 steps (ms) | 262 [233, 299] | 126 [120, 140] | 2.04x [1.91, 2.24] higher |
| small | 4x | bare engine, 720 steps (ms) | 1315 [1119, 1633] | 756 [658, 860] | 1.81x [1.49, 2.19] higher |
| medium | 1x | bare engine, 720 steps (ms) | 1941 [1828, 2088] | 1031 [956, 1134] | 1.90x [1.63, 2.03] higher |
| medium | 4x | bare engine, 720 steps (ms) | 11635 [9726, 13304] | 6584 [6344, 7393] | 1.71x [1.46, 1.99] higher |
| large | 1x | bare engine, 720 steps (ms) | 1985 [1827, 2267] | 2902 [2650, 3062] | 0.70x [0.66, 0.73] lower |
| large | 4x | bare engine, 720 steps (ms) | 15595 [10020, 17945] | 30179 [21491, 33992] | 0.51x [0.34, 0.88] lower |

## hosted

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 1x | wall time, 720 steps (ms) | 306 [280, 379] | 1081 [1015, 1163] | 782 [697, 912] | 907 [805, 972] | 0.29x [0.25, 0.36] lower | 0.75x [0.63, 0.78] lower | 0.81x [0.76, 0.91] lower | 1.16x [1.03, 1.30] inconclusive |
| small | 1x | main-thread time, 720 steps (ms) | 306 [279, 378] | 1080 [1013, 1161] | 781 [696, 911] | 477 [440, 515] | 0.29x [0.25, 0.35] lower | 0.75x [0.63, 0.78] lower | 0.44x [0.40, 0.47] lower | 0.61x [0.54, 0.71] lower |
| small | 1x | main-thread time per batch, p95 (ms) | 4.18 [3.51, 4.84] | 24.3 [22.7, 25.9] | 22.6 [20.4, 26.6] | 17.0 [15.5, 18.6] | 0.17x [0.13, 0.20] lower | 0.95x [0.83, 1.03] inconclusive | 0.68x [0.63, 0.76] lower | 0.74x [0.64, 0.84] lower |
| small | 1x | main-thread time per batch, max (ms) | 10.2 [8.77, 15.4] | 38.7 [31.2, 42.7] | 37.9 [25.4, 50.0] | 25.1 [20.8, 29.5] | 0.27x [0.22, 0.44] lower | 0.99x [0.82, 1.40] inconclusive | 0.65x [0.57, 0.81] lower | 0.65x [0.52, 0.90] lower |
| small | 4x | wall time, 720 steps (ms) | 1423 [1255, 1588] | 5274 [4898, 5832] | 3941 [3529, 4302] | 2851 [2656, 3204] | 0.28x [0.22, 0.31] lower | 0.70x [0.67, 0.85] lower | 0.54x [0.50, 0.59] lower | 0.75x [0.65, 0.79] lower |
| small | 4x | main-thread time, 720 steps (ms) | 1417 [1252, 1582] | 5266 [4892, 5823] | 3935 [3521, 4295] | 2232 [2089, 2535] | 0.28x [0.22, 0.31] lower | 0.70x [0.67, 0.85] lower | 0.43x [0.38, 0.47] lower | 0.59x [0.52, 0.62] lower |
| small | 4x | main-thread time per batch, p95 (ms) | 18.9 [14.9, 20.7] | 109 [104, 119] | 115 [104, 128] | 79.7 [75.9, 86.4] | 0.18x [0.12, 0.20] lower | 1.00x [0.92, 1.20] inconclusive | 0.72x [0.66, 0.81] lower | 0.71x [0.63, 0.74] lower |
| small | 4x | main-thread time per batch, max (ms) | 27.8 [24.8, 33.7] | 159 [140, 193] | 174 [152, 212] | 125 [108, 149] | 0.19x [0.14, 0.24] lower | 1.16x [0.76, 1.29] inconclusive | 0.82x [0.54, 1.01] inconclusive | 0.71x [0.60, 0.84] lower |
| medium | 1x | wall time, 720 steps (ms) | 1981 [1767, 2367] | 6559 [6033, 6860] | 4452 [4181, 4910] | 4927 [4467, 5635] | 0.31x [0.26, 0.40] lower | 0.70x [0.66, 0.76] lower | 0.76x [0.73, 0.86] lower | 1.08x [1.01, 1.24] inconclusive |
| medium | 1x | main-thread time, 720 steps (ms) | 1980 [1766, 2365] | 6557 [6031, 6858] | 4450 [4180, 4908] | 2719 [2426, 3104] | 0.31x [0.26, 0.40] lower | 0.70x [0.66, 0.76] lower | 0.42x [0.38, 0.47] lower | 0.58x [0.54, 0.68] lower |
| medium | 1x | main-thread time per batch, p95 (ms) | 21.9 [19.2, 27.3] | 141 [126, 148] | 129 [123, 147] | 97.1 [86.7, 109] | 0.16x [0.14, 0.20] lower | 0.96x [0.83, 1.07] inconclusive | 0.70x [0.63, 0.85] lower | 0.70x [0.63, 0.89] lower |
| medium | 1x | main-thread time per batch, max (ms) | 85.9 [80.2, 134] | 279 [270, 304] | 190 [170, 232] | 137 [123, 169] | 0.30x [0.28, 0.48] lower | 0.69x [0.58, 0.85] lower | 0.49x [0.43, 0.65] lower | 0.73x [0.63, 0.84] lower |
| medium | 4x | wall time, 720 steps (ms) | 10620 [8852, 12212] | 37517 [33147, 38701] | 24325 [22054, 28105] | 15999 [14558, 17648] | 0.29x [0.26, 0.32] lower | 0.68x [0.64, 0.74] lower | 0.44x [0.41, 0.47] lower | 0.64x [0.62, 0.69] lower |
| medium | 4x | main-thread time, 720 steps (ms) | 10612 [8844, 12198] | 37506 [33135, 38681] | 24313 [22047, 28096] | 13244 [12171, 14834] | 0.29x [0.26, 0.32] lower | 0.68x [0.64, 0.74] lower | 0.37x [0.34, 0.40] lower | 0.54x [0.51, 0.58] lower |
| medium | 4x | main-thread time per batch, p95 (ms) | 118 [101, 146] | 776 [682, 821] | 699 [628, 830] | 477 [429, 549] | 0.16x [0.14, 0.19] lower | 0.94x [0.90, 1.03] inconclusive | 0.62x [0.59, 0.70] lower | 0.68x [0.62, 0.74] lower |
| medium | 4x | main-thread time per batch, max (ms) | 393 [363, 459] | 1527 [1332, 1661] | 956 [779, 1130] | 649 [615, 751] | 0.26x [0.23, 0.34] lower | 0.66x [0.54, 0.70] lower | 0.46x [0.38, 0.51] lower | 0.67x [0.62, 0.86] lower |
| large | 1x | wall time, 720 steps (ms) | 1992 [1885, 2241] | 23094 [21811, 24559] | 14872 [13483, 16738] | 16240 [14802, 17271] | 0.09x [0.08, 0.10] lower | 0.67x [0.57, 0.72] lower | 0.69x [0.66, 0.76] lower | 1.05x [0.97, 1.19] inconclusive |
| large | 1x | main-thread time, 720 steps (ms) | 1990 [1884, 2239] | 23091 [21809, 24557] | 14870 [13481, 16736] | 9360 [8683, 9799] | 0.09x [0.08, 0.10] lower | 0.67x [0.57, 0.72] lower | 0.40x [0.38, 0.42] lower | 0.60x [0.56, 0.67] lower |
| large | 1x | main-thread time per batch, p95 (ms) | 27.2 [25.7, 28.5] | 492 [474, 548] | 473 [409, 551] | 349 [323, 370] | 0.06x [0.05, 0.06] lower | 0.99x [0.84, 1.04] inconclusive | 0.68x [0.67, 0.72] lower | 0.70x [0.65, 0.81] lower |
| large | 1x | main-thread time per batch, max (ms) | 79.6 [76.2, 120] | 645 [570, 715] | 589 [536, 758] | 445 [381, 507] | 0.13x [0.12, 0.17] lower | 0.95x [0.83, 1.07] inconclusive | 0.69x [0.60, 0.77] lower | 0.72x [0.62, 0.94] lower |
| large | 4x | wall time, 720 steps (ms) | 9916 [8872, 11283] | 127606 [116539, 145610] | 87317 [74231, 93746] | 50898 [48211, 53249] | 0.08x [0.07, 0.09] lower | 0.66x [0.64, 0.69] lower | 0.40x [0.37, 0.42] lower | 0.58x [0.54, 0.65] lower |
| large | 4x | main-thread time, 720 steps (ms) | 9906 [8864, 11271] | 127597 [116528, 145602] | 87302 [74223, 93736] | 43068 [41040, 45556] | 0.08x [0.07, 0.09] lower | 0.66x [0.64, 0.69] lower | 0.34x [0.32, 0.36] lower | 0.49x [0.46, 0.55] lower |
| large | 4x | main-thread time per batch, p95 (ms) | 124 [112, 140] | 2575 [2333, 2913] | 2333 [2185, 2591] | 1544 [1485, 1642] | 0.05x [0.04, 0.05] lower | 0.89x [0.84, 0.95] lower | 0.58x [0.54, 0.65] lower | 0.67x [0.62, 0.71] lower |
| large | 4x | main-thread time per batch, max (ms) | 345 [303, 393] | 3355 [2955, 3756] | 2957 [2537, 3339] | 1988 [1899, 2068] | 0.10x [0.09, 0.12] lower | 0.89x [0.83, 1.00] inconclusive | 0.60x [0.55, 0.66] lower | 0.67x [0.60, 0.76] lower |

## frames

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 1x | mean FPS (fps) | 16.9 [15.3, 18.1] | 14.8 [14.1, 15.7] | 14.8 [14.4, 16.6] | 15.5 [15.1, 17.1] | 1.11x [1.05, 1.22] higher | 1.01x [0.98, 1.07] inconclusive | 1.07x [1.00, 1.13] inconclusive | 1.05x [0.97, 1.16] inconclusive |
| small | 1x | 1% low FPS (fps) | 9.62 [7.50, 10.9] | 8.57 [6.67, 8.57] | 8.57 [7.50, 8.57] | 8.57 [7.06, 9.23] | 1.18x [1.08, 1.44] higher | 1.04x [0.86, 1.29] inconclusive | 1.07x [0.88, 1.21] inconclusive | 1.04x [0.82, 1.08] inconclusive |
| small | 1x | frame time p95 (ms) | 83.3 [83.3, 100.0] | 100.0 [83.3, 100] | 100.0 [83.3, 100.0] | 100.0 [83.3, 100.0] | 0.85x [0.83, 1.00] inconclusive | 1.00x [0.86, 1.00] inconclusive | 1.00x [0.83, 1.00] inconclusive | 1.00x [0.83, 1.00] inconclusive |
| small | 1x | frame time p99 (ms) | 100.0 [83.3, 117] | 117 [111, 117] | 109 [100, 117] | 106 [100.0, 117] | 0.87x [0.77, 0.97] inconclusive | 0.97x [0.86, 1.10] inconclusive | 0.93x [0.86, 1.00] inconclusive | 1.00x [0.86, 1.12] inconclusive |
| small | 1x | sim minutes per second (min/s) | 119 [114, 120] | 113 [109, 118] | 115 [112, 118] | 115 [109, 119] | 1.04x [1.01, 1.09] inconclusive | 1.02x [0.99, 1.04] equivalent | 1.01x [0.98, 1.03] equivalent | 1.00x [0.95, 1.04] equivalent |
| small | 1x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] | 0.00 [0.00, 0.00] |  |  |  |  |
| small | 1x | main-thread blocking (long tasks past 50 ms) (ms) | 2606 [1922, 3479] | 3855 [3230, 4325] | 3836 [2813, 4116] | 2761 [1934, 3124] | 0.71x [0.56, 0.89] lower | 0.96x [0.81, 1.08] inconclusive | 0.70x [0.58, 0.82] lower | 0.74x [0.56, 0.92] lower |
| small | 1x | command to visible frame, median (ms) | -10.1 [-13.1, -7.25] | -9.74 [-10.5, -7.27] | -8.10 [-10.0, -6.92] | 46.6 [43.0, 48.1] | 0.99x [0.78, 1.56] inconclusive | 0.85x [0.55, 1.38] inconclusive | -4.77x [-6.30, -3.82] lower | -5.96x [-6.90, -4.57] lower |
| small | 1x | command to visible frame, p95 (ms) | -2.41 [-3.72, -1.28] | -2.66 [-3.17, -1.50] | -2.26 [-2.89, -1.71] | 63.8 [58.5, 83.2] | 0.76x [0.53, 2.29] inconclusive | 0.76x [0.54, 2.18] inconclusive | -26.21x [-50.54, -19.87] lower | -29.94x [-38.72, -22.30] lower |
| small | 4x | mean FPS (fps) | 5.55 [5.36, 5.84] | 5.26 [5.10, 5.42] | 5.29 [4.96, 5.50] | 5.66 [5.39, 6.02] | 1.06x [1.03, 1.13] inconclusive | 1.02x [0.98, 1.04] equivalent | 1.10x [1.06, 1.15] higher | 1.08x [1.04, 1.12] inconclusive |
| small | 4x | 1% low FPS (fps) | 3.08 [2.61, 3.16] | 3.00 [2.61, 3.33] | 3.00 [2.86, 3.16] | 2.61 [2.22, 2.86] | 1.02x [0.95, 1.11] inconclusive | 0.98x [0.91, 1.14] inconclusive | 0.86x [0.76, 1.00] inconclusive | 0.85x [0.72, 1.00] inconclusive |
| small | 4x | frame time p95 (ms) | 278 [245, 283] | 283 [267, 317] | 283 [250, 322] | 297 [267, 300] | 0.94x [0.89, 1.02] inconclusive | 1.00x [0.88, 1.07] inconclusive | 0.99x [0.95, 1.11] inconclusive | 1.02x [0.93, 1.15] inconclusive |
| small | 4x | frame time p99 (ms) | 304 [288, 317] | 325 [300, 350] | 306 [302, 338] | 351 [322, 373] | 0.94x [0.87, 1.06] inconclusive | 1.00x [0.91, 1.02] inconclusive | 1.09x [1.01, 1.23] inconclusive | 1.09x [1.04, 1.22] inconclusive |
| small | 4x | sim minutes per second (min/s) | 40.0 [38.4, 43.8] | 36.3 [33.9, 37.0] | 36.7 [33.9, 39.4] | 37.1 [34.9, 40.2] | 1.12x [1.08, 1.24] higher | 1.02x [0.98, 1.08] inconclusive | 1.05x [1.02, 1.09] inconclusive | 1.04x [0.96, 1.07] inconclusive |
| small | 4x | frames over 200 ms (clamped) (count) | 27.5 [21.0, 29.0] | 33.0 [31.0, 34.0] | 30.5 [28.0, 34.0] | 26.5 [25.0, 29.0] | 0.80x [0.71, 0.90] lower | 0.92x [0.84, 1.06] inconclusive | 0.79x [0.76, 0.88] lower | 0.84x [0.76, 0.96] inconclusive |
| small | 4x | main-thread blocking (long tasks past 50 ms) (ms) | 10745 [10528, 10916] | 11048 [10864, 11096] | 10969 [10808, 11240] | 10012 [9637, 10128] | 0.97x [0.96, 0.99] equivalent | 1.00x [0.98, 1.01] equivalent | 0.90x [0.89, 0.91] lower | 0.90x [0.89, 0.92] lower |
| small | 4x | command to visible frame, median (ms) | -9.42 [-11.4, -7.22] | -9.73 [-12.7, -7.83] | -10.7 [-14.1, -7.99] | 123 [112, 133] | 1.02x [0.70, 1.27] inconclusive | 0.99x [0.80, 1.50] inconclusive | -12.49x [-14.95, -9.08] lower | -11.74x [-14.03, -9.34] lower |
| small | 4x | command to visible frame, p95 (ms) | -3.06 [-4.45, -2.06] | -3.27 [-4.70, -2.11] | -3.27 [-4.06, -2.61] | 198 [171, 224] | 1.09x [0.50, 1.54] inconclusive | 1.08x [0.59, 1.48] inconclusive | -62.18x [-109.60, -40.22] lower | -59.02x [-84.62, -48.12] lower |
| medium | 1x | mean FPS (fps) | 11.0 [10.5, 12.8] | 8.64 [7.76, 8.98] | 9.71 [9.36, 10.5] | 11.5 [11.0, 12.1] | 1.34x [1.20, 1.49] higher | 1.16x [1.08, 1.23] higher | 1.37x [1.30, 1.40] higher | 1.16x [1.12, 1.26] higher |
| medium | 1x | 1% low FPS (fps) | 6.00 [5.00, 7.06] | 3.53 [3.16, 3.75] | 3.88 [3.75, 4.29] | 4.00 [3.53, 4.62] | 1.70x [1.45, 2.13] higher | 1.13x [0.93, 1.42] inconclusive | 1.17x [0.94, 1.42] inconclusive | 1.06x [0.94, 1.14] inconclusive |
| medium | 1x | frame time p95 (ms) | 133 [107, 150] | 217 [183, 233] | 192 [169, 215] | 167 [163, 183] | 0.63x [0.52, 0.73] lower | 0.89x [0.76, 1.00] inconclusive | 0.78x [0.69, 0.91] lower | 0.91x [0.77, 0.98] inconclusive |
| medium | 1x | frame time p99 (ms) | 152 [118, 167] | 250 [233, 292] | 237 [206, 260] | 202 [193, 223] | 0.58x [0.47, 0.75] lower | 0.89x [0.83, 1.04] inconclusive | 0.79x [0.70, 0.98] inconclusive | 0.89x [0.79, 1.00] inconclusive |
| medium | 1x | sim minutes per second (min/s) | 88.1 [84.2, 102] | 69.1 [62.1, 71.8] | 77.7 [74.9, 84.0] | 82.9 [80.1, 87.5] | 1.34x [1.20, 1.47] higher | 1.16x [1.08, 1.23] higher | 1.22x [1.18, 1.29] higher | 1.05x [1.01, 1.13] inconclusive |
| medium | 1x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 8.00 [3.00, 12.0] | 5.00 [2.00, 8.00] | 2.00 [1.00, 3.00] | 0.00x [0.00, 0.00] lower | 0.63x [0.29, 1.60] inconclusive | 0.31x [0.11, 1.00] inconclusive | 0.43x [0.14, 1.00] inconclusive (1 zero) |
| medium | 1x | main-thread blocking (long tasks past 50 ms) (ms) | 6666 [5309, 7019] | 8406 [8165, 9107] | 7644 [7028, 7897] | 4840 [4288, 5171] | 0.75x [0.62, 0.83] lower | 0.88x [0.84, 0.94] lower | 0.55x [0.51, 0.60] lower | 0.64x [0.59, 0.68] lower |
| medium | 1x | command to visible frame, median (ms) | -8.09 [-9.99, -6.47] | -9.01 [-12.2, -6.48] | -9.54 [-10.3, -5.48] | 49.6 [45.0, 60.3] | 0.94x [0.58, 1.53] inconclusive | 0.99x [0.64, 1.42] inconclusive | -5.31x [-8.57, -4.10] lower | -6.32x [-8.48, -4.34] lower |
| medium | 1x | command to visible frame, p95 (ms) | -1.87 [-2.51, -1.53] | -2.61 [-4.55, -1.71] | -2.18 [-3.08, -1.42] | 93.1 [70.5, 111] | 0.65x [0.38, 1.07] inconclusive | 0.78x [0.35, 1.32] inconclusive | -31.84x [-60.57, -19.98] lower | -44.48x [-63.76, -33.63] lower |
| medium | 4x | mean FPS (fps) | 4.33 [4.12, 4.72] | 2.96 [2.76, 3.05] | 3.24 [2.84, 3.38] | 3.80 [3.59, 4.04] | 1.51x [1.43, 1.58] higher | 1.09x [1.01, 1.15] inconclusive | 1.29x [1.23, 1.46] higher | 1.18x [1.12, 1.31] higher |
| medium | 4x | 1% low FPS (fps) | 2.23 [1.88, 2.40] | 1.03 [0.94, 1.15] | 1.02 [0.91, 1.15] | 1.12 [0.98, 1.33] | 2.12x [1.84, 2.31] higher | 1.00x [0.83, 1.16] inconclusive | 1.17x [1.00, 1.20] inconclusive | 1.14x [0.97, 1.36] inconclusive |
| medium | 4x | frame time p95 (ms) | 383 [367, 428] | 795 [729, 831] | 772 [717, 821] | 662 [640, 705] | 0.51x [0.46, 0.54] lower | 1.00x [0.93, 1.05] inconclusive | 0.84x [0.77, 0.98] inconclusive | 0.84x [0.77, 0.93] lower |
| medium | 4x | frame time p99 (ms) | 443 [405, 490] | 935 [867, 1023] | 906 [839, 1010] | 828 [733, 990] | 0.47x [0.42, 0.57] lower | 0.96x [0.86, 1.06] inconclusive | 0.87x [0.78, 1.00] inconclusive | 0.89x [0.80, 1.10] inconclusive |
| medium | 4x | sim minutes per second (min/s) | 29.5 [27.7, 32.3] | 14.1 [12.9, 15.2] | 16.9 [15.2, 20.8] | 22.4 [20.7, 24.8] | 2.10x [2.01, 2.26] higher | 1.25x [1.03, 1.34] inconclusive | 1.61x [1.41, 1.97] higher | 1.35x [1.12, 1.53] higher |
| medium | 4x | frames over 200 ms (clamped) (count) | 33.0 [30.0, 35.0] | 32.5 [30.0, 34.0] | 31.5 [30.0, 35.0] | 27.5 [25.0, 31.0] | 1.01x [0.94, 1.13] inconclusive | 1.00x [0.91, 1.06] inconclusive | 0.84x [0.79, 1.00] inconclusive | 0.90x [0.81, 0.97] inconclusive |
| medium | 4x | main-thread blocking (long tasks past 50 ms) (ms) | 11675 [11352, 11933] | 12889 [12750, 13031] | 12600 [12435, 13005] | 11284 [10942, 11559] | 0.91x [0.88, 0.92] lower | 0.98x [0.95, 1.01] equivalent | 0.88x [0.84, 0.90] lower | 0.89x [0.88, 0.91] lower |
| medium | 4x | command to visible frame, median (ms) | -10.7 [-12.9, -8.58] | -9.14 [-12.0, -8.23] | -9.24 [-13.0, -6.56] | 151 [132, 165] | 1.02x [0.81, 1.59] inconclusive | 1.09x [0.60, 1.54] inconclusive | -15.35x [-19.76, -11.98] lower | -16.75x [-22.99, -10.14] lower |
| medium | 4x | command to visible frame, p95 (ms) | -4.15 [-5.74, -3.31] | -3.45 [-5.05, -2.67] | -3.31 [-5.19, -1.65] | 258 [227, 325] | 1.17x [0.76, 1.67] inconclusive | 0.92x [0.51, 1.67] inconclusive | -91.89x [-109.85, -45.08] lower | -74.36x [-178.92, -43.83] lower |
| large | 1x | mean FPS (fps) | 16.5 [15.5, 17.9] | 5.21 [4.60, 5.41] | 7.17 [6.39, 8.10] | 11.3 [10.6, 12.2] | 3.36x [2.98, 3.47] higher | 1.51x [1.20, 1.55] higher | 2.26x [1.99, 2.35] higher | 1.55x [1.44, 1.77] higher |
| large | 1x | 1% low FPS (fps) | 6.67 [5.71, 7.50] | 1.45 [1.30, 1.54] | 1.56 [1.36, 1.82] | 2.11 [1.71, 2.22] | 4.62x [4.11, 5.37] higher | 1.09x [0.88, 1.24] inconclusive | 1.44x [1.31, 1.54] higher | 1.28x [1.11, 1.63] higher |
| large | 1x | frame time p95 (ms) | 100 [83.3, 117] | 553 [531, 628] | 507 [464, 567] | 362 [333, 383] | 0.18x [0.15, 0.19] lower | 0.86x [0.80, 1.03] inconclusive | 0.63x [0.60, 0.70] lower | 0.72x [0.64, 0.81] lower |
| large | 1x | frame time p99 (ms) | 128 [117, 145] | 640 [582, 735] | 574 [509, 684] | 438 [409, 498] | 0.20x [0.18, 0.21] lower | 0.86x [0.80, 1.07] inconclusive | 0.68x [0.63, 0.73] lower | 0.81x [0.63, 0.83] lower |
| large | 1x | sim minutes per second (min/s) | 117 [112, 120] | 41.6 [36.4, 43.3] | 55.4 [51.1, 60.1] | 63.1 [58.1, 66.3] | 2.84x [2.67, 3.12] higher | 1.40x [1.20, 1.51] higher | 1.55x [1.40, 1.64] higher | 1.11x [1.05, 1.24] inconclusive |
| large | 1x | frames over 200 ms (clamped) (count) | 0.00 [0.00, 0.00] | 14.0 [12.0, 15.0] | 15.0 [13.0, 16.0] | 16.0 [15.0, 16.0] | 0.00x [0.00, 0.00] lower | 1.04x [0.93, 1.23] inconclusive | 1.10x [1.00, 1.25] inconclusive | 1.07x [1.00, 1.14] inconclusive |
| large | 1x | main-thread blocking (long tasks past 50 ms) (ms) | 3015 [2450, 3570] | 11169 [10946, 11694] | 9672 [9014, 10109] | 5560 [5004, 5896] | 0.27x [0.22, 0.32] lower | 0.84x [0.82, 0.90] lower | 0.49x [0.46, 0.53] lower | 0.59x [0.54, 0.60] lower |
| large | 1x | command to visible frame, median (ms) | -8.09 [-10.6, -6.65] | -9.65 [-12.1, -8.20] | -9.07 [-10.8, -5.56] | 43.9 [39.2, 74.6] | 0.84x [0.59, 1.13] inconclusive | 1.01x [0.55, 1.25] inconclusive | -5.05x [-7.56, -4.15] lower | -5.87x [-8.37, -4.25] lower |
| large | 1x | command to visible frame, p95 (ms) | -2.04 [-3.76, -1.27] | -3.41 [-3.82, -2.00] | -1.44 [-3.70, -0.89] | 198 [134, 251] | 0.70x [0.40, 1.06] inconclusive | 0.57x [0.25, 1.95] inconclusive | -61.88x [-67.75, -42.92] lower | -153.71x [-189.90, -34.60] lower |
| large | 4x | mean FPS (fps) | 4.07 [3.78, 4.30] | 1.65 [1.43, 1.86] | 1.97 [1.66, 2.42] | 2.99 [2.78, 3.23] | 2.43x [2.24, 2.74] higher | 1.15x [1.06, 1.35] higher | 1.73x [1.60, 1.97] higher | 1.48x [1.28, 1.83] higher |
| large | 4x | 1% low FPS (fps) | 1.52 [1.28, 1.76] | 0.38 [0.36, 0.42] | 0.36 [0.32, 0.42] | 0.48 [0.45, 0.54] | 3.93x [3.51, 4.82] higher | 0.97x [0.86, 1.10] inconclusive | 1.25x [1.20, 1.48] higher | 1.35x [1.12, 1.52] higher |
| large | 4x | frame time p95 (ms) | 498 [467, 527] | 1767 [1197, 2053] | 1883 [1058, 2128] | 1700 [1607, 1870] | 0.28x [0.24, 0.43] lower | 0.96x [0.66, 1.82] inconclusive | 1.01x [0.88, 1.42] inconclusive | 0.92x [0.84, 1.54] inconclusive |
| large | 4x | frame time p99 (ms) | 608 [556, 703] | 2517 [2290, 2715] | 2672 [2293, 2978] | 1959 [1834, 2129] | 0.23x [0.22, 0.29] lower | 1.04x [0.91, 1.21] inconclusive | 0.81x [0.70, 0.85] lower | 0.75x [0.67, 0.91] lower |
| large | 4x | sim minutes per second (min/s) | 27.1 [24.1, 30.4] | 6.80 [6.42, 7.07] | 8.01 [6.88, 10.2] | 16.3 [14.5, 18.3] | 3.99x [3.46, 4.56] higher | 1.17x [1.05, 1.51] higher | 2.40x [2.10, 2.68] higher | 1.94x [1.78, 2.30] higher |
| large | 4x | frames over 200 ms (clamped) (count) | 32.0 [31.0, 35.0] | 19.5 [17.0, 21.0] | 22.5 [19.0, 26.0] | 14.0 [12.0, 17.0] | 1.69x [1.40, 1.94] higher | 1.12x [1.05, 1.28] higher | 0.72x [0.57, 0.94] lower | 0.62x [0.46, 0.84] lower |
| large | 4x | main-thread blocking (long tasks past 50 ms) (ms) | 11963 [11773, 12099] | 14372 [13787, 15614] | 13886 [13231, 15003] | 11364 [11106, 12072] | 0.82x [0.77, 0.88] lower | 0.97x [0.86, 1.08] inconclusive | 0.79x [0.76, 0.82] lower | 0.82x [0.75, 0.90] lower |
| large | 4x | command to visible frame, median (ms) | -9.74 [-11.8, -7.68] | -11.3 [-13.7, -7.24] | -10.4 [-10.9, -8.95] | 117 [111, 136] | 0.84x [0.64, 1.48] inconclusive | 0.93x [0.80, 1.38] inconclusive | -12.02x [-15.45, -8.20] lower | -12.84x [-15.76, -10.23] lower |
| large | 4x | command to visible frame, p95 (ms) | -3.51 [-5.69, -2.63] | -4.06 [-6.36, -2.82] | -4.07 [-5.91, -2.99] | 370 [298, 435] | 1.00x [0.46, 1.55] inconclusive | 1.20x [0.65, 1.74] inconclusive | -99.92x [-107.60, -49.12] lower | -77.76x [-117.71, -54.97] lower |

## memory

| scenario | throttle | metric | ts | wasm | wasm-frame | wasm-worker | ts / wasm | wasm-frame / wasm | wasm-worker / wasm | wasm-worker / wasm-frame |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 1x | main-thread JS heap (bytes) | 47.43 MiB [47.41 MiB, 47.45 MiB] | 47.32 MiB [47.31 MiB, 47.35 MiB] | 47.27 MiB [47.22 MiB, 47.29 MiB] | 47.25 MiB [47.21 MiB, 47.27 MiB] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent |
| small | 1x | JS heaps + WASM memory (main and worker) (bytes) | 47.43 MiB [47.41 MiB, 47.45 MiB] | 55.76 MiB [55.75 MiB, 55.78 MiB] | 55.71 MiB [55.66 MiB, 55.73 MiB] | 56.18 MiB [56.15 MiB, 56.20 MiB] | 0.85x [0.85, 0.85] lower | 1.00x [1.00, 1.00] equivalent | 1.01x [1.01, 1.01] equivalent | 1.01x [1.01, 1.01] equivalent |
| small | 1x | browser process PSS (bytes) | 492.93 MiB [487.68 MiB, 494.65 MiB] | 497.85 MiB [497.07 MiB, 499.03 MiB] | 499.21 MiB [495.98 MiB, 503.10 MiB] | 500.34 MiB [499.02 MiB, 504.02 MiB] | 0.99x [0.98, 0.99] equivalent | 1.00x [1.00, 1.01] equivalent | 1.01x [1.00, 1.01] equivalent | 1.00x [1.00, 1.01] equivalent |
| medium | 1x | main-thread JS heap (bytes) | 60.29 MiB [58.85 MiB, 60.61 MiB] | 58.39 MiB [58.33 MiB, 59.59 MiB] | 58.37 MiB [58.34 MiB, 59.62 MiB] | 59.18 MiB [58.91 MiB, 60.18 MiB] | 1.02x [1.01, 1.04] equivalent | 1.00x [0.98, 1.02] equivalent | 1.01x [1.00, 1.03] equivalent | 1.01x [0.99, 1.03] equivalent |
| medium | 1x | JS heaps + WASM memory (main and worker) (bytes) | 60.29 MiB [58.85 MiB, 60.61 MiB] | 95.58 MiB [95.51 MiB, 96.77 MiB] | 95.56 MiB [95.53 MiB, 96.81 MiB] | 96.87 MiB [96.60 MiB, 97.87 MiB] | 0.63x [0.61, 0.63] lower | 1.00x [0.99, 1.01] equivalent | 1.01x [1.01, 1.02] equivalent | 1.01x [1.00, 1.02] equivalent |
| medium | 1x | browser process PSS (bytes) | 522.37 MiB [517.75 MiB, 524.55 MiB] | 558.86 MiB [556.12 MiB, 565.41 MiB] | 557.77 MiB [556.23 MiB, 564.05 MiB] | 561.31 MiB [559.96 MiB, 569.07 MiB] | 0.93x [0.92, 0.94] lower | 1.00x [0.99, 1.01] equivalent | 1.01x [0.99, 1.01] equivalent | 1.01x [1.00, 1.02] equivalent |
| large | 1x | main-thread JS heap (bytes) | 75.78 MiB [75.07 MiB, 75.80 MiB] | 75.72 MiB [75.60 MiB, 75.74 MiB] | 75.66 MiB [75.57 MiB, 75.70 MiB] | 77.69 MiB [76.89 MiB, 77.73 MiB] | 1.00x [1.00, 1.00] equivalent | 1.00x [1.00, 1.00] equivalent | 1.03x [1.02, 1.03] equivalent | 1.03x [1.02, 1.03] equivalent |
| large | 1x | JS heaps + WASM memory (main and worker) (bytes) | 75.78 MiB [75.07 MiB, 75.80 MiB] | 204.03 MiB [203.91 MiB, 204.06 MiB] | 203.97 MiB [203.88 MiB, 204.02 MiB] | 206.49 MiB [205.69 MiB, 206.53 MiB] | 0.37x [0.37, 0.37] lower | 1.00x [1.00, 1.00] equivalent | 1.01x [1.01, 1.01] equivalent | 1.01x [1.01, 1.01] equivalent |
| large | 1x | browser process PSS (bytes) | 544.87 MiB [541.30 MiB, 548.13 MiB] | 662.99 MiB [661.11 MiB, 667.61 MiB] | 662.96 MiB [660.74 MiB, 669.38 MiB] | 665.02 MiB [663.05 MiB, 666.34 MiB] | 0.82x [0.81, 0.83] lower | 1.00x [0.99, 1.01] equivalent | 1.00x [1.00, 1.01] equivalent | 1.00x [0.99, 1.01] equivalent |

## traffic

| scenario | throttle | metric | wasm-worker | wasm-worker / wasm |
|---|---|---|---|---|
| small | 1x | worker replies per second (frames) (1/s) | 15.5 [15.1, 17.1] |  |
| small | 1x | messages per second, both ways (frames) (1/s) | 32.0 [31.2, 35.1] |  |
| small | 1x | bytes received per second (frames) (bytes/s) | 2.26 MiB [2.23 MiB, 2.49 MiB] |  |
| small | 1x | reply apply time per second (frames) (ms/s) | 36.7 [33.9, 39.3] |  |
| small | 1x | command to ack, median (frames) (ms) | 55.4 [49.0, 58.4] |  |
| small | 1x | frame view bytes per reply (hosted) (bytes) | 118.7 KiB [118.7 KiB, 118.7 KiB] |  |
| small | 1x | full-save bytes per merge (hosted) (bytes) | 235.2 KiB [235.2 KiB, 235.2 KiB] |  |
| small | 1x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| small | 1x | worker engine time, 720 steps (hosted) (ms) | 349 [294, 369] |  |
| small | 1x | main-thread merge time, 720 steps (hosted) (ms) | 389 [355, 421] |  |
| small | 4x | worker replies per second (frames) (1/s) | 5.57 [5.25, 5.97] |  |
| small | 4x | messages per second, both ways (frames) (1/s) | 12.1 [11.4, 12.9] |  |
| small | 4x | bytes received per second (frames) (bytes/s) | 891.2 KiB [812.5 KiB, 933.8 KiB] |  |
| small | 4x | reply apply time per second (frames) (ms/s) | 64.7 [59.7, 66.0] |  |
| small | 4x | command to ack, median (frames) (ms) | 131 [123, 143] |  |
| small | 4x | frame view bytes per reply (hosted) (bytes) | 118.7 KiB [118.7 KiB, 118.7 KiB] |  |
| small | 4x | full-save bytes per merge (hosted) (bytes) | 235.2 KiB [235.2 KiB, 235.2 KiB] |  |
| small | 4x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| small | 4x | worker engine time, 720 steps (hosted) (ms) | 363 [327, 395] |  |
| small | 4x | main-thread merge time, 720 steps (hosted) (ms) | 1793 [1670, 2042] |  |
| medium | 1x | worker replies per second (frames) (1/s) | 11.2 [10.7, 11.8] |  |
| medium | 1x | messages per second, both ways (frames) (1/s) | 23.3 [22.4, 24.6] |  |
| medium | 1x | bytes received per second (frames) (bytes/s) | 8.36 MiB [7.99 MiB, 8.83 MiB] |  |
| medium | 1x | reply apply time per second (frames) (ms/s) | 145 [141, 150] |  |
| medium | 1x | command to ack, median (frames) (ms) | 60.1 [55.1, 68.0] |  |
| medium | 1x | frame view bytes per reply (hosted) (bytes) | 585.2 KiB [585.2 KiB, 585.2 KiB] |  |
| medium | 1x | full-save bytes per merge (hosted) (bytes) | 1.29 MiB [1.29 MiB, 1.29 MiB] |  |
| medium | 1x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| medium | 1x | worker engine time, 720 steps (hosted) (ms) | 2130 [1867, 2354] |  |
| medium | 1x | main-thread merge time, 720 steps (hosted) (ms) | 2259 [2017, 2544] |  |
| medium | 4x | worker replies per second (frames) (1/s) | 3.62 [3.46, 3.77] |  |
| medium | 4x | messages per second, both ways (frames) (1/s) | 8.13 [7.84, 8.54] |  |
| medium | 4x | bytes received per second (frames) (bytes/s) | 2.61 MiB [2.37 MiB, 2.78 MiB] |  |
| medium | 4x | reply apply time per second (frames) (ms/s) | 200 [186, 213] |  |
| medium | 4x | command to ack, median (frames) (ms) | 162 [139, 174] |  |
| medium | 4x | frame view bytes per reply (hosted) (bytes) | 585.2 KiB [585.2 KiB, 585.2 KiB] |  |
| medium | 4x | full-save bytes per merge (hosted) (bytes) | 1.29 MiB [1.29 MiB, 1.29 MiB] |  |
| medium | 4x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| medium | 4x | worker engine time, 720 steps (hosted) (ms) | 2214 [1955, 2352] |  |
| medium | 4x | main-thread merge time, 720 steps (hosted) (ms) | 10787 [10064, 12287] |  |
| large | 1x | worker replies per second (frames) (1/s) | 8.65 [8.12, 9.38] |  |
| large | 1x | messages per second, both ways (frames) (1/s) | 18.3 [17.2, 19.8] |  |
| large | 1x | bytes received per second (frames) (bytes/s) | 22.88 MiB [20.94 MiB, 24.45 MiB] |  |
| large | 1x | reply apply time per second (frames) (ms/s) | 374 [353, 383] |  |
| large | 1x | command to ack, median (frames) (ms) | 55.6 [47.3, 85.4] |  |
| large | 1x | frame view bytes per reply (hosted) (bytes) | 2.00 MiB [2.00 MiB, 2.00 MiB] |  |
| large | 1x | full-save bytes per merge (hosted) (bytes) | 4.49 MiB [4.49 MiB, 4.49 MiB] |  |
| large | 1x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| large | 1x | worker engine time, 720 steps (hosted) (ms) | 6508 [5906, 7028] |  |
| large | 1x | main-thread merge time, 720 steps (hosted) (ms) | 7989 [7384, 8298] |  |
| large | 4x | worker replies per second (frames) (1/s) | 2.62 [2.42, 2.90] |  |
| large | 4x | messages per second, both ways (frames) (1/s) | 5.91 [5.42, 6.53] |  |
| large | 4x | bytes received per second (frames) (bytes/s) | 6.75 MiB [6.08 MiB, 7.57 MiB] |  |
| large | 4x | reply apply time per second (frames) (ms/s) | 474 [465, 506] |  |
| large | 4x | command to ack, median (frames) (ms) | 135 [126, 148] |  |
| large | 4x | frame view bytes per reply (hosted) (bytes) | 2.00 MiB [2.00 MiB, 2.00 MiB] |  |
| large | 4x | full-save bytes per merge (hosted) (bytes) | 4.49 MiB [4.49 MiB, 4.49 MiB] |  |
| large | 4x | full-save merges, 720 steps (hosted) (count) | 24.0 [24.0, 24.0] |  |
| large | 4x | worker engine time, 720 steps (hosted) (ms) | 6424 [5834, 6682] |  |
| large | 4x | main-thread merge time, 720 steps (hosted) (ms) | 36091 [34703, 38100] |  |

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
- Command latency times a tower rename (relayed by every host, read by nothing in the simulation) to the first frame drawn after the engine's answer is in the read model. The main-thread hosts answer in the call, so their figure is the wait for the next frame. One command is in flight at a time, one per second.
- Memory is measured after 30 steps on a freshly loaded page, after a forced GC. The harness keeps the scenario saves it loads from in the page for every mode (the same text in every mode's JS heap rows); its own stashed start and end saves are dropped before the read. WASM linear memory only grows, so it is a high-water mark that includes the boot tower. The worker's JS heap is read through the DevTools target protocol; when that is unavailable the combined row has no worker sample. Process PSS sums the browser's processes (Linux).
- Frames render at a 640x360 CSS viewport (a common phone size), smaller than perf:compare's 1280x720: on this machine's software rasterizer a 1280x720 frame took about 250 ms, past Excalibur's 200 ms clamp (a longer frame is handed 1 ms of game time), so no mode simulated anything in its frames. Rows with clamped frames still understate the simulation work; the clamped-frame row counts them.
- Message sizes are counted on the way in (frame views, full saves, events, log and pending text at two bytes a character); the way out (steps and commands, a few numbers each) is not measured, so as not to serialize every message twice on the measured thread.
- The serialize and deserialize halves of the full save are split only on the worker host (the worker's reply time includes the serialize, the main thread's merge time the parse and merge). The main-thread hosts' read-model sync is split in perf:compare's attribution pass.
- Throttles run in a fixed order (1x then 4x) in each process. The mode order rotates by repetition (10 repetitions over 4 modes: modes first between 2 and 3 times). The throttled cold start throttles before the navigation and again at commit; its CPU probe runs after startup, so a throttle gap at navigation would not show.
- Audio was not started in these frames (measured in perf:compare). The coalesced and worker hosts are experimental and opt-in; the shipped default is unchanged.
