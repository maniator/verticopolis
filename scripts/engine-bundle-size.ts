/**
 * Size report for one production build directory, for comparing engine build
 * modes (docs/performance/wasm-only-bundle.md). It reuses the #979 size
 * analysis (src/tests/perfCompare/bundle.ts: raw, gzip level 9 and Brotli
 * quality 11 for every file, the precache list, the categories) and adds what
 * a first visit fetches before the game runs: the entry script and the
 * modulepreload links in index.html, plus the engine package when the build
 * loads it at boot.
 *
 *   npx tsx scripts/engine-bundle-size.ts <dist dir> [--wasm-at-boot] [--json]
 *
 * It also charges the game JavaScript's minified bytes to their sources
 * through the sourcemaps (src/build/sourcemapBytes.ts) and reports the
 * TypeScript engine's (`src/engine/`) share. Its Brotli figure compresses
 * those spans on their own, outside their chunks, so it is an estimate.
 *
 * Bytes are what the build wrote; a CDN's own compression can differ.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { analyzeBundle, NOT_GAME, totalOf, type FileSize, type Totals } from "../src/tests/perfCompare/bundle.ts";
import { bytesBySource } from "../src/build/sourcemapBytes.ts";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) throw new Error("usage: npx tsx scripts/engine-bundle-size.ts <dist dir> [--wasm-at-boot] [--json]");
const wasmAtBoot = args.includes("--wasm-at-boot");

const report = analyzeBundle(dir);
const html = readFileSync(join(dir, "index.html"), "utf8");
const initialPaths = new Set<string>();
for (const m of html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)) initialPaths.add(m[1].replace(/^\.?\//, ""));
for (const m of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)) initialPaths.add(m[1].replace(/^\.?\//, ""));

if (initialPaths.size === 0) throw new Error(`found no module script or modulepreload link in ${join(dir, "index.html")}; the report would call every chunk lazy`);

const isGameJs = (f: FileSize) => f.path.endsWith(".js") && !NOT_GAME.includes(f.category) && f.category !== "service-worker" && f.category !== "wasm-glue";
const gameJs = report.files.filter(isGameJs);
const initial = gameJs.filter((f) => initialPaths.has(f.path));
const lazy = gameJs.filter((f) => !initialPaths.has(f.path));
const engine = report.files.filter((f) => f.category === "wasm-binary" || f.category === "wasm-glue");
const sum = (files: FileSize[]): Totals => totalOf(files, () => true);
const atBoot = wasmAtBoot ? [...initial, ...engine] : initial;

// The TypeScript engine's share of the game JavaScript, from the sourcemaps.
const ENGINE_SOURCE = /(^|\/)src\/engine\//;
let mappedJs = 0;
let engineJs = 0;
const engineSpans: string[] = [];
for (const f of gameJs) {
  const mapPath = join(dir, `${f.path}.map`);
  if (!existsSync(mapPath)) throw new Error(`${f.path} has no sourcemap; cannot attribute its bytes`);
  const { bytes, text } = bytesBySource(readFileSync(join(dir, f.path), "utf8"), JSON.parse(readFileSync(mapPath, "utf8")) as { sources: string[]; mappings: string });
  for (const [source, n] of bytes) {
    mappedJs += n;
    if (ENGINE_SOURCE.test(source)) {
      engineJs += n;
      engineSpans.push(...(text.get(source) ?? []));
    }
  }
}
const engineBrotli = brotliCompressSync(Buffer.from(engineSpans.join("")), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;

const out = {
  dir,
  gameJs: { chunks: gameJs.length, ...sum(gameJs) },
  initialJs: { files: initial.map((f) => f.path), ...sum(initial) },
  lazyJs: { files: lazy.map((f) => f.path), ...sum(lazy) },
  enginePackage: { files: engine.map((f) => f.path), ...sum(engine) },
  firstVisitBeforePlay: { wasmAtBoot, ...sum(atBoot) },
  precache: report.precache,
  tsEngine: { minified: engineJs, ofGameJs: mappedJs, share: mappedJs ? engineJs / mappedJs : 0, brotliOnItsOwn: engineBrotli },
  everythingButMaps: totalOf(report.files, (f) => f.category !== "sourcemaps"),
};

if (args.includes("--json")) {
  console.log(JSON.stringify(out, null, 2));
} else {
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KiB`;
  const row = (name: string, t: Totals) => `| ${name} | ${kb(t.raw)} | ${kb(t.brotli)} |`;
  console.log(`| ${dir} | raw | Brotli |\n| --- | --- | --- |`);
  console.log(row(`Game JavaScript (${out.gameJs.chunks} chunks)`, out.gameJs));
  console.log(row(`Initial JavaScript (${initial.length} files)`, out.initialJs));
  console.log(row(`Lazy JavaScript (${lazy.length} files)`, out.lazyJs));
  console.log(row("WASM engine package (glue + binary)", out.enginePackage));
  console.log(row(`Fetched before play${wasmAtBoot ? " (with the engine)" : ""}`, out.firstVisitBeforePlay));
  console.log(row(`Precache (${report.precache.entries} entries)`, report.precache));
  console.log(`| TypeScript engine in game JS | ${engineJs.toLocaleString("en-US")} B (${((100 * engineJs) / (mappedJs || 1)).toFixed(1)}%) | ${(engineBrotli / 1024).toFixed(1)} KiB on its own |`);
}
