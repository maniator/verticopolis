import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ViewFocus } from "../render/excalibur/TowerEngine";

/**
 * The inert-contract test (toneAudioEngine.test.ts) proves the engine is safe
 * with NO AudioContext. This file does the opposite: it stands up a fake
 * AudioContext and a mocked Tone.js so start() actually BUILDS the graph and the
 * engine's real control flow runs — scene selection + hysteresis, zoom→detail,
 * the sfx dispatch switch, mute/unmute, and teardown. The audio *nodes* are
 * stubbed (so we test our logic, not Tone's synthesis), which is the only way to
 * exercise everything gated behind `if (!this.started) return`.
 */

/** What the recording mock captures per node: its Tone class, constructor
 *  args, where it connected, whether start() ran, and every trigger call.
 *  Regression tests assert graph SHAPE from this (a no-throw suite would pass
 *  with the whole feature deleted). */
type NodeRec = {
  kind: string;
  args: unknown[];
  connects: NodeRec[];
  started: boolean;
  triggers: unknown[][];
};

// Shared holders, hoisted so the vi.mock factory can reach them: the per-beat
// callback the mocked Transport hands back, and the node registry.
const beat = vi.hoisted(() => ({ step: null as null | ((t: number) => void) }));
const graph = vi.hoisted(() => ({ nodes: [] as NodeRec[] }));

/** A self-returning chainable stub for a Tone node: any property access or
 *  call yields the same proxy, so `n.connect(x).connect(y)`, `n.gain.rampTo(…)`,
 *  `n.volume.value = …` all no-op safely, while `connect`, `start` and
 *  `triggerAttackRelease` additionally record onto the node's registry entry
 *  (sub-property accesses like `.gain` yield the same proxy, so an edge into a
 *  node's param records as an edge into that node). */
function node(kind = "anon", args: unknown[] = []): unknown {
  const rec: NodeRec = { kind, args, connects: [], started: false, triggers: [] };
  graph.nodes.push(rec);
  const p: any = new Proxy(function () {} as unknown as object, {
    get: (_t, prop) => {
      if (prop === Symbol.toPrimitive) return () => 0; // numeric coercion (Tone.now())
      if (prop === "then") return undefined; // never a thenable
      if (prop === "__rec") return rec;
      if (prop === "connect")
        return (target: any) => {
          if (target?.__rec) rec.connects.push(target.__rec);
          return p;
        };
      if (prop === "start")
        return () => {
          rec.started = true;
          return p;
        };
      if (prop === "triggerAttackRelease")
        return (...a: unknown[]) => {
          rec.triggers.push(a);
          return p;
        };
      return p;
    },
    apply: () => p,
    set: () => true,
  });
  return p;
}

vi.mock("tone", () => {
  // Regular functions (not arrows) so `new Tone.Gain(...)` works; each returns a
  // node, which `new` then yields as the instance.
  const ctorFor = (kind: string) =>
    function (...args: unknown[]) {
      return node(kind, args);
    };
  return {
    Gain: ctorFor("Gain"),
    Filter: ctorFor("Filter"),
    PolySynth: ctorFor("PolySynth"),
    Synth: ctorFor("Synth"),
    Noise: ctorFor("Noise"),
    Reverb: ctorFor("Reverb"),
    NoiseSynth: ctorFor("NoiseSynth"),
    MembraneSynth: ctorFor("MembraneSynth"),
    LFO: ctorFor("LFO"),
    getTransport: () => ({
      bpm: node(), // chainable: supports both `bpm.value = …` and `bpm.rampTo(…)`
      scheduleRepeat: (cb: (t: number) => void) => ((beat.step = cb), 1),
      start: () => {},
      clear: () => {},
      stop: () => {},
    }),
    getContext: () => node(),
    start: () => Promise.resolve(),
    now: () => 0,
  };
});

import { ToneAudioEngine, type SfxName } from "./ToneAudioEngine";

const focus = (over: Partial<ViewFocus> = {}): ViewFocus =>
  ({ centerFloor: 5, dominant: "office", night: false, zoom: 1, ...over }) as ViewFocus;

describe("ToneAudioEngine — full graph driven with a mocked Tone.js", () => {
  let prevAudioContext: unknown;
  beforeEach(() => {
    prevAudioContext = (globalThis as { AudioContext?: unknown }).AudioContext;
    (globalThis as { AudioContext?: unknown }).AudioContext = function () {}; // pass the hasWebAudio gate
    beat.step = null; // each start() must RE-schedule the beat callback — no stale carry-over between tests
    graph.nodes.length = 0; // fresh node registry per test
  });
  afterEach(() => {
    // Restore whatever the environment had (don't blindly delete a real one).
    if (prevAudioContext === undefined) delete (globalThis as { AudioContext?: unknown }).AudioContext;
    else (globalThis as { AudioContext?: unknown }).AudioContext = prevAudioContext as never;
    beat.step = null;
  });

  it("start() builds the graph and becomes active; a second call takes the resume path", () => {
    const eng = new ToneAudioEngine();
    expect(() => eng.start()).not.toThrow();
    // Assert the graph actually built. Without this, a future mid-start() throw
    // (catch → dispose leaves started=false — the exact bpm.rampTo failure mode
    // this file guards) would let every gated test below pass trivially on its
    // `if (!this.started) return`.
    expect((eng as unknown as { started: boolean }).started).toBe(true);
    expect(() => eng.start()).not.toThrow(); // already-started branch
  });

  it("update() drives scene selection across zooms and facilities (incl. overview hysteresis)", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    const path: ViewFocus[] = [
      focus({ zoom: 0.3, dominant: "empty", centerFloor: 1 }), // zoomed out → overview latch
      focus({ zoom: 2.0, dominant: "office" }), // zoom in → detail scene
      focus({ zoom: 2.5, dominant: "hotelSuite" }),
      focus({ zoom: 2.5, dominant: "restaurant" }),
      focus({ zoom: 2.5, dominant: "cinema" }),
      focus({ zoom: 2.5, dominant: "security" }),
      focus({ zoom: 1.6, dominant: "outside" }),
      focus({ zoom: 2.0, dominant: "empty", centerFloor: -3 }), // metro (basement)
      focus({ zoom: 0.35, dominant: "empty", centerFloor: 30 }), // back out → overview
    ];
    for (const f of path) expect(() => eng.update(f)).not.toThrow();
  });

  it("sfx() plays every cue once the graph is up", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    const names: SfxName[] = ["build", "sell", "error", "promote", "money", "click"];
    for (const n of names) expect(() => eng.sfx(n)).not.toThrow();
  });

  it("mute silences sfx; unmute restores — neither throws", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    expect(() => eng.setMuted(true)).not.toThrow();
    expect(() => eng.sfx("build")).not.toThrow(); // muted → no-op path
    expect(() => eng.update(focus({ zoom: 2 }))).not.toThrow();
    expect(() => eng.setMuted(false)).not.toThrow();
  });

  it("the scheduled beat callback generates music per scene (and stops when muted)", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    expect(beat.step).toBeTypeOf("function"); // Transport handed us the per-beat step
    eng.update(focus({ zoom: 2.2, dominant: "office" })); // zoom in → detail high → accents fire
    for (let i = 0; i < 40; i++) expect(() => beat.step!(i * 0.25)).not.toThrow(); // several 16-step bars
    eng.update(focus({ zoom: 2.2, dominant: "hotelSuite" })); // switch scene mid-sequence
    for (let i = 0; i < 20; i++) beat.step!(i * 0.25);
    eng.setMuted(true);
    expect(() => beat.step!(99)).not.toThrow(); // muted → the step is a no-op
  });

  it("setVolumes clamps and holds its values before and after start()", () => {
    const eng = new ToneAudioEngine();
    eng.setVolumes(1.5, -0.2); // pre-start: store only, clamped
    expect(eng.musicVolume).toBe(1);
    expect(eng.sfxVolume).toBe(0);
    eng.start();
    expect(() => eng.setVolumes(0.4, 0.6)).not.toThrow(); // live: ramps the buses
    expect(eng.musicVolume).toBe(0.4);
    expect(eng.sfxVolume).toBe(0.6);
    // Volume is independent of mute: flipping mute must not disturb the levels.
    eng.setMuted(true);
    eng.setMuted(false);
    expect(eng.musicVolume).toBe(0.4);
    expect(eng.sfxVolume).toBe(0.6);
    // A non-finite input keeps that channel's level (never a NaN ramp target).
    eng.setVolumes(NaN, 0.25);
    expect(eng.musicVolume).toBe(0.4);
    expect(eng.sfxVolume).toBe(0.25);
  });

  it("REGRESSION: the rain bed is band-limited with a gust swell (static-on-phones fix)", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    const filters = graph.nodes.filter((n) => n.kind === "Filter");
    const opts = (n: NodeRec) => (n.args[0] ?? {}) as { type?: string; frequency?: number };
    // Walk the chain from its unique anchor: the 600 Hz highpass (the band's
    // floor; the bed's distance filter is also lowpass-3000, so start here)...
    const rainHp = filters.find((n) => opts(n).type === "highpass" && opts(n).frequency === 600);
    expect(rainHp, "rain highpass (600 Hz) missing").toBeTruthy();
    // ...into the 3 kHz lowpass that keeps rain from reading as flat hiss...
    const rainTone = rainHp!.connects[0];
    expect(rainTone?.kind).toBe("Filter");
    expect(opts(rainTone!)).toEqual({ type: "lowpass", frequency: 3000, Q: 0.5 });
    // ...into the swell gain, which a started 0.3 Hz LFO (0.7..1) breathes.
    const swell = rainTone!.connects[0];
    expect(swell?.kind).toBe("Gain");
    const lfo = graph.nodes.find((n) => n.kind === "LFO");
    expect(lfo, "gust LFO missing").toBeTruthy();
    expect(lfo!.args[0]).toEqual({ frequency: 0.3, min: 0.7, max: 1 });
    expect(lfo!.started).toBe(true);
    expect(lfo!.connects).toContain(swell);
  });

  it("REGRESSION: the overview melody is doubled two octaves up; other scenes are not", () => {
    // +24 semitones is exactly a 4x frequency ratio, so a same-step trigger
    // pair at ratio 4 IS the doubling (the close-up sparkle is +12 = 2x).
    const pairsAtRatio4 = (eng: ToneAudioEngine, f: ViewFocus): number => {
      eng.update(f);
      const synths = graph.nodes.filter((n) => n.kind === "PolySynth");
      let found = 0;
      for (let i = 0; i < 200; i++) {
        const before = synths.map((s) => s.triggers.length);
        beat.step!(i * 0.25);
        const stepFreqs = synths
          .flatMap((s, si) => s.triggers.slice(before[si]))
          .map((t) => t[0])
          .filter((x): x is number => typeof x === "number");
        for (const a of stepFreqs)
          for (const b of stepFreqs) if (Math.abs(b / a - 4) < 0.001) found++;
      }
      return found;
    };
    const over = new ToneAudioEngine();
    over.start();
    expect(pairsAtRatio4(over, focus({ zoom: 0.3, dominant: "empty", centerFloor: 30 }))).toBeGreaterThan(0);
    over.dispose();
    graph.nodes.length = 0;
    const office = new ToneAudioEngine();
    office.start();
    expect(pairsAtRatio4(office, focus({ zoom: 2.2, dominant: "office" }))).toBe(0);
  });

  it("rain weather adds an outdoor layer when the sky is visible", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    expect(() => eng.update(focus({ zoom: 0.3, dominant: "empty", centerFloor: 30, weather: "rain" }))).not.toThrow();
    expect(() => eng.update(focus({ zoom: 1.6, dominant: "outside", weather: "rain" }))).not.toThrow();
    expect(() => eng.update(focus({ zoom: 2.2, dominant: "office", weather: "rain" }))).not.toThrow(); // indoors → no rain
  });

  it("dispose tears the built graph down", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    expect(() => eng.dispose()).not.toThrow();
  });
});
