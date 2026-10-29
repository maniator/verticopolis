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
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import { AUDIO_ENGINE_CHUNK, AUDIO_RUNTIME_FILES } from "../src/audio/audioAssets.ts";
import { engineDistProblems, manifestIntegrityProblems, shellProblems, shellRevisionProblems } from "../src/build/enginePackageBuild.ts";
import { ALLOW_NO_ENGINE, missingEngine, precacheFile } from "../src/precacheEntry.ts";
import { ENGINE_BUILD_ONLY_FILES, ENGINE_DIR, ENGINE_GLUE, ENGINE_RUNTIME_FILES, ENGINE_WASM, glueLoads } from "../src/wasmhost/engineAssets.ts";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const SW = resolve(DIST, "sw.js");

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
// skips it, and never on a deploy (VC_ALLOW_NO_ENGINE=1, missingEngine in
// src/precacheEntry.ts; see CONTRIBUTING.md). The package's files, and which
// of them the game fetches at run time, are listed in
// src/wasmhost/engineAssets.ts (kept complete by engineAssets.test.ts and by
// the package build itself).
const engineDir = resolve(DIST, ENGINE_DIR);
const builtEngine = existsSync(engineDir) && readdirSync(engineDir).length > 0;
const stop = missingEngine(process.env, builtEngine);
if (stop) fail(stop);
if (builtEngine) {
  const notBuilt = ENGINE_RUNTIME_FILES.filter((f) => !existsSync(resolve(DIST, f)));
  if (notBuilt.length > 0) fail(`the engine package in dist/ is incomplete (rebuild it with npm run wasm:build): ${notBuilt.join(", ")}`);
  // A file in the package that the list does not classify could be one the
  // game fetches, so it stops the build until someone says which it is.
  const shipped = readdirSync(engineDir, { recursive: true, withFileTypes: true })
    .filter((e) => !e.isDirectory())
    .map((e) => ENGINE_DIR + relative(engineDir, resolve(e.parentPath, e.name)).split(sep).join("/"));
  const unclassified = shipped.filter((f) => !ENGINE_RUNTIME_FILES.includes(f) && !ENGINE_BUILD_ONLY_FILES.includes(f));
  if (unclassified.length > 0) fail(`dist/${ENGINE_DIR} holds files src/wasmhost/engineAssets.ts does not list; add each with whether the game fetches it at run time: ${unclassified.join(", ")}`);
  // The glue fetches its binary (and would fetch any snippet) relative to
  // itself; each such file must be one the list marks as fetched.
  const glueRefs = glueLoads(readFileSync(resolve(DIST, ENGINE_DIR + ENGINE_GLUE), "utf8")).map((f) => ENGINE_DIR + f);
  if (!glueRefs.some((f) => f !== ENGINE_DIR + ENGINE_GLUE)) fail(`found no file the engine glue loads beside itself (its binary); did wasm-bindgen's output change shape? (glueLoads in src/wasmhost/engineAssets.ts)`);
  // The byte check verifies the glue and the binary only, so a glue that
  // pulls in anything else (a snippet) would run bytes nothing has hashed.
  const stray = glueRefs.filter((f) => f !== ENGINE_DIR + ENGINE_GLUE && f !== ENGINE_DIR + ENGINE_WASM);
  if (stray.length > 0) fail(`the engine glue loads files besides its binary (${stray.join(", ")}); the package check hashes only the glue and the binary, so extend it (design 5.2) before shipping them`);
  const notRuntime = glueRefs.filter((f) => !ENGINE_RUNTIME_FILES.includes(f));
  if (notRuntime.length > 0) fail(`the engine glue loads files src/wasmhost/engineAssets.ts does not mark as fetched at run time, so they would not be precached: ${notRuntime.join(", ")}`);
  const absent = ENGINE_RUNTIME_FILES.filter((f) => !seen.has(f));
  if (absent.length > 0) fail(`engine files the game fetches at run time are missing from the precache manifest, so the WASM engine would not start offline (#945, #985); check the workbox globPatterns and maximumFileSizeToCacheInBytes in vite.config.ts: ${absent.join(", ")}`);
  // A build-only file in the manifest costs every install its download for
  // nothing (THIRD-PARTY.json alone is about 0.6 MB). If the game starts
  // reading one, mark it runtime in engineAssets.ts instead.
  const wasted = ENGINE_BUILD_ONLY_FILES.filter((f) => seen.has(f));
  if (wasted.length > 0) fail(`engine files the game never fetches are in the precache manifest (src/wasmhost/engineAssets.ts marks them build-only): ${wasted.join(", ")}`);
  // The package check (#985 criterion 5): BUILD.json describes the files
  // beside it, and the three engine entries carry the integrity that keeps a
  // body from another build out of the precache.
  const unsound = engineDistProblems(DIST, manifest);
  if (unsound.length > 0) fail(`the engine package in dist/ is not one consistent set: ${unsound.join("; ")}`);
}
// Every entry carries the integrity of its file (#1345), engine or not: a miss
// is stored only for an entry with one, so the shell refills after the
// browser drops the precache. An entry listed twice is already refused above.
const integrity = manifestIntegrityProblems(DIST, manifest);
if (integrity.length > 0) fail(`the precache manifest's integrity is not sound: ${integrity.join("; ")}`);
// The navigation fallback (#1345) loads through importScripts and is updated
// with the worker, so the worker must import it and the precache must not
// list it.
if (!/importScripts\(\s*["']sw-navigation-fallback\.js["']/.test(sw)) fail("dist/sw.js does not import sw-navigation-fallback.js, so a navigation that fails its integrity would show a blank page");
if (!existsSync(resolve(DIST, "sw-navigation-fallback.js"))) fail("dist/sw-navigation-fallback.js is missing, so the worker would not install");
if (seen.has("sw-navigation-fallback.js")) fail("sw-navigation-fallback.js is in the precache manifest; the worker imports it, so it must stay out of it");
// The page checks the engine against the id compiled into its chunks, and a
// production bundle must not carry the development serve's skip (#985).
const shell = shellProblems(DIST, builtEngine);
if (shell.length > 0) fail(`the shell in dist/ and its engine check are not sound: ${shell.join("; ")}`);
const revisions = builtEngine ? shellRevisionProblems(DIST) : [];
if (revisions.length > 0) fail(`the shell in dist/ and the precache revisions of the engine files disagree: ${revisions.join("; ")}`);

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
    (builtEngine ? `the ${ENGINE_RUNTIME_FILES.length} engine files fetched at run time are precached` : `no engine package in this build (${ALLOW_NO_ENGINE}=1)`),
);
