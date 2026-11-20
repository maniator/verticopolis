/**
 * The player's screen saver choices, kept on this browser like the other
 * display settings (never in a save). Read once when the game starts and
 * again only when the Screen Saver dialog saves.
 */

/** The savers, in the order the dialog lists them. */
export const SAVERS = ["night", "stars", "express", "endless", "marquee"] as const;
export type SaverId = (typeof SAVERS)[number];

/** Each saver's name as the dialog lists it. */
export const SAVER_NAMES: Readonly<Record<SaverId, string>> = {
  night: "Night Shift",
  stars: "Skyline Starfield",
  express: "Express Elevators",
  endless: "Endless Tower",
  marquee: "Bulletin Marquee",
};

/** The choice that turns the saver off. */
export const NO_SAVER = "none";
export type SaverChoice = SaverId | typeof NO_SAVER;

/** The waits the dialog offers, in minutes. */
export const WAIT_MINUTES = [1, 3, 5, 10, 15] as const;

export interface SaverPrefs {
  /** Which saver runs, or none. */
  saver: SaverChoice;
  /** Minutes of a paused, untouched tower before it starts, and the least
   *  time away from the tab that brings it up on the way back. */
  waitMinutes: number;
  /** Show it when the player comes back to the tab after the wait. */
  onReturn: boolean;
}

const KEY = "vc.screensaver";

/** The defaults (party 2026-11-15): Night Shift after 5 minutes; on the way
 *  back to the tab on a computer, never on a touch screen, which locks and
 *  unlocks all day. */
export function defaultSaverPrefs(touchScreen: boolean): SaverPrefs {
  return { saver: "night", waitMinutes: 5, onReturn: !touchScreen };
}

function isChoice(v: unknown): v is SaverChoice {
  return v === NO_SAVER || (SAVERS as readonly unknown[]).includes(v);
}

export function loadSaverPrefs(
  touchScreen: boolean,
  storage: Pick<Storage, "getItem"> | null = safeStorage(),
): SaverPrefs {
  const out = defaultSaverPrefs(touchScreen);
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return out;
    const p = JSON.parse(raw) as Partial<Record<keyof SaverPrefs, unknown>>;
    if (isChoice(p.saver)) out.saver = p.saver;
    if ((WAIT_MINUTES as readonly unknown[]).includes(p.waitMinutes)) out.waitMinutes = p.waitMinutes as number;
    if (typeof p.onReturn === "boolean") out.onReturn = p.onReturn;
  } catch {
    /* unreadable or blocked storage: the defaults */
  }
  return out;
}

export function saveSaverPrefs(p: SaverPrefs, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(p));
  } catch {
    /* a full or blocked storage: the choice holds for this visit */
  }
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
