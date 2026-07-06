import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
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

// Capture the environment's real AudioContext (if any) once, so each test can
// stub it and afterEach can restore the exact original — never leaking a stub
// into sibling tests.
const realAudioContext = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");

/** The facade's injectable loader signature, specialized to the stub engine. */
type TestLoader = () => Promise<{ ToneAudioEngine: typeof StubEngine }>;

describe("AudioEngine facade lazy loading", () => {
  // Reset per test: a fresh spy loader that resolves with the stub engine.
  let loader: Mock<TestLoader>;

  beforeEach(() => {
    built.length = 0;
    loader = vi.fn<TestLoader>(() => Promise.resolve({ ToneAudioEngine: StubEngine }));
    (globalThis as { AudioContext?: unknown }).AudioContext = class {};
  });
  afterEach(() => {
    if (realAudioContext) Object.defineProperty(globalThis, "AudioContext", realAudioContext);
    else delete (globalThis as { AudioContext?: unknown }).AudioContext;
  });

  it("does not load or construct the engine until start()", () => {
    const audio = new AudioEngine(loader);
    expect(loader).not.toHaveBeenCalled();
    expect(built).toHaveLength(0);
    expect(audio.started).toBe(false);
  });

  it("loads and starts the engine on the first start()", async () => {
    const audio = new AudioEngine(loader);
    audio.start();
    await vi.waitFor(() => expect(audio.started).toBe(true));
    expect(loader).toHaveBeenCalledTimes(1);
    expect(built).toHaveLength(1);
    expect(built[0].started).toBe(true);
  });

  it("stays inert with no WebAudio and never loads the engine", () => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    const audio = new AudioEngine(loader);
    audio.start(); // feature check fails → returns before loading
    expect(loader).not.toHaveBeenCalled();
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

  it("loads the chunk only once across repeated start() calls", async () => {
    const audio = new AudioEngine(loader);
    audio.start();
    audio.start(); // second gesture while loading — guarded, no second load
    await vi.waitFor(() => expect(audio.started).toBe(true));
    audio.start(); // after load — delegates to the existing engine
    expect(loader).toHaveBeenCalledTimes(1);
    expect(built).toHaveLength(1);
  });

  it("forwards setMuted() and update() to the live engine after load", async () => {
    const audio = new AudioEngine(loader);
    audio.start();
    await vi.waitFor(() => expect(audio.started).toBe(true));
    const focus = { zoom: 3, dominant: "food", centerFloor: 8, weather: "clear" };
    audio.setMuted(true);
    audio.update(focus as never);
    expect(built[0].muted).toBe(true);
    expect(built[0].lastFocus).toBe(focus);
  });

  it("replays the latest pre-load focus onto the engine once loaded", async () => {
    const audio = new AudioEngine(loader);
    const focus = { zoom: 2, dominant: "office", centerFloor: 5, weather: "clear" };
    audio.update(focus as never);
    audio.start();
    await vi.waitFor(() => expect(audio.started).toBe(true));
    expect(built[0].lastFocus).toBe(focus);
  });

  it("tears down the live engine on dispose() after a successful load", async () => {
    const audio = new AudioEngine(loader);
    audio.start();
    await vi.waitFor(() => expect(audio.started).toBe(true));
    audio.dispose();
    expect(built[0].disposed).toBe(true);
    expect(audio.started).toBe(false);
  });

  it("does not resurrect a torn-down engine, and restarts cleanly, when dispose() interrupts a load", async () => {
    const audio = new AudioEngine(loader);
    audio.start(); // load #1 in flight
    audio.dispose(); // invalidates #1 mid-load
    audio.start(); // load #2 — the one that should win
    await vi.waitFor(() => expect(audio.started).toBe(true));
    // The abandoned #1 resolves first (microtask order) and hits the generation
    // guard, so it never constructs — exactly one engine is ever built.
    expect(built).toHaveLength(1);
  });

  it("stays silent when the load fails, and retries on a later gesture", async () => {
    let failNext = true;
    const flaky = vi.fn<TestLoader>(() =>
      failNext ? Promise.reject(new Error("chunk fetch failed")) : Promise.resolve({ ToneAudioEngine: StubEngine }),
    );
    const audio = new AudioEngine(flaky);

    audio.start(); // attempt #1 rejects
    await vi.waitFor(() => expect(flaky).toHaveBeenCalledTimes(1));
    expect(audio.started).toBe(false);
    expect(built).toHaveLength(0);

    // The failure must have released the in-flight guard so a later gesture can
    // retry. Poll start() until the (now-succeeding) load takes.
    failNext = false;
    await vi.waitFor(() => {
      audio.start();
      expect(audio.started).toBe(true);
    });
    expect(flaky).toHaveBeenCalledTimes(2);
    expect(built).toHaveLength(1);
  });
});
