# Diagnosis: Pixel 8a rush stutter (2026-07-14)

Owner report: Pixel 8a, fully zoomed out, highest speed, stutters at the
morning and evening rushes. Profiled against the owner's save
`sixseven_8.vctower` (4★, population 5,085, 20,155 units, 24 elevator
shafts, floors -8 to 91, classic mode, v2 sim model).

## Measurements

Headless (Node, dev-class CPU):

- `sim.tick(1)` costs ~7.5ms per sim-minute, FLAT across all 24 hours
  (343-499ms per 60 ticks). Rush hours are not more expensive per minute.
- Hourly substep spike: one tick per hour costs 50-110ms (largest, 108ms,
  at the 07:00 rush): the `onHour` block runs `updatePresence`,
  `updateSatisfaction` (super-linear: per-unit `isFloorServed` /
  `nearestTransportDistance` / noise scans), `attemptMoveIns`,
  `collectTrafficIncome`, `sampleElevatorUtil`, `evaluateStar`, all
  synchronously.
- Crowd is small: people(max) ~170, waiting(max) ~110 at every hour;
  `elevatorCalls` sub-millisecond.

Browser (Chromium, minimum zoom 0.06, speed 3 = 120 min/s, 4x CPU
throttle, splash removed, steady clock, probe = rAF deltas over 30s
windows at 06:00/07:00/12:00/18:00):

- EVERY window: p50 frame ~830-1050ms, p95 ~950-1170ms; 30+ of ~33 frames
  over 250ms. The stutter is not rush-specific under these conditions; the
  render is saturated at all hours.
- `sim.tick` share: 55-112ms TOTAL per 30s window (3-4 calls). The
  remaining ~29.9s is render/engine-frame overhead.
- Scene actors at minimum zoom: 2,409-2,531.

## Mechanism (render-architecture briefing, all file:line verified)

- Floors/lobbies live in ONE TileMap (18,520 of the 20,155 units cost one
  entity). Every OTHER unit is one retained `ex.Actor` whose graphic is a
  PRIVATE `ex.Canvas` baked per unit (`towerReconcile.ts` addRoom). Each
  distinct canvas is a distinct WebGL texture.
- Excalibur 0.32's ImageRenderer batches sprites sharing a texture but
  flushes when distinct textures exceed the GPU texture-slot cap (8-16 on
  mobile). ~1,635 room actors with unique textures = a draw call every
  handful of sprites: the draw-call storm that saturates phone frames at
  full zoom-out.
- People/walkers/cars use SHARED baked graphics and batch well; walkers
  are budget-capped at 400 and rebuilt only on structural revision. But
  `updateMotion` + `reconcileCrowd` reposition every car/train/truck/
  walker/person actor EVERY frame, and all are drawn at all zooms; at
  zoom 0.06 a person is ~1.4 screen px (sub-legible).
- On the hour, the engine's `onHour` spike and the render's full
  `syncScene` reconcile (triggered by the displayed-hour change) land in
  the SAME frame, stacking into the on-the-hour mega-frame the player
  feels as a freeze; at top speed an hour boundary passes every 30 real
  seconds.
- No zoom-based LOD exists anywhere in the render layer (greenfield).
- Compounding: long frames make the catch-up clamp (MAX_CATCHUP_MINUTES=30)
  drop sim debt, so the game also runs far below the promised 120 min/s
  while stuttering.

## Party verdict (Cloud/Link/Samus; Grumbal walk-on)

Three presentation-only stories, in order: S1 zoom-gated crowd/vehicle
cull with hysteresis (CAP-1), S2 shared immutable room bakes keyed by the
existing draw signature (CAP-2), S3 defer the hour-boundary render
reconcile one frame (CAP-3). Engine `onHour` amortization REJECTED as a
rider (determinism/golden-master load-bearing); backlogged pending a
checkpoint-the-inputs design.

## Verification harness

The rush probe (Playwright spec pattern preserved at the session
scratchpad as `rushProbe.spec.ts`): loads the owner save via
`game.saveLoad.importGame`, removes the splash, neutralizes emergencies,
steady clock, `setCamera(mid, 40, MIN_ZOOM)`, speed 3, 4x CDP throttle;
warps the clock to 15 minutes before each target hour; samples rAF deltas
for 30s and reports p50/p95/p99/max, over-50/100/250ms counts, sim-minute
progress, `sim.tick` share, and actor count. Run before/after per story
on `sixseven_8.vctower`.
