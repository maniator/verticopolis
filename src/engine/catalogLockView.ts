import type { Catalog } from "./catalogTypes";
import type { FacilityKind } from "./types";

/**
 * The kinds whose footprint (`width` and `floors`) the shared catalog lock does
 * not pin. Only the Rust engine builds the wedding hall as the 28 wide, five
 * story cathedral; this engine keeps its one story hall, so the lock holds both
 * engines to every other number in the entry and leaves the footprint out.
 * `LOCK_FOOTPRINT_EXEMPT` in `engine-rs/src/catalog.rs` is the same list.
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
