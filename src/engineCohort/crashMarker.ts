import { BOOT_MARKER_KEY, readMarker, remove, writeChecked, type KeyValueStore, type MarkerEntry } from "./records";

/**
 * The crash-loop marker (#1197, spec section 3). Every page life that requests
 * Rust keeps its own entry, so two windows never clear or count each other's.
 * The entry carries a heartbeat that the page refreshes while it is visible
 * and is removed when the page is hidden, which is a clean exit for this check
 * (`survival.ts` says when it also clears other stale entries).
 * An entry for this build whose heartbeat went stale belongs to a page life
 * that died while visible (out of memory, a hang the browser killed) without
 * reaching the fallback path. Two of them latch `unclean-exit`.
 */

/** How often a visible page life refreshes its heartbeat. */
export const HEARTBEAT_MS = 10_000;

/** A heartbeat older than this means the page life died while visible. */
export const STALE_MS = 30_000;

/** Stale entries on one build that latch a crash loop. */
export const CRASH_LOOP_PAGES = 2;

export interface PageLife {
  id: string;
  sha: string;
}

const entriesOf = (store: KeyValueStore | null): MarkerEntry[] => {
  const r = readMarker(store);
  return r.ok ? r.value.entries : [];
};

function write(store: KeyValueStore | null, entries: MarkerEntry[]): boolean {
  if (entries.length > 0) return writeChecked(store, BOOT_MARKER_KEY, { v: 1, entries });
  remove(store, BOOT_MARKER_KEY);
  return true;
}

const isStale = (e: MarkerEntry, now: number) => now - e.beat > STALE_MS;

/** Count this boot against the marker. Entries for another build are dropped.
 *  `loop` when this build has `CRASH_LOOP_PAGES` stale entries: those are
 *  removed and the caller latches; nothing is added for this page life.
 *  `unwritable` when storage did not keep this page life's entry, so a crash
 *  could not be counted. Else `ok`, with the entry added. */
export function crashLoopFound(store: KeyValueStore | null, page: PageLife, now: number): "ok" | "loop" | "unwritable" {
  const mine = entriesOf(store).filter((e) => e.sha === page.sha && e.id !== page.id);
  const stale = mine.filter((e) => isStale(e, now));
  if (stale.length >= CRASH_LOOP_PAGES) {
    write(store, mine.filter((e) => !isStale(e, now)));
    return "loop";
  }
  return write(store, [...mine, { id: page.id, sha: page.sha, beat: now }]) ? "ok" : "unwritable";
}

/** The page life is visible and alive: add or refresh its entry. */
export function heartbeat(store: KeyValueStore | null, page: PageLife, now: number): void {
  const others = entriesOf(store).filter((e) => e.id !== page.id);
  write(store, [...others, { id: page.id, sha: page.sha, beat: now }]);
}

/** The page life closed after running visibly for `STALE_MS`: remove its entry
 *  and this build's stale ones, since that shows the build is running. */
export function exitCleanly(store: KeyValueStore | null, page: PageLife, now: number): void {
  write(
    store,
    entriesOf(store).filter((e) => e.id !== page.id && !(e.sha === page.sha && isStale(e, now))),
  );
}

/** Remove only this page life's entry: a page that starts hidden has not run
 *  Rust yet, so it says nothing about the stale entries of earlier ones. */
export function stepAside(store: KeyValueStore | null, page: PageLife): void {
  write(store, entriesOf(store).filter((e) => e.id !== page.id));
}

/** Forget every entry (the player's retry). */
export function clearMarker(store: KeyValueStore | null): void {
  remove(store, BOOT_MARKER_KEY);
}
