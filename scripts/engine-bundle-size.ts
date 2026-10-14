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
 * Bytes are what the build wrote; a CDN's own compression can differ.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeBundle, NOT_GAME, totalOf, type FileSize, type Totals } from "../src/tests/perfCompare/bundle.ts";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) throw new Error("usage: npx tsx scripts/engine-bundle-size.ts <dist dir> [--wasm-at-boot] [--json]");
const wasmAtBoot = args.includes("--wasm-at-boot");

const report = analyzeBundle(dir);
const html = readFileSync(join(dir, "index.html"), "utf8");
const initialPaths = new Set<string>();
for (const m of html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)) initialPaths.add(m[1].replace(/^\.?\//, ""));
for (const m of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)) initialPaths.add(m[1].replace(/^\.?\//, ""));

const isGameJs = (f: FileSize) => f.path.endsWith(".js") && !NOT_GAME.includes(f.category) && f.category !== "service-worker" && f.category !== "wasm-glue";
const gameJs = report.files.filter(isGameJs);
const initial = gameJs.filter((f) => initialPaths.has(f.path));
const lazy = gameJs.filter((f) => !initialPaths.has(f.path));
const engine = report.files.filter((f) => f.category === "wasm-binary" || f.category === "wasm-glue");
const sum = (files: FileSize[]): Totals => totalOf(files, () => true);
const atBoot = wasmAtBoot ? [...initial, ...engine] : initial;

const out = {
  dir,
  gameJs: { chunks: gameJs.length, ...sum(gameJs) },
  initialJs: { files: initial.map((f) => f.path), ...sum(initial) },
  lazyJs: { files: lazy.map((f) => f.path), ...sum(lazy) },
  enginePackage: { files: engine.map((f) => f.path), ...sum(engine) },
  firstVisitBeforePlay: { wasmAtBoot, ...sum(atBoot) },
  precache: report.precache,
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
}
