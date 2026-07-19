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
  disposed: boolean;
  triggers: unknown[][];
  ramps: unknown[][];
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
  const rec: NodeRec = { kind, args, connects: [], started: false, disposed: false, triggers: [], ramps: [] };
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
      if (prop === "rampTo")
        return (...a: unknown[]) => {
          rec.ramps.push(a);
          return p;
        };
      if (prop === "dispose")
        return () => {
          rec.disposed = true;
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
    Part: ctorFor("Part"),
    LFO: ctorFor("LFO"),
    ToneAudioBuffer: ctorFor("ToneAudioBuffer"),
    ToneBufferSource: ctorFor("ToneBufferSource"),
    Oscillator: ctorFor("Oscillator"),
    Context: ctorFor("Context"),
    setContext: () => {},
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

  it("builds the crowd ambience layer into the graph (its steep filters exist)", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    // The crowd layer's murmur and noise filters carry the steep -48 rolloff
    // (the audition rule that keeps voices warm and noise dark).
    const steep = graph.nodes.filter(
      (n) => n.kind === "Filter" && ((n.args[0] ?? {}) as { rolloff?: number }).rolloff === -48,
    );
    expect(steep.length).toBeGreaterThanOrEqual(2);
    // Driving updates across scenes (with occupancy and clock present) never throws.
    const path: ViewFocus[] = [
      focus({ zoom: 2.2, dominant: "office", hour: 10, crowd: 0.8 }),
      focus({ zoom: 2.2, dominant: "restaurant", hour: 13, crowd: 0.5 }),
      focus({ zoom: 2.2, dominant: "partyHall", hour: 20, crowd: 0.6 }),
      focus({ zoom: 2.2, dominant: "empty", centerFloor: -3, hour: 9, crowd: 0.2 }),
      focus({ zoom: 0.3, dominant: "empty", centerFloor: 30 }),
    ];
    for (const f of path) expect(() => eng.update(f)).not.toThrow();
  });

  it("builds a looping music Part that plays finite notes through the music voices", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    const part = graph.nodes.find((n) => n.kind === "Part");
    expect(part, "music Part missing").toBeTruthy();
    // The engine passes its per-note callback as the Part's first ctor arg.
    const cb = part!.args[0] as (t: number, ev: unknown) => void;
    expect(cb).toBeTypeOf("function");
    // Drive one event of each voice; every frequency handed to a synth is finite.
    const evs = [
      { t: 0, midi: 62, dur: 0.5, vel: 0.5, voice: "arp" },
      { t: 0, midi: 45, dur: 1, vel: 0.6, voice: "bass" },
      { t: 0, midi: 69, dur: 0.5, vel: 0.7, voice: "hook" },
    ];
    for (const ev of evs) expect(() => cb(0, ev)).not.toThrow();
    const synths = graph.nodes.filter((n) => n.kind === "PolySynth" || n.kind === "Synth");
    const freqs = synths
      .flatMap((s) => s.triggers)
      .map((t) => t[0])
      .filter((x): x is number => typeof x === "number");
    expect(freqs.length).toBeGreaterThan(0);
    for (const f of freqs) expect(Number.isFinite(f)).toBe(true);
    // Muted: the callback must schedule nothing.
    eng.setMuted(true);
    const before = synths.reduce((n, s) => n + s.triggers.length, 0);
    cb(0, { t: 0, midi: 62, dur: 0.5, vel: 0.5, voice: "arp" });
    expect(synths.reduce((n, s) => n + s.triggers.length, 0)).toBe(before);
  });

  it("setProgram crossfades to the other track (rebuilds the Part after a fade) only when it changes", () => {
    vi.useFakeTimers();
    try {
      const eng = new ToneAudioEngine();
      eng.start();
      const parts = () => graph.nodes.filter((n) => n.kind === "Part").length;
      const built = parts();
      eng.setProgram("game"); // same as the default → no-op, no crossfade timer
      vi.advanceTimersByTime(2000);
      expect(parts()).toBe(built);
      eng.setProgram("splash"); // change → dip first...
      expect(parts()).toBe(built); // ...part not swapped until the dip bottoms out
      vi.advanceTimersByTime(2000);
      expect(parts()).toBe(built + 1); // swapped in after the fade-out
    } finally {
      vi.useRealTimers();
    }
  });

  it("setVolumes clamps and holds its values before and after start()", () => {
    const eng = new ToneAudioEngine();
    eng.setVolumes(1.5, 2, -0.2); // pre-start: store only, clamped
    expect(eng.musicVolume).toBe(1);
    expect(eng.ambienceVolume).toBe(1);
    expect(eng.sfxVolume).toBe(0);
    eng.start();
    expect(() => eng.setVolumes(0.4, 0.8, 0.6)).not.toThrow(); // live: ramps the buses
    expect(eng.musicVolume).toBe(0.4);
    expect(eng.ambienceVolume).toBe(0.8);
    expect(eng.sfxVolume).toBe(0.6);
    // Volume is independent of mute: flipping mute must not disturb the levels.
    eng.setMuted(true);
    eng.setMuted(false);
    expect(eng.musicVolume).toBe(0.4);
    expect(eng.ambienceVolume).toBe(0.8);
    expect(eng.sfxVolume).toBe(0.6);
    // A non-finite input keeps that channel's level (never a NaN ramp target).
    eng.setVolumes(NaN, NaN, 0.25);
    expect(eng.musicVolume).toBe(0.4);
    expect(eng.ambienceVolume).toBe(0.8);
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
    // More than one LFO lives in the graph now (the street hum breathes on its
    // own); find the rain gust by its exact signature.
    const lfo = graph.nodes.find(
      (n) => n.kind === "LFO" && (n.args[0] as { frequency?: number })?.frequency === 0.3,
    );
    expect(lfo, "gust LFO missing").toBeTruthy();
    expect(lfo!.args[0]).toEqual({ frequency: 0.3, min: 0.7, max: 1 });
    expect(lfo!.started).toBe(true);
    expect(lfo!.connects).toContain(swell);
  });

  it("rain weather adds an outdoor layer when the sky is visible", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    expect(() => eng.update(focus({ zoom: 0.3, dominant: "empty", centerFloor: 30, weather: "rain" }))).not.toThrow();
    expect(() => eng.update(focus({ zoom: 1.6, dominant: "outside", weather: "rain" }))).not.toThrow();
    expect(() => eng.update(focus({ zoom: 2.2, dominant: "office", weather: "rain" }))).not.toThrow(); // indoors → no rain
  });


  it("honest rooms: a near-empty attendance venue schedules no crowd sounds", () => {
    vi.useFakeTimers();
    try {
      const eng = new ToneAudioEngine();
      eng.start();
      const settle = (f: ViewFocus) => {
        eng.update(f); // the scene key must win two consecutive updates
        eng.update(f);
      };
      const triggerCount = () => graph.nodes.reduce((n, r) => n + r.triggers.length, 0);
      // 4 percent full: below the GDD's 0.05 silence line -> nothing fires.
      settle(focus({ zoom: 2.4, dominant: "restaurant", hour: 13, crowd: 0.04 }));
      const before = triggerCount();
      vi.advanceTimersByTime(15_000);
      expect(triggerCount()).toBe(before);
      // A busy restaurant clinks within the same window.
      settle(focus({ zoom: 2.4, dominant: "restaurant", hour: 13, crowd: 0.8 }));
      vi.advanceTimersByTime(15_000);
      expect(triggerCount()).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("city spaces stay alive off-hours while a closed tower room falls silent", () => {
    vi.useFakeTimers();
    try {
      const eng = new ToneAudioEngine();
      eng.start();
      const settle = (f: ViewFocus) => {
        eng.update(f);
        eng.update(f);
      };
      const triggerCount = () => graph.nodes.reduce((n, r) => n + r.triggers.length, 0);
      // An office at 3am is closed: nobody there, nothing fires (honest rooms).
      settle(focus({ zoom: 2.4, dominant: "office", hour: 3, crowd: 0 }));
      const beforeOffice = triggerCount();
      vi.advanceTimersByTime(15_000);
      expect(triggerCount()).toBe(beforeOffice);
      // The metro platform is the city's own space: its crowd floor keeps the
      // trains rolling and riders murmuring even at 3am with no drawn crowd.
      settle(focus({ zoom: 2.0, dominant: "empty", centerFloor: -3, hour: 3, crowd: 0 }));
      const beforeMetro = triggerCount();
      vi.advanceTimersByTime(20_000);
      expect(triggerCount()).toBeGreaterThan(beforeMetro);
    } finally {
      vi.useRealTimers();
    }
  });

  it("venue programs start only with live attendance and stop on scene exit", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    const parts = () => graph.nodes.filter((n) => n.kind === "Part");
    const baseline = parts().length; // the music part
    const settle = (f: ViewFocus) => {
      eng.update(f);
      eng.update(f);
    };
    // An empty party hall on screen builds no band.
    settle(focus({ zoom: 2.4, dominant: "partyHall", hour: 20, crowd: 0.01 }));
    expect(parts().length).toBe(baseline);
    // A live party starts the band's looping part...
    settle(focus({ zoom: 2.4, dominant: "partyHall", hour: 20, crowd: 0.7 }));
    expect(parts().length).toBe(baseline + 1);
    const bandPart = parts()[parts().length - 1];
    expect(bandPart.started).toBe(true);
    // ...and leaving the scene tears it down.
    settle(focus({ zoom: 2.4, dominant: "office", hour: 10, crowd: 0.6 }));
    expect(bandPart.disposed).toBe(true);
  });

  it("REGRESSION: every crowd noise source sits behind a steep rolloff -48 filter", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    const steepInto = (rec: NodeRec) =>
      rec.connects.some(
        (t) => t.kind === "Filter" && ((t.args[0] ?? {}) as { rolloff?: number }).rolloff === -48,
      );
    // The crowd layer's NoiseSynth (venue bursts) and the metro's brown rumble
    // must both pass the audition's no-static rule. The room-tone bed now takes
    // the same steep treatment (a steep rolloff -48 lowpass, per-scene cutoff);
    // only the rain layer keeps its own deliberate 600-3000 Hz band-shaping.
    const noiseSynths = graph.nodes.filter((n) => n.kind === "NoiseSynth");
    expect(noiseSynths.length).toBeGreaterThan(0);
    for (const n of noiseSynths) expect(steepInto(n)).toBe(true);
    const rumble = graph.nodes.find(
      (n) => n.kind === "Noise" && String(n.args[0]) === "brown",
    );
    expect(rumble, "metro rumble missing").toBeTruthy();
    expect(steepInto(rumble!)).toBe(true);
  });

  it("applies each scene's murmur level (the hotel whispers)", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    const settle = (f: ViewFocus) => {
      eng.update(f);
      eng.update(f);
    };
    settle(focus({ zoom: 2.4, dominant: "hotelSuite", hour: 12, crowd: 0.6 }));
    // Some gain ramped to the hotel's 0.24 murmur level from the spec table.
    const rampedToHotel = graph.nodes.some(
      (n) => n.kind === "Gain" && n.ramps.some((r) => r[0] === 0.24),
    );
    expect(rampedToHotel).toBe(true);
  });

  it("volume sliders land perceptually: zero is zero, half is a quarter gain", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    eng.setVolumes(0, 0.3, 0.5);
    const ramps = graph.nodes.filter((n) => n.kind === "Gain").flatMap((n) => n.ramps);
    expect(ramps.some((r) => r[0] === 0)).toBe(true); // music slider at zero silences its bus
    expect(ramps.some((r) => Math.abs((r[0] as number) - 0.09) < 1e-9)).toBe(true); // ambience at 0.3 ramps to 0.3^2
    expect(ramps.some((r) => r[0] === 0.25)).toBe(true); // sfx at half ramps to 0.5^2
  });

  it("dispose tears the built graph down", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    expect(() => eng.dispose()).not.toThrow();
  });
});
