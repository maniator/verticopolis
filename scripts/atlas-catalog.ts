/**
 * The Modern catalog the atlas bake draws from, read from the engine package
 * the web build ships (`src/public/engine/`, built by `npm run wasm:build`, or
 * the built app's copy in `dist/engine/`, which the end-to-end job unpacks):
 * the Rust engine's catalog, the only one the game reads. The bake binds the
 * view to it in Node (`ArchiveInfo.catalog`) and in the page (`__vcAtlas.bind`), so
 * every size and kind fact in the atlas is the one the game draws with.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readCatalog, type Catalog } from "../src/dualrun/catalog";
import type { WasmModule } from "../src/dualrun/binding";

export async function atlasCatalog(root: string): Promise<Catalog> {
  const dir = ["src/public/engine", "dist/engine"]
    .map((d) => resolve(root, d))
    .find((d) => existsSync(resolve(d, "verticopolis_engine.js")) && existsSync(resolve(d, "verticopolis_engine_bg.wasm")));
  if (!dir) {
    throw new Error("the atlas reads its catalog from the engine package, and neither src/public/engine/ nor dist/engine/ has one; run npm run wasm:build");
  }
  const glue = resolve(dir, "verticopolis_engine.js");
  const bytes = resolve(dir, "verticopolis_engine_bg.wasm");
  const mod = (await import(/* @vite-ignore */ pathToFileURL(glue).href)) as Pick<WasmModule, "catalog"> & {
    initSync(arg: { module: BufferSource }): unknown;
  };
  mod.initSync({ module: readFileSync(bytes) });
  return readCatalog(mod, "modern");
}
