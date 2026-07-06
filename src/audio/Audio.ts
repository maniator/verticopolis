import type { ViewFocus } from "../render/excalibur/TowerEngine";
import type { SfxName, ToneAudioEngine } from "./ToneAudioEngine";

export type { SfxName };

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
  /** True once the real engine has loaded and started. */
  started = false;

  private impl: ToneAudioEngine | null = null;
  /** In-flight guard so repeated gestures don't kick off duplicate imports. */
  private loading = false;
  /** Latest focus seen before the engine loaded, replayed once it's ready so the
   *  correct scene is showing immediately rather than a frame later. */
  private lastFocus: ViewFocus | null = null;

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
    void import("./ToneAudioEngine")
      .then(({ ToneAudioEngine }) => {
        this.loading = false;
        const impl = new ToneAudioEngine();
        impl.setMuted(this.muted);
        impl.start();
        this.impl = impl;
        this.started = impl.started;
        if (this.lastFocus) impl.update(this.lastFocus);
      })
      .catch(() => {
        // Chunk failed to load (offline first-run, blocked request) — stay
        // silent and let a later gesture retry.
        this.loading = false;
      });
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.impl?.setMuted(m);
  }

  update(focus: ViewFocus): void {
    this.lastFocus = focus;
    this.impl?.update(focus);
  }

  sfx(name: SfxName): void {
    this.impl?.sfx(name);
  }

  dispose(): void {
    this.impl?.dispose();
    this.impl = null;
    this.started = false;
  }
}
