# #1051 before/after PC run notes, 2026-10-20 (NafRogRig)

Nothing committed or pushed from the PC. Results folders (untracked) stay in `C:\Users\nafta\projects\vc-1051-before\docs\performance\results\2026-10-20-06a6dcb-1051-before` and `C:\Users\nafta\projects\vc-1051-after\docs\performance\results\2026-10-20-a532572-1051-after`. Fresh clones with `core.autocrlf=false` were used instead of worktrees inside the main repo (deviation from the run file, to leave the existing repo untouched).

| | before | after |
|---|---|---|
| commit | 06a6dcbc7114bfce15a62880233851ecde09c3a1 | a532572a22917930fdcb3ee9c030eaaa1265a84b |
| engine hash | ef3616e64f111fc4959bb25266f4209d71350ba360b8cc98a6549cf1d56e41ff (matches) | 87617ea9147471be69c01549f437f2dd2ff8245469873a5a99907373cf30b8c3 (matches) |
| tree before run | clean (porcelain empty) | clean (porcelain empty) |
| command | `npm.cmd run perf:compare -- --scenarios "medium,large" --throttles "1,4" --reps 10 --out docs/performance/results/2026-10-20-06a6dcb-1051-before` | same, `--out docs/performance/results/2026-10-20-a532572-1051-after` |
| exit code | 0 | 0 |
| start / end (UTC) | 17:20:15 / 18:55:40 | 18:55:53 / 20:28:12 |
| idle CPU % (5 samples just before) | 8,4,0,5,1 | 1,3,1,0 |
| validation | ok, 0 errors, 113 warnings | ok, 0 errors, 110 warnings |
| Node conformance (start, end, crowd) | same/same/same, yes (medium and large) | same/same/same, yes |

- Preflight GPU gate passed before each pass (3 launches each): `ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)`. The reports' WebGL renderer row names the RTX 3060 for both.
- Browser: Playwright full Chromium 149.0.7827.55, headless, `PW_CHROMIUM_PATH=C:\Users\nafta\AppData\Local\ms-playwright\chromium-1228\chrome-win64\chrome.exe`. Switches: `--autoplay-policy=no-user-gesture-required`, `--js-flags=--expose-gc`. Chromium printed a sandbox "Access is denied" line at launch; the run was unaffected.
- Power plan: High performance, GUID 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c (switched from Balanced 381b4222-f694-41f0-9685-ff5bb260df2e after RUN-0b-prelim; no Ultimate plan installed). Restore to Balanced is queued after the last timed run.
- Machine state: AC (no battery), Chrome closed, ChatGPT app closed. Deviation: NVIDIA Overlay (5 processes) could not be stopped (they persist after Stop-Process). No LLM inference or other heavy work during the runs. Two read-only log reads happened mid-run.

## Reading the results
- **perf:compare's large-tower TypeScript rows, and every WASM/TS ratio on large, are invalid** (TypeScript's JIT state from the medium scenario in the same page roughly doubles its large time; fix is #1164, issue #1162). Medium rows and all within-engine before/after numbers are usable. The fair large comparison is the queued large-fresh pass.
- Frame rows (audio off/on) are valid for the GPU renderer but carry heavy clamping at 4x (many frames over 200 ms) and the report's Limitations section still contains a stale "software WebGL" sentence.
- Browser process PSS memory is n/a in both passes (0 of 10 processes produced a value).

