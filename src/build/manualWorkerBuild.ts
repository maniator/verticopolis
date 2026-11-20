/**
 * How the build writes the Player's Manual's offline worker (dist/help/sw.js,
 * src/manual/manualWorker.ts): which of the manual's built files it saves, the
 * version that names the saved copy, and the worker file itself.
 * scripts/manual-worker.ts runs it after the help site's build, and
 * scripts/check-production-worker.ts checks the result before a production
 * deploy ({@link manualWorkerProblem}).
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs the scripts
 * that import it directly.
 */
import { createHash } from "node:crypto";
import type { ManualConfig, ManualFile } from "../manual/manualWorker.ts";

/** The first line of the manual's worker, which the production check looks for. */
export const MANUAL_WORKER_MARKER = "Verticopolis manual worker";

/** The global the worker file sets before its code runs. */
export const MANUAL_CONFIG_GLOBAL = "__VC_MANUAL__";

/** A built file: its path under dist/help with forward slashes, and its bytes. */
export interface BuiltFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** Built files the worker saves at install: every page, its styles and
 *  scripts, the small pictures the page frame draws, the room catalog the
 *  sprites read, and the search index, so search works offline too. */
const SAVED = [
  /(^|\/)index\.html$/,
  /^_astro\/[^/]+\.(?:css|js|png|svg)$/,
  /^pagefind\//,
  /^catalog\.json$/,
  /^favicon\.png$/,
];

/** Built files never saved at install, even when a rule above matches:
 *  source maps. The screenshots (`.webp`) are saved as they are shown, and
 *  the share cards, sitemaps and robots.txt are for other sites. */
const NEVER = /\.map$/;

/** Built pictures the pages show, saved the first time each is shown: the
 *  screenshots and any other picture the build bundles, whose names carry a
 *  digest. */
const PICTURE = /^_astro\/[^/]+\.(?:png|webp|jpe?g|gif|svg|avif)$/;

/** The address a built file is saved under, relative to the manual's base:
 *  a page's folder ("rooms/hotels/") for its index.html, the front page as
 *  "", and any other file as its path. */
export function savedPath(path: string): string {
  if (path === "index.html") return "";
  if (path.endsWith("/index.html")) return path.slice(0, -"index.html".length);
  return path;
}

/** A short digest of `bytes`. */
function digest(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/** Sorts addresses in code-point order, so a build lists them the same way
 *  on every machine. */
const byAddress = (a: string, b: string) => Number(a > b) - Number(a < b);

/** The worker's config for the manual's built `files`: what it saves, sorted
 *  by address, each with a digest of its contents, the pictures it saves as
 *  they are shown, and a version that changes whenever any of them does. */
export function manualConfig(files: readonly BuiltFile[]): ManualConfig {
  const isSaved = (path: string) => !NEVER.test(path) && SAVED.some((rule) => rule.test(path));
  const saved: ManualFile[] = files
    .filter((f) => isSaved(f.path))
    .map((f) => ({ url: savedPath(f.path), revision: digest(f.bytes) }))
    .sort((a, b) => byAddress(a.url, b.url));
  const pictures = files
    .map((f) => f.path)
    .filter((path) => PICTURE.test(path) && !isSaved(path))
    .sort(byAddress);
  return { version: digest(JSON.stringify({ saved, pictures })), files: saved, pictures };
}

/**
 * The worker file: the marker line, the config as {@link MANUAL_CONFIG_GLOBAL},
 * then `workerJs` (src/manual/manualWorker.ts compiled to CommonJS) run in a
 * function of its own, which starts the worker. `<` is escaped in the config
 * so no file name can close anything.
 */
export function manualWorkerSource(config: ManualConfig, workerJs: string): string {
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  return `// ${MANUAL_WORKER_MARKER}: the Player's Manual offline (src/manual/manualWorker.ts).
self.${MANUAL_CONFIG_GLOBAL} = ${json};
(function () {
var exports = {};
${workerJs}
exports.startManualWorker(self, self.${MANUAL_CONFIG_GLOBAL});
})();
`;
}

/**
 * Why a build's dist/help/sw.js is not the manual's offline worker, or null
 * when it is. `sw` is the file's text, or null when the file is missing. The
 * production deploy runs it beside the game worker's check, so the manual's
 * host never goes live without a worker that saves pages and clears a game
 * worker left there.
 */
export function manualWorkerProblem(sw: string | null): string | null {
  if (sw === null) return "dist/help/sw.js is missing, so the manual would not work offline";
  if (!sw.startsWith(`// ${MANUAL_WORKER_MARKER}`)) return "dist/help/sw.js is not the manual's offline worker";
  const config = sw.match(new RegExp(`self\\.${MANUAL_CONFIG_GLOBAL} = (.*);\\n`));
  try {
    const parsed = config ? (JSON.parse(config[1]) as ManualConfig) : null;
    if (!parsed?.files.some((f) => f.url === "")) return "dist/help/sw.js does not save the manual's front page";
  } catch {
    return "dist/help/sw.js has a config that does not read";
  }
  return null;
}
