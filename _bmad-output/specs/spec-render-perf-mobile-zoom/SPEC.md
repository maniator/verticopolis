---
id: SPEC-render-perf-mobile-zoom
companions:
  - diagnosis.md
  - ../../project-context.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only: consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Mobile render performance: zoom culling, shared room bakes, deferred hour reconcile

## Why

A pain to solve: the owner's Pixel 8a stutters at the morning and evening rushes when fully zoomed out at top speed on their real 4★ tower (5,085 population, 20,155 units). Profiling that save exonerated the simulation (flat ~7.5ms per sim-minute all day) and convicted the render layer: ~2,500 retained actors produce second-long frames at minimum zoom under phone-class throttling at every hour, because 1,635 room actors each own a private canvas texture against a mobile GPU's 8-16 texture slots per sprite batch, and the hourly engine scans share a frame with a full render reconcile. The fix is presentation-only; canon parity is not in play. Full evidence in `diagnosis.md`.

## Capabilities

- **CAP-1**
  - **intent:** Below a named sub-legible zoom threshold, crowd and vehicle actors (routed people, ambient walkers, elevator cars, metro train, garbage trucks, garage cars) stop being drawn and their per-frame position/graphic update loops are skipped, with hysteresis so actors never strobe at the threshold while pinching.
  - **success:** The rush probe on the owner's save at minimum zoom shows the crowd/vehicle share of frame time eliminated; zooming in past the re-show threshold restores every actor correctly; sweeping zoom across the boundary produces no flicker.

- **CAP-2**
  - **intent:** Room actors share immutable baked canvases keyed by the draw signature the reconcile already computes, so units that look identical share one texture; a unit whose look changes swaps to the bake for its new signature instead of repainting a canvas; a refcounted cache evicts bakes no unit references; animated rooms keep private canvases.
  - **success:** The pinned e2e visual baselines pass byte-identical; distinct room textures on the owner's save collapse from ~1,635 (one per unit) to the live signature population (order dozens); the rush probe shows a material frame-time drop at minimum zoom.

- **CAP-3**
  - **intent:** The hour-boundary full render reconcile (the `syncScene` pass triggered by the displayed-hour change) runs one frame after the engine's hourly scans instead of inside the same frame, so the two costs never stack into one mega-frame.
  - **success:** The on-the-hour longest-frame in the rush probe drops by roughly the reconcile's share; every hour-driven visual change still lands (one frame later); no reconcile is ever skipped.

## Constraints

- Presentation-only: zero engine-number changes, `src/engine/` stays DOM-free and untouched except comments, the golden master stays byte-stable, and canon parity is out of scope by construction.
- The cull threshold is a named constant whose comment states the sub-legible rationale (a person figure under ~3 screen pixels); hysteresis re-shows at a strictly higher zoom than it hides.
- Walker/vehicle BUILD stays gated on structural revision only; zoom changes must never trigger `buildWalkers`/`syncMotion` rebuilds (each rebuild bakes canvases).
- Shared bakes are immutable by contract: no code path may mutate (flagDirty/redraw) a canvas that more than one unit can reference; a look change is a reference swap. Signature under-keying is guarded by the visual baselines failing the PR.
- One story per PR, in order CAP-1, CAP-2, CAP-3; each PR carries all four quality gates, the CI perf gate, `/gds-code-review` with patch findings fixed and defers backlogged, and before/after rush-probe stats on `sixseven_8.vctower` in the PR body.

## Non-goals

- Amortizing the engine's `onHour` scans (`updateSatisfaction`, `collectTrafficIncome`): load-bearing for determinism and the golden master; backlogged pending a checkpoint-the-inputs design consult.
- LOD or culling for room/structure sprites: rooms stay drawn at every zoom; only crowd/vehicle actors cull.
- Any gameplay, balance, or engine-behavior change; any Excalibur upgrade or renderer swap.

## Success signal

On the owner's save at minimum zoom, top speed, under 4x CPU throttle, the rush probe's median frame time drops from ~1s to a smooth-scrolling budget, and the on-the-hour hitch shrinks visibly; on the physical Pixel 8a the morning and evening rushes scroll without perceived freezes.

## Assumptions

- The 400-walker budget and shared person graphics are already cheap enough above the cull threshold; no walker-count tuning is in scope.
- The signature strings the reconcile computes today capture every visual input of `drawUnit` (the visual-baseline gate is the backstop if not).
