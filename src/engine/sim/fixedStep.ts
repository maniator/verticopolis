import { paceFactor } from "../timePacing";

/**
 * The engine-owned fixed time step. A host (the web frame loop today, any other
 * frontend later) owes the sim some game minutes each frame; it hands them here
 * with the speed's nominal rate, and the engine decides how they are cut.
 *
 * Before this, the web host stepped `Math.min(20, accMinutes)` with a
 * fractional, frame-rate-derived `accMinutes`. The crowd spawns and the
 * elevator demand accumulates once per step, so a different step sequence gave
 * a measurably different tower (same save, three game days: money and
 * population diverged between 30, 60 and 144 Hz).
 *
 * The guarantee: every step's size is a pure function of the player's speed
 * and steady-clock choices and the sim's own clock, never of frame timing. So
 * for the same choices the sim runs the same sequence of `tick` calls at any
 * frame rate, and a slower host simply runs fewer of them (it falls behind
 * instead of stepping differently). The choices are inputs, like a build
 * command: changing speed or the steady clock changes the step size from that
 * point on. Player commands still land between frames, so a session with input
 * is reproducible only when its commands are replayed at the same sim minutes.
 */

/** The frame rate the quantum is sized for: about one step per frame here. */
export const REFERENCE_HZ = 60;

/** At most this many steps run in one frame. The quantum never exceeds what a
 *  reference frame owes, so a 60 Hz host that owes a minute or more a frame
 *  runs one or two steps every frame (at lower rates, one every few frames). A
 *  host too slow to cover its owed minutes in this many steps (the threshold
 *  depends on speed and hour; see story-engine-fixed-time-step.md) carries the
 *  rest as debt, and once the host's own catch-up cap drops that debt the game
 *  runs slower than the requested speed. The trade: such a device now runs up
 *  to this many small steps a frame where it used to run one or two coarse
 *  ones, which is the price of the same tower at every frame rate. */
export const MAX_STEPS_PER_FRAME = 4;

/** The largest step, in game minutes: the old host loop's chunk size, and below
 *  the host's 30-minute catch-up cap so a capped debt can always cover one
 *  step (a step larger than the cap could never be owed in full, and the sim
 *  would stall). Today's fastest pace needs 6. */
export const MAX_QUANTUM_MINUTES = 20;

/** Float dust tolerated when deciding a whole quantum is owed. Far below any
 *  real frame's contribution (a 144 Hz frame at 10 min/s owes about 0.07). */
export const OWED_EPSILON = 1e-6;

/** Minutes the host still owes the sim, carried between frames, and the step
 *  mode (speed and pacing) they were owed under. The host keeps one per sim
 *  session and passes it back every frame. */
export interface StepDebt {
  minutes: number;
  mode?: string;
}

export interface StepOptions {
  /** The player's steady-clock preference: true feeds time at a flat rate, so
   *  the step is sized from pace 1 instead of the canon curve. */
  steadyClock?: boolean;
  /** Per-frame step budget; defaults to {@link MAX_STEPS_PER_FRAME}. */
  maxSteps?: number;
}

/**
 * The step size, in whole game minutes, for a host at `minutesPerSecond` when
 * the sim clock reads `minuteOfDay`: the minutes a reference frame owes,
 * rounded down and never under one. Rounding down keeps the step within one
 * frame's owed minutes, so a host at the reference rate steps every frame
 * rather than banking a frame and stepping the next. A port must match the
 * rounding and {@link paceFactor}'s values. Through the canon pacing curve the
 * night sprint takes bigger steps and the lunch crawl one-minute ones; with
 * the steady clock the pace is flat.
 */
export function quantumFor(minutesPerSecond: number, minuteOfDay: number, steadyClock = false): number {
  const pace = steadyClock ? 1 : paceFactor(minuteOfDay);
  const perFrame = (minutesPerSecond * pace) / REFERENCE_HZ;
  if (!Number.isFinite(perFrame) || perFrame < 1) return 1;
  return Math.min(MAX_QUANTUM_MINUTES, Math.floor(perFrame));
}

/**
 * Record the step mode (speed and pacing) the host is about to owe minutes
 * under, dropping any minutes owed under a different one so banked time never
 * replays under another step size. A host calls this before adding a frame's
 * owed minutes; {@link drainFixedSteps} calls it too, so a host that forgets
 * still never replays stale time (it just loses that frame's minutes too).
 */
export function syncStepMode(debt: StepDebt, minutesPerSecond: number, steadyClock: boolean): void {
  const mode = `${minutesPerSecond}|${steadyClock}`;
  if (debt.mode !== undefined && debt.mode !== mode) debt.minutes = 0;
  debt.mode = mode;
}

/**
 * Advance `sim` by whole quanta out of `debt.minutes` (at most the step
 * budget), each sized by {@link quantumFor} from the sim clock at that step.
 * Minutes owed under a different speed or pacing mode than this call's are
 * dropped first (see {@link syncStepMode}).
 * Whatever is not stepped stays in `debt.minutes` for the next frame; bounding
 * that debt (and so deciding when a slow host falls behind) is the host's
 * catch-up cap, applied to the raw owed minutes before this call. The debt is
 * reduced after every completed step, so if a step throws, the steps that
 * already ran are not owed again. A non-finite or negative owed amount, or a
 * non-positive or non-finite rate, steps nothing and owes nothing, which is how
 * a pause clears the carry. The one negative kept is the dust a tolerated step
 * overdrew (at most {@link OWED_EPSILON}), paid back from the next frame.
 */
export function drainFixedSteps(
  sim: { tick(dtMinutes: number): void; clock: { minuteOfDay: number } },
  debt: StepDebt,
  minutesPerSecond: number,
  options: StepOptions = {},
): void {
  const steady = options.steadyClock ?? false;
  const requested = options.maxSteps ?? MAX_STEPS_PER_FRAME;
  const maxSteps = Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : MAX_STEPS_PER_FRAME;
  syncStepMode(debt, minutesPerSecond, steady);
  const owedOk = debt.minutes >= -OWED_EPSILON && Number.isFinite(debt.minutes);
  const rateOk = minutesPerSecond > 0 && Number.isFinite(minutesPerSecond);
  if (!owedOk || !rateOk) {
    debt.minutes = 0;
    return;
  }
  let q = quantumFor(minutesPerSecond, sim.clock.minuteOfDay, steady);
  // Owed minutes are summed from fractional frame times, so a whole quantum can
  // arrive as 1.9999999999. Without the tolerance that step slips a frame on
  // one machine and not another; with it, the step runs. The shortfall it
  // forgave stays owed (a debt a hair below 0, floored at the tolerance so float
  // rounding cannot push it past the line `owedOk` accepts) and the next frame
  // pays it back. Within one speed and pacing mode, the total stepped then never
  // runs ahead of the total owed by more than the tolerance however the minutes
  // were chunked. Clamping it to 0 instead would
  // let two near-quantum frames step twice where the same minutes owed in one
  // frame step once.
  for (let steps = 0; debt.minutes >= q - OWED_EPSILON && steps < maxSteps; steps++) {
    sim.tick(q);
    debt.minutes = Math.max(-OWED_EPSILON, debt.minutes - q);
    q = quantumFor(minutesPerSecond, sim.clock.minuteOfDay, steady);
  }
}
