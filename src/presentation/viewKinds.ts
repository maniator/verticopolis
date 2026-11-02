import { catalogOpenAt, type Catalog, type CatalogFacility } from "../engine/catalogTypes";
import type { FacilityKind } from "../engine/types";

/**
 * What the view knows about each kind, read from the engine's catalog: which
 * kinds are commercial, hotel rooms, lease amenities, demand tenants or
 * elevators, and which keep business hours and when they are open. The view
 * asks these here instead of keeping kind lists of its own, so a kind the
 * engine adds lands on the right side of every check with no frontend edit.
 *
 * The facts are the same in both modes, so a catalog of either one binds them.
 * Like the view's world, they must be bound before anything draws: all lookups
 * throw if no catalog is bound. Once bound, findViewKind returns null for an
 * unknown kind so legacy/unknown-kind rendering can fall back; strict helpers
 * throw for unknown kinds rather than silently inventing simulation rules.
 */

let bound: ReadonlyMap<FacilityKind, CatalogFacility> | null = null;

/** Binds the view's kind facts to a catalog. A later bind replaces them: both
 *  modes' catalogs state the same facts, and a damaged catalog is refused where
 *  it is read. */
export function bindViewKinds(catalog: Catalog): void {
  bound = new Map(catalog.facilities.map((f) => [f.key, f]));
}

function entry(kind: FacilityKind): CatalogFacility {
  if (!bound) throw new Error("the view's kind facts are not bound yet: bind them from the tower's catalog before drawing");
  const f = bound.get(kind);
  if (!f) throw new Error(`the catalog lists no ${kind}`);
  return f;
}

/** The catalog facts for `kind`, or null when the bound catalog lists none.
 *  Throws before the first bind. */
export function findViewKind(kind: FacilityKind): CatalogFacility | null {
  if (!bound) throw new Error("the view's kind facts are not bound yet: bind them from the tower's catalog before drawing");
  return bound.get(kind) ?? null;
}

/** The kind keys in the bound catalog, in catalog order. */
export function viewKindKeys(): FacilityKind[] {
  if (!bound) throw new Error("the view's kind facts are not bound yet: bind them from the tower's catalog before drawing");
  return [...bound.keys()];
}

/** A foot-traffic trading kind (fast food, restaurant, shop, cinema and the
 *  Modern venues that draw shoppers). */
export function isCommercialKind(kind: FacilityKind): boolean {
  return entry(kind).commercial;
}

/** A hotel room of any size. */
export function isHotelKind(kind: FacilityKind): boolean {
  return entry(kind).hotel;
}

/** A Modern lease amenity (fitness club, clinic). */
export function isLeaseAmenityKind(kind: FacilityKind): boolean {
  return entry(kind).leaseAmenity;
}

/** A demand tenant whose unmet local coverage drains satisfaction. */
export function isUnmetDemandKind(kind: FacilityKind): boolean {
  return entry(kind).unmetDemand;
}

/** An elevator of any kind: the only transports with cars. */
export function isElevatorKind(kind: FacilityKind): boolean {
  return entry(kind).maxCars !== null;
}

/** Whether the kind keeps posted business hours (it can be closed). */
export function hasBusinessHours(kind: FacilityKind): boolean {
  return entry(kind).openHours !== null;
}

/** Whether the kind is open in `hour`, read as the engines read it (a fraction
 *  or 24 wraps onto its hour); a kind with no posted hours is always open. */
export function isOpenAt(kind: FacilityKind, hour: number): boolean {
  return catalogOpenAt(entry(kind), hour);
}

/** Test hook: forget the bound facts. */
export function resetViewKindsForTests(): void {
  bound = null;
}
