import { describe, it, expect, vi } from "vitest";
import { scheduleStep, maybeAccent, accentHit, type AccentNodes } from "./toneVoices";
import type { Accent, SceneDef } from "./toneScenes";

/**
 * scheduleStep is an exported synthesis helper (extracted from the engine's
 * inline sequencer). These tests pin the public contract that matters once it is
 * callable from outside: it only ever hands finite frequencies to the lead
 * voice, and it plays nothing rather than a NaN note when a scene has no scale.
 */

const BASE: SceneDef = {
  scale: [0, 2, 4, 5, 7, 9, 11],
  root: 60,
  bpm: 100,
  wave: "sine",
  pad: [0, 4, 7],
  density: 1, // always plays, so the note path is exercised every call
  gain: 0.5,
  bass: 0.3,
  amb: { type: "lowpass", freq: 200, q: 0.7, gain: 0.2 },
  accent: "none",
};

function fakeLead() {
  return { triggerAttackRelease: vi.fn() };
}

describe("scheduleStep", () => {
  it("only ever schedules finite frequencies for a normal scene", () => {
    const lead = fakeLead();
    // Walk a full bar across several ticks so on-beat (pad) and off-beat (scale)
    // branches, plus the overview and sparkle doublings, all get exercised.
    for (let step = 0; step < 16; step++) {
      scheduleStep(lead as never, BASE, "overview", step, step + 1, 0.6, 0);
    }
    expect(lead.triggerAttackRelease).toHaveBeenCalled();
    for (const call of lead.triggerAttackRelease.mock.calls) {
      expect(Number.isFinite(call[0] as number)).toBe(true);
    }
  });

  it("plays nothing (no NaN note) when the scene has an empty scale", () => {
    const lead = fakeLead();
    // step 1 is off-beat, so without the guard this hits the scale branch and
    // indexes an empty array; the guard must short-circuit instead.
    scheduleStep(lead as never, { ...BASE, scale: [], pad: [] }, "office", 1, 1, 0.6, 0);
    expect(lead.triggerAttackRelease).not.toHaveBeenCalled();
  });
});

/** Recording stand-ins for the accent nodes (three sound voices: synth,
 *  membrane, noise; plus their shared filter). The synth/membrane voices take a
 *  frequency as their first trigger arg; the noise voice takes a duration
 *  string, so only the tonal voices are checked for finite pitch. */
function fakeAccentNodes() {
  const calls = { synth: [] as unknown[][], membrane: [] as unknown[][], noise: [] as unknown[][] };
  const nodes: AccentNodes = {
    accentSynth: { triggerAttackRelease: (...a: unknown[]) => calls.synth.push(a) },
    membrane: { triggerAttackRelease: (...a: unknown[]) => calls.membrane.push(a) },
    noiseAccent: { triggerAttackRelease: (...a: unknown[]) => calls.noise.push(a) },
    accentFilter: { type: "bandpass", frequency: { value: 0 }, Q: { value: 0 } },
  } as unknown as AccentNodes;
  const total = () => calls.synth.length + calls.membrane.length + calls.noise.length;
  return { nodes, calls, total };
}

describe("accentHit", () => {
  const accents: Exclude<Accent, "none">[] = ["ding", "clatter", "keys", "rumble", "boom", "register", "chatter"];

  it("dispatches every accent to a voice with finite pitches and never throws", () => {
    for (const a of accents) {
      const { nodes, calls, total } = fakeAccentNodes();
      expect(() => accentHit(nodes, a, 0)).not.toThrow();
      expect(total(), `accent ${a} triggered nothing`).toBeGreaterThan(0);
      for (const c of [...calls.synth, ...calls.membrane]) {
        expect(Number.isFinite(c[0] as number)).toBe(true);
      }
    }
  });
});

describe("maybeAccent", () => {
  const withAccent = (accent: Accent): SceneDef => ({ ...BASE, accent });

  it("never fires for a no-accent scene", () => {
    const { nodes, total } = fakeAccentNodes();
    for (let t = 0; t < 100; t++) maybeAccent(nodes, withAccent("none"), t, 1, 0);
    expect(total()).toBe(0);
  });

  it("fires occasionally when zoomed in (drives the dispatch)", () => {
    const { nodes, total } = fakeAccentNodes();
    // Over many ticks at full detail some pass the rarity gate, so at least one
    // accent lands (the exact count is deterministic but not asserted).
    for (let t = 0; t < 3000; t++) maybeAccent(nodes, withAccent("ding"), t, 1, 0);
    expect(total()).toBeGreaterThan(0);
  });
});
