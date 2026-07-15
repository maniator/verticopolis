# Region composition: synthesized design (party ruling 2026-07-15)

The engineering contract for CAP-2's region mechanism, distilled from the
reconvened party (dev + architect verdicts, designer conditions). SPEC.md
holds the intent and constraints; this holds the shape the implementer
builds against.

## Shape

- A fixed world-space region grid anchored to `GRID` (the `structTileMap`
  precedent). Region dimensions `REGION_TILES` x `REGION_FLOORS` live in a
  pure module (no Excalibur import) beside `scale.ts`, with a unit test
  pinning both pixel sides <= 2048 (the `TRANSPORT_BAND_FLOORS` precedent).
  Candidate sizes 64x16 (704x704 px) and 32x20 (352x880 px); the upload
  micro-bench decides.
- One `ex.Actor` (anchor 0,0, z 0, no collider) plus one cached `ex.Canvas`
  per region that contains at least one settled room. Lazy-created, evicted
  when its member set empties, otherwise repainted in place via `flagDirty`
  forever (the RoomRec repaint-in-place law promoted one level).
- The region draw closure iterates member unit ids, resolves each unit live
  from `engine.sim.tower`, and calls `drawUnit` at integer world offsets
  (multiples of TILE/FLOOR) with a per-unit `ctx.save/clip/restore` on the
  unit rect. The clip is mandatory, not defensive: private canvases clipped
  overdraw implicitly, regions do not. Units spanning a region boundary are
  drawn whole by every intersecting region; out-of-bounds pixels clip and
  the union equals the unclipped draw (the `transportGraphic` band
  argument).
- Animated rooms (fire, construction) keep today's private cache:false
  actor path at z 0.5 (deterministically over the region, under transports
  at z 1); their region leaves their footprint unpainted, so no double
  draw and no baked ghost under the flames.
- The dead-parking flag moves from the per-actor `live` holder to a set
  refreshed from the single `functionalParkingSet()` read per sync; the
  dead bit stays in the signature.

## Invariants (the review skill hunts violations of these)

- **I1 Region identity is permanent:** materialized region actors/canvases
  are never reallocated, only repainted, until empty or scene disposal.
  Steady-state GPU allocation stays zero.
- **I2 No full-tower rasterization in any single frame:** dirty regions
  drain through a budgeted queue (small named count per frame, visible
  first). Exceptions: animated-state transitions repaint their region the
  same frame (no fire ghost), and initial load may drain fully before the
  first presented frame.
- **I3 Repaints read live state at drain time** (no captured snapshots):
  dirty marks coalesce for free, and a cleared-on-dispose queue can never
  paint stale-tower pixels.
- **I4 Queue-empty means region content equals f(current unit states)**,
  reached within dirtyCount/budget frames. The visual-baseline harness
  steps frames until queue-empty, then captures.

## Reconcile and lifecycle wiring

- `syncScene` keeps its signature string and loop shape; the
  repaint-vs-rebuild branch becomes "mark the unit's region(s) dirty",
  membership updates ride the same loop, and reap diffs membership. The
  meal-overlay trigger (`mealOverlayRevision`, `outForMeal` in the sig) is
  unchanged: a lunch dip dirties one region.
- Settled -> animated removes the unit from its regions (same-frame
  repaint) and creates the private actor; the reverse kills the actor and
  re-adds (same-frame repaint back).
- `disposeScene` kills region actors and clears regions, membership, the
  dirty queue, and the dead-parking set; `setSim`'s forced full sync then
  rebuilds from the new tower. Nothing may enqueue between dispose and the
  first sync.
- Picking: `pickEntityAt` drops the roomActors scan; after the
  transport-actor scan misses, `worldToCell` + `tower.unitAt` resolves any
  unit. Verified safe: `Tower.register` footprint-indexes every story of a
  multi-floor unit, so upper floors of a cinema/metro resolve. Lands as
  its own PR before the region story.

## Seams (500-line ceiling)

- New `src/render/regionGrid.ts` (pure: constants, footprint -> region
  keys, region rects, pinned 2048 test).
- New `src/render/excalibur/towerRegions.ts` (RegionRec, membership, dirty
  queue + budgeted drain, materialize/evict, dispose). Friend-module
  idiom.
- `towerReconcile.ts` shrinks (addRoom narrows to animated-only);
  `TowerEngine.ts` swaps roomActors/roomSig for a regions handle +
  animatedRooms map + one drain call in tick(); `towerInputCamera.ts` and
  `towerScene.ts` get the small edits above. TowerEngine sits at exactly
  500 lines: the swap must be net non-positive there or the planned seam
  split happens first.

## Cost model (owner's save, floors -8..91)

~40 live regions worst case. Min zoom: ~40 region textures + shaft bands +
TileMap + ground, roughly 7-15 batch flushes versus 100+ today, and ~900
actors versus ~2,500. Memory: ~2.5x today's room-canvas pixel footprint
(transparent slack is the price of fixed geometry) in exchange for zero
steady-state churn; escape hatch is halving region height. The 17:00 lit
flip dirties every live region: budget 2/frame => ~2.5MB upload + ~600K px
raster per frame, settled within ~20 frames (~0.7% of a top-speed hour);
at min zoom a region is ~21x53 screen px so the ripple is sub-legible by
the CROWD_CULL_ZOOM argument.

## Open items priced by the pre-region gates

- Byte-identity of integer-offset composition under Excalibur's pixel-art
  sampling: the one-region spike in the pinned container falsifies cheaply.
- Real texture-upload bandwidth under 4x throttle on phone-class hardware:
  the micro-bench sizes the region constants and the drain budget.
- Blame split between texture flushes and raw actor count: the two-probe
  experiment (all rooms one shared bake vs all room actors hidden) runs
  before the story so the region size math targets the real cost.
