import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * The TypeScript engine's source hash (#1422): a SHA-256 over every
 * non-test `.ts` and `.json` file under `src/engine` and every module those
 * import, followed through relative imports to the whole closure (a few
 * live outside the folder, such as the save codecs). Each file adds its path
 * relative to `src` and its bytes, in sorted order. It is built into the page
 * as `__TS_ENGINE_SOURCES__` and shown beside the engine's pinned version
 * (`src/wasmhost/tsEngineIdentity.ts`), so a report names the engine code
 * the way the Rust binary's source hash does. Node only (the Vite config and
 * its test); never imported by the app.
 */

/** A relative module specifier in an import, export or dynamic import. */
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;

const isSource = (name: string) => (name.endsWith(".ts") && !name.endsWith(".test.ts")) || name.endsWith(".json");

function resolveImport(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  for (const p of [base, `${base}.ts`, `${base}.d.ts`, join(base, "index.ts")]) if (existsSync(p) && lstatSync(p).isFile()) return p;
  throw new Error(`${from} imports ${spec}, which the TypeScript engine's source hash cannot find; extend src/build/tsEngineSources.ts`);
}

export function tsEngineSourceHash(engineDir: string, srcDir = resolve(engineDir, "..")): string {
  const files = new Set<string>();
  const queue: string[] = [];
  const add = (p: string) => {
    if (files.has(p)) return;
    files.add(p);
    queue.push(p);
  };
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (lstatSync(p).isDirectory()) walk(p);
      else if (isSource(name)) add(p);
    }
  };
  walk(engineDir);
  while (queue.length > 0) {
    const p = queue.pop()!;
    if (!p.endsWith(".ts")) continue;
    for (const m of readFileSync(p, "utf8").matchAll(RELATIVE_IMPORT)) add(resolveImport(p, m[1]!));
  }
  const hash = createHash("sha256");
  for (const p of [...files].sort()) {
    hash.update(relative(srcDir, p).split("\\").join("/"));
    hash.update("\0");
    hash.update(readFileSync(p));
    hash.update("\0");
  }
  return hash.digest("hex");
}
