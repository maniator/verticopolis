import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

/**
 * Size analysis of a production build (issue #972): every file in `dist/`
 * with its raw, gzip (level 9) and Brotli (quality 11) size, a category, the
 * service worker's precache list, and the section layout of the engine's
 * `.wasm`. Which files a first visit actually downloads is measured by the
 * runner (served requests); this module only reads the build output.
 */

export type Category =
  | "app-js"
  | "audio-js"
  | "css"
  | "html"
  | "wasm-binary"
  | "wasm-glue"
  | "engine-meta"
  | "audio-assets"
  | "images"
  | "fonts"
  | "service-worker"
  | "non-game-pages"
  | "tooling"
  | "sourcemaps"
  | "other";

export interface FileSize {
  path: string;
  category: Category;
  raw: number;
  gzip: number;
  brotli: number;
  precached: boolean;
}

/** The category of a build file, by its path relative to `dist/`. */
export function categorize(path: string): Category {
  const p = path.split("\\").join("/");
  const base = p.slice(p.lastIndexOf("/") + 1);
  if (p.endsWith(".map")) return "sourcemaps";
  if (p.startsWith("engine/")) {
    if (p.endsWith(".wasm")) return "wasm-binary";
    return p.endsWith(".js") ? "wasm-glue" : "engine-meta";
  }
  if (base === "sw.js" || /^workbox-[\w-]+\.js$/.test(base)) return "service-worker";
  if (/^(help|gallery|preview|pageShell|helpContent)[-.]/.test(base) || p.startsWith("assets/help-media/")) return "non-game-pages";
  if (/^worker-[\w-]+\.js$/.test(base)) return "tooling";
  if (/^ToneAudioEngine-[\w-]+\.js$/.test(base)) return "audio-js";
  if (p.endsWith(".js")) return "app-js";
  if (p.endsWith(".css")) return "css";
  if (p.endsWith(".html")) return "html";
  if (/\.(mp3|ogg|wav|m4a)$/.test(p)) return "audio-assets";
  if (/\.(png|svg|ico|jpg|jpeg|webp|gif)$/.test(p)) return "images";
  if (/\.(woff2?|ttf|otf)$/.test(p)) return "fonts";
  return "other";
}

/** The precache URLs a Workbox `sw.js` lists (`{url:"...",revision:...}`). */
export function precacheUrls(swSource: string): string[] {
  const urls = new Set<string>();
  for (const m of swSource.matchAll(/\{\s*url:\s*"([^"]+)"\s*,\s*revision:/g)) urls.add(m[1].replace(/^\//, ""));
  for (const m of swSource.matchAll(/\{\s*revision:\s*(?:"[^"]*"|null)\s*,\s*url:\s*"([^"]+)"\s*\}/g)) urls.add(m[1].replace(/^\//, ""));
  return [...urls].sort();
}

/** Read one unsigned LEB128 value at `pos`. */
function uleb(bytes: Uint8Array, pos: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let i = pos;
  for (;;) {
    if (i >= bytes.length) throw new Error("truncated LEB128 in the wasm");
    const b = bytes[i++];
    value += (b & 0x7f) * 2 ** shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) throw new Error("LEB128 too long in the wasm");
  }
  return { value, next: i };
}

const SECTION_NAMES = ["custom", "type", "import", "function", "table", "memory", "global", "export", "start", "element", "code", "data", "datacount", "tag"];

/** The size of every section of a WASM module, custom sections by name. */
export function wasmSections(bytes: Uint8Array): { name: string; bytes: number }[] {
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) throw new Error("not a wasm module");
  const out: { name: string; bytes: number }[] = [];
  let pos = 8;
  while (pos < bytes.length) {
    const id = bytes[pos];
    const { value: size, next } = uleb(bytes, pos + 1);
    const end = next + size;
    if (end > bytes.length) throw new Error("a wasm section runs past the end");
    let name = SECTION_NAMES[id] ?? `unknown-${id}`;
    if (id === 0) {
      const n = uleb(bytes, next);
      if (n.next + n.value > end) throw new Error("a custom section's name runs past its section");
      name = `custom:${new TextDecoder().decode(bytes.subarray(n.next, n.next + n.value))}`;
    }
    out.push({ name, bytes: end - pos });
    pos = end;
  }
  return out;
}

function walk(dir: string, root: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    if (name === ".perf-build.json") continue; // the harness's own build stamp
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, root, out);
    else out.push(relative(root, p).split("\\").join("/"));
  }
}

/** Categories a player of the game never downloads (source maps, the help
 *  and gallery pages, the dual-run worker), left out of the game totals. */
export const NOT_GAME: readonly Category[] = ["sourcemaps", "non-game-pages", "tooling"];
/** The categories that exist only for the WASM engine. */
export const WASM_ONLY: readonly Category[] = ["wasm-binary", "wasm-glue", "engine-meta"];

export interface Totals {
  raw: number;
  gzip: number;
  brotli: number;
}

export function totalOf(files: readonly FileSize[], keep: (f: FileSize) => boolean): Totals {
  const t = { raw: 0, gzip: 0, brotli: 0 };
  for (const f of files) {
    if (!keep(f)) continue;
    t.raw += f.raw;
    t.gzip += f.gzip;
    t.brotli += f.brotli;
  }
  return t;
}

export interface BundleReport {
  /** Every game file, then the same without the WASM engine's files (what
   *  a TypeScript-only build would ship), then the WASM files alone. */
  totals: { game: Totals; gameWithoutWasm: Totals; wasmOnly: Totals; everything: Totals };
  files: FileSize[];
  byCategory: Record<string, { files: number; raw: number; gzip: number; brotli: number }>;
  precache: { entries: number; missing: string[]; raw: number; gzip: number; brotli: number };
  wasm: { path: string; raw: number; sections: { name: string; bytes: number }[]; customBytes: number } | null;
}

export function sizeOf(buf: Buffer): { raw: number; gzip: number; brotli: number } {
  return {
    raw: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
    brotli: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }).length,
  };
}

export function analyzeBundle(distDir: string): BundleReport {
  const paths: string[] = [];
  walk(distDir, distDir, paths);
  const swPath = paths.includes("sw.js") ? join(distDir, "sw.js") : null;
  const precache = swPath ? precacheUrls(readFileSync(swPath, "utf8")) : [];
  const pre = new Set(precache);
  const files: FileSize[] = paths.map((p) => ({ path: p, category: categorize(p), ...sizeOf(readFileSync(join(distDir, p))), precached: pre.has(p) }));
  const byCategory: BundleReport["byCategory"] = {};
  for (const f of files) {
    const c = (byCategory[f.category] ??= { files: 0, raw: 0, gzip: 0, brotli: 0 });
    c.files++;
    c.raw += f.raw;
    c.gzip += f.gzip;
    c.brotli += f.brotli;
  }
  const inPre = files.filter((f) => f.precached);
  const wasmFile = files.find((f) => f.category === "wasm-binary");
  let wasm: BundleReport["wasm"] = null;
  if (wasmFile) {
    const sections = wasmSections(readFileSync(join(distDir, wasmFile.path)));
    wasm = { path: wasmFile.path, raw: wasmFile.raw, sections, customBytes: sections.filter((s) => s.name.startsWith("custom:")).reduce((s, x) => s + x.bytes, 0) };
  }
  const game = (f: FileSize) => !NOT_GAME.includes(f.category);
  return {
    totals: {
      game: totalOf(files, game),
      gameWithoutWasm: totalOf(files, (f) => game(f) && !WASM_ONLY.includes(f.category)),
      wasmOnly: totalOf(files, (f) => WASM_ONLY.includes(f.category)),
      everything: totalOf(files, () => true),
    },
    files,
    byCategory,
    precache: {
      entries: precache.length,
      missing: precache.filter((u) => !paths.includes(u)),
      raw: inPre.reduce((s, f) => s + f.raw, 0),
      gzip: inPre.reduce((s, f) => s + f.gzip, 0),
      brotli: inPre.reduce((s, f) => s + f.brotli, 0),
    },
    wasm,
  };
}
