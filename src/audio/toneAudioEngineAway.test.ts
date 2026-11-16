import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ViewFocus } from "../render/excalibur/TowerEngine";

/**
 * The player leaving the page (another tab, another app in front): the music
 * crackled there, because a background page's main thread is starved and
 * throttled and the notes it builds arrive late. Away, the engine fades out,
 * stops building notes and cues, quiets the crowd and puts the context to
 * sleep; back, it wakes at the player's own mute setting. Driven with the
 * recording Tone mock, as in `toneAudioEngineGraph.test.ts`.
 */

vi.mock("tone", async () => (await import("./toneRecordingMock")).toneMock());
vi.mock("./lightSynth", async () => (await import("./toneRecordingMock")).lightSynthMock());

import { contextCalls, graph, resetToneFaults, toneFaults, type NodeRec } from "./toneRecordingMock";
import { ToneAudioEngine } from "./ToneAudioEngine";

const triggerCount = (): number => graph.nodes.reduce((sum, n) => sum + n.triggers.length, 0);
/** The master gain: the first gain the build makes, the one `toDestination` takes. */
const master = (): NodeRec => graph.nodes.filter((n) => n.kind === "Gain")[0];
const lastRamp = (n: NodeRec): unknown[] | undefined => n.ramps[n.ramps.length - 1];
/** Play one note of the looping music part, as the Transport would. */
const playNote = (): void => {
  const part = graph.nodes.filter((n) => n.kind === "Part").pop();
  (part?.args[0] as (t: number, ev: object) => void)(0, { voice: "arp", midi: 60, dur: 0.2, vel: 0.5 });
};
const focus = (): ViewFocus => ({ centerFloor: 5, dominant: "office", night: false, zoom: 1 }) as ViewFocus;
type Crowd = { update: (...a: unknown[]) => void };
const crowdOf = (eng: ToneAudioEngine): Crowd => (eng as unknown as { crowd: Crowd }).crowd;

describe("ToneAudioEngine: the player leaving the page", () => {
  let prevAudioContext: unknown;
  let eng: ToneAudioEngine;
  beforeEach(() => {
    vi.useFakeTimers();
    prevAudioContext = (globalThis as { AudioContext?: unknown }).AudioContext;
    (globalThis as { AudioContext?: unknown }).AudioContext = function () {};
    graph.nodes.length = 0;
    resetToneFaults();
    eng = new ToneAudioEngine();
    eng.start();
    expect(master()).toBeDefined();
    contextCalls.length = 0;
  });
  afterEach(() => {
    eng.dispose();
    vi.useRealTimers();
    if (prevAudioContext === undefined) delete (globalThis as { AudioContext?: unknown }).AudioContext;
    else (globalThis as { AudioContext?: unknown }).AudioContext = prevAudioContext as never;
    resetToneFaults();
  });

  it("fades out, then puts the context to sleep once the fade has played", () => {
    eng.setAway(true);
    expect(lastRamp(master())).toEqual([0, 0.1]);
    vi.advanceTimersByTime(100);
    expect(contextCalls).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(contextCalls).toEqual(["suspend"]);
  });

  it("wakes the context and fades back in when the player returns", () => {
    eng.setAway(true);
    vi.advanceTimersByTime(200);
    eng.setAway(false);
    expect(contextCalls).toEqual(["suspend", "resume"]);
    expect(lastRamp(master())).toEqual([0.35, 0.1]);
  });

  it("never sleeps when the player is back before the fade ends", () => {
    eng.setAway(true);
    eng.setAway(false);
    vi.advanceTimersByTime(1000);
    expect(contextCalls).not.toContain("suspend");
  });

  it("comes back silent for a player who muted the game", () => {
    eng.setMuted(true);
    eng.setAway(true);
    vi.advanceTimersByTime(200);
    contextCalls.length = 0;
    eng.setAway(false);
    expect(contextCalls).toEqual([]);
    expect(lastRamp(master())).toEqual([0, 0.1]);
    eng.setMuted(false);
    expect(contextCalls).toEqual(["resume"]);
  });

  it("builds no music note and plays no cue while away", () => {
    playNote();
    eng.sfx("build");
    const heard = triggerCount();
    expect(heard).toBeGreaterThan(1);
    eng.setAway(true);
    playNote();
    eng.sfx("build");
    expect(triggerCount()).toBe(heard);
  });

  it("does not let a frame wake the sleeping context while the page is out of focus", () => {
    eng.setAway(true);
    vi.advanceTimersByTime(200);
    toneFaults.contextState = "suspended";
    eng.update(focus());
    expect(contextCalls).toEqual(["suspend"]);
    eng.setAway(false);
    eng.update(focus());
    expect(contextCalls.filter((c) => c === "resume").length).toBeGreaterThan(0);
  });

  it("builds silent and goes to sleep when the player left before the build", () => {
    eng.dispose();
    graph.nodes.length = 0;
    contextCalls.length = 0;
    eng = new ToneAudioEngine();
    eng.setAway(true);
    eng.start();
    expect(master().args[0]).toBe(0);
    vi.advanceTimersByTime(200);
    expect(contextCalls).toEqual(["suspend"]);
  });

  it("quiets the crowd at once, since a hidden page runs no frames", () => {
    eng.update(focus());
    const update = vi.spyOn(crowdOf(eng), "update");
    eng.setAway(true);
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0][3]).toBe(true);
    eng.update(focus());
    expect(update.mock.calls[1][3]).toBe(true);
  });
});
