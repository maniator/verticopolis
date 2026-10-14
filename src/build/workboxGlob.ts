/**
 * Reads vite.config.ts's workbox `globPatterns` for the precache coverage
 * tests (src/audio/audioAssets.test.ts, src/wasmhost/engineAssets.test.ts).
 * It understands the two entry shapes the config uses: one brace list of
 * extensions (`**\/*.{js,css,...}`) and plain paths for a single file, which
 * is how a run-time `.json` joins the precache without matching every
 * `.json` (see the note in vite.config.ts). Any other shape returns null, so
 * a test fails and someone extends this reader before trusting it.
 */

/** What the glob precaches: file extensions, and single files by path. */
export interface WorkboxGlob {
  extensions: Set<string>;
  paths: Set<string>;
}

export function readWorkboxGlob(config: string): WorkboxGlob | null {
  const list = /globPatterns:\s*\[([^\]]*)\]/.exec(config);
  if (!list) return null;
  const entries = [...list[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  if (entries.length === 0) return null;
  const glob: WorkboxGlob = { extensions: new Set(), paths: new Set() };
  for (const entry of entries) {
    const braces = /^\*\*\/\*\.\{([\w,]+)\}$/.exec(entry);
    if (braces) for (const ext of braces[1].toLowerCase().split(",")) glob.extensions.add(ext);
    else if (/^[\w./-]+$/.test(entry) && !entry.includes("*")) glob.paths.add(entry);
    else return null;
  }
  return glob;
}

/** Whether the glob precaches `file`, a path under the site base. */
export function globCovers(glob: WorkboxGlob, file: string): boolean {
  return glob.paths.has(file) || glob.extensions.has(file.slice(file.lastIndexOf(".") + 1).toLowerCase());
}
