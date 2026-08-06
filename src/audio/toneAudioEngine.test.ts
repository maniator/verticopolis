import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { ViewFocus } from "../render/excalibur/TowerEngine";
import { ToneAudioEngine, type SfxName } from "./ToneAudioEngine";
import { sceneFor, detailFor, midiToFreq, clamp, lerp, sameNotes } from "./toneScenes";

/**
 * ToneAudioEngine is the Web-Audio synthesis layer. This file unit-tests (1) the
 * pure scene/zoom/pitch math and (2) the load-bearing CONTRACT that with no
 * AudioContext (a test runner, a locked-down browser) the engine stays fully
 * inert — start() is a no-op and every control call is safe. The engine's graph
 * control flow (scene transitions, the beat sequencer, sfx dispatch) is exercised
 * separately in toneAudioEngineGraph.test.ts against a mocked Tone.js + a fake
 * AudioContext — the audio *nodes* are stubbed so it tests our logic, not Tone's.
 */

const focus = (over: Partial<ViewFocus> = {}): ViewFocus =>
  ({ centerFloor: 5, dominant: "office", night: false, zoom: 1, ...over }) as ViewFocus;

describe("audio scene selection (pure)", () => {
  it("the overview latch overrides everything", () => {
    expect(sceneFor(focus({ dominant: "outside" }), true)).toBe("overview");
  });

  it("maps the dominant facility (and basements) to a scene", () => {
    expect(sceneFor(focus({ dominant: "outside" }), false)).toBe("outside");
    expect(sceneFor(focus({ centerFloor: -3, dominant: "empty" }), false)).toBe("metro");
    expect(sceneFor(focus({ dominant: "office" }), false)).toBe("office");
    expect(sceneFor(focus({ dominant: "condo" }), false)).toBe("residential");
    expect(sceneFor(focus({ dominant: "hotelSuite" }), false)).toBe("hotel");
    expect(sceneFor(focus({ dominant: "restaurant" }), false)).toBe("food");
    expect(sceneFor(focus({ dominant: "shop" }), false)).toBe("retail");
    expect(sceneFor(focus({ dominant: "cinema" }), false)).toBe("cinema");
    expect(sceneFor(focus({ dominant: "security" }), false)).toBe("service");
  });

  it("falls back by height when nothing dominates: ground → lobby, high → quiet", () => {
    expect(sceneFor(focus({ dominant: "empty", centerFloor: 1 }), false)).toBe("lobby");
    expect(sceneFor(focus({ dominant: "empty", centerFloor: 40 }), false)).toBe("quiet");
  });
});

describe("audio math (pure)", () => {
  it("detailFor maps zoom to a bounded 0..1 closeness, zoomed-in > zoomed-out", () => {
    for (const z of [-5, 0, 0.3, 0.55, 1.7, 3, 100]) {
      const d = detailFor(z);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
    expect(detailFor(2)).toBeGreaterThan(detailFor(0.4));
    expect(detailFor(100)).toBe(1); // clamps in
    expect(detailFor(-100)).toBe(0);
  });

  it("midiToFreq is equal-tempered around A4 = 440Hz", () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(81)).toBeCloseTo(880, 6); // one octave up
    expect(midiToFreq(57)).toBeCloseTo(220, 6); // one octave down
  });

  it("clamp and lerp behave", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.25)).toBe(2.5);
  });

  it("sameNotes compares chords element-wise", () => {
    expect(sameNotes([60, 64, 67], [60, 64, 67])).toBe(true);
    expect(sameNotes([60, 64, 67], [60, 64, 68])).toBe(false);
    expect(sameNotes([60], [60, 64])).toBe(false);
  });
});

describe("inert-without-AudioContext contract", () => {
  let prevAudioContext: unknown;
  let prevWebkitAudioContext: unknown;
  beforeAll(() => {
    // Force the no-WebAudio path deterministically, regardless of what the test
    // DOM provides — this is the exact condition start() must survive. Save the
    // prior globals so a later suite in the same worker isn't left without them.
    prevAudioContext = (globalThis as { AudioContext?: unknown }).AudioContext;
    prevWebkitAudioContext = (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext;
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    delete (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext;
  });
  afterAll(() => {
    if (prevAudioContext !== undefined) (globalThis as { AudioContext?: unknown }).AudioContext = prevAudioContext;
    if (prevWebkitAudioContext !== undefined)
      (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext = prevWebkitAudioContext;
  });

  it("constructs, and start() is a silent no-op (no AudioContext)", () => {
    const eng = new ToneAudioEngine();
    expect(() => eng.start()).not.toThrow();
  });

  it("every control call is safe while inert (update / sfx / mute never throw)", () => {
    const eng = new ToneAudioEngine();
    eng.start(); // inert
    expect(() => eng.update(focus())).not.toThrow();
    const names: SfxName[] = ["build", "sell", "error", "promote", "money", "notify", "click"];
    for (const n of names) expect(() => eng.sfx(n)).not.toThrow();
    expect(() => eng.setMuted(true)).not.toThrow();
    expect(() => eng.setVolumes(0.5, 0.5, 0.5)).not.toThrow();
    expect(() => eng.setProgram("splash")).not.toThrow();
    expect(() => eng.setProgram("game")).not.toThrow();
  });

  it("dispose tears down safely even when nothing was ever built", () => {
    const eng = new ToneAudioEngine();
    eng.start(); // inert — no graph created
    expect(() => eng.dispose()).not.toThrow(); // guarded teardown over null nodes
    expect(() => eng.dispose()).not.toThrow(); // idempotent
  });
});
