import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The light voices drive Web Audio through Tone's context. These tests stand
 * in for the context with spies that record every native call, and check
 * what a voice asks of it: two nodes per note, the planned envelope, the
 * stop, the hand-over on a mono voice, the glide on the current note, and the
 * nodes released when a note ends.
 */

interface FakeParam {
  value: number;
  calls: Array<[string, ...number[]]>;
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  setTargetAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
}
function param(): FakeParam {
  const p = { value: 0, calls: [] as Array<[string, ...number[]]> } as FakeParam;
  for (const name of [
    "setValueAtTime",
    "linearRampToValueAtTime",
    "exponentialRampToValueAtTime",
    "setTargetAtTime",
    "cancelScheduledValues",
  ] as const) {
    p[name] = vi.fn((...a: number[]) => {
      p.calls.push([name, ...a]);
      return p;
    });
  }
  return p;
}
interface FakeOsc {
  type: string;
  frequency: FakeParam;
  onended: (() => void) | null;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}
interface FakeGain {
  gain: FakeParam;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

const ctx = {
  currentTime: 0,
  sampleRate: 48000,
  oscs: [] as FakeOsc[],
  gains: [] as FakeGain[],
  createOscillator: vi.fn((): FakeOsc => {
    const o: FakeOsc = {
      type: "sine",
      frequency: param(),
      onended: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    ctx.oscs.push(o);
    return o;
  }),
  createGain: vi.fn((): FakeGain => {
    const g: FakeGain = { gain: param(), connect: vi.fn(), disconnect: vi.fn() };
    ctx.gains.push(g);
    return g;
  }),
};
const toneConnect = vi.fn();
const volumes: Array<{ volume: { value: number }; connect: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = [];

vi.mock("tone", () => ({
  getContext: () => ctx,
  now: () => ctx.currentTime + 0.1,
  connect: (...a: unknown[]) => toneConnect(...a),
  Time: (t: unknown) => ({ toSeconds: () => (t === "16n" ? 0.125 : Number(t)) }),
  Volume: function (db: number) {
    const v = { volume: { value: db }, connect: vi.fn(), dispose: vi.fn() };
    volumes.push(v);
    return v;
  },
}));

import { LightMembraneSynth, LightMonoSynth, LightPolySynth } from "./lightSynth";
import { planNote } from "./lightEnvelope";

beforeEach(() => {
  ctx.currentTime = 0;
  ctx.oscs.length = 0;
  ctx.gains.length = 0;
  volumes.length = 0;
  toneConnect.mockClear();
});

const ENV = { attack: 0.01, decay: 0.2, sustain: 0, release: 0.1 };

describe("LightPolySynth", () => {
  it("plays a note as one oscillator into one envelope gain, on the planned curve, into its output", () => {
    const v = new LightPolySynth({ oscillator: { type: "sine" }, envelope: ENV, volume: -9 });
    v.triggerAttackRelease(440, 0.5, 2, 0.7);
    expect(ctx.oscs).toHaveLength(1);
    expect(ctx.gains).toHaveLength(1);
    const [osc] = ctx.oscs;
    const [env] = ctx.gains;
    expect(osc.type).toBe("sine");
    expect(osc.frequency.value).toBe(440);
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(440, 2);
    expect(osc.connect).toHaveBeenCalledWith(env);
    expect(toneConnect).toHaveBeenCalledWith(env, volumes[0]);
    const plan = planNote({ ...ENV, attackCurve: "linear" }, 2, 0.5, 0.7, 1 / 48000);
    const expected = plan.events.map((e) => {
      if (e.kind === "set") return ["setValueAtTime", e.value, e.time];
      if (e.kind === "linear") return ["linearRampToValueAtTime", e.value, e.time];
      return ["setTargetAtTime", e.value, e.time, e.timeConstant];
    });
    expect(env.gain.calls).toEqual(expected);
    expect(osc.start).toHaveBeenCalledWith(2);
    expect(osc.stop).toHaveBeenCalledWith(plan.stopAt);
    expect(v.volume.value).toBe(-9);
  });

  it("starts from Tone.Synth's defaults (triangle, its envelope) when built bare", () => {
    const v = new LightPolySynth();
    expect(v.envelope).toEqual({ attack: 0.005, decay: 0.1, sustain: 0.3, release: 1, attackCurve: "linear" });
    v.triggerAttackRelease(220, "16n", 0);
    expect(ctx.oscs[0].type).toBe("triangle");
    // A Tone time string is converted for the release.
    expect(ctx.oscs[0].stop).toHaveBeenCalledWith(planNote(v.envelope, 0, 0.125, 1, 1 / 48000).stopAt);
  });

  it("drops a note past maxPolyphony while the others still sound, and admits one once they end", () => {
    const v = new LightPolySynth({ envelope: ENV, maxPolyphony: 2 });
    v.triggerAttackRelease(200, 1, 0);
    v.triggerAttackRelease(300, 1, 0);
    v.triggerAttackRelease(400, 1, 0.1); // both still sounding
    expect(ctx.oscs).toHaveLength(2);
    v.triggerAttackRelease(500, 1, 5); // both long stopped by then
    expect(ctx.oscs).toHaveLength(3);
  });

  it("set({ envelope }) changes later notes only", () => {
    const v = new LightPolySynth({ envelope: ENV });
    v.triggerAttackRelease(200, 1, 0);
    v.set({ envelope: { decay: 0.6 } });
    v.triggerAttackRelease(200, 1, 2);
    expect(ctx.oscs[0].stop.mock.calls[0][0]).toBeCloseTo(0.21, 12);
    expect(ctx.oscs[1].stop.mock.calls[0][0]).toBeCloseTo(2.61, 12);
  });

  it("releases a note's nodes when it ends, and reaps one whose end never arrived", () => {
    const v = new LightPolySynth({ envelope: ENV });
    v.triggerAttackRelease(200, 1, 0);
    v.triggerAttackRelease(300, 1, 0);
    ctx.oscs[0].onended?.();
    expect(ctx.oscs[0].disconnect).toHaveBeenCalled();
    expect(ctx.gains[0].disconnect).toHaveBeenCalled();
    expect(ctx.oscs[1].disconnect).not.toHaveBeenCalled();
    // A suspended context never fires onended: the next note reaps it.
    ctx.currentTime = 10;
    v.triggerAttackRelease(400, 1, 10);
    expect(ctx.oscs[1].disconnect).toHaveBeenCalled();
    expect(ctx.oscs[2].disconnect).not.toHaveBeenCalled();
  });

  it("dispose stops what still sounds, frees it, drops the output, and plays nothing after", () => {
    const v = new LightPolySynth({ envelope: ENV });
    v.triggerAttackRelease(200, 1, 0);
    v.dispose();
    expect(ctx.oscs[0].stop).toHaveBeenCalledTimes(2);
    expect(ctx.oscs[0].disconnect).toHaveBeenCalled();
    expect(volumes[0].dispose).toHaveBeenCalled();
    v.triggerAttackRelease(300, 1, 1);
    expect(ctx.oscs).toHaveLength(1);
  });
});

describe("LightMonoSynth", () => {
  it("routes each note through a hand-over gain and fades the sounding note when the next starts", () => {
    const v = new LightMonoSynth({ envelope: ENV });
    v.triggerAttackRelease(300, 0.2, 1);
    v.triggerAttackRelease(400, 0.2, 1.05); // the first note is mid-decay
    expect(ctx.oscs).toHaveLength(2);
    expect(ctx.gains).toHaveLength(4); // envelope + hand-over per note
    const firstHandOver = ctx.gains[1];
    expect(ctx.gains[0].connect).toHaveBeenCalledWith(firstHandOver);
    expect(firstHandOver.gain.calls).toEqual([
      ["setValueAtTime", 1, 1.05],
      ["linearRampToValueAtTime", 0, 1.055],
    ]);
    expect(ctx.oscs[0].stop).toHaveBeenLastCalledWith(1.055);
    // The new note's own hand-over is untouched.
    expect(ctx.gains[3].gain.calls).toEqual([]);
  });

  it("leaves a finished note alone", () => {
    const v = new LightMonoSynth({ envelope: ENV });
    v.triggerAttackRelease(300, 0.05, 1);
    v.triggerAttackRelease(400, 0.05, 3);
    expect(ctx.gains[1].gain.calls).toEqual([]);
  });

  it("its glide control steers the note just triggered", () => {
    const v = new LightMonoSynth({ envelope: ENV });
    v.triggerAttackRelease(520, 0.2, 1);
    v.triggerAttackRelease(700, 0.2, 2);
    v.frequency.cancelScheduledValues(2).setValueAtTime(700, 2).exponentialRampToValueAtTime(380, 2.1);
    expect(ctx.oscs[1].frequency.calls.slice(1)).toEqual([
      ["cancelScheduledValues", 2],
      ["setValueAtTime", 700, 2],
      ["exponentialRampToValueAtTime", 380, 2.1],
    ]);
    expect(ctx.oscs[0].frequency.calls).toEqual([["setValueAtTime", 520, 1]]);
  });

  it("a glide with no note yet does nothing and does not throw", () => {
    const v = new LightMonoSynth();
    expect(() => v.frequency.linearRampToValueAtTime(120, 1)).not.toThrow();
  });
});

describe("LightMembraneSynth", () => {
  it("strikes at freq * octaves and glides onto the note over pitchDecay, on Tone's membrane envelope", () => {
    const v = new LightMembraneSynth({ octaves: 0.5, pitchDecay: 0.045 });
    expect(v.envelope.attackCurve).toBe("exponential");
    v.triggerAttackRelease(92.5, 0.2, 1, 0.9);
    const f = ctx.oscs[0].frequency;
    expect(f.value).toBeCloseTo(46.25, 9);
    expect(f.calls).toEqual([
      ["setValueAtTime", 46.25, 1],
      ["exponentialRampToValueAtTime", 92.5, 1.045],
    ]);
    expect(ctx.oscs[0].type).toBe("sine");
  });

  it("uses Tone.MembraneSynth's defaults when built bare", () => {
    const v = new LightMembraneSynth();
    expect(v.envelope).toEqual({ attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4, attackCurve: "exponential" });
    v.triggerAttackRelease(55, 0.25, 0);
    expect(ctx.oscs[0].frequency.calls[1]).toEqual(["exponentialRampToValueAtTime", 55, 0.05]);
    expect(ctx.oscs[0].frequency.calls[0]).toEqual(["setValueAtTime", 550, 0]);
  });
});
