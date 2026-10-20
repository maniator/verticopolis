import { advanceOwedMinutes } from "../../game/frameLoop";
import type { StepDebt } from "../../engine/sim/fixedStep";

/**
 * Frame sequences for the engine-owned fixed step, and what the TypeScript
 * host loop does with them. The Rust step driver (`engine-rs/src/fixed_step.rs`)
 * replays the same sequences from `engine-rs/tests/data/fixed-step-cases.json` and must
 * produce the same ticks and the same carried debt, bit for bit.
 *
 * A frame is `[dtMs, minutesPerSecond, steadyClock, step]` (the flags as 0 or
 * 1); its output is `[owedMinutesAfter, ...tickSizes]`. The driven sim is a
 * bare clock that moves by each tick, so the cases pin the step math and not
 * the tower.
 */

export type Frame = [dtMs: number, minutesPerSecond: number, steadyClock: 0 | 1, step: 0 | 1];
export interface FixedStepCase {
  id: string;
  description: string;
  startMinute: number;
  frames: Frame[];
  out: number[][];
}

/** A small deterministic generator (the same one the step's unit tests use). */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s;
  };
}

const at = (n: number, dtMs: number, mps: number, steady: 0 | 1 = 0, step: 0 | 1 = 1): Frame[] => Array.from({ length: n }, () => [dtMs, mps, steady, step]);
const cycle = (n: number, dts: number[], mps: number, steady: 0 | 1 = 0): Frame[] => Array.from({ length: n }, (_, i) => [dts[i % dts.length], mps, steady, 1]);
const jitter = (n: number, seed: number, mps: number): Frame[] => {
  const next = lcg(seed);
  return Array.from({ length: n }, () => [8 + (next() % 34), mps, 0, 1] as Frame);
};

export const FRAME_SEQUENCES: Omit<FixedStepCase, "out">[] = [
  { id: "day-fastest-60hz", description: "A game day at the fastest speed, steady 60 Hz frames, from midnight.", startMinute: 0, frames: at(720, 1000 / 60, 120) },
  { id: "day-fastest-mixed-frames", description: "The dual run's frame-time cycle (60, 30 and 120 Hz frames, a 400 ms and a 3 s stall) at the fastest speed.", startMinute: 420, frames: cycle(400, [1000 / 60, 1000 / 60, 1000 / 30, 1000 / 120, 1000 / 60, 400, 1000 / 60, 1000 / 60, 3000, 1000 / 60], 120) },
  { id: "steady-clock-144hz", description: "The steady clock at 144 Hz and the fastest speed.", startMinute: 0, frames: at(500, 1000 / 144, 120, 1) },
  { id: "normal-speed-30hz-lunch", description: "Normal speed at 30 Hz through the lunch crawl.", startMinute: 700, frames: at(600, 1000 / 30, 30) },
  { id: "slow-speed-jitter", description: "The slowest speed with jittery 8 to 41 ms frames.", startMinute: 720, frames: jitter(500, 7, 10) },
  {
    id: "speed-changes-and-pause",
    description: "Speed 10, then 120, then paused, then 30 with the steady clock, then 120 again: minutes owed under another mode are dropped, a pause owes nothing.",
    startMinute: 400,
    frames: [...at(150, 1000 / 60, 10), ...at(150, 1000 / 60, 120), ...at(60, 1000 / 60, 0), ...at(150, 1000 / 60, 30, 1), ...at(150, 1000 / 60, 120)],
  },
  {
    id: "busy-host-owes-then-steps",
    description: "A host still busy with its last batch owes frames without stepping them (the carry hits the 30-minute cap), then steps.",
    startMinute: 1000,
    frames: [...at(40, 1000 / 60, 120, 0, 0), ...at(200, 1000 / 60, 120)],
  },
  { id: "stalls-hit-the-catchup-cap", description: "Long stalls at the fastest speed, each capped at 30 owed minutes.", startMinute: 60, frames: cycle(300, [1000 / 60, 250, 1000 / 60, 3000, 1000 / 60, 16000], 120) },
];

/** What the TypeScript host loop does with one sequence. */
export function runSequence(startMinute: number, frames: Frame[]): number[][] {
  const calls: number[] = [];
  const clock = { minuteOfDay: startMinute };
  const sim = { clock, tick: (dt: number) => { calls.push(dt); clock.minuteOfDay = (clock.minuteOfDay + dt) % 1440; } };
  const host = { sim, accMinutes: 0 };
  const debt: StepDebt = { minutes: 0 };
  return frames.map(([dtMs, mps, steady, step]) => {
    calls.length = 0;
    advanceOwedMinutes(host, debt, dtMs, mps, steady === 1, step === 1);
    return [host.accMinutes, ...calls];
  });
}

export function buildCases(): FixedStepCase[] {
  return FRAME_SEQUENCES.map((c) => ({ ...c, out: runSequence(c.startMinute, c.frames) }));
}
