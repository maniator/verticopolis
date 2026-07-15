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

## CAP-2 census and correction (2026-07-15)

Before implementing S2, a pixel-hash census (rasterize every room actor's
canvas on the owner's save, hash the bitmaps) tested CAP-2's premise that
same-looking rooms are common. It falsified it:

- Day (hour 10, unlit): 1,635 room actors -> 738 unique bitmaps. Per kind
  (unique/actors): office 120/557, condo 357/431, hotelSingle 104/164,
  hotelDouble 79/107, hotelSuite 47/74, parking 8/244, housekeeping 1/18.
- Night (hour 20, lit): 1,302 unique. office 555/557, condo 431/431,
  hotelSuite 74/74. The lit-only `windowView` sparkle (geoVariant axis
  n=997) gives nearly every office/condo/hotel window its own pattern of
  distant city lights, exactly at the evening rush the owner reported.

The cause is the party-ratified variety law working as designed
(geometry-seeded per-room looks, "your mauve corner office on 40 stays
mauve"), not waste. Signature-keyed shared bakes therefore top out at
738/1,302 distinct textures against 8-16 GPU slots per batch: the
draw-call storm survives. The reconvened party (unanimous) replaced the
mechanism with REGION COMPOSITION: rooms draw into a fixed world-space
region grid (one cached canvas per region, clipped per-unit draws at
integer offsets, the transport-band precedent), which makes the texture
count small by construction (~40 regions) while leaving every pixel and
the variety law untouched. Alternatives rejected: dynamic texture atlas
(a rendering-engine feature built against Excalibur's grain, full-page
re-uploads on churn) and bucketing the night sparkle (changes pixels,
breaks the variety law, and still leaves 738 day textures). The 17:00 lit
flip makes bounded drain load-bearing: naive full-region repaint is ~40
uploads (~50MB) in one frame, worse than the status quo, so dirty regions
drain through a budgeted visible-first queue. Details and story recut in
SPEC.md.

## Verification harness

The rush probe (Playwright spec pattern preserved at the session
scratchpad as `rushProbe.spec.ts`): loads the owner save via
`game.saveLoad.importGame`, removes the splash, neutralizes emergencies,
steady clock, `setCamera(mid, 40, MIN_ZOOM)`, speed 3, 4x CDP throttle;
warps the clock to 15 minutes before each target hour; samples rAF deltas
for 30s and reports p50/p95/p99/max, over-50/100/250ms counts, sim-minute
progress, `sim.tick` share, and actor count. Run before/after per story
on `sixseven_8.vctower`.
