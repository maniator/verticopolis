/**
 * Build-time guard for the service-worker precache manifest (PROD-003 and its
 * review follow-up). The five app icons (favicon, apple-touch-icon, the three
 * PWA manifest icons) are precached solely by the workbox globPatterns in
 * vite.config.ts; includeAssets and includeManifestIcons are deliberately off
 * because they double-listed the same files. That leaves the glob as a single
 * point of failure guarded, before this script, only by a comment: narrow the
 * glob or move an icon and offline installs would silently lose assets. This
 * runs from postbuild, so every `npm run build` (local and every CI lane)
 * fails loudly if an expected icon is missing from the manifest or any entry
 * is listed twice.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SW = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "sw.js");

/** Icons that must each appear exactly once (kept in sync with src/public/). */
const REQUIRED_ICONS = [
  "favicon.png",
  "apple-touch-icon.png",
  "pwa-192x192.png",
  "pwa-512x512.png",
  "pwa-maskable-512x512.png",
];

function fail(msg: string): never {
  console.error(`verify-precache: ${msg}`);
  process.exit(1);
}

let sw: string;
try {
  sw = readFileSync(SW, "utf8");
} catch (e) {
  fail(`could not read ${SW} (run the build first): ${e instanceof Error ? e.message : String(e)}`);
}
const start = sw.indexOf("precacheAndRoute(");
if (start === -1) fail("no precacheAndRoute call found in dist/sw.js; did the workbox output format change?");

// Bracket-match the manifest array so URLs elsewhere in the worker (routing
// regexes, cache names) can never leak into the count.
const open = sw.indexOf("[", start);
if (open === -1) fail("no manifest array follows the precacheAndRoute call in dist/sw.js");
let depth = 0;
let end = -1;
for (let i = open; i < sw.length; i++) {
  if (sw[i] === "[") depth++;
  else if (sw[i] === "]" && --depth === 0) {
    end = i;
    break;
  }
}
if (end === -1) fail("could not bracket-match the precache manifest array in dist/sw.js");
const manifest = sw.slice(open, end + 1);

// generateSW emits entries as {url:"...",revision:"..."} (unquoted keys,
// double-quoted values in the minified output); tolerate quoted keys and
// single-quoted values too, and normalize a leading "./" or "/", so a purely
// cosmetic emitter change cannot false-fail the build. A real format change
// still lands in the zero-entries failure below.
const urls = [...manifest.matchAll(/["']?url["']?\s*:\s*(["'])(.*?)\1/g)].map((m) => m[2].replace(/^\.?\//, ""));
if (urls.length === 0) fail("the precache manifest parsed to zero url entries; the entry format may have changed");

const seen = new Map<string, number>();
for (const u of urls) seen.set(u, (seen.get(u) ?? 0) + 1);
const dupes = [...seen.entries()].filter(([, n]) => n > 1);
if (dupes.length > 0) fail(`duplicate precache entries (each asset must be listed once): ${dupes.map(([u, n]) => `${u} x${n}`).join(", ")}`);

const missing = REQUIRED_ICONS.filter((icon) => !seen.has(icon));
if (missing.length > 0) fail(`expected icons missing from the precache manifest (a narrowed glob or moved file?): ${missing.join(", ")}`);

// The developer debug surface (src/debug/**, see DEBUGGING.md) must stay OUT of
// the precache: it is a dynamic import no player ever executes, and precaching
// it makes every PWA install download it.
//
// Both halves are asserted, because each guards a different silent failure.
// The chunk must EXIST under its expected name: the `**/debug-surface*`
// globIgnore only matches because `chunkFileNames` in vite.config.ts renames
// this one chunk, and that rename keys off `facadeModuleId`, which Rollup sets
// to null whenever the dynamic entry stops being a chunk's sole facade. The
// name would then silently revert to the generic `index-<hash>.js`, the glob
// would stop matching, and the chunk would quietly re-enter the precache with
// nothing failing. And it must not be PRECACHED, which is the property itself.
const assets = readdirSync(resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "assets"));
const debugChunks = assets.filter((f) => f.startsWith("debug-surface-") && f.endsWith(".js"));
if (debugChunks.length === 0) {
  fail(
    "no debug-surface-*.js chunk in dist/assets. The `chunkFileNames` rename in vite.config.ts has stopped " +
      "matching src/debug/index.ts (Rollup nulls `facadeModuleId` when the dynamic entry is no longer a chunk's " +
      "sole facade), so the `**/debug-surface*` globIgnore now matches nothing and the debug chunk is precached " +
      "into every PWA install.",
  );
}
const precachedDebug = [...seen.keys()].filter((u) => u.includes("debug-surface"));
if (precachedDebug.length > 0) {
  fail(`the debug surface is in the precache manifest (${precachedDebug.join(", ")}); check the globIgnores in vite.config.ts`);
}

console.log(
  `verify-precache: ${urls.length} unique precache entries; all ${REQUIRED_ICONS.length} required icons present exactly once; ` +
    `debug surface built (${debugChunks.join(", ")}) and excluded`,
);
