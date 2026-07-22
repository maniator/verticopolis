import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GameApp } from "../main";
import {
  toggleMute,
  setVolume,
  toggleReducedMotion,
  toggleSteadyClock,
  isSteadyClock,
  schedulePrefsSave,
  flushPrefsSave,
  applyReducedMotion,
} from "./audioPrefs";
import { savePrefs } from "../storage/Prefs";

/**
 * These pin the audio/accessibility/steady-clock preference commands against a
 * hand-built fake `GameApp`: each function reads the live `app.audio`/`app.prefs`
 * facade per call, so the fake only needs the members each command touches.
 * `savePrefs` is spied (mocked below) so a persist can be asserted without
 * reaching localStorage; `reducedMotionActive` stays the real pure function so
 * the effective-state math (OS pref OR user pref) is exercised, not restated.
 */

vi.mock("../storage/Prefs", async (importActual) => {
  const actual = await importActual<typeof import("../storage/Prefs")>();
  return { ...actual, savePrefs: vi.fn() };
});

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

interface FakeAudio {
  start: ReturnType<typeof vi.fn>;
  setMuted: ReturnType<typeof vi.fn>;
  muted: boolean;
  started: boolean;
  setVolumes: ReturnType<typeof vi.fn>;
  musicVolume: number;
  ambienceVolume: number;
  sfxVolume: number;
}

function makeApp() {
  const audio: FakeAudio = {
    started: false,
    muted: false,
    musicVolume: 0.5,
    ambienceVolume: 0.5,
    sfxVolume: 0.5,
    start: vi.fn(() => {
      audio.started = true;
    }),
    setMuted: vi.fn((m: boolean) => {
      audio.muted = m;
    }),
    // Mirror the real facade: clamp on write, so the command's read-back can
    // never store an out-of-range value in prefs.
    setVolumes: vi.fn((m: number, a: number, s: number) => {
      audio.musicVolume = clamp01(m);
      audio.ambienceVolume = clamp01(a);
      audio.sfxVolume = clamp01(s);
    }),
  };
  const engine = { setReducedMotion: vi.fn() };
  const ui = { setAudioGlyph: vi.fn() };
  const app = {
    audio,
    engine,
    ui,
    reduceMq: { matches: false },
    prefs: {} as Record<string, unknown>,
    prefsSaveTimer: null as number | null,
  };
  return { app: app as unknown as GameApp, raw: app, audio, engine, ui };
}

beforeEach(() => {
  vi.mocked(savePrefs).mockClear();
  document.documentElement.classList.remove("reduce-motion");
});

describe("toggleMute", () => {
  it("starts audio, flips the facade, mirrors into prefs, persists, and returns the new state", () => {
    const { app, raw, audio, ui } = makeApp();
    const result = toggleMute(app);
    expect(audio.start).toHaveBeenCalledTimes(1);
    expect(audio.setMuted).toHaveBeenCalledExactlyOnceWith(true);
    expect(audio.muted).toBe(true);
    expect(raw.prefs.muted).toBe(true);
    expect(savePrefs).toHaveBeenCalledExactlyOnceWith(raw.prefs);
    // The topbar glyph follows every caller (splash toggle included), so the
    // two views of the one mute can never disagree (SPEC-splash-mute CAP-2).
    expect(ui.setAudioGlyph).toHaveBeenCalledExactlyOnceWith(true);
    expect(result).toBe(true);
  });

  it("toggles back to unmuted on a second call", () => {
    const { app, audio, ui } = makeApp();
    toggleMute(app);
    const result = toggleMute(app);
    expect(audio.muted).toBe(false);
    expect(ui.setAudioGlyph).toHaveBeenLastCalledWith(false);
    expect(result).toBe(false);
  });
});

describe("setVolume", () => {
  it("starts audio only when it is not yet started", () => {
    const { app, audio } = makeApp();
    audio.started = false;
    setVolume(app, "music", 0.3);
    expect(audio.start).toHaveBeenCalledTimes(1);

    audio.start.mockClear();
    audio.started = true;
    setVolume(app, "music", 0.4);
    expect(audio.start).not.toHaveBeenCalled();
  });

  it("sets only the chosen channel, keeping the others at their facade values", () => {
    const { app, audio } = makeApp();
    audio.musicVolume = 0.2;
    audio.ambienceVolume = 0.6;
    audio.sfxVolume = 0.9;
    setVolume(app, "ambience", 0.1);
    expect(audio.setVolumes).toHaveBeenCalledExactlyOnceWith(0.2, 0.1, 0.9);
  });

  it("stores the facade's clamped read-back into prefs, never the raw input", () => {
    const { app, raw } = makeApp();
    setVolume(app, "music", 5); // out of range; the facade clamps to 1
    expect(raw.prefs.musicVolume).toBe(1);
    setVolume(app, "sfx", -3); // clamps to 0
    expect(raw.prefs.sfxVolume).toBe(0);
  });

  it("schedules a debounced save rather than writing immediately", () => {
    vi.useFakeTimers();
    try {
      const { app, raw } = makeApp();
      setVolume(app, "music", 0.4);
      expect(raw.prefsSaveTimer).not.toBeNull();
      expect(savePrefs).not.toHaveBeenCalled();
      vi.advanceTimersByTime(200);
      expect(savePrefs).toHaveBeenCalledTimes(1);
      expect(raw.prefsSaveTimer).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("schedulePrefsSave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes once after the 200ms trailing delay and clears its own timer", () => {
    const { app, raw } = makeApp();
    schedulePrefsSave(app);
    expect(savePrefs).not.toHaveBeenCalled();
    vi.advanceTimersByTime(199);
    expect(savePrefs).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(savePrefs).toHaveBeenCalledExactlyOnceWith(raw.prefs);
    expect(raw.prefsSaveTimer).toBeNull();
  });

  it("a second call clears the prior pending timer so only the last write lands", () => {
    const clearSpy = vi.spyOn(window, "clearTimeout");
    const { app } = makeApp();
    schedulePrefsSave(app); // first: no prior timer to clear
    expect(clearSpy).not.toHaveBeenCalled();
    schedulePrefsSave(app); // second: clears the first
    expect(clearSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(savePrefs).toHaveBeenCalledTimes(1); // debounced to a single write
  });
});

describe("flushPrefsSave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes immediately and cancels the pending timer when one is queued", () => {
    const clearSpy = vi.spyOn(window, "clearTimeout");
    const { app, raw } = makeApp();
    schedulePrefsSave(app);
    expect(savePrefs).not.toHaveBeenCalled();
    flushPrefsSave(app);
    expect(savePrefs).toHaveBeenCalledExactlyOnceWith(raw.prefs);
    expect(raw.prefsSaveTimer).toBeNull();
    expect(clearSpy).toHaveBeenCalledTimes(1);
    // The queued timer must not fire a second save after the flush.
    vi.advanceTimersByTime(200);
    expect(savePrefs).toHaveBeenCalledTimes(1);
  });

  it("no-ops when no save is pending", () => {
    const { app, raw } = makeApp();
    expect(raw.prefsSaveTimer).toBeNull();
    flushPrefsSave(app);
    expect(savePrefs).not.toHaveBeenCalled();
  });
});

describe("toggleReducedMotion and applyReducedMotion", () => {
  it("toggles the pref, persists, drives the html class and engine, and returns the effective state", () => {
    const { app, raw, engine } = makeApp();
    raw.reduceMq.matches = false;

    const on = toggleReducedMotion(app);
    expect(raw.prefs.reducedMotion).toBe(true);
    expect(savePrefs).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(true);
    expect(engine.setReducedMotion).toHaveBeenLastCalledWith(true);
    expect(on).toBe(true);

    const off = toggleReducedMotion(app);
    expect(raw.prefs.reducedMotion).toBe(false);
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(false);
    expect(engine.setReducedMotion).toHaveBeenLastCalledWith(false);
    expect(off).toBe(false);
  });

  it("stays effective-on while the OS media query matches, even with the user pref off", () => {
    const { app, raw, engine } = makeApp();
    raw.reduceMq.matches = true;
    raw.prefs.reducedMotion = false;
    applyReducedMotion(app);
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(true);
    expect(engine.setReducedMotion).toHaveBeenLastCalledWith(true);
  });
});

describe("steady clock", () => {
  it("toggleSteadyClock flips the pref, persists, and returns the new state", () => {
    const { app, raw } = makeApp();
    expect(toggleSteadyClock(app)).toBe(true);
    expect(raw.prefs.steadyClock).toBe(true);
    expect(savePrefs).toHaveBeenCalledTimes(1);
    expect(toggleSteadyClock(app)).toBe(false);
    expect(raw.prefs.steadyClock).toBe(false);
  });

  it("isSteadyClock reports the live pref, treating anything but true as off", () => {
    const { app, raw } = makeApp();
    expect(isSteadyClock(app)).toBe(false); // undefined
    raw.prefs.steadyClock = true;
    expect(isSteadyClock(app)).toBe(true);
    raw.prefs.steadyClock = false;
    expect(isSteadyClock(app)).toBe(false);
  });
});
