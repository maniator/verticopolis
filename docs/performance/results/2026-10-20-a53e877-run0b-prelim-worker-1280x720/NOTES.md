# RUN-0b-prelim notes, 2026-10-20 (PC, NafRogRig)

**Preliminary current-main baseline. Not RUN-0a and not the declared RUN-0b.** Frame metrics are INVALID: the renderer was SwiftShader (software). Timing rows are the usable evidence. Nothing committed or pushed; the folder is in `C:\Users\nafta\projects\vc-run0b-prelim`.

- Commit `a53e87791e93564cf8b57bb1481a2ecb98b93144` (clean clone, `core.autocrlf=false`). `git status --porcelain` was empty before the run; after it only the new results folder (untracked). results.json `dirty: false`.
- Engine source hash `ef3616e64f111fc4959bb25266f4209d71350ba360b8cc98a6549cf1d56e41ff` = the expected Linux git-archive hash. `npm.cmd ci` and `npm.cmd run wasm:build` exit 0.
- Command: `npm.cmd run perf:worker -- --reps 10 --viewport 1280x720 --out docs/performance/results/2026-10-20-a53e877-run0b-prelim-worker-1280x720`. Exit **0**. 10 of 10 reps, validation `ok: true` with no errors or warnings, 0 matches for retry/failed/Error/ENOENT/EINVAL.
- Start 2026-10-20T15:05:18Z, end 2026-10-20T17:14:28Z (2 h 09 min incl. builds).
- Browser: Playwright's bundled headless shell, version 149.0.7827.55, `executable: null` (no PW_CHROMIUM_PATH). **Renderer: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)**, not the RTX 3060.
- Hardware: Ryzen 5 5600X (6C/12T), 31.9 GB RAM (free at start 13.1 GB), RTX 3060 (driver 32.0.16.1088, unused by this run), Windows 11 Pro 10.0.26200, Node v22.22.0, npm 11.8.0, rustc 1.97.0, wasm-bindgen 0.2.129, Playwright 1.61.1.
- Power plan during this run: **Balanced** (381b4222-f694-41f0-9685-ff5bb260df2e), a deviation. After it finished I switched to **High performance** (8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c; no Ultimate plan is installed) with Naftali's approval; before = Balanced, after = High performance.
- Machine state: Chrome closed (26 processes, done for RUN-0a). ChatGPT app and NVIDIA Overlay were still open during this run (closed afterwards for the next runs; the 5 NVIDIA Overlay processes could not be stopped, they persist after Stop-Process). Idle CPU before start 0 to 2%.

## Bare engine, 720 steps (report.md "raw"), medians [95% interval], ms
| scenario | throttle | TypeScript | WASM |
|---|---|---|---|
| medium | 1x | 768 [759, 794] | 390 [389, 400] |
| medium | 4x | 4783 [4713, 4813] | 2502 [2478, 2616] |
| large | 1x | 703 [696, 776] | 847 [809, 924] |
| large | 4x | 4734 [4656, 4912] | 5264 [5213, 5303] |

Hosted main-thread time, 720 steps (ms): medium 1x TS 775, wasm 2302, wasm-frame 1599, wasm-worker 895; large 1x TS 758, wasm 7127, wasm-frame 4767, wasm-worker 2928; large 4x TS 4762, wasm 41979, wasm-frame 29582, wasm-worker 17385. Full tables in report.md. No verdict given. Orientation: this report leads with TS / WASM (above 1.0 means TypeScript is slower).
