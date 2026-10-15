/**
 * The cinema's two looping pictures (`drawCinema` in
 * `pixelSprites/food.interiors.ts`), the one room art that reads the animation
 * clock: the marquee bulbs swap colors 4 times a second, and the screen steps
 * through its 5 frames 2.5 times a second (`floor(clock * 4)` and
 * `floor(clock * 2.5 + seed) % 5`), so together they repeat every 2 seconds.
 * The atlas bakes each room at clock 0 and each cycle's other pictures as
 * layers over it; at clock `t` a frontend draws step `floor(t * rate) % len`
 * of each.
 */

export interface CycleSpec {
  /** Pictures a second. */
  rate: number;
  /** Pictures in one loop. */
  frames: number;
}

export const CINEMA_CYCLES: Readonly<Record<string, CycleSpec>> = {
  marquee: { rate: 4, frames: 2 },
  screen: { rate: 2.5, frames: 5 },
};

/** The step of `cycle` at `clock` seconds; a negative or non-finite clock
 *  reads as 0. */
export function cycleStep(cycle: CycleSpec, clock: number): number {
  const t = Number.isFinite(clock) ? Math.max(0, clock) : 0;
  return Math.floor(t * cycle.rate) % cycle.frames;
}

/** Every cycle's step at `clock`. */
export function cycleSteps(cycles: Readonly<Record<string, CycleSpec>>, clock: number): Record<string, number> {
  return Object.fromEntries(Object.entries(cycles).map(([k, c]) => [k, cycleStep(c, clock)]));
}

/** How often the clock is sampled when looking for a moment: every 1/20 s,
 *  at the middle of each slice, so a sample never sits on a step boundary
 *  (every boundary of both cinema cycles falls on a multiple of 1/20 s). */
const SAMPLES_PER_SECOND = 20;

/** A clock that shows each cycle at the step `want` names (cycles it does not
 *  name at step 0), or null when no moment in the first `seconds` does. */
export function clockFor(cycles: Readonly<Record<string, CycleSpec>>, want: Readonly<Record<string, number>>, seconds = 2): number | null {
  for (let i = 0; i < seconds * SAMPLES_PER_SECOND; i++) {
    const clock = (i + 0.5) / SAMPLES_PER_SECOND;
    if (Object.entries(cycles).every(([k, c]) => cycleStep(c, clock) === (want[k] ?? 0))) return clock;
  }
  return null;
}
