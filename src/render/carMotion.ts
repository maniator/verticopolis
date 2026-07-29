/**
 * Eased pursuit for the drawn position of an elevator car (GH #688,
 * spec-elevator-car-motion). The sim moves `carPositions` in whole-game-minute
 * ticks (a few per second at normal speed), while the renderer draws every
 * frame, so drawing the sim value raw freezes a moving car between ticks and
 * jumps it on each one. Each car instead keeps a drawn position that chases
 * the sim position frame by frame: the sim value stays the only truth for
 * WHERE the car is, this shapes HOW the pixels get there. Ease-in comes from
 * the acceleration cap, ease-out from the gap-proportional desired speed, the
 * two halves of the 1994 original's accel/decel curve. Nothing here reads a
 * clock: callers pass the frame's stepped elapsed seconds, so the screenshot
 * generator's manually stepped TestClock reproduces identical motion.
 */

/** Fastest the drawn car travels, floors per second of render time. Sized
 *  above the on-screen sim rate through speed 1's whole breathing-clock range
 *  (0.8 floors/game-min x 10 game-min/s x pace) so a normal-speed shaft is
 *  never outrun for long; fast-forward outruns any chase by design and lands
 *  on {@link SNAP_FLOORS} instead. */
export const CAR_MAX_SPEED = 20;
/** Speed change ceiling, floors/second^2. Also the decel tracker: it must stay
 *  above CAR_MAX_SPEED / CAR_TAU (the fastest the desired speed can fall while
 *  arriving) or the settle clamps instead of easing. 80 > 20 / 0.28. */
export const CAR_ACCEL = 80;
/** Pursuit time constant, seconds: desired speed is gap / CAR_TAU (capped), so
 *  a steadily advancing target is followed at its own speed with a short,
 *  constant trail, and a stopped target is settled onto exponentially. */
export const CAR_TAU = 0.28;
/** A gap wider than this snaps instead of gliding: motion-layer rebuilds,
 *  loaded saves, and fast-forward, where a visible chase would read as lag. */
export const SNAP_FLOORS = 6;
/** Frame-time ceiling, seconds: a stalled real frame advances the pursuit by
 *  at most this much, so a hitch cannot fling a car. Pure function of the
 *  (stepped) input, so determinism is unaffected. */
const MAX_STEP_S = 0.05;

export interface CarDrawState {
  /** Drawn shaft position, floors (the unit `Transport.carPositions` uses). */
  pos: number;
  /** Drawn velocity, floors per second of render time. */
  vel: number;
}

/**
 * Advance one car's drawn position toward the sim position by one frame.
 * Mutates and returns `s`. A sign guard clamps the step at the target so the
 * car settles exactly on its floor and never bounces past it.
 */
export function stepCarPursuit(s: CarDrawState, target: number, dtSeconds: number): CarDrawState {
  if (!Number.isFinite(target)) return s;
  const dt = Number.isFinite(dtSeconds) ? Math.min(Math.max(dtSeconds, 0), MAX_STEP_S) : 0;
  const gap = target - s.pos;
  if (!Number.isFinite(gap) || Math.abs(gap) > SNAP_FLOORS) {
    s.pos = target;
    s.vel = 0;
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
  const maxDv = CAR_ACCEL * dt;
  s.vel += Math.abs(dv) <= maxDv ? dv : Math.sign(dv) * maxDv;
  const next = s.pos + s.vel * dt;
  // Crossing the target this frame means arrival: land on it and stop.
  if ((target - next) * gap <= 0) {
    s.pos = target;
    s.vel = 0;
  } else {
    s.pos = next;
  }
  return s;
}
