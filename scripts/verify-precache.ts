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
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import { AUDIO_ENGINE_CHUNK, AUDIO_RUNTIME_FILES } from "../src/audio/audioAssets.ts";
import { ALLOW_NO_ENGINE, missingEngine, precacheFile } from "../src/precacheEntry.ts";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const SW = resolve(DIST, "sw.js");

/** The WASM engine package, precached with the shell so the engine starts
 *  offline (#945). Every build must carry it, whatever hosts it, unless a
 *  build that is not a deploy opts out with VC_ALLOW_NO_ENGINE=1
 *  (missingEngine in src/precacheEntry.ts; see CONTRIBUTING.md). */
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

const realDist = realpathSync(DIST);
const total = urls.reduce((sum, u) => {
  let file: string;
  try {
    file = precacheFile(DIST, u);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
  if (!existsSync(file)) fail(`precache entry ${u} has no file under dist/; cannot size the precache`);
  const real = relative(realDist, realpathSync(file));
  if (real === "" || real === ".." || real.startsWith(`..${sep}`) || isAbsolute(real)) fail(`precache entry ${u} links outside dist/`);
  return sum + statSync(file).size;
}, 0);
if (total > PRECACHE_BUDGET_BYTES) {
  fail(`the precache is ${(total / 1048576).toFixed(2)} MiB, over its ${PRECACHE_BUDGET_BYTES / 1048576} MiB budget; every install downloads it, so shrink it or raise PRECACHE_BUDGET_BYTES with the reason`);
}

// Every build needs the whole package, precached, so a partial build (glue
// without binary) or a missing one stops here before it can reach a player
// as a silent fallback to the TypeScript engine. Only an explicit opt-in
// skips it, and never on a deploy.
const builtEngine = [...ENGINE_FILES, "engine/BUILD.json"].some((f) => existsSync(resolve(DIST, f)));
const stop = missingEngine(process.env, builtEngine);
if (stop) fail(stop);
if (builtEngine) {
  const notBuilt = ENGINE_FILES.filter((f) => !existsSync(resolve(DIST, f)));
  if (notBuilt.length > 0) fail(`the engine package in dist/ is incomplete (rebuild it with npm run wasm:build): ${notBuilt.join(", ")}`);
  const absent = ENGINE_FILES.filter((f) => !seen.has(f));
  if (absent.length > 0) fail(`the built engine package is missing from the precache manifest, so the WASM engine would not start offline (#945); check the workbox globPatterns and maximumFileSizeToCacheInBytes in vite.config.ts: ${absent.join(", ")}`);
}

// Today's sounds must play offline too (#985): the lazy chunk that carries
// Tone.js and every synthesized sound, and each recorded file the audio layer
// fetches (src/audio/audioAssets.ts, kept complete by audioAssets.test.ts).
const audioChunks = urls.map((u) => u.split("?")[0]).filter((u) => AUDIO_ENGINE_CHUNK.test(u));
if (audioChunks.length === 0) {
  fail(`no precache entry matches the audio engine chunk (${AUDIO_ENGINE_CHUNK}), so an installed game would play no sound offline (#985); check the workbox globPatterns and the chunk's name`);
}
// The chunk is self-contained today. If a later build splits Tone.js (or
// anything else it uses) into other chunks, every file it loads, directly or
// through another chunk, must be precached too, or the lazy import fails
// offline. Follows relative imports, `new URL(..., import.meta.url)` assets
// and Vite's preload lists ("assets/..."), with POSIX paths so the manifest
// keys match on every OS.
const audioDeps = new Set<string>();
const unresolved: string[] = [];
const queue = [...audioChunks];
while (queue.length > 0) {
  const chunk = queue.pop()!;
  if (!existsSync(resolve(DIST, chunk))) fail(`precache entry ${chunk} has no file under dist/`);
  const text = readFileSync(resolve(DIST, chunk), "utf8");
  const from = (ref: string) => (ref.startsWith("/") ? ref.slice(1) : posix.join(posix.dirname(chunk), ref));
  // A relative import is real code the chunk runs: it must resolve.
  for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["'`](\.\.?\/[^"'`]+\.js)["'`]/g)) {
    const ref = from(m[1]);
    if (ref.startsWith("..") || !existsSync(resolve(DIST, ref))) unresolved.push(`${m[1]} (from ${chunk})`);
    else if (!audioDeps.has(ref) && !audioChunks.includes(ref)) {
      audioDeps.add(ref);
      queue.push(ref);
    }
  }
  // Asset references: only those that name a real file under dist/ count, so
  // a string that merely looks like a path cannot fail the build.
  const assets = [
    ...[...text.matchAll(/new URL\(\s*["'`]([^"'`:]+)["'`]\s*,\s*import\.meta\.url/g)].map((m) => from(m[1])),
    ...[...text.matchAll(/["'`](assets\/[\w./-]+\.(?:js|css|wasm|mp3|ogg|wav|m4a|flac|aac|opus|webm|json))["'`]/g)].map((m) => m[1]),
  ];
  for (const ref of assets) {
    if (ref.startsWith("..") || audioDeps.has(ref) || audioChunks.includes(ref) || !existsSync(resolve(DIST, ref))) continue;
    audioDeps.add(ref);
    if (ref.endsWith(".js")) queue.push(ref);
  }
}
if (unresolved.length > 0) fail(`the audio engine chunk imports files that are not in dist/: ${unresolved.join(", ")}`);
const unprecached = [...audioDeps].filter((f) => !seen.has(f));
if (unprecached.length > 0) fail(`the audio engine chunk loads files missing from the precache manifest, so it would not load offline (#985): ${unprecached.join(", ")}`);
const silent = AUDIO_RUNTIME_FILES.filter((f) => !seen.has(f));
if (silent.length > 0) fail(`audio files the game fetches at run time are missing from the precache manifest, so they would not play offline (#985): ${silent.join(", ")}`);

console.log(
  `verify-precache: ${urls.length} unique precache entries (${(total / 1048576).toFixed(2)} MiB); all ${REQUIRED_ICONS.length} required icons present exactly once; the audio chunk and ${AUDIO_RUNTIME_FILES.length} audio files are precached; ` +
    (builtEngine ? "the engine package is precached" : `no engine package in this build (${ALLOW_NO_ENGINE}=1)`),
);
