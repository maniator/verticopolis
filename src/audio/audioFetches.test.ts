import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewFocus } from "../render/excalibur/TowerEngine";
import { AUDIO_RUNTIME_FILES } from "./audioAssets";

/**
 * The offline PWA (#985) plays every sound only if each file the audio layer
 * fetches is in AUDIO_RUNTIME_FILES, which scripts/verify-precache.ts checks
 * against the service worker's manifest. This runs the engine's real start-up
 * against a recording Tone.js and compares what it asks for with that list, so
 * a sound added to the code without the list fails here, however its path is
 * spelled. The same loaders run in the offline browser spec
 * (e2e/offline.spec.ts), which sees every audio request the page makes.
 */
vi.mock("tone", async () => (await import("./toneRecordingMock")).toneMock());
vi.mock("./lightSynth", async () => (await import("./toneRecordingMock")).lightSynthMock());

import { graph } from "./toneRecordingMock";
import { ToneAudioEngine, type SfxName } from "./ToneAudioEngine";

const focus = (over: Partial<ViewFocus>): ViewFocus => ({ centerFloor: 5, dominant: "office", night: false, zoom: 2, ...over }) as ViewFocus;
/** The scenes the engine can sit in, and every cue: a loader on a later code
 *  path (a scene change, a program swap, a cue) has to run before the
 *  comparison, or the test would not see it. */
const FOCUSES = [
  focus({ zoom: 0.3, dominant: "empty", centerFloor: 1 }),
  focus({ dominant: "office" }),
  focus({ dominant: "hotelSuite" }),
  focus({ dominant: "restaurant" }),
  focus({ dominant: "cinema" }),
  focus({ dominant: "security" }),
  focus({ zoom: 1.6, dominant: "outside" }),
  focus({ dominant: "empty", centerFloor: -3 }),
  focus({ night: true }),
];
const CUES: SfxName[] = ["build", "sell", "error", "promote", "money", "notify", "click"];

describe("the files the audio engine fetches at run time", () => {
  let prevAudioContext: unknown;
  beforeEach(() => {
    prevAudioContext = (globalThis as { AudioContext?: unknown }).AudioContext;
    (globalThis as { AudioContext?: unknown }).AudioContext = function () {}; // pass the hasWebAudio gate
    graph.nodes.length = 0;
  });
  afterEach(() => {
    if (prevAudioContext === undefined) delete (globalThis as { AudioContext?: unknown }).AudioContext;
    else (globalThis as { AudioContext?: unknown }).AudioContext = prevAudioContext as never;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("are exactly the files AUDIO_RUNTIME_FILES lists, each under the site base", () => {
    // Tone's own loader is the mock here, so any fetch or element load the
    // engine made itself would reach these spies.
    const fetchSpy = vi.fn();
    const audioElement = vi.fn();
    const xhr = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("Audio", audioElement);
    vi.stubGlobal("XMLHttpRequest", xhr);
    const createElement = vi.spyOn(document, "createElement");

    const engine = new ToneAudioEngine();
    engine.start();
    expect((engine as unknown as { started: boolean }).started, "the graph built, so the loaders ran").toBe(true);
    engine.setProgram("game");
    for (const f of FOCUSES) engine.update(f);
    for (const cue of CUES) engine.sfx(cue);

    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "./";
    const requested = graph.nodes.filter((n) => n.kind === "ToneAudioBuffer" && typeof n.args[0] === "string").map((n) => String(n.args[0]));
    expect(requested.sort()).toEqual(AUDIO_RUNTIME_FILES.map((f) => `${base}${f}`).sort());
    expect(fetchSpy, "every file goes through Tone's buffer loader").not.toHaveBeenCalled();
    expect(xhr, "no XMLHttpRequest is made").not.toHaveBeenCalled();
    expect(audioElement, "no HTMLAudioElement is created").not.toHaveBeenCalled();
    expect(createElement.mock.calls.filter(([tag]) => /^(?:audio|video|source)$/i.test(String(tag))), "no media element is created").toEqual([]);
    engine.dispose();
  });
});
