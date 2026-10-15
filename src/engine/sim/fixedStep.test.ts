import { describe, it, expect } from "vitest";
import { drainFixedSteps, quantumFor, syncStepMode, MAX_STEPS_PER_FRAME, MAX_QUANTUM_MINUTES, OWED_EPSILON } from "./fixedStep";
import { paceFactor } from "../timePacing";

/**
 * Unit guards for the engine-owned fixed step, against a fake host. The
 * real-save proof that the tower is the same at any frame rate lives in
 * `src/tests/integration/fixedStep.integration.test.ts`.
 */

function recorder() {
  const calls: number[] = [];
  return { calls, host: { clock: { minuteOfDay: 0 }, tick: (dt: number) => { calls.push(dt); } } };
}

/** Owe one paced game day in frames from `frames()` to a fake host whose clock
 *  advances with each step, and return the step sizes it ran. */
function playDay(rate: number, frames: () => number): number[] {
  const calls: number[] = [];
  const clock = { minuteOfDay: 0 };
  const host = { clock, tick: (dt: number) => { calls.push(dt); clock.minuteOfDay = (clock.minuteOfDay + dt) % 1440; } };
  const debt = { minutes: 0 };
  let owed = 0;
  while (owed < 1440) {
    const owe = Math.min(rate * frames() * paceFactor(clock.minuteOfDay), 1440 - owed);
    owed += owe;
    debt.minutes += owe;
    drainFixedSteps(host, debt, rate);
  }
  for (let n = -1; n !== calls.length; ) {
    n = calls.length;
    drainFixedSteps(host, debt, rate);
  }
  return calls;
}

describe("engine fixed time step (unit)", () => {
  it("cuts the same owed day into the same steps however it is chunked", () => {
    let s = 7;
    const jittery = () => {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      return (8 + (s % 34)) / 1000;
    };
    for (const rate of [120, 30]) {
      const at60 = playDay(rate, () => 1 / 60);
      if (rate === 120) expect(new Set(at60).size).toBeGreaterThan(1); // the paced day varies the step
      expect(playDay(rate, () => 1 / 30)).toEqual(at60);
      expect(playDay(rate, () => 1 / 144)).toEqual(at60);
      expect(playDay(rate, jittery)).toEqual(at60);
    }
  });

  it("pays back the dust a tolerated step overdrew, so chunking cannot add a step", () => {
    // Two frames each owing just under a quantum (inside the tolerance), against
    // the same minutes owed in one frame: both must run the same steps.
    const q = quantumFor(120, 0, true);
    const nearQ = q - 0.75 * OWED_EPSILON;
    const split = recorder();
    const a = { minutes: nearQ };
    drainFixedSteps(split.host, a, 120, { steadyClock: true });
    expect(a.minutes).toBeLessThan(0); // the forgiven shortfall stays owed
    expect(a.minutes).toBeGreaterThanOrEqual(-OWED_EPSILON);
    a.minutes += nearQ;
    drainFixedSteps(split.host, a, 120, { steadyClock: true });
    const whole = recorder();
    const b = { minutes: 2 * nearQ };
    drainFixedSteps(whole.host, b, 120, { steadyClock: true });
    expect(split.calls).toEqual([q]);
    expect(whole.calls).toEqual([q]);
    // What is left is just under a quantum, outside the tolerance, so it waits.
    expect(a.minutes).toBeCloseTo(q - 1.5 * OWED_EPSILON, 9);
    expect(a.minutes).toBeCloseTo(b.minutes, 9);
  });

  it("keeps the overdraw at the tolerance boundary through an empty frame", () => {
    // Owing exactly a quantum minus the tolerance steps, and float rounding may
    // land the remainder a few ulps past -OWED_EPSILON. It must still count as
    // owed, so a following frame that owes nothing does not zero it.
    for (const q of [1, 3, 5, 8, 17, 20]) {
      const rate = q * 60; // steady clock: a 60 Hz frame owes exactly q
      expect(quantumFor(rate, 0, true)).toBe(q);
      const { host } = recorder();
      const debt = { minutes: q - OWED_EPSILON };
      drainFixedSteps(host, debt, rate, { steadyClock: true });
      expect(debt.minutes).toBeGreaterThanOrEqual(-OWED_EPSILON);
      expect(debt.minutes).toBeLessThan(0);
      const left = debt.minutes;
      drainFixedSteps(host, debt, rate, { steadyClock: true }); // an empty frame
      expect(debt.minutes).toBe(left);
    }
  });

  it("caps one frame's work at the step budget and carries the rest", () => {
    const { calls, host } = recorder();
    const q = quantumFor(120, 0);
    const debt = { minutes: 40 };
    drainFixedSteps(host, debt, 120);
    expect(calls).toEqual(Array(MAX_STEPS_PER_FRAME).fill(q));
    expect(debt.minutes).toBe(40 - MAX_STEPS_PER_FRAME * q);
  });

  it("never steps a partial quantum, and a bad owed amount, rate, or budget is handled", () => {
    const { calls, host } = recorder();
    const run = (minutes: number, rate: number, maxSteps?: number) => {
      const debt = { minutes };
      drainFixedSteps(host, debt, rate, { maxSteps });
      return debt.minutes;
    };
    expect(run(1.9, 120)).toBe(1.9);
    expect(run(Number.NaN, 120)).toBe(0);
    expect(run(10, 0)).toBe(0);
    expect(run(10, Number.POSITIVE_INFINITY)).toBe(0);
    expect(run(-3, 120)).toBe(0);
    // Overdraw dust within the tolerance is kept as owed; anything past it is cleared.
    expect(run(-0.5 * OWED_EPSILON, 120)).toBe(-0.5 * OWED_EPSILON);
    expect(run(-2 * OWED_EPSILON, 120)).toBe(0);
    expect(calls).toEqual([]);
    // A nonsense budget falls back to the default instead of stepping nothing
    // or stepping without bound.
    expect(run(40, 120, 0)).toBe(40 - MAX_STEPS_PER_FRAME * 2);
    expect(run(40, 120, Number.POSITIVE_INFINITY)).toBe(40 - MAX_STEPS_PER_FRAME * 2);
    expect(calls).toHaveLength(2 * MAX_STEPS_PER_FRAME);
  });

  it("reduces the debt step by step, so a step that throws never re-owes the ones that ran", () => {
    let n = 0;
    const host = {
      clock: { minuteOfDay: 0 },
      tick: () => {
        if (++n === 2) throw new Error("boom");
      },
    };
    const debt = { minutes: 6 };
    expect(() => drainFixedSteps(host, debt, 120)).toThrow("boom");
    expect(debt.minutes).toBe(4);
  });

  it("drops minutes owed under a different speed or pacing mode, but not on the first call", () => {
    const debt: { minutes: number; mode?: string } = { minutes: 5 };
    syncStepMode(debt, 120, false);
    expect(debt.minutes).toBe(5); // no previous mode: nothing to drop
    syncStepMode(debt, 120, false);
    expect(debt.minutes).toBe(5);
    syncStepMode(debt, 30, false);
    expect(debt.minutes).toBe(0);
    debt.minutes = 4;
    syncStepMode(debt, 30, true);
    expect(debt.minutes).toBe(0);
  });

  it("sizes the step from the canon pace: at most one 60 Hz frame's worth, never under a minute", () => {
    expect(quantumFor(120, 0)).toBe(2); // pace ~1.08: 2.2 min per frame
    expect(quantumFor(120, 180)).toBe(6); // night sprint, pace 3.25: 6.5 rounds down
    expect(quantumFor(120, 600)).toBe(2); // morning, pace ~1.35: 2.7 rounds down
    expect(quantumFor(30, 180)).toBe(1); // 1.6 rounds down
    expect(quantumFor(120, 720)).toBe(1); // lunch crawl, pace ~0.14
    expect(quantumFor(30, 0)).toBe(1);
    expect(quantumFor(10, 180)).toBe(1);
    expect(quantumFor(120, 180, true)).toBe(2); // the steady clock ignores the curve
    expect(quantumFor(120, 720, true)).toBe(2);
    // A much faster speed is capped (the frame loop's test pins the cap under
    // the host's catch-up cap).
    expect(quantumFor(6000, 180)).toBe(MAX_QUANTUM_MINUTES);
  });
});
