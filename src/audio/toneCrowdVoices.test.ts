import { describe, it, expect, vi } from "vitest";

// A tone mock whose buffer machinery always fails: the layer's promised
// degradation path is that missing/broken seeds leave the ambience tone-only,
// silently. Everything else the module touches is inert.
vi.mock("tone", () => ({
  ToneAudioBuffer: function () {
    throw new Error("no audio context");
  },
  ToneBufferSource: function () {
    throw new Error("no audio context");
  },
  now: () => 0,
}));

import { CrowdVoices } from "./toneCrowdVoices";

describe("CrowdVoices seed-loading failure", () => {
  it("degrades silently to tone-only: never ready, every voiced call a no-op", () => {
    const voices = new CrowdVoices();
    expect(() => voices.load("./")).not.toThrow();
    expect(voices.ready).toBe(false);
    const gain = {} as never;
    expect(voices.phrase(gain, -3, 1)).toBeNull();
    expect(() => voices.laugh(gain, 2)).not.toThrow();
    expect(() => voices.whoop(gain, 3)).not.toThrow();
    expect(() => voices.dispose()).not.toThrow();
  });
});
