# RUN-0a notes, 2026-10-20 (PC, NafRogRig)

Files in this set (all prefixed run0a-): notes (this file), report.md, results.json, metrics.csv, ratios.csv (the harness output folder `docs/performance/results/2026-10-20-e25ec01-run0a-worker-1280x720/`), console.log (full console log), npm-ci.log, wasm-build.log. Nothing was committed or pushed. The folder is still in the clone at `C:\Users\nafta\projects\vc-run0a`.

## Run
- Commit: `e25ec01c03ee94199d7288e1e0a952225a4bc2db` (clean clone, `git -c core.autocrlf=false`), plus the declared build-fix patch (below).
- Command: `npm.cmd run perf:worker -- --reps 10 --viewport 1280x720 --out docs/performance/results/2026-10-20-e25ec01-run0a-worker-1280x720`
- Exit code: **0**. Start 2026-10-20T12:52:50Z, end 2026-10-20T15:01:53Z (2 h 09 min, including the two builds at the start).
- Reps: 10 of 10 (rep numbers 0 to 9 in the log). No failed or re-run repetitions: 0 matches for retry/failed/Error in the console log, and no ENOENT/EINVAL.
- Validation (results.json): `ok: true`, errors `[]`, one warning: "the working tree had uncommitted changes; the folder is marked -dirty" (expected for RUN-0a, from the declared patch).
- Browser actually used: Playwright's bundled Chromium 149.0.7827.55 (executable null), headless. Installed Chrome 155 was not used. Renderer string in the report: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver), i.e. software rendering, not the RTX 3060. Cross-origin isolated: true.

## Identity
- Engine source hash (`BUILD.json` sources, results.json `engineSourceHash` and `engineBuildHash`): `b2786beb447604a5b9fafa6a4947221038247b73efe0cde1589845e1cbf329a1`. This equals the expected `b2786beb…`, checked after the patch and after the second `wasm:build`.
- Package SHA-256 (record only): `verticopolis_engine_bg.wasm` `8d34b471c4502e235ae646796b728bdb3f14a2402ba0a5191e0c37ddea27feaf`, `verticopolis_engine.js` `e1c99c1a7c69fdd88da22dc20fc1fb405c8f00c68756b0a578adf6af3c652754`.
- results.json `environment.dirty: true`, `behindMain: 148` (main at a53e877).

## Declared patch
- Source: `docs/performance/patches/run0a-e25ec01-build-fix.patch` at commit 32ba224 on `claude/benchmark-protocol`.
- SHA-256 (Get-FileHash, verified before applying): `CF781EE652A9377252AE6BE5DA73A0B990E325C39984BE292BE3A715BBAD73A1` (equals the expected cf781ee6…73a1).
- `git apply` exit 0. Then `git reset -q HEAD -- <patch>` and the patch file was removed.
- `git status --porcelain` before the patch: empty.
- `git status --porcelain` after the patch (before the run):
```
 M src/tests/perfCompare/main.ts
 M src/tests/perfWorker/main.ts
?? src/tests/perfWorker/build.ts
```
- `git status --porcelain` after the run (the results folder is new):
```
 M src/tests/perfCompare/main.ts
 M src/tests/perfWorker/main.ts
?? docs/performance/results/2026-10-20-e25ec01-run0a-worker-1280x720/
?? src/tests/perfWorker/build.ts
```
- History of the attempt: the first `perf:worker` try, before the patch, failed with `spawnSync npm ENOENT` at `src/tests/perfWorker/main.ts:123`, as the protocol expects. I then started a hand edit (copied main's `build.ts` into the clone); the permission system denied the edit. I deleted that copy before applying the published patch, so the final tree is exactly clean-plus-patch (porcelain above). `npm.cmd ci` and `npm.cmd run wasm:build` were run twice (before and after the patch), all exit 0 (the logs here are from the second pass).

## Hardware and machine state
- CPU AMD Ryzen 5 5600X (6 cores, 12 threads); RAM 31.9 GB (free at start 14.3 GB); GPU NVIDIA GeForce RTX 3060, driver 32.0.16.1088 (not used by the headless renderer, see above); Windows 11 Pro 10.0.26200; Node v22.22.0; npm 11.8.0; rustc/cargo 1.97.0; wasm-bindgen 0.2.129; Playwright 1.61.1. No battery present (desktop on AC).
- Deviation: Windows power plan was **Balanced** (GUID 381b4222-f694-41f0-9685-ff5bb260df2e). Not changed, because it was not approved. The protocol asks for best-performance.
- Closed before the run: Google Chrome, all 26 `chrome.exe` processes from `C:\Program Files\Google\Chrome\Application` (one open window, "Dashboard - Google Chrome"), closed with CloseMainWindow at about 12:51Z (Naftali approved closing windows). Not closed: other Claude sessions' node/node_repl processes, the Claude and Codex apps, the ChatGPT desktop app, NVIDIA Overlay, Windows Defender (MsMpEng, no scan was observed). Idle CPU load sampled at 0 to 26% just before the start, so the machine was not fully quiet.
- Nothing else heavy was started on the PC during the run (no LLM inference or downloads).

## RUN-0a question: large tower, 720 bare steps, 1x (report.md, "raw" table)
Reference figures from 2026-10-15: TypeScript 702 ms, WASM 830 ms.
| | this run, median [95% interval] |
|---|---|
| TypeScript | 732 ms [696, 815] |
| WASM | 832 ms [810, 855] |
The committed intervals from the 2026-10-15 runs are not reproduced in this file; comparing against them is left to the coordinator. At 4x the same row reads TypeScript 4785 ms [4656, 5297], WASM 5289 ms [5228, 5555]. Small and medium bare-engine rows are in report.md. This is reported without a pass/fail reading.

## Other things worth knowing
- report.md orientation: `perf:worker` still leads with TypeScript / WASM (above 1.0 means TypeScript is slower). Invert before using the gate's orientation (protocol section 5).
- Frame metrics were taken with software rendering (SwiftShader), which dominates FPS at this viewport; the report's Limitations section applies.
