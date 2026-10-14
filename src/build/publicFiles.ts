/**
 * Every file under `src/public/` (#974). Vite copies that folder into `dist/`
 * outside the module graph, so no sourcemap lists what is in it and the
 * third-party notices (#951) cannot see a package font, image, stylesheet or
 * sound placed there. Each file is listed here with where it comes from and
 * its license, and `scripts/verify-public-files.ts` fails `verify:dist` when
 * the folder and this list disagree. Third-party content belongs in the
 * module graph, where the notices list it.
 *
 * `src/public/engine/` is the WASM engine package: build output, attributed
 * by the `THIRD-PARTY.json` record its build writes beside it (#955).
 *
 * Keep this file ERASABLE (no enums, namespaces or parameter properties) so
 * `node` can run the script that imports it directly.
 */

/** One file under `src/public/`. */
export interface PublicFile {
  /** Its path under `src/public/` (and `dist/`), `/`-separated. */
  path: string;
  /** The project's own licenses: CC BY 4.0 for assets (ASSETS-LICENSE.md), MIT for code and config (LICENSE). */
  license: "CC-BY-4.0" | "MIT";
  /** Who made it, or the script that draws it. */
  source: string;
}

/** Folders under `src/public/` that are attributed elsewhere and left out of the list. */
export const PUBLIC_EXCLUDED_DIRS: readonly string[] = ["engine"];

const ICONS = "drawn in code by scripts/gen-pwa-icons.mjs";

export const PUBLIC_FILES: readonly PublicFile[] = [
  { path: ".well-known/assetlinks.json", license: "MIT", source: "written for the project (Android app link)" },
  { path: "apple-touch-icon.png", license: "CC-BY-4.0", source: ICONS },
  { path: "audio/voice-laughs.mp3", license: "CC-BY-4.0", source: "recorded by the project owner and family (ASSETS-LICENSE.md)" },
  { path: "audio/voice-talk.mp3", license: "CC-BY-4.0", source: "recorded by the project owner and family (ASSETS-LICENSE.md)" },
  { path: "favicon.png", license: "CC-BY-4.0", source: ICONS },
  { path: "icon-1024x1024.png", license: "CC-BY-4.0", source: ICONS },
  { path: "og-image.png", license: "CC-BY-4.0", source: "drawn in code by scripts/gen-og-image.mjs" },
  { path: "pwa-192x192.png", license: "CC-BY-4.0", source: ICONS },
  { path: "pwa-512x512.png", license: "CC-BY-4.0", source: ICONS },
  { path: "pwa-maskable-512x512.png", license: "CC-BY-4.0", source: ICONS },
  { path: "robots.txt", license: "MIT", source: "written for the project" },
  { path: "sitemap.xml", license: "MIT", source: "written for the project" },
];

/**
 * Files an operating system writes into any folder it shows (Finder,
 * Explorer). Vite would ship one with the rest of the folder, and a
 * `.DS_Store` names local files, so the check asks for it to be deleted.
 */
export const OS_FILE_NAMES: readonly string[] = [".DS_Store", "Thumbs.db", "desktop.ini"];

/** True when a `src/public/` path sits in a folder that is attributed elsewhere. */
export function isExcludedPublicPath(path: string): boolean {
  return PUBLIC_EXCLUDED_DIRS.some((dir) => path === dir || path.startsWith(`${dir}/`));
}

/**
 * Where the list, the folder and the build disagree. `inPublic` is every file
 * under `src/public/` (excluded folders already left out); `inDist` tells
 * whether a path shipped in `dist/`. A file the list does not name, a listed
 * file that is gone or did not ship, a listed path twice and a listed path in
 * an excluded folder are each a problem.
 */
export function publicFileProblems(listed: readonly PublicFile[], inPublic: readonly string[], inDist: (path: string) => boolean): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const f of listed) {
    if (names.has(f.path)) problems.push(`${f.path} is listed twice`);
    names.add(f.path);
    if (isExcludedPublicPath(f.path)) problems.push(`${f.path} is in a folder attributed elsewhere and must not be listed`);
    else if (!inPublic.includes(f.path)) problems.push(`${f.path} is listed but not in src/public`);
    else if (!inDist(f.path)) problems.push(`${f.path} is listed but did not ship in dist`);
  }
  for (const path of inPublic) {
    if (OS_FILE_NAMES.includes(path.slice(path.lastIndexOf("/") + 1))) {
      problems.push(`src/public/${path} is a file the operating system wrote; delete it, or it ships in dist`);
    } else if (!names.has(path) && !isExcludedPublicPath(path)) {
      problems.push(`src/public/${path} ships with no entry in src/build/publicFiles.ts; list its source and license, or move third-party content into the module graph`);
    }
  }
  return problems;
}
