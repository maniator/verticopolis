/**
 * Per-device accessibility/presentation preferences, kept DELIBERATELY
 * separate from SaveGame (localStorage key `vc.prefs`): they must not travel
 * with a shared/exported tower or perturb the save schema or determinism.
 * Corrupt/absent JSON falls back to defaults.
 */
export interface Prefs {
  /** Force reduced motion even when the OS `prefers-reduced-motion` is off. */
  reducedMotion?: boolean;
  /** Color-blind redundant cues (default on; only gates optional markers). */
  colorblindCue?: boolean;
  /** Disable the 1994 "breathing clock" (lunch dilates, night sprints) and run
   *  the day at a uniform real-time rate. Presentation-only, like the speed
   *  buttons: never serialized with a tower, and never touches the sim. */
  steadyClock?: boolean;
  /** Master mute (the top-bar speaker button). */
  muted?: boolean;
  /** Music & ambience loudness 0..1 (scene themes, room tone, accents, rain). */
  musicVolume?: number;
  /** Action-jingle loudness 0..1 (build, sell, error, money, promote, click). */
  sfxVolume?: number;
}

const KEY = "vc.prefs";

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object") return {};
    const out: Prefs = {};
    if (typeof (p as Prefs).reducedMotion === "boolean") out.reducedMotion = (p as Prefs).reducedMotion;
    if (typeof (p as Prefs).colorblindCue === "boolean") out.colorblindCue = (p as Prefs).colorblindCue;
    if (typeof (p as Prefs).steadyClock === "boolean") out.steadyClock = (p as Prefs).steadyClock;
    if (typeof (p as Prefs).muted === "boolean") out.muted = (p as Prefs).muted;
    const music = volumeOrNull((p as Prefs).musicVolume);
    if (music !== null) out.musicVolume = music;
    const sfx = volumeOrNull((p as Prefs).sfxVolume);
    if (sfx !== null) out.sfxVolume = sfx;
    return out;
  } catch {
    return {};
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private-mode / disabled storage — prefs just don't persist */
  }
}

/** A stored volume is kept only when it is a finite number; out-of-range
 *  finite values clamp into 0..1, everything else is dropped (use default). */
function volumeOrNull(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(1, v));
}

/** Effective reduced-motion = the OS media query OR the explicit user pref. */
export function reducedMotionActive(prefs: Prefs, mqMatches: boolean): boolean {
  return mqMatches || prefs.reducedMotion === true;
}
