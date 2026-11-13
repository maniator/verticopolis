/**
 * Eased pursuit for the drawn position of an elevator car (GH #688,
 * spec-elevator-car-motion). The sim now steps about once per 60 Hz frame
 * (the engine's FrameStepper), so a drawn car no longer has whole-minute ticks
 * to bridge, but its steps still land unevenly across display rates and game
 * speeds. Each car keeps a drawn position that chases the sim position frame
 * by frame: the sim value stays the only truth for WHERE the car is, this
 * shapes HOW the pixels get there. The chase is kept tight, so the drawn car
 * reaches its floor while the sim car stands there and riders step out of a
 * car that is drawn at their floor (a loose chase trailed the sim by more than
 * a floor and swallowed every stop). Ease-in comes from
 * the acceleration cap, ease-out from the gap-proportional desired speed, the
 * two halves of the 1994 original's accel/decel curve. Nothing here reads a
 * clock: callers pass the frame's stepped elapsed seconds, so the screenshot
 * generator's manually stepped TestClock reproduces identical motion.
 */

/** Fastest the drawn car travels, floors per second of render time. Must clear
 *  the on-screen sim rate through speed 1's WHOLE breathing-clock range:
 *  0.8 floors/game-min x 10 game-min/s x pace, and pace reaches ~3.25x through
 *  the night (timePacing.ts), ~26 floors/s. Speeds 2 and 3 outrun any chase by
 *  design and ride {@link SNAP_FLOORS} with carried momentum instead. */
export const CAR_MAX_SPEED = 30;
/** Speed change ceiling, floors/second^2. Two duties: the ease-in ramp, and
 *  tracking the falling desired speed on arrival, which needs
 *  CAR_MAX_SPEED / CAR_TAU (375) plus one-frame Euler lag headroom or the
 *  settle clamps instead of easing, and low enough that a departure still
 *  takes a few frames to reach full speed. */
export const CAR_ACCEL = 440;
/** Pursuit time constant, seconds: desired speed is gap / CAR_TAU (capped), so
 *  a steadily advancing target is trailed by speed x CAR_TAU floors. About
 *  five 60 Hz frames: the morning speed-1 rate (~11 floors/s) trails under a
 *  floor and the night sprint (~26 floors/s) about two, so a car settles onto
 *  a stop within a few frames and never nears the snap threshold. */
export const CAR_TAU = 0.08;
/** A gap wider than this snaps instead of gliding: motion-layer rebuilds,
 *  loaded saves, and fast-forward, where a visible chase would read as lag. */
export const SNAP_FLOORS = 6;
/** Frame-time ceiling, seconds. Sized to Excalibur's own 200ms stall boundary:
 *  the sim advances by the full frame delta up to that clamp, so capping the
 *  chase any lower would let a slow device's sim outrun the pursuit (a 10fps
 *  phone would chase at half speed). Beyond 200ms Excalibur reports 1ms, which
 *  {@link CLAMP_ARTIFACT_S} handles. Pure function of the (stepped) input, so
 *  determinism is unaffected. */
const MAX_STEP_S = 0.2;
/** Excalibur clamps a frame longer than 200ms to 1ms (see TowerEngine.tick).
 *  On a phone that stalls, taking that literally starves the chase into a
 *  freeze-then-snap cycle, so a delta at or under this reads as the clamp
 *  artifact and is treated as one ordinary 60fps frame. */
const CLAMP_ARTIFACT_S = 0.002;

export interface CarDrawState {
  /** Drawn shaft position, floors (the unit `Transport.carPositions` uses). */
  pos: number;
  /** Drawn velocity, floors per second of render time. */
  vel: number;
}

/**
 * Advance one car's drawn position toward the sim position by one frame.
 * Mutates and returns `s`. A sign guard clamps the approach at the target so
 * the car settles exactly on its floor; a target that reverses against the
 * car's momentum brakes at double strength, so the carried excursion stays
 * under two floors (the caller additionally clamps to the shaft span).
 */
export function stepCarPursuit(s: CarDrawState, target: number, dtSeconds: number): CarDrawState {
  if (!Number.isFinite(target)) return s;
  if (!Number.isFinite(s.vel)) s.vel = 0;
  const raw = Number.isFinite(dtSeconds) ? Math.max(dtSeconds, 0) : 0;
  const dt = Math.min(raw > 0 && raw <= CLAMP_ARTIFACT_S ? 1 / 60 : raw, MAX_STEP_S);
  const gap = target - s.pos;
  if (!Number.isFinite(gap) || Math.abs(gap) > SNAP_FLOORS) {
    // Snap. A car that was already chasing flat-out keeps its momentum so
    // sustained fast-forward reads as fast motion with skips, not a
    // freeze-ramp-jump cycle; any other discontinuity lands parked.
    const chasing = Number.isFinite(gap) && Math.sign(s.vel) === Math.sign(gap) && Math.abs(s.vel) >= CAR_MAX_SPEED / 2;
    s.pos = target;
    s.vel = chasing ? Math.sign(gap) * CAR_MAX_SPEED : 0;
    return s;
  }
  // Inside a millifloor (~0.04px) the chase has landed: settle exactly so a
  // parked car reads (and computes) as parked instead of decaying forever.
  if (Math.abs(gap) < 1e-3) {
    s.pos = target;
    s.vel = 0;
    return s;
  }
  const desired = Math.sign(gap) * Math.min(Math.abs(gap) / CAR_TAU, CAR_MAX_SPEED);
  const dv = desired - s.vel;
  // Brake twice as hard when momentum opposes the target (a reversed call),
  // which bounds the drift past the turn-around point.
  const braking = s.vel !== 0 && Math.sign(s.vel) !== Math.sign(gap);
  const maxDv = (braking ? 2 * CAR_ACCEL : CAR_ACCEL) * dt;
  s.vel += Math.abs(dv) <= maxDv ? dv : Math.sign(dv) * maxDv;
  const next = s.pos + s.vel * dt;
  // Crossing the target while approaching means arrival: land on it and stop.
  if ((target - next) * gap <= 0 && !braking) {
    s.pos = target;
    s.vel = 0;
  } else {
    s.pos = next;
  }
  return s;
}
