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

/** Effective reduced-motion = the OS media query OR the explicit user pref. */
export function reducedMotionActive(prefs: Prefs, mqMatches: boolean): boolean {
  return mqMatches || prefs.reducedMotion === true;
}
