import { describe, it, expect } from "vitest";
import { approachTimeConstant, planNote, valueAt, type EnvelopeShape } from "./lightEnvelope";

const SAMPLE = 1 / 48000;
const synth = (over: Partial<EnvelopeShape> = {}): EnvelopeShape => ({
  attack: 0.03,
  decay: 0.5,
  sustain: 0.2,
  release: 0.8,
  attackCurve: "linear",
  ...over,
});

describe("approachTimeConstant", () => {
  it("is Tone's ln(rampTime + 1) / ln(200)", () => {
    expect(approachTimeConstant(0.2)).toBeCloseTo(Math.log(1.2) / Math.log(200), 12);
    expect(approachTimeConstant(1.1)).toBeCloseTo(Math.log(2.1) / Math.log(200), 12);
  });
});

describe("planNote", () => {
  it("rises linearly to the velocity, decays onto the sustain level and lets go to silence", () => {
    const { events, stopAt } = planNote(synth(), 1, 1, 0.6, SAMPLE);
    expect(valueAt(events, 1)).toBeLessThan(1e-6);
    expect(valueAt(events, 1.015)).toBeCloseTo(0.3, 5); // halfway up the 30 ms attack
    expect(valueAt(events, 1.03)).toBeCloseTo(0.6, 9);
    expect(valueAt(events, 1.53)).toBeCloseTo(0.12, 9); // decay lands on velocity * sustain
    expect(valueAt(events, 1.8)).toBeCloseTo(0.12, 9); // and holds
    expect(valueAt(events, 2 + 0.8)).toBeCloseTo(0, 9); // release ends at zero
    expect(stopAt).toBeCloseTo(2.8, 12);
  });

  it("decays along Tone's exponential approach until its last tenth", () => {
    const env = synth({ sustain: 0 });
    const { events } = planNote(env, 0, 2, 1, SAMPLE);
    const tc = approachTimeConstant(env.decay);
    const at = env.attack + 0.2;
    expect(valueAt(events, at)).toBeCloseTo(Math.exp(-0.2 / tc), 9);
  });

  it("a release inside the attack starts from where the attack had reached, with no jump", () => {
    const env = synth();
    const { events } = planNote(env, 0, 0.01, 1, SAMPLE);
    const reached = 0.01 / env.attack;
    expect(valueAt(events, 0.01 - 1e-9)).toBeCloseTo(reached, 6);
    expect(valueAt(events, 0.01)).toBeCloseTo(reached, 6);
    expect(valueAt(events, 0.01 + 1e-6)).toBeCloseTo(reached, 4);
    // Nothing from the cut-off attack or decay is scheduled after the release.
    const late = events.filter((e) => e.time > 0.01 && e.kind !== "target");
    expect(late.every((e) => e.value <= reached + 1e-9)).toBe(true);
  });

  it("a note with no sustain held past its decay stops when the decay ends, with nothing to release", () => {
    const env = synth({ sustain: 0, decay: 0.2, attack: 0.008, release: 0.08 });
    const { events, stopAt } = planNote(env, 0, 0.5, 1, SAMPLE);
    expect(stopAt).toBeCloseTo(0.208, 12);
    expect(events.some((e) => e.time > 0.208 + 1e-9)).toBe(false);
  });

  it("a note with no sustain let go mid-decay rings out its release before the oscillator stops", () => {
    // Tone stopped this note at the decay's end (0.208 s) while its release
    // tail still sounded, a small cut. The plan keeps the tail.
    const env = synth({ sustain: 0, decay: 0.2, attack: 0.008, release: 0.08 });
    const { events, stopAt } = planNote(env, 0, 0.18, 1, SAMPLE);
    expect(stopAt).toBeCloseTo(0.26, 12);
    expect(valueAt(events, 0.18)).toBeGreaterThan(0);
    expect(valueAt(events, 0.26)).toBeCloseTo(0, 12);
  });

  it("the membrane's exponential attack approaches the velocity and lands on it", () => {
    const env = synth({ attack: 0.01, attackCurve: "exponential" });
    const { events } = planNote(env, 0, 1, 0.9, SAMPLE);
    const tc = approachTimeConstant(0.01);
    expect(valueAt(events, 0.005)).toBeCloseTo(0.9 * (1 - Math.exp(-0.005 / tc)), 6);
    expect(valueAt(events, 0.01)).toBeCloseTo(0.9, 9);
  });

  it("an attack shorter than one sample starts at full level", () => {
    const { events } = planNote(synth({ attack: 0 }), 0, 1, 0.5, SAMPLE);
    expect(events[0]).toEqual({ kind: "set", value: 0.5, time: 0 });
  });

  it("every scheduled level stays finite, inside 0 and the velocity", () => {
    for (const dur of [0, 0.005, 0.05, 0.3, 2]) {
      const { events, stopAt } = planNote(synth({ sustain: 0.6 }), 3, dur, 0.7, SAMPLE);
      expect(Number.isFinite(stopAt)).toBe(true);
      for (const e of events) {
        expect(Number.isFinite(e.value) && Number.isFinite(e.time)).toBe(true);
        expect(e.value).toBeGreaterThanOrEqual(0);
        expect(e.value).toBeLessThanOrEqual(0.7 + 1e-12);
      }
      // Events are scheduled in time order (Web Audio requires it of ramps).
      for (let i = 1; i < events.length; i++) expect(events[i].time).toBeGreaterThanOrEqual(events[i - 1].time);
    }
  });
});
