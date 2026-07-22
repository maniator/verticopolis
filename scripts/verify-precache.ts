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
import { readFileSync } from "node:fs";
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

// generateSW emits entries as {url:"...",revision:"..."} (unquoted keys in the
// minified output); tolerate quoted keys too in case the emitter changes.
const urls = [...manifest.matchAll(/["']?url["']?\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
if (urls.length === 0) fail("the precache manifest parsed to zero url entries; the entry format may have changed");

const seen = new Map<string, number>();
for (const u of urls) seen.set(u, (seen.get(u) ?? 0) + 1);
const dupes = [...seen.entries()].filter(([, n]) => n > 1);
if (dupes.length > 0) fail(`duplicate precache entries (each asset must be listed once): ${dupes.map(([u, n]) => `${u} x${n}`).join(", ")}`);

const missing = REQUIRED_ICONS.filter((icon) => !seen.has(icon));
if (missing.length > 0) fail(`expected icons missing from the precache manifest (a narrowed glob or moved file?): ${missing.join(", ")}`);

console.log(`verify-precache: ${urls.length} unique precache entries; all ${REQUIRED_ICONS.length} required icons present exactly once`);
