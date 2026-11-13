/**
 * The drawn position of an elevator car (GH #688, #2097). The engine moves a
 * car once per sim step, and at the slow speeds a step is a whole game minute
 * of travel that lands a few times a second, or once every second or two in
 * the lunch slowdown. A car that chased each new position and then waited
 * for the next one stopped between floors. So the drawn car glides from where
 * it is drawn to the engine's new position over one step's length, on the
 * same step clock as the people (`crowdLook.ts`): it moves the whole time the
 * engine says it moves, and it reaches a floor when the people waiting there
 * see it arrive. The engine's value stays the only truth for WHERE the car is;
 * this only shapes how the pixels get there. Nothing here reads a clock, so
 * the screenshot generator's stepped TestClock reproduces identical motion.
 */

/** A gap wider than this snaps instead of gliding: motion-layer rebuilds,
 *  loaded saves, and the top speed through the night, where a car can cross
 *  more floors in one step than a glide could show. */
export const SNAP_FLOORS = 6;

export interface CarDrawState {
  /** Drawn shaft position, floors (the unit `Transport.carPositions` uses). */
  pos: number;
  /** Where this step's glide started. */
  from: number;
  /** The engine's position the glide is heading for. */
  to: number;
}

export function newCarDraw(pos: number): CarDrawState {
  return { pos, from: pos, to: pos };
}

/**
 * Move one car's drawn position on by a frame: on a step (or a new engine
 * position) start from where the car is drawn toward the engine's position,
 * or jump there when the gap is too far to glide; then draw it `progress`
 * (0 to 1) of the way. Mutates and returns `s`.
 */
export function glideCar(s: CarDrawState, target: number, stepped: boolean, progress: number): CarDrawState {
  if (!Number.isFinite(target)) return s;
  if (!Number.isFinite(s.pos)) s.pos = target;
  if (stepped || target !== s.to) {
    s.from = Math.abs(target - s.pos) > SNAP_FLOORS ? target : s.pos;
    s.to = target;
  }
  const t = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 1));
  s.pos = t >= 1 ? s.to : s.from + (s.to - s.from) * t;
  return s;
}
