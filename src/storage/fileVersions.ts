/**
 * A tower file's earlier versions (owner, 2026-11-16; save-model party
 * verdict item 3, #2380). Each My Towers tower keeps its last
 * {@link VERSIONS_KEPT} versions, at least {@link VERSION_GAP_MS} apart, plus
 * the last one saved by hand, in the browser only, and the bytes the file
 * held before the game first wrote over it (its original: an old slot copy,
 * a file saved by an earlier version), so a write never loses what was there
 * (review of #2411). A version is the same bytes the file held, so it adds no
 * format: opening one hands those bytes to the importer, as a file's own
 * open does.
 *
 * `fileSpace.ts` keeps the bodies beside the files' and one list per file;
 * this module only plans which versions a write keeps. Pure, so the rule is
 * tested without a database.
 */

/** How many timed versions a tower keeps. */
export const VERSIONS_KEPT = 5;
/** The least time between two timed versions. */
export const VERSION_GAP_MS = 10 * 60_000;

export interface TowerVersion {
  /** Where its bytes are kept. */
  readonly key: string;
  /** When the file held these bytes, in milliseconds since 1970. */
  readonly at: number;
  readonly size: number;
  /** The last version saved by hand (File > Save). */
  readonly manual?: true;
  /** The file as it was before the game first wrote over it. */
  readonly original?: true;
}

/** The record that lists file `id`'s versions. */
export function versionsKey(id: string): string {
  return `versions:${id}`;
}

/** A stored list as versions, dropping any row that is not one. */
export function readVersions(value: unknown): TowerVersion[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is TowerVersion =>
      typeof v === "object" &&
      v !== null &&
      typeof v.key === "string" &&
      typeof v.at === "number" &&
      typeof v.size === "number" &&
      (v.manual === undefined || v.manual === true) &&
      (v.original === undefined || v.original === true),
  );
}

/** What one write does to a file's versions. */
export interface VersionPlan {
  /** The list to keep: the original first, then oldest first, the
   *  hand-saved one last. */
  readonly versions: TowerVersion[];
  /** A new version of the bytes being written, or null when none is due. */
  readonly put: TowerVersion | null;
  /** The keys of versions no longer kept. */
  readonly drop: string[];
}

/** The version that keeps a file's bytes from before the game first wrote
 *  over it, last written at `at`. */
export function originalVersion(id: string, at: number, size: number): TowerVersion {
  return { key: `v:${id}:o${at}`, at, size, original: true };
}

/**
 * The versions file `id` keeps once bytes of `size` are written at `at`. A
 * write by hand replaces the hand-saved version; any other write adds a timed
 * one when none is newer than {@link VERSION_GAP_MS} before it, and the oldest
 * goes once more than {@link VERSIONS_KEPT} are kept. The original stays.
 */
export function planVersions(
  list: readonly TowerVersion[],
  id: string,
  at: number,
  size: number,
  manual: boolean,
): VersionPlan {
  const original = list.filter((v) => v.original);
  const timed = list.filter((v) => !v.manual && !v.original).sort((a, b) => a.at - b.at);
  let byHand = list.find((v) => v.manual) ?? null;
  const drop: string[] = [];
  let put: TowerVersion | null = null;
  if (manual) {
    put = { key: `v:${id}:m${at}`, at, size, manual: true };
    if (byHand) drop.push(byHand.key);
    byHand = put;
  } else {
    const newest = timed[timed.length - 1];
    if (!newest || at - newest.at >= VERSION_GAP_MS) {
      put = { key: `v:${id}:${at}`, at, size };
      timed.push(put);
      while (timed.length > VERSIONS_KEPT) drop.push(timed.shift()!.key);
    }
  }
  return { versions: [...original, ...timed, ...(byHand ? [byHand] : [])], put, drop };
}
