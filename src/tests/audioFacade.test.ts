import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "../audio/Audio";

/**
 * The AudioEngine facade (src/audio/Audio.ts) is a thin synchronous shell that
 * lazy-loads the heavy Tone.js engine on the first user-gesture `start()`. Its
 * loader is an injectable seam, so these tests hand it a synchronous stub engine
 * and exercise the facade's load/dispose/mute bookkeeping directly — no
 * dynamic-import or Tone/WebAudio involved. Post-load assertions use
 * `vi.waitFor`; cases where the facade never loads (no gesture / no WebAudio)
 * are synchronous and asserted directly.
 */

// A stand-in engine that records how the facade drives it.
const built: StubEngine[] = [];
class StubEngine {
  started = false;
  muted = false;
  disposed = false;
  lastFocus: unknown = null;
  constructor() {
    built.push(this);
  }
  start(): void {
    this.started = true;
  }
  setMuted(m: boolean): void {
    this.muted = m;
  }
  update(focus: unknown): void {
    this.lastFocus = focus;
  }
  sfx(): void {}
  dispose(): void {
    this.disposed = true;
    this.started = false;
  }
}

/** The injected loader — resolves asynchronously (like the real import) but with
 *  our stub, so no chunk is loaded. */
const loader = () => Promise.resolve({ ToneAudioEngine: StubEngine });

describe("AudioEngine facade lazy loading", () => {
  const hadAudioContext = "AudioContext" in globalThis;
  beforeEach(() => {
    built.length = 0;
    (globalThis as { AudioContext?: unknown }).AudioContext = class {};
  });
  afterEach(() => {
    if (!hadAudioContext) delete (globalThis as { AudioContext?: unknown }).AudioContext;
  });

  it("does not construct the engine until start()", () => {
    const audio = new AudioEngine(loader);
    expect(built).toHaveLength(0);
    expect(audio.started).toBe(false);
  });

  it("loads and starts the engine on the first start()", async () => {
    const audio = new AudioEngine(loader);
    audio.start();
    await vi.waitFor(() => expect(audio.started).toBe(true));
    expect(built).toHaveLength(1);
    expect(built[0].started).toBe(true);
  });

  it("stays inert with no WebAudio and never loads the engine", () => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    const audio = new AudioEngine(loader);
    audio.start(); // feature check fails → returns before loading
    expect(built).toHaveLength(0);
    expect(audio.started).toBe(false);
  });

  it("forwards the current muted state to the engine on load", async () => {
    const audio = new AudioEngine(loader);
    audio.setMuted(true);
    audio.start();
    await vi.waitFor(() => expect(audio.started).toBe(true));
    expect(built[0].muted).toBe(true);
  });

  it("only loads/constructs once across repeated start() calls", async () => {
    const audio = new AudioEngine(loader);
    audio.start();
    audio.start(); // second gesture while loading — no duplicate load
    await vi.waitFor(() => expect(audio.started).toBe(true));
    audio.start(); // after load — delegates to the existing engine
    expect(built).toHaveLength(1);
  });

  it("does not resurrect a torn-down engine, and restarts cleanly, when dispose() interrupts a load", async () => {
    const audio = new AudioEngine(loader);
    audio.start(); // load #1 in flight
    audio.dispose(); // invalidates #1 mid-load
    audio.start(); // load #2 — the one that should win
    await vi.waitFor(() => expect(audio.started).toBe(true));
    // Exactly one engine built: the abandoned #1 resolves first (microtask
    // order) and hits the generation guard, so it never constructs.
    expect(built).toHaveLength(1);
  });

  it("replays the latest focus onto the engine once loaded", async () => {
    const audio = new AudioEngine(loader);
    const focus = { zoom: 2, dominant: "office", centerFloor: 5, weather: "clear" };
    audio.update(focus as never);
    audio.start();
    await vi.waitFor(() => expect(audio.started).toBe(true));
    expect(built[0].lastFocus).toBe(focus);
  });
});
