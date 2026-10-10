import { CATALOG_VERSION, type Catalog } from "../engine/catalogTypes";
import type { GameMode } from "../engine/types";
import type { WasmModule } from "./binding";

/**
 * The catalog through the WASM binding: `catalog(mode)` on the module returns
 * canonical JSON in the shape of {@link Catalog} (declared in
 * `src/engine/catalogTypes.ts`, which carries no engine tables), so a
 * frontend reads every price, size and build rule from the engine instead of
 * from the TypeScript tables. `conformance/catalog-digests.json` holds the
 * two engines to the same text.
 */
export { CATALOG_VERSION } from "../engine/catalogTypes";
export type {
  Catalog,
  CatalogCalendar,
  CatalogEconomy,
  CatalogFacility,
  CatalogPool,
  CatalogRent,
  CatalogWorld,
  CatalogRentCadence,
} from "../engine/catalogTypes";

/** The catalog for `mode`, parsed. Refuses, by name, a binding without the
 *  export, a refusal or unparsable reply, a reply missing a top-level section,
 *  and a shape version other than the one asked for (by default the version
 *  this build was written against). Fields inside each section are trusted to
 *  the lock, which holds both engines to one shape. */
export function readCatalog(mod: Pick<WasmModule, "catalog">, mode: GameMode, version: number = CATALOG_VERSION): Catalog {
  if (typeof mod.catalog !== "function") throw new Error("the WASM binding exports no catalog; rebuild it");
  let c: unknown;
  try {
    c = JSON.parse(mod.catalog(mode));
  } catch (e) {
    throw new Error(`the engine returned no ${mode} catalog: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (c === null || typeof c !== "object" || Array.isArray(c)) throw new Error("the engine returned no catalog");
  const r = c as Record<string, unknown>;
  if (r.version !== version) throw new Error(`the engine's catalog is version ${String(r.version)}; expected version ${version}`);
  if (r.mode !== mode) throw new Error(`asked for the ${mode} catalog, got ${String(r.mode)}`);
  const isObject = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!isObject(r.world) || !isObject(r.economy) || !Array.isArray(r.pools) || !Array.isArray(r.facilities)) {
    throw new Error("the engine returned a catalog without its world, economy, pools or facilities");
  }
  return c as Catalog;
}
