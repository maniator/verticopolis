import type { Catalog } from "@verticopolis/engine/catalog/catalogTypes";
import type { FacilityKind } from "@verticopolis/engine/model/types";

/**
 * The kinds whose footprint (`width` and `floors`) the catalog lock does not
 * pin. The exemption dates from when the lock also pinned the TypeScript
 * engine, which keeps a one story wedding hall where the Rust engine builds the
 * 28 wide, five story cathedral. The lock is now written from the Rust catalog
 * alone, and the engine's `conformanceWasm` glue suite pins the hall's footprint
 * directly. `LOCK_FOOTPRINT_EXEMPT` in `src/catalog.rs` is the same
 * list, and dropping it moves the lock (an engine crate change).
 */
export const LOCK_FOOTPRINT_EXEMPT: readonly FacilityKind[] = ["weddingHall"];

/** `catalog` with the footprint of each exempt kind set to `null`: the value
 *  `conformance/catalog-digests.json` hashes (Rust: `lock_view`). */
export function catalogLockView(catalog: Catalog): unknown {
  return {
    ...catalog,
    facilities: catalog.facilities.map((entry) =>
      LOCK_FOOTPRINT_EXEMPT.includes(entry.key) ? { ...entry, width: null, floors: null } : entry,
    ),
  };
}
