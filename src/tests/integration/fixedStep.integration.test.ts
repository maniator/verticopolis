import { describe, it, expect } from "vitest";
import { inflateSync } from "fflate";
// A real Modern save, inlined as a string (vite ?raw) so the test needs no node fs.
import towerFile from "../fixtures/split-tower.vctower?raw";
import { Simulation } from "../../engine/Simulation";
import { drainFixedSteps, quantumFor, syncStepMode, MAX_STEPS_PER_FRAME, MAX_QUANTUM_MINUTES } from "../../engine/sim/fixedStep";
import { paceFactor } from "../../engine/timePacing";
import type { SerializedGame } from "../../engine/types";

/** Decode a `.vctower` container (magic line + base64 deflate-raw JSON). */
function decodeVctower(text: string): SerializedGame {
  const b64 = text.slice(text.indexOf("\n") + 1).trim();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(inflateSync(bytes))) as SerializedGame;
}

const SAVE = decodeVctower(towerFile);
const GAME_MINUTES = 24 * 60;

/**
 * Drive a fresh load of the fixture the way the web host does: each frame owes
 * `rate * frameSeconds * paceFactor(clock)` game minutes (the canon pacing
 * curve, so the night sprint and lunch crawl are exercised, or a flat pace
 * with the steady clock) and hands them to the engine with the nominal rate.
 * Frame lengths come from `frames()`. It stops once `GAME_MINUTES` have been
 * owed, then lets the engine drain the rest.
 */
function play(
  rate: number,
  frames: () => number,
  steadyClock = false,
  catchupCap = Number.POSITIVE_INFINITY,
): { state: string; ticks: number[]; leftover: number; finalQuantum: number } {
  const sim = Simulation.deserialize(structuredClone(SAVE));
  const ticks: number[] = [];
  const host = {
    clock: sim.clock,
    tick: (dt: number) => {
      ticks.push(dt);
      sim.tick(dt);
    },
  };
  const debt = { minutes: 0 };
  let owedTotal = 0;
  while (owedTotal < GAME_MINUTES) {
    const pace = steadyClock ? 1 : paceFactor(sim.clock.minuteOfDay);
    const owe = Math.min(rate * frames() * pace, GAME_MINUTES - owedTotal);
    owedTotal += owe;
    debt.minutes = Math.min(debt.minutes + owe, catchupCap);
    drainFixedSteps(host, debt, rate, { steadyClock });
  }
  for (let n = -1; n !== ticks.length; ) {
    n = ticks.length;
    drainFixedSteps(host, debt, rate, { steadyClock });
  }
  const finalQuantum = quantumFor(rate, sim.clock.minuteOfDay, steadyClock);
  return { state: JSON.stringify(sim.serialize()), ticks, leftover: debt.minutes, finalQuantum };
}

const steady = (hz: number) => () => 1 / hz;

/** A deterministic jittery frame source: 8 to 41 ms frames from a fixed LCG. */
function jittery(): () => number {
  let s = 12345;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (8 + (s % 34)) / 1000;
  };
}

function recorder() {
  const calls: number[] = [];
  return { calls, host: { clock: { minuteOfDay: 0 }, tick: (dt: number) => { calls.push(dt); } } };
}

describe("engine fixed time step: the tower is the same at any frame rate", () => {
  const cases = [
    ["fastest speed (120 min/s)", 120, false],
    ["fastest speed with the steady clock", 120, true],
    ["middle speed (30 min/s)", 30, false],
    ["slowest speed (10 min/s)", 10, false],
  ] as const;
  for (const [label, rate, steadyClock] of cases) {
    it(`${label}: 30, 60, 144 Hz and a jittery frame source end byte-identical`, () => {
      const runs = [steady(30), steady(60), steady(144), jittery()].map((f) => play(rate, f, steadyClock));
      for (const r of runs) {
        // Nothing was dropped: every run stepped the whole owed day.
        expect(r.leftover).toBeLessThan(r.finalQuantum);
        expect(r.ticks).toEqual(runs[0].ticks);
        expect(r.state).toBe(runs[0].state);
      }
      // The paced day really does vary the step (bigger through the night sprint).
      if (rate === 120 && !steadyClock) expect(new Set(runs[0].ticks).size).toBeGreaterThan(1);
      if (steadyClock) expect(new Set(runs[0].ticks)).toEqual(new Set([2]));
    });
  }

  it("a host too slow for the step budget falls behind on the same step sequence", () => {
    // 12 Hz at the fastest speed owes more per frame than the step budget
    // covers, so its debt hits the host's 30-minute catch-up cap and the excess
    // is dropped. It must still take exactly the steps a 60 Hz host takes, just
    // fewer of them.
    const fast = play(120, steady(60), false, 30);
    const slow = play(120, steady(12), false, 30);
    expect(slow.ticks.length).toBeLessThan(fast.ticks.length);
    expect(slow.ticks).toEqual(fast.ticks.slice(0, slow.ticks.length));
    const replay = Simulation.deserialize(structuredClone(SAVE));
    for (const dt of slow.ticks) replay.tick(dt);
    expect(JSON.stringify(replay.serialize())).toBe(slow.state);
  });

  it("the frame-rate-derived stepping it replaces did diverge (why this exists)", () => {
    // The pre-fixed-step host loop: step min(20, acc) with acc carrying the
    // fractional frame-derived minutes. Same save, same owed total, two
    // monitor rates: the step sequences differ, and so does the tower.
    const legacy = (hz: number): string => {
      const sim = Simulation.deserialize(structuredClone(SAVE));
      let owedTotal = 0;
      let acc = 0;
      while (owedTotal < GAME_MINUTES) {
        const owe = Math.min(120 / hz, GAME_MINUTES - owedTotal);
        owedTotal += owe;
        acc += owe;
        while (acc >= 1) {
          const step = Math.min(20, acc);
          sim.tick(step);
          acc -= step;
        }
      }
      return JSON.stringify(sim.serialize());
    };
    expect(legacy(30)).not.toBe(legacy(144));
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
