# RUN-0a reading

Measured 2026-10-20 on the owner's desktop at `e25ec01` plus the declared build patch. `NOTES.md` is the PC session's record; this file reads the result against the protocol's rule (docs/performance/benchmark-protocol.md, section 7, RUN-0a). The committed reference is `docs/performance/results/2026-10-15-e25ec01c-worker-1280x720`. This is a snapshot. The percentages below are this file's own arithmetic on the medians in `metrics.csv`. For live numbers run `npm run perf:worker`; the report's definitions are pinned by `src/tests/perfWorker/analysis.test.ts`.

## The rule

RUN-0a passes when the run meets the machine state and the GPU renderer, and the large tower's 720 bare steps at 1x come out near 702 ms (TypeScript) and 830 ms (WASM), each median inside the committed interval of the 1280x720 reference run.

| Large tower, 720 bare steps, 1x | 2026-10-15 reference, median [95% interval] | RUN-0a, median [95% interval] | Inside the reference interval |
| --- | --- | --- | --- |
| TypeScript | 702 [670, 734] | 732 [696, 815] | yes (732 is 2 ms under the upper bound) |
| WASM | 830 [786, 971] | 832 [810, 855] | yes |

Both large 1x medians fall inside the 1280x720 reference intervals: TypeScript sits at the top of its interval (4.3% above the old median), and WASM matches to within 0.3%. **RUN-0a does not pass.** The run used a software renderer and missed the machine state (see the differences below), so it does not qualify, and RUN-0a stays open until a compliant repeat or the owner's explicit acceptance. Against the earlier 640x360 run (large 1x, WASM 806 [791, 830]), WASM 832 is also 1.9 ms above its upper bound.

## What does not reproduce

The rule covers only those two figures. The other bare-engine rows moved, and the 4x rows moved a lot:

| Scenario | CPU | Engine | Reference | RUN-0a | Inside |
| --- | --- | --- | --- | --- | --- |
| large | 4x | TypeScript | 3050 [2944, 3176] | 4785 [4656, 5297] | no (+57%) |
| large | 4x | WASM | 3632 [3583, 3808] | 5289 [5228, 5555] | no (+46%) |
| medium | 1x | TypeScript | 690 [684, 692] | 771 [766, 800] | no (+12%) |
| medium | 1x | WASM | 387 [381, 395] | 393 [388, 410] | yes |
| medium | 4x | TypeScript | 3045 [3014, 3095] | 4777 [4753, 4839] | no (+57%) |
| medium | 4x | WASM | 1763 [1709, 1788] | 2491 [2477, 2549] | no (+41%) |
| small | 1x | TypeScript | 107 [103, 110] | 131 [128, 135] | no (+22%) |
| small | 1x | WASM | 76 [75, 76] | 81 [80, 97] | no (+7%) |
| small | 4x | TypeScript | 602 [505, 744] | 756 [748, 764] | no (+26%) |
| small | 4x | WASM | 341 [335, 401] | 505 [497, 513] | no (+48%) |

The 4x rows are the largest movers, and TypeScript moved more than WASM at 1x.

## Differences between the two runs

Same machine, same browser version (Chromium 149.0.7827.55), same engine source hash (`b2786beb…`), same Node and Playwright. These differ:

- **Renderer.** The reference recorded ANGLE D3D11 on the RTX 3060. RUN-0a recorded ANGLE on Vulkan SwiftShader, which is software rendering. See the follow-up #1115. Software rendering can load the CPU while the bare-step rows run, and it invalidates every frame metric in this folder.
- **Power plan.** Balanced in RUN-0a. The protocol asks for best-performance. The 2026-10-15 run's plan is not recorded.
- **Background load.** The ChatGPT desktop app, the NVIDIA Overlay and the Claude and Codex apps were running, and idle CPU read 0 to 26% at the start. The protocol now asks for the first two to be closed.

This folder cannot say which of these moved the 4x rows. A RUN-0a repeat on the GPU renderer with a best-performance plan and the apps closed would separate the machine state from the code.

## Use

- Frame metrics from this folder are invalid (software renderer). Do not quote FPS, 1% lows or frame-time rows.
- The two large 1x medians landing inside the reference intervals is an observation only. No row of this folder is used as evidence for the gate.
- RUN-0b waits on the renderer fix (#1115) before its frame metrics.
- The old `perf:worker` report leads with TypeScript over WASM. The gate's orientation is the other way (WASM over TypeScript); invert before comparing with the pass rules.
