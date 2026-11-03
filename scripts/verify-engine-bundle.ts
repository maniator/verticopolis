/**
 * Postbuild guard for the engine bundle (see src/build/engineBundle.ts).
 * It reads what the build emitted rather than the source imports: every JavaScript
 * file's sourcemap (the bundler's own record of which modules it carries) and
 * the service worker's precache list, so every `npm run build` proves its own
 * output:
 *   - no build ships test code;
 *   - the build ships no TypeScript step loop, precaches the engine package
 *     whenever dist/ holds one (a VC_ALLOW_NO_ENGINE=1 build has none), and
 *     carries only the TypeScript engine modules
 *     scripts/engine-bundle.allow.txt lists (and all of them, so the list
 *     only shrinks).
 * `VC_ENGINE_REPORT=<file>` also writes the engine modules found as JSON.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { checkEngineBundle, ENGINE_PACKAGE_FILES, parseAllowList, precacheManifest, repoRelativeSource, type EmittedChunk } from "../src/build/engineBundle.ts";
import { ENGINE_DIR } from "../src/wasmhost/enginePackageNames.ts";
import { MAPLESS_PUBLIC_SCRIPTS } from "../src/build/publicFiles.ts";
import { sourceToPath } from "../src/build/thirdPartyNotices.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const ALLOW = join(ROOT, "scripts", "engine-bundle.allow.txt");

function fail(msg: string): never {
  console.error(`verify-engine-bundle: ${msg}`);
  process.exit(1);
}

function filesUnder(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) fail(`${relative(DIST, p)} is a symbolic link; the build writes none, so it cannot be checked`);
    if (st.isDirectory()) out.push(...filesUnder(p, keep));
    else if (keep(name)) out.push(p);
  }
  return out;
}

const tooling = process.env.VC_TOOLING === "1";
if (!existsSync(DIST)) fail(`no ${DIST} (run the build first)`);

// Every emitted script must carry a sourcemap: without one its modules cannot
// be read, and a guard that skips what it cannot read proves nothing.
const scripts = filesUnder(DIST, (n) => /\.[mc]?js$/.test(n));
const chunks: EmittedChunk[] = [];
const ROOT_PATH = ROOT.replace(/\\/g, "/").replace(/\/$/, "");
for (const file of scripts) {
  const rel = relative(DIST, file).replace(/\\/g, "/");
  const mapFile = `${file}.map`;
  if (!existsSync(mapFile)) {
    // The engine package's glue is the wasm-bindgen output of the Rust
    // crate, copied in as built: it has no map and no TypeScript in it.
    if (ENGINE_PACKAGE_FILES.includes(rel)) continue;
    // The project's own plain scripts from src/public/ bundle no module.
    if (MAPLESS_PUBLIC_SCRIPTS.includes(rel)) continue;
    fail(`${rel} has no sourcemap, so the modules it carries cannot be checked`);
  }
  let map: { sources?: unknown; sourceRoot?: unknown };
  try {
    map = JSON.parse(readFileSync(mapFile, "utf8")) as typeof map;
  } catch {
    fail(`${rel}.map is not valid JSON`);
  }
  if (!Array.isArray(map.sources)) fail(`${rel}.map has no sources array`);
  const mapDir = dirname(mapFile).replace(/\\/g, "/");
  const sources: string[] = [];
  for (const s of map.sources) {
    const path = sourceToPath(s, mapDir, map.sourceRoot);
    if (path === null) continue; // a virtual or bundler module
    sources.push(repoRelativeSource(path, ROOT_PATH));
  }
  chunks.push({ file: rel, sources });
}

if (!existsSync(join(DIST, "sw.js"))) fail("no dist/sw.js, so the precache cannot be checked");
const precache = precacheManifest(readFileSync(join(DIST, "sw.js"), "utf8"));
if (precache === null) fail("found no precacheAndRoute manifest in dist/sw.js; did the workbox output format change?");

const allow = parseAllowList(readFileSync(ALLOW, "utf8"));
if (allow.errors.length > 0) fail(`scripts/engine-bundle.allow.txt: ${allow.errors.join("; ")}`);

// The same test scripts/verify-precache.ts uses for "the build holds the engine".
const engineDir = join(DIST, ENGINE_DIR);
const enginePackageBuilt = existsSync(engineDir) && readdirSync(engineDir).length > 0;
const result = checkEngineBundle({ tooling, chunks, precache, enginePackageBuilt, allowed: allow.modules });
if (process.env.VC_ENGINE_REPORT) {
  writeFileSync(process.env.VC_ENGINE_REPORT, JSON.stringify({ tooling, engineModules: result.engineModules }, null, 2));
}
if (result.errors.length > 0) fail(`\n  - ${result.errors.join("\n  - ")}`);
console.log(
  `verify-engine-bundle: ${tooling ? "tooling " : ""}build, ${chunks.length} scripts checked; ` +
    `${result.engineModules.length} TypeScript engine modules ship (all listed in scripts/engine-bundle.allow.txt), no step loop, no runtime engine switch`,
);
