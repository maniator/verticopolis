import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The first gesture's cue (#554): the gesture that starts the audio also fires
 * its own cue, while `Tone.start()` is still waking the context. Driven with
 * the recording Tone mock, as in `toneAudioEngineGraph.test.ts`, whose
 * `Tone.start()` settles on the next microtask.
 */

vi.mock("tone", async () => (await import("./toneRecordingMock")).toneMock());
vi.mock("./lightSynth", async () => (await import("./toneRecordingMock")).lightSynthMock());

import { beat, graph, resetToneFaults, toneFaults } from "./toneRecordingMock";
import { ToneAudioEngine } from "./ToneAudioEngine";

const triggerCount = (): number => graph.nodes.reduce((sum, n) => sum + n.triggers.length, 0);
/** Let `Tone.start()` settle and its handler run. */
const unlockLands = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("ToneAudioEngine: the cue fired while the context unlocks", () => {
  let prevAudioContext: unknown;
  beforeEach(() => {
    prevAudioContext = (globalThis as { AudioContext?: unknown }).AudioContext;
    (globalThis as { AudioContext?: unknown }).AudioContext = function () {};
    beat.step = null;
    graph.nodes.length = 0;
    resetToneFaults();
  });
  afterEach(() => {
    if (prevAudioContext === undefined) delete (globalThis as { AudioContext?: unknown }).AudioContext;
    else (globalThis as { AudioContext?: unknown }).AudioContext = prevAudioContext as never;
    beat.step = null;
    resetToneFaults();
  });

  /** How many notes one "build" cue plays on a running context. */
  const buildNotes = async (): Promise<number> => {
    const eng = new ToneAudioEngine();
    eng.start();
    await unlockLands();
    const before = triggerCount();
    eng.sfx("build");
    const n = triggerCount() - before;
    eng.dispose();
    graph.nodes.length = 0;
    return n;
  };

  it("plays the latest cue fired before the unlock landed, once, when it lands", async () => {
    const perBuild = await buildNotes();
    expect(perBuild).toBeGreaterThan(0);
    const eng = new ToneAudioEngine();
    eng.start(); // Tone.start() is still settling
    toneFaults.contextState = "suspended";
    const before = triggerCount();
    eng.sfx("click");
    eng.sfx("build");
    expect(triggerCount()).toBe(before);
    toneFaults.contextState = "running";
    await unlockLands();
    expect(triggerCount() - before).toBe(perBuild);
  });

  it("never replays a cue dropped while the context was suspended after the unlock", async () => {
    const eng = new ToneAudioEngine();
    eng.start();
    await unlockLands();
    toneFaults.contextState = "suspended"; // a backgrounded tab
    const before = triggerCount();
    eng.sfx("build");
    toneFaults.contextState = "running";
    await unlockLands();
    expect(triggerCount()).toBe(before);
  });
});
