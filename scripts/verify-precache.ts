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
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const SW = resolve(DIST, "sw.js");

/** The WASM engine package, precached with the shell so the engine starts
 *  offline (#945). Required whenever the build carries an engine: a build
 *  without one (a checkout with no Rust toolchain, see CONTRIBUTING.md) has
 *  nothing to precache. */
const ENGINE_FILES = ["engine/verticopolis_engine.js", "engine/verticopolis_engine_bg.wasm"];

/** What a first install may download, uncompressed. About 2.9 MiB with the
 *  engine (2026-10-13); the headroom is for ordinary growth. Crossing it should
 *  be a deliberate call: raise this with the reason. */
const PRECACHE_BUDGET_BYTES = 4 * 1024 * 1024;

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

const total = urls.reduce((sum, u) => {
  const file = resolve(DIST, u.split("?")[0]);
  if (!existsSync(file)) fail(`precache entry ${u} has no file under dist/; cannot size the precache`);
  return sum + statSync(file).size;
}, 0);
if (total > PRECACHE_BUDGET_BYTES) {
  fail(`the precache is ${(total / 1048576).toFixed(2)} MiB, over its ${PRECACHE_BUDGET_BYTES / 1048576} MiB budget; every install downloads it, so shrink it or raise PRECACHE_BUDGET_BYTES with the reason`);
}

// Any engine file in the build means the whole package must be there and
// precached, so a partial build (glue without binary) stops the build before
// it can reach an offline player. A Vercel deploy always builds the engine
// (scripts/vercel-build.sh), so there a build without one fails too.
const builtEngine = ENGINE_FILES.some((f) => existsSync(resolve(DIST, f)));
if (!builtEngine && process.env.VERCEL === "1") fail("a Vercel deploy has no engine package in dist/; scripts/vercel-build.sh should have built it");
if (builtEngine) {
  const notBuilt = ENGINE_FILES.filter((f) => !existsSync(resolve(DIST, f)));
  if (notBuilt.length > 0) fail(`the engine package in dist/ is incomplete (rebuild it with npm run wasm:build): ${notBuilt.join(", ")}`);
  const absent = ENGINE_FILES.filter((f) => !seen.has(f));
  if (absent.length > 0) fail(`the built engine package is missing from the precache manifest, so the WASM engine would not start offline (#945); check the workbox globPatterns and maximumFileSizeToCacheInBytes in vite.config.ts: ${absent.join(", ")}`);
}

console.log(
  `verify-precache: ${urls.length} unique precache entries (${(total / 1048576).toFixed(2)} MiB); all ${REQUIRED_ICONS.length} required icons present exactly once; ` +
    (builtEngine ? "the engine package is precached" : "no engine package in this build"),
);
