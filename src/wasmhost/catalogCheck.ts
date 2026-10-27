import { catalogFor } from "../engine/catalog";
import type { Catalog, CatalogWorld } from "../engine/catalogTypes";

/** Refuses a binding catalog that states another world, or lists other
 *  facility kinds, than this build's tables for the same mode: the view was
 *  sized from that world and the UI has a color and a description only for
 *  those kinds. The error names the field or the kinds that differ. Shared
 *  with the worker host, so both hosts refuse the same bindings. */
export function refuseForeignCatalog(c: Catalog): void {
  const own = catalogFor(c.mode);
  for (const field of Object.keys(own.world) as (keyof CatalogWorld)[]) {
    if (c.world[field] !== own.world[field]) {
      throw new Error(`the Rust engine's ${c.mode} catalog states a different world from this build's tables (${field})`);
    }
  }
  // `readCatalog` already refuses a kind listed twice.
  const keys = c.facilities.map((f) => f.key);
  const kinds = new Set(own.facilities.map((f) => f.key));
  const listed = new Set(keys);
  const extra = keys.filter((k) => !kinds.has(k));
  const missing = [...kinds].filter((k) => !listed.has(k));
  if (extra.length > 0 || missing.length > 0) {
    const parts = [extra.length > 0 ? `unknown ${extra.join(", ")}` : "", missing.length > 0 ? `missing ${missing.join(", ")}` : ""];
    throw new Error(`the Rust engine's ${c.mode} catalog lists other facility kinds than this build draws (${parts.filter(Boolean).join("; ")})`);
  }
}
