/**
 * How My Towers (`fileSpace.ts`) names its files: the characters a name may
 * hold, and the free "Name (2)" and "Copy of …" names a new file takes so it
 * never replaces another. Split out of `fileSpace.ts` at the 500-line guard.
 */

/** The longest name a file may have. */
export const FILE_NAME_MAX = 60;

/** A name as a file keeps it: control characters and the characters a disk
 *  refuses in a file name are dropped, runs of spaces become one, and it is
 *  cut at {@link FILE_NAME_MAX}. Empty when nothing is left. */
export function cleanFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const kept = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "");
  return kept.replace(/\s+/g, " ").trim().slice(0, FILE_NAME_MAX).trim();
}

/** Two names that differ only in case name the same file, as on most disks. */
export const sameName = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/** Anything with a name: a My Towers file, a file in the linked folder. */
interface Named {
  readonly name: string;
}

/** `name`, or the first of "name (2)", "name (3)" and up that no file has. */
export function freeName(name: string, entries: readonly Named[]): string {
  const clean = cleanFileName(name);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : ` (${n})`;
    const candidate = cleanFileName(clean.slice(0, FILE_NAME_MAX - suffix.length) + suffix);
    if (!entries.some((e) => sameName(e.name, candidate))) return candidate;
  }
}

/** The first free "Copy of …" name, the way a desktop names a pasted copy. */
export function copyName(name: string, entries: readonly Named[]): string {
  for (let n = 1; ; n++) {
    const prefix = n === 1 ? "Copy of " : `Copy (${n}) of `;
    const candidate = cleanFileName(prefix + name);
    if (!entries.some((e) => sameName(e.name, candidate))) return candidate;
  }
}
