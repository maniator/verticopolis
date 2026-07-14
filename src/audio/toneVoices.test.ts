import { describe, it, expect, vi } from "vitest";
import { scheduleStep } from "./toneVoices";
import type { SceneDef } from "./toneScenes";

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
