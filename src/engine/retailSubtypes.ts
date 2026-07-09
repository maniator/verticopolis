import type { FacilityKind } from "./types";

/**
 * Canon named variants for the three retail kinds, ordered per
 * `docs/canon/tdt-format.md` §7 (Commercial retail table). Order is
 * load-bearing: the TDT format writes an ORDINAL byte, not a string, so
 * SHOP_SUBTYPES[3] must be the same tile the 1994 game reads at index 3.
 * `src/tests/canon.test.ts` pins length and order against the canon doc.
 */
export const RESTAURANT_SUBTYPES = [
  "English Pub",
  "French",
  "Chinese",
  "Sushi Bar",
  "Steak House",
] as const;

export const FASTFOOD_SUBTYPES = [
  "Japanese Soba",
  "Chinese Cafe",
  "Hamburger Stand",
  "Ice Cream",
  "Coffee Shop",
] as const;

export const SHOP_SUBTYPES = [
  "Men's Clothing",
  "Pet Store",
  "Flower Shop",
  "Book Store",
  "Drug Store",
  "Boutique",
  "Electronics",
  "Bank",
  "Hair Salon",
  "Post Office",
  "Sports Gear",
] as const;

/**
 * The canon name list for `kind`, or null when the kind carries no canon
 * subtype (every kind that isn't shop / fastFood / restaurant). Callers use
 * the null return as the pre-RNG-draw short-circuit: a Classic tower whose
 * diet skips retail must NOT touch `sim.rng`, or its seeded rent/event stream
 * would drift. Mirrors the `rollCondoRelocations` short-circuit at
 * `Simulation.ts:1460` where `chance <= 0` returns before the roll.
 */
export function subtypeListFor(kind: FacilityKind): readonly string[] | null {
  switch (kind) {
    case "restaurant":
      return RESTAURANT_SUBTYPES;
    case "fastFood":
      return FASTFOOD_SUBTYPES;
    case "shop":
      return SHOP_SUBTYPES;
    default:
      return null;
  }
}

/**
 * The ordinal position of `name` in `kind`'s canon list, or -1 if it isn't a
 * canon variant for that kind. Used by the TDT exporter to write the variant
 * byte and by the reroll action's "guaranteed different from current" guard.
 */
export function subtypeIndex(kind: FacilityKind, name: string | undefined): number {
  if (name === undefined) return -1;
  const list = subtypeListFor(kind);
  if (list === null) return -1;
  const i = list.indexOf(name);
  return i;
}

/**
 * Whitelist coerce: return the canonical name only when `raw` is a real entry
 * in `kind`'s list, else undefined. The one gate every untrusted string
 * passes through (persisted saves, TDT imports, hand-edited JSON), so a
 * scrambled input can never inject an unknown value into the render layer.
 * Mirrors `filmPolicy` at `Simulation.ts:2297-2300`.
 */
export function canonicalSubtype(kind: FacilityKind, raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const list = subtypeListFor(kind);
  if (list === null) return undefined;
  return (list as readonly string[]).includes(raw) ? raw : undefined;
}
