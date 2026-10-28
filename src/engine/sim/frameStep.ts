import { paceFactor } from "../timePacing";
import { drainFixedSteps, syncStepMode, type StepDebt } from "./fixedStep";

/**
 * The host half of the fixed time step (`fixedStep.ts`): what a frame owes,
 * capped, then drained. The web frame loop calls it each frame, and the
 * TypeScript engine's port runs it for `advance`, so either engine steps a
 * frame the same way (`engine-rs/src/fixed_step.rs`, `FrameStepper`).
 */

/** Hard cap on owed-but-unsimulated minutes carried between frames. At the
 *  fastest speed (120 min/s) a device that can't simulate that fast in real
 *  time accrues debt every frame; without a cap each frame does more work than
 *  the last until frames run seconds long (see the clamp in runFrame). 30
 *  minutes is 15 ideal frames of fastest-speed debt (2 sim-minutes per 60fps
 *  frame), generous headroom for hitches. The engine's step budget
 *  (`MAX_STEPS_PER_FRAME` in engine/sim/fixedStep) bounds the work in one
 *  frame; this cap bounds the debt carried between frames, so it is where a
 *  device that cannot keep up drops time and falls behind. */
export const MAX_CATCHUP_MINUTES = 30;

/** One frame's worth of simulation: add the minutes a frame of `dtMs` owes at
 *  `minutesPerSecond` under the pacing curve (or the steady clock), carried in
 *  `host.accMinutes`, and drain them through the engine's fixed step. This is
 *  the whole of how the web host advances the engine, kept apart so the dual
 *  run's day gate drives the engine through the same code.
 *
 *  Minutes owed under one speed or pacing mode must not replay under another
 *  (the engine sizes its step from both), so the engine drops the carry when
 *  either changes, before this frame's minutes are added. A non-finite dtMs
 *  (a NaN/Infinity timestamp delta from a hung or restored frame source)
 *  would poison accMinutes to NaN, and NaN fails every comparison, so the sim
 *  would stop ticking FOREVER with no recovery: reset to 0 and skip this
 *  frame's catch-up; the next finite frame resumes. The catch-up debt is
 *  capped: owed minutes grow with real frame time, so on a device that can't
 *  simulate the fastest speed in real time every frame would carry ever more
 *  sim work, stretching frames toward seconds of sustained CPU+GPU load, the
 *  profile under which Android reclaims the WebGL context (the Pixel 8a
 *  "random crash"). Dropping the excess trades clock accuracy for survival:
 *  the game visibly runs slower than the speed button promises on hardware
 *  that can't keep up, and a tab restored from the background resumes with a
 *  bounded catch-up instead of replaying the whole absence. The engine cuts
 *  the owed minutes into quanta sized from its own clock, so the tower comes
 *  out the same at any frame rate; what it leaves owed carries to the next
 *  frame (at speed 0 it is nothing, so a pause never spends carried time).
 *  The write-back sits in `finally` so a step that throws (the frame-error
 *  guard catches it) never re-owes the steps that already ran. */
export function advanceOwedMinutes(host: { sim: { tick(dtMinutes: number): void; clock: { minuteOfDay: number } }; accMinutes: number }, debt: StepDebt, dtMs: number, minutesPerSecond: number, steadyClock: boolean, step = true): void {
  debt.minutes = host.accMinutes;
  syncStepMode(debt, minutesPerSecond, steadyClock);
  host.accMinutes = debt.minutes;
  const pace = steadyClock ? 1 : paceFactor(host.sim.clock.minuteOfDay);
  host.accMinutes += (dtMs / 1000) * minutesPerSecond * pace;
  if (!Number.isFinite(host.accMinutes)) host.accMinutes = 0;
  if (host.accMinutes > MAX_CATCHUP_MINUTES) host.accMinutes = MAX_CATCHUP_MINUTES;
  debt.minutes = host.accMinutes;
  // A host still busy with its last batch (the experimental worker host,
  // see wasmhost/stepGate) owes this frame's minutes under the same cap and
  // steps them on a later frame.
  if (!step) return;
  try {
    drainFixedSteps(host.sim, debt, minutesPerSecond, { steadyClock });
  } finally {
    host.accMinutes = debt.minutes;
  }
}
