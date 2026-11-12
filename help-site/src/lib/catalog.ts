// The engine's catalog, read at build time so every price, size and limit the
// help pages print is the one the game runs on. The engine package is build
// output (scripts/build-engine-wasm.sh writes src/public/engine/), so the game
// and this site read the same WASM file.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Catalog, CatalogFacility } from "../../../src/catalog/catalogTypes";
import { readCatalog } from "../../../src/dualrun/catalog";
import type { FacilityKind, GameMode } from "../../../src/shared/types";

/** The game's checkout: `npm run build --prefix help-site` runs from help-site/. */
const repo = resolve(process.cwd(), process.cwd().endsWith("help-site") ? ".." : ".");
const engineDir = resolve(repo, "src/public/engine");

interface EngineModule {
  initSync(input: { module: Uint8Array }): unknown;
  catalog(mode: string): string;
}

let both: Promise<Record<GameMode, Catalog>> | null = null;

/** Both modes' catalogs, read once per build. A missing engine package fails
 *  the build with the command that makes it, since the pages have no second
 *  source for their numbers. */
export function catalogs(): Promise<Record<GameMode, Catalog>> {
  both ??= (async () => {
    let wasm: Uint8Array;
    try {
      wasm = readFileSync(resolve(engineDir, "verticopolis_engine_bg.wasm"));
    } catch {
      throw new Error("the help site needs the engine package for its room facts: run `npm run wasm:build` in the game's checkout first");
    }
    const mod = (await import(/* @vite-ignore */ pathToFileURL(resolve(engineDir, "verticopolis_engine.js")).href)) as EngineModule;
    mod.initSync({ module: wasm });
    return { classic: readCatalog(mod, "classic"), modern: readCatalog(mod, "modern") };
  })();
  return both;
}

/** One kind's entry in each mode's catalog. */
export async function facility(kind: FacilityKind): Promise<{ classic: CatalogFacility; modern: CatalogFacility }> {
  const c = await catalogs();
  const find = (cat: Catalog): CatalogFacility => {
    const f = cat.facilities.find((e) => e.key === kind);
    if (!f) throw new Error(`the ${cat.mode} catalog lists no ${kind}`);
    return f;
  };
  return { classic: find(c.classic), modern: find(c.modern) };
}

/** A dollar amount the way the game writes it. */
export function dollars(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
