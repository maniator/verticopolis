import { catalogFacility, catalogOpenAt, type CatalogFacility } from "../catalog/catalogTypes";
import type { FacilityKind } from "../shared/types";
import { catalogFor } from "./catalogFixture";

/**
 * Per-kind facts for tests that draw or lay out rooms: a kind's size, the
 * people it holds, its varieties and its business hours, read from the Rust
 * engine's catalog fixture (`catalogFor`). The facts read here are the same in
 * both modes' catalogs, so the Classic one answers them.
 */

const CATALOG = catalogFor("classic");

/** `kind`'s catalog entry. */
export function kindFacts(kind: FacilityKind): CatalogFacility {
  return catalogFacility(CATALOG, kind);
}

/** Every facility kind, in the engine's catalog order. */
export function kindKeys(): FacilityKind[] {
  return CATALOG.facilities.map((f) => f.key);
}

/** The varieties a new unit of `kind` draws from, in the engine's order.
 *  Throws for a kind with none, so a test cannot loop over nothing. */
export function subtypesOf(kind: FacilityKind): readonly string[] {
  const list = kindFacts(kind).subtypes;
  if (!list) throw new Error(`the catalog lists no varieties for ${kind}`);
  return list;
}

/** Whether `kind` keeps posted business hours (it can be closed). */
export function keepsHours(kind: FacilityKind): boolean {
  return kindFacts(kind).openHours !== null;
}

/** Whether `kind` is open in `hour`; a kind with no posted hours always is. */
export function openAt(kind: FacilityKind, hour: number): boolean {
  return catalogOpenAt(kindFacts(kind), hour);
}
