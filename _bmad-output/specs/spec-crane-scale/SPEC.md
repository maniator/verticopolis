---
id: SPEC-crane-scale
companions: []
sources: []
---

> **Canonical contract.** This SPEC is the complete, preservation-validated contract for what to build, test, and validate.

# Rooftop Crane Rescale

## Why

A vision-plus-pain combination. The scenery pass (city skyline of 10-36 floor buildings behind everything, plaza and side streets at the lot edges) gave the scene a real scale ruler, and the rooftop crane failed it: at 128x76 world px the crane stands 1.7 floors tall, where a real tower crane rises 4-8 floors above the roof it builds. The owner reports it, players feel it, and the design party (UX, game design, dev, player advocate, 1994-purist) ratified it unanimously: the crane must hold its own against the city without breaking the ruler that exposed it. The crane is a Verticopolis flourish (1994 SimTower had none), so its size answers to composition and physical plausibility, not canon.

## Capabilities

- **CAP-1**
  - **intent:** A player viewing the whole tower at fit zoom beside the skyline reads the crane as construction machinery crowning the build, with mast, jib, and counterweight distinguishable.
  - **success:** CRANE_SCALE >= 2.0 on the 76 px base, so the crane stands at least 3.4 world floors tall (unit-pinned in rooftop.test.ts). The regenerated tower-scene visual baselines and docs gallery show the enlarged crane, adopted through the standard pinned-container flows.
- **CAP-2**
  - **intent:** The crane's existing lifecycle and render semantics survive the rescale untouched, and the camera can still frame all of it.
  - **success:** It still perches centered on the widest contiguous built run of the top floor (craneAnchor tests green), still comes down when the tower tops out at GRID.maxFloor and returns if demolished below it, and still rasterizes via a cache:true canvas whose repaint stops under pause and reduced motion. The camera's sky headroom derives from CRANE_H (SKY_HEADROOM_FLOORS in cameraBounds.ts), so the full crane, beacon included, is framable on a 99-floor build (regression-pinned).

## Constraints

- CRANE_SCALE is a single compile-time constant. It never derives from tower height, zoom, or any sim state; the growth-with-tower idea was rejected by the party and stays rejected.
- The 128x76 base raster is scaled, never retuned: drawCrane's hand-authored coordinates stay on the base grid inside one ctx.scale wrap (line widths scale with it, keeping the chunky-pixel look).
- The existing palette stays untouched (the crane's construction-amber steel and gray fixtures; the purist condition is no recolor and no gaudying) and the existing animation set only (trolley, hook, beacon, lit cab). No new flourishes ride along.
- CRANE_W and CRANE_H must stay integers (unit-pinned): a fractional product would truncate the canvas backing store and silently clip the crane's base.
- Visual baselines and the docs gallery regenerate only through the pinned-container flows ([update-baselines] mint and the pr-drift-check commit-on-approval); no host-browser pixels are committed.
- Player-facing change: minor version bump in the same PR.
- Composition gate before merge: at fit zoom on a tall save, the counter-jib must not crowd the sky over the plaza (check a left-leaning top run).
- Implementation lands as one PR reviewed by /gds-code-review in the authoring session.

## Non-goals

- No crane redesign or re-art; the drawing itself is untouched apart from the scale wrap.
- No dynamic or per-mode sizing; Classic and Modern share the one constant.
- No scenery changes: the skyline, plaza, and street layers are not adjusted to fit the crane.
- No canon claim: the crane remains an owner-ratified divergence, and this spec does not alter the 1994-parity scope.

## Success signal

On a 60+ floor save at fit zoom, the crane reads as a machine that could plausibly have built the tower beneath it instead of a rooftop antenna, and the moment it comes down at floor 100 lands bigger than before because there is visibly more of it to lose. Baselines and gallery adopt the new pixels through the standard flows with no other visual drift.

## Assumptions

- The host-browser mockups (k = 1 / 2 / 2.5) are valid for judging proportion even though their pixels are never committable; the pinned container renders the same geometry.

## Decision log

- CRANE_SCALE = 3.0, owner-ratified 2026-07-22. The review surfaced that the engine renders pixelArt (antialiasing off), so a fractional scale bakes anti-aliased softness into the cached raster while integer scales stay pixel-crisp; 3.0 is crisp, stands 5.2 floors (inside the real 4-8 floor crane range), and was validated against a k=3 mockup. 2.5 (soft edges) and 2.0 (modest) were declined.
