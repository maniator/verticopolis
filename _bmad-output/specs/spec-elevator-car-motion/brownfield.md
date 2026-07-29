# Brownfield anchors: where this change lands

Code facts the implementation builds on, verified 2026-07-28 on main at 2.1.1.

## The stutter path

- `src/game/frameLoop.ts` accumulates game-minutes and steps the sim only while `app.accMinutes >= 1`, in chunks up to 20 minutes. At normal pace that is a sim tick every ~250-500ms; the breathing clock (`minutesPerSecond`) stretches the interval further through the midday crush.
- `src/render/excalibur/towerCrowd.ts` `updateMotion()` runs on the engine's per-frame update and assigns each car actor's position directly from sim state: `c.actor.pos = ex.vec(engine.worldX(c.t.x), -c.t.carPositions[c.i] * FLOOR)`. No state is kept between frames.
- Car actors are created in `syncMotion()` with `{ actor, t, i, seed, w, kind, gfx, shown }` entries on `engine.carActors`. `syncMotion` is a full rebuild (`clearMotion` first), so any per-car draw state dies and respawns there; a rebuild is a natural snap point (CAP-3).

## The constant-speed fact

- `src/engine/ElevatorDispatch.ts` moves cars by `carDt * CAR_FLOORS_PER_MINUTE` (line ~185), a constant velocity in floors per game-minute, and dwells consume `carDt` before travel. There is no acceleration model in the sim, and this spec deliberately leaves it that way.

## The deterministic clock

- `src/render/excalibur/TowerEngine.ts` (~line 347): the engine `onPostUpdate`-side path receives `elapsedMs`, adds it to `animClock` only while `animating`, publishes `d.anim`, then calls `updateMotion()`. The interpolation must consume `elapsedMs` (or an ungated accumulation of it), NOT `d.anim`: `d.anim` freezes when decoration animation is off, and car motion is functional.
- The screenshot harness (`scripts/screenshot-page-ops.ts`, `pgStep` / `pgStepNoDraw`) steps the Excalibur TestClock in whole frames; `elapsedMs` under it is exactly the stepped frame time, which keeps eased pursuit reproducible. `pgStepNoDraw` documents a draw-position sync that keeps the final frame byte-identical when intermediate draws are skipped; whatever per-car state the interpolation keeps must stay consistent under that path (state advances per update, not per draw).

## Indicators

- `carIndicator(dir, load, cap)` in `src/render/carIndicator.ts` derives the cab graphic key from live sim state; the graphic cache (`carGfx`) is keyed on that state. Untouched by this spec.

## Suggested shape (implementation hint, not contract)

- Add `drawnPos` (float floors) and `drawnVel` (floors/sec of real render time) to the `carActors` entry; initialize `drawnPos` to the sim position in `syncMotion`.
- Each `updateMotion` frame: pursue `target = t.carPositions[i]` with arrive-style steering: accelerate `drawnVel` toward the target up to a cap, and brake so the car can stop exactly at the target (`v <= sqrt(2 * a * distance)`), which produces the ramp-up / cruise / settle profile with no overshoot. Snap when `|target - drawnPos|` exceeds a few floors (rebuilds, loads, teleports).
- Tuning starting points: max speed comfortably above the fastest on-screen sim speed at 3x pace so the drawn car never falls behind for long; acceleration chosen so a one-floor hop still reads as ease-out rather than a snap. Pin the numbers in tests loosely (shape, not exact values) so feel tuning does not churn tests.
