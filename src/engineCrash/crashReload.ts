/**
 * The Rust engine's crash reload (#1422, owner 2026-10-28). A trap in the
 * running engine never hands the tower to another engine mid-game: the page
 * reloads, and the tower comes back from its last autosave on Rust. This tab
 * counts those crashes per build, and at `CRASH_LOOP_PAGES` the game stops
 * with the engine-failure screen instead of reloading again, so a crash that
 * repeats cannot reload forever. The count lives in `sessionStorage`: it holds
 * across the reload and ends with the tab.
 */

/** The crashes on one build that spend the tab's reloads: the first reloads,
 *  the second stops. */
export const CRASH_LOOP_PAGES = 2;

/** The slice of `Storage` the crash count uses. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Write a value and read it back. False when storage threw or did not keep it. */
function writeChecked(store: KeyValueStore | null, key: string, value: unknown): boolean {
  if (!store) return false;
  const text = JSON.stringify(value);
  try {
    store.setItem(key, text);
    return store.getItem(key) === text;
  } catch {
    return false;
  }
}

/** This tab's Rust crashes on one build. */
export const RUST_CRASHES_KEY = "vc.rustCrashes";

interface CrashCount {
  v: 1;
  sha: string;
  count: number;
}

function recordOf(store: KeyValueStore | null, sha: string): CrashCount | null {
  try {
    const raw = store?.getItem(RUST_CRASHES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CrashCount>;
    if (parsed.v !== 1 || parsed.sha !== sha || !Number.isInteger(parsed.count)) return null;
    return { v: 1, sha, count: parsed.count! };
  } catch {
    return null;
  }
}

const countOf = (store: KeyValueStore | null, sha: string): number => recordOf(store, sha)?.count ?? 0;

/** Count one crash on this build and return the tab's count, or null when
 *  storage did not keep it: that reload could not be counted, so the caller
 *  must not reload. */
export function countRustCrash(store: KeyValueStore | null, sha: string): number | null {
  const count = countOf(store, sha) + 1;
  const record: CrashCount = { v: 1, sha, count };
  return writeChecked(store, RUST_CRASHES_KEY, record) ? count : null;
}

/** Whether this tab crashed often enough on this build that the game stops
 *  instead of reloading. */
export function crashReloadsSpent(count: number): boolean {
  return count >= CRASH_LOOP_PAGES;
}

/** The tab's `sessionStorage`, or null where reading the property throws. */
export function tabStore(): KeyValueStore | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** What a crash does: reload onto the last autosave, or stop where the tab's
 *  reloads are spent or the count could not be kept. */
export type CrashOutcome = "reload" | "stop";

export function crashOutcome(count: number | null): CrashOutcome {
  return count !== null && !crashReloadsSpent(count) ? "reload" : "stop";
}

/** Set by a crash that reloads, and taken by the boot that follows: that one
 *  load of the autosave starts with nobody in the building (#2209). The save
 *  carries the people and the cars' timers, so replaying them could replay
 *  the very steps that trapped, and the tab's second crash stops the game. */
export const CRASH_FRESH_CROWD_KEY = "vc.crashFreshCrowd";

/** Ask the next boot of this tab to load the autosave without its people. */
export function markCrashReload(store: KeyValueStore | null): void {
  writeChecked(store, CRASH_FRESH_CROWD_KEY, true);
}

/** Whether this boot follows a crash reload. Clears the request, so only the
 *  one boot after the crash leaves the people out. */
export function takeCrashReload(store: KeyValueStore | null): boolean {
  try {
    const asked = store?.getItem(CRASH_FRESH_CROWD_KEY) === "true";
    if (asked) store?.setItem(CRASH_FRESH_CROWD_KEY, "false");
    return asked;
  } catch {
    return false;
  }
}

/** The save keys that hold the people and the cars mid-stop. */
const SAVED_PEOPLE_KEYS = ["crowd", "dispatch"] as const;

/** `text` without the people and the cars' timers, so the tower loads as a
 *  save from before people were saved did. Text that is not a save object
 *  comes back unchanged, for the engine to refuse as before. */
export function withoutSavedPeople(text: string): string {
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data !== "object" || data === null || Array.isArray(data)) return text;
    const save = data as Record<string, unknown>;
    if (!SAVED_PEOPLE_KEYS.some((key) => key in save)) return text;
    for (const key of SAVED_PEOPLE_KEYS) delete save[key];
    return JSON.stringify(save);
  } catch {
    return text;
  }
}

/** The cover line while the page reloads after a crash. */
export const CRASH_RELOAD_LINE = "The Rust engine hit an error. Reloading your tower from its last autosave.";

/** How long the cover line shows before the reload. */
export const CRASH_RELOAD_DELAY_MS = 2_000;

/** Reload the page once the cover line has had time to be read. */
export function reloadSoon(): void {
  setTimeout(() => globalThis.location.reload(), CRASH_RELOAD_DELAY_MS);
}
