import type { GameApp } from "../main";
import { savePrefs, reducedMotionActive } from "../storage/Prefs";
import { trackAppAction, trackAppActionOnce } from "../analytics";

/**
 * Audio, accessibility, and steady-clock preference commands, split out of the
 * `GameApp` class as friend functions. They read the live `app.audio`/`app.prefs`
 * facade per call (never captured). The `GameAppPorts` members
 * (`toggleMute`/`setVolume`/`toggleReducedMotion`/`toggleSteadyClock`/`isSteadyClock`)
 * stay on `GameApp` as one-line delegators into these. Behavior unchanged.
 */

/** Toggle mute, persist it, and return the new muted state. */
export function toggleMute(app: GameApp): boolean {
  app.audio.start();
  app.audio.setMuted(!app.audio.muted);
  app.prefs.muted = app.audio.muted;
  savePrefs(app.prefs);
  // Keep the topbar glyph honest for EVERY caller: the splash mute toggles
  // this same state while the topbar is behind the overlay, and a stale 🔊
  // there would contradict the muted game after dismissal (SPEC-splash-mute
  // CAP-2, one source of truth includes its visible views).
  app.ui.setAudioGlyph(app.audio.muted);
  trackAppAction("mute", app.audio.muted ? "on" : "off"); // new muted state
  return app.audio.muted;
}

/** Set one audio channel's level (0..1) and persist it. */
export function setVolume(app: GameApp, kind: "music" | "ambience" | "sfx", value: number): void {
  // A slider drag is a user gesture, so it may be the interaction that
  // starts the engine (a not-yet-started facade also covers the
  // retry-after-failed-load path). Once running, skip the call: input
  // events arrive at pointer-move rate and each start() would allocate
  // a fresh resume() promise for nothing.
  if (!app.audio.started) app.audio.start();
  // Session-latched: this fires at pointer-move rate, so count only the first
  // touch ("did the player adjust audio levels at all"), never the value.
  trackAppActionOnce("volume");
  app.audio.setVolumes(
    kind === "music" ? value : app.audio.musicVolume,
    kind === "ambience" ? value : app.audio.ambienceVolume,
    kind === "sfx" ? value : app.audio.sfxVolume,
  );
  // Read back the facade's clamped values so prefs never store junk.
  app.prefs.musicVolume = app.audio.musicVolume;
  app.prefs.ambienceVolume = app.audio.ambienceVolume;
  app.prefs.sfxVolume = app.audio.sfxVolume;
  schedulePrefsSave(app);
}

/** Toggle reduced motion, persist it, and return the new effective state. */
export function toggleReducedMotion(app: GameApp): boolean {
  app.prefs.reducedMotion = !app.prefs.reducedMotion;
  savePrefs(app.prefs);
  applyReducedMotion(app);
  const on = reducedMotionActive(app.prefs, app.reduceMq.matches);
  trackAppAction("reduced_motion", on ? "on" : "off"); // new effective state
  return on;
}

/** Toggle the steady-clock pref and return the new steady state. */
export function toggleSteadyClock(app: GameApp): boolean {
  app.prefs.steadyClock = !app.prefs.steadyClock;
  savePrefs(app.prefs);
  trackAppAction("steady_clock", app.prefs.steadyClock ? "on" : "off"); // new steady state
  return app.prefs.steadyClock;
}

/** The live steady-clock state (the same in-memory prefs the game loop reads). */
export function isSteadyClock(app: GameApp): boolean {
  return app.prefs.steadyClock === true;
}

/** Persist prefs after a short trailing delay (see {@link GameApp.prefsSaveTimer}).
 *  Single-shot writes (the mute toggle, the accessibility buttons) keep
 *  calling savePrefs directly; this is only for high-frequency sources.
 *  A pagehide flush (bindKeys) covers unload/reload inside the window. */
export function schedulePrefsSave(app: GameApp): void {
  if (app.prefsSaveTimer !== null) window.clearTimeout(app.prefsSaveTimer);
  app.prefsSaveTimer = window.setTimeout(() => {
    app.prefsSaveTimer = null;
    savePrefs(app.prefs);
  }, 200);
}

/** Write a pending debounced pref save NOW. Wired to pagehide so a slider
 *  adjustment inside the debounce window survives a tab close or any
 *  reload (including the app's own update-flow and recovery reloads). */
export function flushPrefsSave(app: GameApp): void {
  if (app.prefsSaveTimer === null) return;
  window.clearTimeout(app.prefsSaveTimer);
  app.prefsSaveTimer = null;
  savePrefs(app.prefs);
}

/** Push the effective reduced-motion state (OS pref OR user pref) to the DOM
 *  (a class CSS keys off) and the engine (freezes ambient canvas motion). */
export function applyReducedMotion(app: GameApp): void {
  const on = reducedMotionActive(app.prefs, app.reduceMq.matches);
  document.documentElement.classList.toggle("reduce-motion", on);
  app.engine.setReducedMotion(on);
}
