import type { TowerFileKind } from "./fileSpace";

/**
 * The towers the player opened or saved last, newest first, for File > Open
 * Recent (owner, 2026-11-16: "the last 5 or less open towers"). A device
 * preference, like the window choices: kept in localStorage, never in a tower
 * file, never sent anywhere (a name is the player's own text).
 *
 * The list only points at files: it holds no tower and never writes, renames
 * or deletes one. Dropping an entry (its file is gone) changes nothing but
 * this list, so it can never cost a save.
 *
 * Each entry names where its file lives: `towers` for My Towers, by the file's
 * id there, or `folder` for the folder linked on the player's computer, by
 * the file's name on disk and the link it was opened through. A link's id is
 * new each time a folder is linked (`linkedFolder.linkId`), so a file of the
 * same name in a folder linked later is never taken for this one.
 */

/** Where a recent tower's file lives. */
export type RecentPlace = "towers" | "folder";

export interface RecentTower {
  readonly place: RecentPlace;
  /** The My Towers file's id, or the linked folder file's name on disk. */
  readonly id: string;
  /** The name to show when the file's own entry can't be read yet. */
  readonly name: string;
  readonly kind: TowerFileKind;
  /** The linked folder's link id; only for `folder`. */
  readonly link?: string;
}

/** How many towers File > Open Recent lists (owner, 2026-11-16). */
export const RECENT_MAX = 5;

export const RECENT_KEY = "vc.recentTowers";

/** The longest id or name kept: a file name on disk is never longer than
 *  this on any system the game runs on, and a damaged entry can't grow the
 *  stored text without bound. */
const TEXT_MAX = 260;

function text(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= TEXT_MAX;
}

/** One stored entry, or null for anything that isn't one. */
function entryOf(v: unknown): RecentTower | null {
  if (!v || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  if (e.place !== "towers" && e.place !== "folder") return null;
  if (!text(e.id) || !text(e.name) || (e.kind !== "tower" && e.kind !== "tdt")) return null;
  if (e.place === "folder") return text(e.link) ? { place: "folder", id: e.id, name: e.name, kind: e.kind, link: e.link } : null;
  return { place: "towers", id: e.id, name: e.name, kind: e.kind };
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The same file: the same place and id (and, in a linked folder, the same link). */
export function sameFile(a: RecentTower, b: RecentTower): boolean {
  return a.place === b.place && a.id === b.id && a.link === b.link;
}

/** The stored list, newest first. A damaged or blocked store reads as empty. */
export function recentTowers(): RecentTower[] {
  let raw: string | null;
  try {
    raw = storage()?.getItem(RECENT_KEY) ?? null;
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: RecentTower[] = [];
    for (const v of parsed) {
      const e = entryOf(v);
      if (e && !out.some((o) => sameFile(o, e))) out.push(e);
      if (out.length === RECENT_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

function store(list: readonly RecentTower[]): void {
  try {
    storage()?.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // A full quota or a blocked origin: the list just doesn't change.
  }
}

/** Put `tower` at the top of the list, dropping its older line and the
 *  oldest past {@link RECENT_MAX}. */
export function noteRecentTower(tower: RecentTower): void {
  const e = entryOf(tower);
  if (!e) return;
  store([e, ...recentTowers().filter((o) => !sameFile(o, e))]);
}

/** Drop `tower` from the list (its file is gone). */
export function dropRecentTower(tower: RecentTower): void {
  const list = recentTowers();
  const kept = list.filter((o) => !sameFile(o, tower));
  if (kept.length !== list.length) store(kept);
}

/** Replace the list (a menu that found files gone keeps the rest). */
export function keepRecentTowers(list: readonly RecentTower[]): void {
  store(list);
}

/** Note a My Towers file the live tower came from or was saved as. */
export function noteTowersFile(file: { readonly id: string; readonly name: string; readonly kind: TowerFileKind }): void {
  noteRecentTower({ place: "towers", id: file.id, name: file.name, kind: file.kind });
}

/** Note a linked folder's file (`id` is its name on disk), opened or saved
 *  through link `link`. Nothing is noted with no link. */
export function noteFolderFile(file: { readonly id: string; readonly kind: TowerFileKind }, link: string | null): void {
  if (link) noteRecentTower({ place: "folder", id: file.id, name: file.id, kind: file.kind, link });
}
