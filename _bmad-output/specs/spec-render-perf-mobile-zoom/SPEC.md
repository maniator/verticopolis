---
id: SPEC-render-perf-mobile-zoom
companions:
  - diagnosis.md
  - region-design.md
  - ../../project-context.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only: consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Mobile render performance: zoom culling, region composition, deferred hour reconcile

## Why

A pain to solve: the owner's Pixel 8a stutters at the morning and evening rushes when fully zoomed out at top speed on their real 4★ tower (5,085 population, 20,155 units). Profiling that save exonerated the simulation (flat ~7.5ms per sim-minute all day) and convicted the render layer: ~2,500 retained actors produce second-long frames at minimum zoom under phone-class throttling at every hour, because 1,635 room actors each own a private canvas texture against a mobile GPU's 8-16 texture slots per sprite batch, and the hourly engine scans share a frame with a full render reconcile. The fix is presentation-only; canon parity is not in play. Full evidence, including the pixel-hash census that retired the earlier shared-bake design for CAP-2, in `diagnosis.md`.

## Capabilities

- **CAP-1** (landed: PR #296)
  - **intent:** Below a named sub-legible zoom threshold, crowd and vehicle actors (routed people, ambient walkers, elevator cars, metro train, garbage trucks, garage cars) stop being drawn and their per-frame position/graphic update loops are skipped, with hysteresis so actors never strobe at the threshold while pinching.
  - **success:** The rush probe on the owner's save at minimum zoom shows the crowd/vehicle share of frame time eliminated; zooming in past the re-show threshold restores every actor correctly; sweeping zoom across the boundary produces no flicker.

- **CAP-2**
  - **intent:** Settled room units draw into a fixed world-space region grid: one cached canvas plus anchor actor per region, each region compositing its member units with clipped draws at integer world offsets (the transport band precedent). Animated rooms (fire, construction) keep private per-unit actors and their region leaves their footprint unpainted. A unit's signature flip marks its region(s) dirty; dirty regions repaint in place through a budgeted, visible-first queue. Per-unit room actors retire; pointer picking resolves rooms through the tower's footprint-indexed grid lookup.
  - **success:** The pinned e2e visual baselines pass byte-identical; distinct room-layer textures on the owner's save collapse from ~1,635 (one per unit) to the live region count (order dozens) at day AND at night, verified by re-running the bitmap census; the rush probe shows a material frame-time drop at minimum zoom.

- **CAP-3**
  - **intent:** The hour-boundary full render reconcile (the `syncScene` pass triggered by the displayed-hour change) runs one frame after the engine's hourly scans instead of inside the same frame, so the two costs never stack into one mega-frame.
  - **success:** The on-the-hour longest-frame in the rush probe drops by roughly the reconcile's share; every hour-driven visual change still lands (one frame later); no reconcile is ever skipped; the probe reports the hour-boundary frame sequence, not just the single longest frame.

## Constraints

- Presentation-only: zero engine-number changes, `src/engine/` stays DOM-free and untouched except comments, the golden master stays byte-stable, and canon parity is out of scope by construction.
- The cull threshold is a named constant whose comment states the sub-legible rationale (a person figure under ~3 screen pixels); hysteresis re-shows at a strictly higher zoom than it hides.
- Walker/vehicle BUILD stays gated on structural revision only; zoom changes must never trigger `buildWalkers`/`syncMotion` rebuilds (each rebuild bakes canvases).
- Region composition preserves pixels exactly: per-unit clipped draws at integer offsets of the same `drawUnit` calls, geo-seeded variety untouched. The variety law (geometry-seeded per-room looks, including the lit-only window sparkle) is a design invariant, not an implementation detail; no candidate that changes room pixels is in scope.
- Bounded drain is load-bearing, not tuning: no frame ever rasterizes or uploads the whole tower. Dirty regions drain through a budgeted, visible-first queue (naive repaint at the 17:00 lit flip is ~40 full-region uploads, ~50MB, in one frame: worse than the status quo). Two exceptions: animated-state transitions repaint their region in the same frame (no fire ghost), and initial load may drain fully before the first presented frame.
- Region dimensions are named constants with both pixel sides pinned <= 2048 by a unit test (the `TRANSPORT_BAND_FLOORS` precedent); exact values are chosen by the upload micro-bench, not by taste.
- Pre-region gates, all before the region story starts: (1) a one-region pixel-diff spike in the pinned Playwright container proves byte-identity; (2) a texture-upload micro-bench under 4x throttle prices region size; (3) a blame-split probe (all rooms sharing one bake vs all room actors hidden) decomposes texture flushes vs actor overhead; (4) a full-tower day/night scene baseline is minted on main via the sanctioned workflow, because the current pinned baselines image single gallery units and cannot catch region seams or layering.
- One story per PR, in order: CAP-1 (landed), CAP-3, picking-via-grid-lookup, CAP-2 regions (with the drain budget inside), then an optional drain-tuning story only if the probe demands it. Each PR carries all four quality gates, the CI perf gate, `/gds-code-review` with patch findings fixed and defers backlogged, and before/after rush-probe stats on `sixseven_8.vctower` in the PR body.
- Owner acceptance for CAP-2 includes the physical Pixel 8a: both rushes plus the 17:00-19:00 sunset window at top speed fully zoomed out, a zoom-in pass mid-rush (tap, inspect, variety reroll must feel identical), and a fire drill (no ghost, no hole, no seam).

## Non-goals

- Amortizing the engine's `onHour` scans (`updateSatisfaction`, `collectTrafficIncome`): load-bearing for determinism and the golden master; backlogged pending a checkpoint-the-inputs design consult. Expect its 50-110ms tick to surface once render frames stop hiding it; set that expectation with the owner rather than treating it as a regression.
- LOD or culling for room/structure sprites: rooms stay drawn at every zoom; only crowd/vehicle actors cull.
- Shared bakes keyed by draw signature: the ratified 2026-07-14 design, retired 2026-07-15 by the pixel-hash census (738 day / 1,302 night unique room bitmaps on the owner's save; the geo-seeded variety law makes per-look approximately per-unit). Recorded here so nobody re-derives it from the spec later.
- Bucketing or flattening the night window sparkle (or any variety axis) to raise texture sharing: changes pixels, breaks the variety law, and still leaves 738 day textures against 8-16 slots.
- Any gameplay, balance, or engine-behavior change; any Excalibur upgrade or renderer swap.

## Success signal

On the owner's save at minimum zoom, top speed, under 4x CPU throttle, the rush probe's median frame time drops from ~1s to a smooth-scrolling budget, and the on-the-hour hitch shrinks visibly; on the physical Pixel 8a the morning and evening rushes scroll without perceived freezes, including the 17:00-19:00 sunset window.

## Assumptions

- The 400-walker budget and shared person graphics are already cheap enough above the cull threshold; no walker-count tuning is in scope.
- Rasterizing the same `drawUnit` calls at integer offsets into a larger canvas is pixel-identical to per-unit canvases (integer world coordinates, nearest sampling, non-overlapping footprints); the pre-region spike in the pinned container is the falsifier before the story, and the visual-baseline gate is the backstop after.
- Region repaint reads live tower state at drain time, so dirty marks coalesce and a drained queue always renders f(current unit states); the sim-swap path clears the queue so stale-tower pixels are unreachable.
