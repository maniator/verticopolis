# RUN-0b-prelim reading

**Snapshot of one run: `perf:worker`, 10 repetitions, started 2026-10-20 15:05Z on the owner's desktop (NafRogRig) at `a53e877`, finished 17:14Z.** It is a preliminary baseline of current `main`, not RUN-0a, not the declared RUN-0b and not acceptance evidence. The live numbers come from `npm run perf:worker`; the report's definitions are pinned by `src/tests/perfWorker/analysis.test.ts`. `NOTES.md` is the PC session's record; this file says how to read the result. Every figure below is copied from `NOTES.md` or `report.md`; this file computes nothing.

## Read this first

- **Frame metrics are INVALID.** The renderer was ANGLE on Vulkan SwiftShader, which is software rendering, not the RTX 3060 (the report's Renderer line says so). Do not quote FPS, 1% lows, frame-time rows, long tasks or any ratio from the `frames` section. See #1115 and #1125.
- The harness at `a53e877` predates the renderer check of #1125, so its validation reads `ok: true` for a run that the current check rejects. That `ok` does not make the frame rows usable.
- The bare-engine and hosted rows are the usable evidence. They may still carry software-rendering CPU load from the page, as RUN-0a's rows might (see its `READING.md`), so they are a preliminary read, not a baseline to compare a candidate against.
- **The 4x `wasm-worker` rows are not a 4x device.** DevTools CPU throttling slows the page's main thread but not the dedicated worker. On RUN-0a's data the large-tower worker engine time went from 1,862 ms at 1x to 2,189 ms at 4x while the bare step slowed 6.4x, so a 4x worker row models a slow main thread beside a fast worker, which no real device has. That covers the 4x worker wall and main-thread times (for example large 4x main-thread 17385 ms against `wasm`'s 41979 ms) and every 4x ratio that has `wasm-worker` in it; they overstate the worker. Compare the worker against the main-thread hosts with the 1x rows until the harness throttles the worker too (the labeling follow-up stacked on #1124 marks those rows). The 1x rows and the 4x rows of `ts` and `wasm` are unaffected.
- `NOTES.md` is the PC session's own record, written on the PC before this commit; its line that nothing was committed or pushed was true then.
- The report leads with TypeScript over WASM (above 1.0 means TypeScript is slower). The gate's orientation is the other way; invert before comparing with the pass rules.

## Deviations from the protocol's machine state

- Power plan: Balanced during the run (the protocol asks for best-performance). Switched to High performance afterwards with the owner's approval; no Ultimate plan is installed.
- The ChatGPT desktop app and the NVIDIA Overlay were open during the run; they were closed afterwards for the next runs, apart from five NVIDIA Overlay processes that persist after `Stop-Process`.
- Idle CPU before the start was 0 to 2%.
- Browser: Playwright's bundled headless shell (`executable: null`, 149.0.7827.55), the same default as RUN-0a and not the full bundled Chromium the 2026-10-15 references used.
- Clean clone with `core.autocrlf=false`; `git status --porcelain` was empty before the run and `results.json` records `dirty: false`. Engine source hash `ef3616e6…` matches the expected Linux archive hash.

## Bare engine, 720 steps, median [95% interval], ms

| Scenario | CPU | TypeScript | WASM |
| --- | --- | --- | --- |
| medium | 1x | 768 [759, 794] | 390 [389, 400] |
| medium | 4x | 4783 [4713, 4813] | 2502 [2478, 2616] |
| large | 1x | 703 [696, 776] | 847 [809, 924] |
| large | 4x | 4734 [4656, 4912] | 5264 [5213, 5303] |

For the same large-tower rows, RUN-0a (`e25ec01` plus its declared patch, same renderer and browser) recorded TypeScript 732 [696, 815] and WASM 832 [810, 855] at 1x, and TypeScript 4785 [4656, 5297] and WASM 5289 [5228, 5555] at 4x (its folder is in PR #1116). The 2026-10-15 references recorded 4x rows near 3050 (TypeScript) and 3632 (WASM) on the RTX 3060.

## Use

- No verdict is drawn from this folder, and no row of it is evidence for the gate (#945).
- RUN-0a stays open until a compliant repeat on a verified GPU; RUN-0b is declared once the renderer check has merged and the pin is recorded in #1104.
