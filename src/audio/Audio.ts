import type { ViewFocus } from "../render/excalibur/TowerEngine";
import type { SfxName } from "./ToneAudioEngine";
import type { ProgramKind } from "./toneTracks";

export type { SfxName };
export type { ProgramKind };

/** The subset of the Tone engine the facade constructs and drives. Declared
 *  structurally (rather than importing the concrete class) so the loader is a
 *  clean injectable seam — tests supply any object with this shape, no
 *  dynamic-import mocking required. */
interface AudioEngineImpl {
  readonly started: boolean;
  start(): void;
  setMuted(m: boolean): void;
  setVolumes(music: number, ambience: number, sfx: number): void;
  setProgram(program: ProgramKind): void;
  update(focus: ViewFocus): void;
  sfx(name: SfxName): void;
  dispose(): void;
}

/** What the lazy engine chunk exposes: a zero-arg engine constructor. */
type EngineModule = { ToneAudioEngine: new () => AudioEngineImpl };

/**
 * Lightweight synchronous facade over the procedural {@link ToneAudioEngine}.
 *
 * The real engine pulls in all of Tone.js (~230 kB), none of which is audible
 * until the player's first gesture (browser autoplay policy). So this facade —
 * which carries NO `tone` import — is what the app constructs at boot, and it
 * defers `await import("./ToneAudioEngine")` until the first {@link start} call.
 * That keeps Tone out of the initial `main` chunk; it lands in its own async
 * chunk instead (still precached by the service worker for offline audio).
 *
 * The facade mirrors the engine's public surface exactly, so callers
 * (`main.ts` and the `Pick<AudioEngine, "sfx">` consumers) are unchanged. State
 * that must be readable synchronously — `muted`, `started` — lives here and is
 * forwarded to the real engine once it loads; every other call is a no-op until
 * then, which matches the engine's own pre-`start()` behavior.
 */
export class AudioEngine {
  /** Authoritative mute state — read synchronously by the UI toggle, forwarded
   *  to the real engine on load. */
  muted = false;
  /** Authoritative player volume levels 0..1 (music / crowd & room ambience /
   *  action jingles), read synchronously by the settings sliders and forwarded
   *  to the real engine on load. Independent of `muted`. */
  musicVolume = 1;
  ambienceVolume = 1;
  sfxVolume = 1;
  /** Which composed track should play. Stored here (start screen vs. tower) so
   *  a pre-load switch lands on the engine the moment it builds. */
  program: ProgramKind = "game";
  /** True once the real engine has loaded and started. */
  started = false;

  private impl: AudioEngineImpl | null = null;
  /** In-flight guard so repeated gestures don't kick off duplicate imports. */
  private loading = false;
  /** Bumped whenever `start()` kicks off a new load and by every `dispose()`. A
   *  resolving import that captured an older value is stale — a `dispose()` or a
   *  superseding load happened mid-flight — and must abandon rather than
   *  resurrect a torn-down engine. */
  private generation = 0;
  /** Latest focus seen before the engine loaded, replayed once it's ready so the
   *  correct scene is showing immediately rather than a frame later. */
  private lastFocus: ViewFocus | null = null;

  /**
   * @param loadEngine Loader for the heavy Tone engine chunk. Defaults to the
   *   dynamic `import()` that produces the lazy async chunk — the whole point of
   *   this facade. Injectable purely so tests can supply a synchronous stub
   *   instead of exercising the bundler's code-split at runtime.
   */
  constructor(private readonly loadEngine: () => Promise<EngineModule> = () => import("./ToneAudioEngine")) {}

  /** Load (once) and start the real engine. Must be called from a user gesture. */
  start(): void {
    if (this.impl) {
      this.impl.start();
      this.started = this.impl.started;
      return;
    }
    if (this.loading) return;
    // Feature-detect BEFORE importing so tests / SSR / unsupported environments
    // stay fully inert and never fetch the audio chunk — matching the engine's
    // own no-op-without-WebAudio contract.
    const g = globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown };
    if (typeof g.AudioContext === "undefined" && typeof g.webkitAudioContext === "undefined") return;
    this.loading = true;
    const generation = ++this.generation;
    void this.loadEngine()
      .then(({ ToneAudioEngine }) => {
        // A dispose() (or a superseding start()) during the load window bumped
        // `generation`; abandon this stale load — never resurrect a torn-down
        // engine — and leave `loading` to whoever now owns it.
        if (generation !== this.generation) return;
        this.loading = false;
        const impl = new ToneAudioEngine();
        // Adopt the instance BEFORE start()/setMuted() so that if engine init
        // throws (a live AudioContext already allocated in the constructor), it
        // stays reachable by dispose() rather than leaking as an orphan.
        this.impl = impl;
        impl.setMuted(this.muted);
        impl.setVolumes(this.musicVolume, this.ambienceVolume, this.sfxVolume);
        impl.setProgram(this.program);
        impl.start();
        this.started = impl.started;
        if (this.lastFocus) impl.update(this.lastFocus);
      })
      .catch(() => {
        // Chunk failed to load (offline first-run, blocked request) — stay
        // silent and let a later gesture retry. Only clear our own guard.
        if (generation === this.generation) this.loading = false;
      });
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.impl?.setMuted(m);
  }

  /** Choose the composed track: `"splash"` on the start screen, `"game"` in
   *  the tower. Stored synchronously and forwarded to the engine (now if it's
   *  loaded, otherwise when it builds). */
  setProgram(program: ProgramKind): void {
    this.program = program;
    this.impl?.setProgram(program);
  }

  /** Set the player volume levels (0..1 each). Inputs are clamped, and a
   *  non-finite value keeps that channel's current level (NaN would slip
   *  through a min/max clamp and later blow up the native AudioParam ramp),
   *  so synchronous readers of the fields always see the same sane values
   *  the engine gets. */
  setVolumes(music: number, ambience: number, sfx: number): void {
    this.musicVolume = saneLevel(music, this.musicVolume);
    this.ambienceVolume = saneLevel(ambience, this.ambienceVolume);
    this.sfxVolume = saneLevel(sfx, this.sfxVolume);
    this.impl?.setVolumes(this.musicVolume, this.ambienceVolume, this.sfxVolume);
  }

  update(focus: ViewFocus): void {
    this.lastFocus = focus;
    this.impl?.update(focus);
  }

  sfx(name: SfxName): void {
    this.impl?.sfx(name);
  }

  dispose(): void {
    // Invalidate any in-flight load so it can't resurrect us, and release the
    // guard so a later start() can retry cleanly.
    this.generation++;
    this.loading = false;
    this.impl?.dispose();
    this.impl = null;
    this.started = false;
  }
}

/** Clamp a level into 0..1; a non-finite input falls back to `prev`. */
function saneLevel(v: number, prev: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : prev;
}
