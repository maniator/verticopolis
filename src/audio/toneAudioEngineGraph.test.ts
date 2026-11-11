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

vi.mock("tone", async () => (await import("./toneRecordingMock")).toneMock());

import { beat, graph, type NodeRec } from "./toneRecordingMock";
import { ToneAudioEngine, type SfxName } from "./ToneAudioEngine";
import { SCENES, type Scene } from "./toneScenes";

/** A built node's record, read through the recording mock's `__rec` handle. */
const recOf = (n: unknown): NodeRec => (n as { __rec: NodeRec }).__rec;

/** The engine's private graph state the assertions below read. */
type Inner = { scene: Scene; ambFilter: unknown; rain: { rainGain: unknown } | null; started: boolean };
const inner = (eng: ToneAudioEngine): Inner => eng as unknown as Inner;

/** Every one-shot note any built node has been asked to play so far. */
const triggerCount = (): number => graph.nodes.reduce((sum, n) => sum + n.triggers.length, 0);

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
    const expected: Scene[] = ["overview", "office", "hotel", "food", "cinema", "service", "outside", "metro", "overview"];
    const ambFilter = recOf(inner(eng).ambFilter);
    path.forEach((f, i) => {
      const before = ambFilter.ramps.length;
      eng.update(f);
      expect(inner(eng).scene, `step ${i}`).toBe(expected[i]);
      // The scene change reached the graph: the room-tone filter glides to the scene's cutoff.
      expect(ambFilter.ramps.slice(before), `step ${i}`).toContainEqual([SCENES[expected[i]].amb.freq, 1.2]);
    });
  });

  it("holds the overview scene between the enter and exit zooms (hysteresis)", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    eng.update(focus({ zoom: 0.5, dominant: "office" })); // below the enter threshold
    expect(inner(eng).scene).toBe("overview");
    eng.update(focus({ zoom: 0.6, dominant: "office" })); // between enter and exit: stays latched
    expect(inner(eng).scene).toBe("overview");
    eng.update(focus({ zoom: 0.7, dominant: "office" })); // past the exit threshold
    expect(inner(eng).scene).toBe("office");
  });

  it("sfx() plays every cue once the graph is up", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    const names: SfxName[] = ["build", "sell", "error", "promote", "money", "notify", "click", "tick"];
    for (const n of names) {
      const before = triggerCount();
      eng.sfx(n);
      expect(triggerCount(), n).toBeGreaterThan(before);
    }
  });

  it("the recorded percussion bypasses the music tone filters on its way to the bus", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    // Both membranes (heartbeat thump + object tap) must reach the reverb via
    // gain nodes ONLY: the music chain's lowpass would dull the tap's click
    // and its highpass would gut the thump's body, so a Filter anywhere on the
    // path is the regression this test exists to catch.
    // The crowd layer builds membranes of its own (the party kick), so pick
    // the two percussion voices by their authored tunings.
    const membranes = graph.nodes.filter(
      (n) =>
        n.kind === "MembraneSynth" &&
        [0.045, 0.008].includes((n.args[0] as { pitchDecay?: number } | undefined)?.pitchDecay ?? -1),
    );
    expect(membranes.length).toBe(2);
    // Walk EVERY connect edge (not just the first) so a second connection
    // sneaking a Filter onto the perc path cannot hide from this test.
    const reachable = (from: NodeRec): NodeRec[] => {
      const seen = new Set<NodeRec>();
      const queue = [from];
      while (queue.length) {
        const cur = queue.pop()!;
        for (const next of cur.connects) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      return [...seen];
    };
    for (const m of membranes) {
      const downstream = reachable(m);
      expect(
        downstream.some((n) => n.kind === "Reverb"),
        "membrane never reaches the reverb",
      ).toBe(true);
      expect(
        downstream.filter((n) => n.kind === "Filter"),
        "a Filter sneaked onto the perc path",
      ).toEqual([]);
    }
    // Contrast: the melody path deliberately DOES pass the warm filters.
    const poly = graph.nodes.filter((n) => n.kind === "PolySynth");
    const filtered = poly.some((p) => reachable(p).some((n) => n.kind === "Filter"));
    expect(filtered).toBe(true);
  });

  it("mute silences sfx; unmute restores — neither throws", () => {
    const eng = new ToneAudioEngine();
    eng.start();
    expect(() => eng.setMuted(true)).not.toThrow();
    const muted = triggerCount();
    expect(() => eng.sfx("build")).not.toThrow(); // muted → no-op path
    expect(triggerCount()).toBe(muted);
    expect(() => eng.update(focus({ zoom: 2 }))).not.toThrow();
    expect(() => eng.setMuted(false)).not.toThrow();
    const unmuted = triggerCount();
    eng.sfx("build");
    expect(triggerCount()).toBeGreaterThan(unmuted);
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
    const rain = recOf(inner(eng).rain!.rainGain);
    eng.update(focus({ zoom: 0.3, dominant: "empty", centerFloor: 30, weather: "rain" }));
    expect(rain.ramps[rain.ramps.length - 1]).toEqual([0.13, 1.5]); // the sky is in view from the overview
    const ramps = rain.ramps.length;
    eng.update(focus({ zoom: 1.6, dominant: "outside", weather: "rain" }));
    expect(rain.ramps.length).toBe(ramps); // still outdoors: the level holds, no new ramp
    eng.update(focus({ zoom: 2.2, dominant: "office", weather: "rain" }));
    expect(rain.ramps[rain.ramps.length - 1]).toEqual([0, 1.5]); // indoors → no rain
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
    // The room-tone bed's pink noise (constructed with the bare "pink" string,
    // unlike the rain layer's `{ type: "pink", ... }` options object) must sit
    // behind the steep filter too: it is the de-static change, and without this
    // pin a future edit could drop it back to a bright bandpass and stay green.
    const roomTone = graph.nodes.find(
      (n) => n.kind === "Noise" && n.args[0] === "pink",
    );
    expect(roomTone, "room-tone pink noise missing").toBeTruthy();
    expect(steepInto(roomTone!)).toBe(true);
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
    // Every audio node start() built, music, sfx, ambience, rain and crowd alike.
    // The anonymous chainable stubs (Transport, context) are not graph nodes.
    const built = graph.nodes.filter((n) => n.kind !== "anon" && n.kind !== "Context");
    expect(built.length).toBeGreaterThan(0);
    eng.dispose();
    expect(inner(eng).started).toBe(false);
    expect(inner(eng).ambFilter).toBeNull();
    expect(inner(eng).rain).toBeNull();
    const leaked = built.filter((n) => !n.disposed && n.kind !== "ToneAudioBuffer").map((n) => `${n.kind} #${graph.nodes.indexOf(n)}`);
    expect(leaked, "nodes still alive after dispose").toEqual([]);
  });
});
