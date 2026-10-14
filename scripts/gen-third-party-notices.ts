/**
 * Post-build step (#951): write `dist/third-party-notices.txt` from what the
 * build actually shipped. Every emitted sourcemap lists the sources its file
 * was built from; the `node_modules` ones are the bundled npm packages, the
 * service worker's workbox chunk included. Build-tool code that no sourcemap
 * lists (Vite's preload helper, vite-plugin-pwa's register module) is added
 * from `INJECTED_CODE`. Serverless `api/` dependencies never reach a browser
 * bundle, so they never appear here.
 *
 * When anything ships under `dist/engine/`, the WASM engine's Rust crates and
 * the Rust standard library come from the record its build wrote beside it
 * (`THIRD-PARTY.json`, #955), which must match the package's `BUILD.json`.
 *
 * Fails the build (one line, non-zero exit) when no sourcemap is found, a
 * sourcemap is malformed, shipped JavaScript has no sourcemap (outside a
 * short allowlist), a bundled package or recorded crate lacks a name,
 * version, allowed license id or license text, or the engine ships without a
 * valid, matching record, so an incomplete notices file never ships. It also
 * fails when package.json links a local package (a `file:`, `link:`,
 * `portal:` or `workspace:` spec, a bare local path, the same in its
 * overrides or resolutions, or a `workspaces` field), when either lockfile
 * installs a package as a link, or when `node_modules` holds a link at any
 * depth, since a linked package's code would read as our own.
 * Runs first in `verify:dist`, for every build mode.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
// The license texts it gathers are the notices themselves, so it copies no
// package content into code or assets.
// copies-package: none
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { dirname, resolve, join, relative } from "node:path";
import {
  INJECTED_CODE,
  collectPackageDirs,
  declaredLicense,
  isKnownOutsideRepoSource,
  isPackagePath,
  isWholeInjectedChunk,
  linkedDependencyProblems,
  lockfileLinkProblems,
  noticeProblem,
  packageDirFromSource,
  renderNotices,
  sourceToPath,
  type NoticePackage,
} from "../src/build/thirdPartyNotices.ts";
import { installedLinkProblems } from "../src/build/installedLinks.ts";
import { ENGINE_THIRD_PARTY, engineRecordPackages } from "../src/build/rustNotices.ts";
import { readLicenseFiles } from "./license-files.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/");
// VC_NOTICES_DIST points the generator at another built tree; its tests use
// it to run the real script against fixture builds (thirdPartyNoticesEngine.test.ts).
// Honored only under vitest, so a stray variable in a real build cannot send
// the notices to another tree.
const DIST_OVERRIDE = process.env.VITEST ? process.env.VC_NOTICES_DIST : undefined;
const DIST = (DIST_OVERRIDE ? resolve(DIST_OVERRIDE) : join(ROOT, "dist")).replace(/\\/g, "/");
const OUT = join(DIST, "third-party-notices.txt");

function fail(msg: string): never {
  process.stderr.write(`gen-third-party-notices: ${msg}\n`);
  process.exit(1);
}

function filesUnder(dir: string, test: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(p, test));
    else if (test(entry.name)) out.push(p);
  }
  return out;
}

// A linked package (a file:, link:, portal: or workspace: spec, or a bare local path) can sit inside the repository
// outside node_modules, where its sources would read as the game's own code.
let rootManifest: unknown;
try {
  rootManifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
} catch {
  fail("package.json is missing or not valid JSON, so its dependencies cannot be checked for linked packages");
}
const linked = typeof rootManifest === "object" && rootManifest !== null ? linkedDependencyProblems(rootManifest as Record<string, unknown>) : ["package.json is not an object"];
// What is installed can differ from what is declared (a hand-made symlink, an
// unsaved npm link), so the installed tree is checked too.
const nodeModules = join(ROOT, "node_modules");
linked.push(...installedLinkProblems(nodeModules));
const hiddenLock = join(nodeModules, ".package-lock.json");
if (existsSync(hiddenLock)) {
  try {
    linked.push(...lockfileLinkProblems(JSON.parse(readFileSync(hiddenLock, "utf8")), "node_modules/.package-lock.json"));
  } catch {
    fail("node_modules/.package-lock.json is not valid JSON, so the installed tree cannot be checked for linked packages");
  }
}
const lockPath = join(ROOT, "package-lock.json");
if (existsSync(lockPath)) {
  try {
    linked.push(...lockfileLinkProblems(JSON.parse(readFileSync(lockPath, "utf8"))));
  } catch {
    fail("package-lock.json is not valid JSON, so it cannot be checked for linked packages");
  }
}
if (linked.length > 0) fail(`${linked.join("; ")}; the notices cannot attribute a linked package's code`);

if (!existsSync(DIST)) fail(`${DIST} does not exist; run the build first`);
const maps = filesUnder(DIST, (n) => /\.([mc]?js|css)\.map$/.test(n));
if (maps.length === 0) fail("no sourcemaps in dist; they are needed to list the bundled packages");

// Shipped JavaScript with no sourcemap would carry unlisted code. The only one
// is the WASM engine's wasm-bindgen glue, which is attributed instead by the
// record its build writes beside it (read below, #955).
const ENGINE_GLUE = "engine/verticopolis_engine.js";
const MAPLESS_JS_ALLOWED = new Set([ENGINE_GLUE]);
const mapless = filesUnder(DIST, (n) => /\.[mc]?js$/.test(n))
  .filter((f) => !existsSync(`${f}.map`))
  .map((f) => relative(DIST, f).replace(/\\/g, "/"))
  .filter((f) => !MAPLESS_JS_ALLOWED.has(f));
if (mapless.length > 0) fail(`no sourcemap for ${mapless.join(", ")}; its bundled packages cannot be listed`);

// Package stylesheets, and package assets emitted from CSS, appear in no
// sourcemap; the `no-unlisted-package-files` plugin in vite.config.ts stops the
// build before one can ship.

const sources: string[] = []; // repo-relative, each starting with "/"
const rawSources: string[] = [];
for (const map of maps) {
  // A map whose emitted file is gone (a stale or partial dist) describes code
  // that does not ship.
  if (!existsSync(map.slice(0, -".map".length))) fail(`${relative(ROOT, map)} has no emitted file beside it`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(map, "utf8"));
  } catch {
    fail(`${relative(ROOT, map)} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { sources?: unknown }).sources)) {
    fail(`${relative(ROOT, map)} has no sources array`);
  }
  const { sources: mapSources, sourceRoot } = parsed as { sources: unknown[]; sourceRoot?: unknown };
  if (mapSources.some((x) => typeof x !== "string")) fail(`${relative(ROOT, map)} has a source that is not a string`);
  // A map that lists nothing is allowed only for a chunk that is known
  // build-tool code and nothing else (Vite's modulepreload polyfill).
  if (mapSources.length === 0) {
    const code = readFileSync(map.slice(0, -".map".length), "utf8");
    if (!INJECTED_CODE.some((inj) => inj.wholeChunk && inj.codeMarker && isWholeInjectedChunk(code, inj.codeMarker))) {
      fail(`${relative(ROOT, map)} lists no sources, so its chunk's packages cannot be listed`);
    }
  }
  for (const s of mapSources) {
    if (typeof s === "string") rawSources.push(s);
    // A `\0` id is a bundler helper. One that wraps an absolute file
    // (`\0/abs/node_modules/p/x.js?commonjs-proxy`) still counts, so strip the
    // marker and the query; any other (`\0vite/preload-helper.js`) names no file.
    let id: unknown = s;
    if (typeof s === "string" && s.startsWith("\0")) {
      const wrapped = s.slice(1).replace(/\?.*$/, "");
      id = /^([A-Za-z]:)?[\\/]/.test(wrapped) ? wrapped : null;
    }
    const path = sourceToPath(id, dirname(map).replace(/\\/g, "/"), sourceRoot);
    if (path) {
      // Packages are read only from the part of the path inside the repo, so a
      // checkout that itself sits under a node_modules folder is not mistaken
      // for one, and a path that climbs out of the repo is never attributed
      // to whatever copy the build host happens to have.
      const inRepo = path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length) : null;
      // The only sources allowed outside it are build-tool code that an
      // `INJECTED_CODE` entry marked `outsideRepo` attributes by its source id
      // (workbox-build's template in a temporary folder, vite-plugin-pwa's
      // virtual module).
      if (inRepo === null) {
        if (typeof s !== "string" || !isKnownOutsideRepoSource(s)) fail(`${relative(ROOT, map)} lists ${JSON.stringify(s)}, which is outside the repository`);
        continue;
      }
      // A node_modules path that names no package (a tool cache such as
      // node_modules/.vite) cannot be attributed.
      if (isPackagePath(inRepo) && !packageDirFromSource(inRepo)) {
        fail(`${relative(ROOT, map)} lists ${JSON.stringify(s)}, which is under node_modules but names no package`);
      }
      // A stale or corrupt map can name a file that is not there; it must not
      // stand as evidence that a package ships. Two bundlers write sources one
      // level off, relative to dist/ itself (workbox-build's temporary
      // directory and Vite's worker bundles), so a path under dist/ that is
      // missing is read again from the repository root.
      // A directory is not a source file, so it identifies nothing that shipped.
      const isFile = (p: string): boolean => existsSync(p) && statSync(p).isFile();
      let onDisk = inRepo;
      if (!isFile(ROOT + onDisk) && onDisk.startsWith("/dist/")) onDisk = onDisk.slice("/dist".length);
      if (!isFile(ROOT + onDisk)) fail(`${relative(ROOT, map)} lists ${JSON.stringify(s)}, which is not a file`);
      sources.push(onDisk);
    }
    // An id that names no file (a virtual module, a `\0` helper, a URL) could
    // carry a tool's code; it passes only when an `INJECTED_CODE` entry marked
    // for ids outside the repository attributes it.
    else if (typeof s === "string" && !isKnownOutsideRepoSource(s)) {
      fail(`${relative(ROOT, map)} lists ${JSON.stringify(s)}, which names no local file; add it to INJECTED_CODE with its package`);
    }
  }
}

// Package directories from the maps; every source was checked on disk above.
const dirs = new Map<string, string>(); // dir -> how it was found
for (const found of collectPackageDirs(sources).map((rel) => ROOT + rel)) dirs.set(found, found);
// Node's lookup: the nearest node_modules/<pkg> from the package that loads it
// (or the repo root), so a nested copy is the one read.
function resolvePackage(pkg: string, from?: string): string {
  let dir = from ? resolvePackage(from) : ROOT;
  for (;;) {
    const candidate = join(dir, "node_modules", pkg).replace(/\\/g, "/");
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dir === ROOT || !dir.startsWith(`${ROOT}/`)) return join(ROOT, "node_modules", pkg).replace(/\\/g, "/");
    dir = dirname(dir).replace(/\\/g, "/");
  }
}

// Build-tool code that no sourcemap lists.
const shippedJs = filesUnder(DIST, (n) => /\.[mc]?js$/.test(n)).map((f) => readFileSync(f, "utf8"));
for (const inj of INJECTED_CODE) {
  const bySource = inj.sourcePattern ? rawSources.some((s) => inj.sourcePattern!.test(s)) : false;
  const byCode = inj.codeMarker ? shippedJs.some((code) => code.includes(inj.codeMarker!)) : false;
  if (bySource || byCode) dirs.set(resolvePackage(inj.pkg, inj.from), `injected:${inj.pkg}`);
}

const packages: NoticePackage[] = [];
const problems: string[] = [];
for (const [dir, origin] of dirs) {
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) {
    problems.push(`${relative(ROOT, dir)}: no package.json (from ${origin.startsWith("injected:") ? origin : relative(ROOT, origin)})`);
    continue;
  }
  let manifest: { name?: unknown; version?: unknown; license?: unknown; licenses?: unknown };
  try {
    const parsedManifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof parsedManifest !== "object" || parsedManifest === null) throw new Error("not an object");
    manifest = parsedManifest;
  } catch {
    problems.push(`${relative(ROOT, manifestPath)} is not a valid package.json`);
    continue;
  }
  const read = readLicenseFiles(dir);
  if (read.problems.length > 0) {
    problems.push(...read.problems.map((p) => `${relative(ROOT, p.file)} ${p.reason}`));
    continue;
  }
  const pkg = {
    name: typeof manifest.name === "string" ? manifest.name : undefined,
    version: typeof manifest.version === "string" ? manifest.version : undefined,
    license: declaredLicense(manifest),
    hasLicenseFile: read.hasLicenseFile,
    licenseText: read.licenseText,
  };
  const problem = noticeProblem(pkg);
  if (problem) problems.push(problem);
  else packages.push({ name: pkg.name!, version: pkg.version!, license: pkg.license!, licenseText: pkg.licenseText });
}

// The WASM engine: its crates and the Rust standard library, from the record
// every engine build writes beside the package. The engine never ships
// without one: any file under dist/engine/ (the glue, the .wasm, or both)
// requires it.
const engineDir = join(DIST, "engine");
const ENGINE_FILES = new Set(["verticopolis_engine.js", "verticopolis_engine_bg.wasm", "BUILD.json", ENGINE_THIRD_PARTY]);
if (existsSync(engineDir) && (!statSync(engineDir).isDirectory() || readdirSync(engineDir).length > 0)) {
  const recordPath = join(DIST, "engine", ENGINE_THIRD_PARTY);
  const read = (path: string): unknown => {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      fail(`${relative(ROOT, path)} is missing or not valid JSON, so the WASM engine that ships cannot be attributed (rebuild it with npm run wasm:build)`);
    }
  };
  const build = read(join(DIST, "engine", "BUILD.json")) as { sources?: unknown } | null;
  const wasmPath = join(DIST, "engine", "verticopolis_engine_bg.wasm");
  let wasm: string | null = null;
  if (existsSync(wasmPath)) {
    try {
      wasm = createHash("sha256").update(readFileSync(wasmPath)).digest("hex");
    } catch {
      fail(`${relative(ROOT, wasmPath)} cannot be read`);
    }
  }
  // The record describes this package and nothing else, so another file here would ship unattributed.
  const extra = statSync(engineDir).isDirectory() ? readdirSync(engineDir).filter((f) => !ENGINE_FILES.has(f)) : [];
  if (extra.length > 0) problems.push(`dist/engine/ ships ${extra.join(", ")}, which the engine's record does not describe`);
  const engine = engineRecordPackages(read(recordPath), { sources: build?.sources, wasm });
  problems.push(...engine.problems.map((p) => `${relative(ROOT, recordPath)}: ${p}`));
  packages.push(...engine.packages);
}

if (problems.length > 0) fail(problems.join("; "));
if (packages.length === 0) fail("the build lists no third-party packages; refusing to write an empty notices file");

writeFileSync(OUT, renderNotices(packages));
console.log(`gen-third-party-notices: ${packages.length} packages -> ${relative(ROOT, OUT)}`);
