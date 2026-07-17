import { describe, it, expect, vi } from "vitest";

// playSfx reads Tone.now() for its schedule base; everything else it touches
// is the synth the test injects, so a one-function mock keeps this suite off
// the real AudioContext.
vi.mock("tone", () => ({ now: () => 0 }));

import { playSfx } from "./toneVoices";
import type { SfxName } from "./toneScenes";

/**
 * toneVoices is now just the action jingles. These tests pin the public
 * contract: every jingle name schedules at least one note, and every pitch
 * handed to the synth is a finite frequency (a NaN would throw inside the
 * native AudioParam at runtime).
 */

function fakeSynth() {
  return { triggerAttackRelease: vi.fn() };
}

describe("playSfx", () => {
  const names: SfxName[] = ["build", "sell", "error", "promote", "money", "click"];

  it("schedules finite-frequency notes for every jingle", () => {
    for (const name of names) {
      const synth = fakeSynth();
      playSfx(synth as never, name);
      expect(synth.triggerAttackRelease, `jingle ${name} played nothing`).toHaveBeenCalled();
      for (const call of synth.triggerAttackRelease.mock.calls) {
        expect(Number.isFinite(call[0] as number)).toBe(true);
      }
    }
  });

  it("plays multi-note runs for the celebratory jingles", () => {
    for (const name of ["money", "promote"] as SfxName[]) {
      const synth = fakeSynth();
      playSfx(synth as never, name);
      expect(synth.triggerAttackRelease.mock.calls.length).toBeGreaterThanOrEqual(4);
    }
  });
});
