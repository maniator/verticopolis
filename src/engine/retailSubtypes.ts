import type { FacilityKind } from "./types";

/**
 * Canon named variants for the three retail kinds, ordered per
 * `docs/canon/tdt-format.md` §7 (Commercial retail table). Order is
 * load-bearing: the TDT format writes an ORDINAL byte, not a string, so
 * SHOP_SUBTYPES[3] must be the same name the 1994 game reads at index 3.
 * `src/tests/integration/canon.integration.test.ts` pins length and order against the canon doc.
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
 * The stalls a Modern Food Hall can present. Unlike the three canon lists above,
 * these are NOT canon and carry NO ordinal: Food Hall is Modern-only content, a
 * Modern tower is never exported to the 1994 `.TDT` format, and the native save
 * persists the stall by NAME (a string, see `serializeUnit`), not by index. So
 * order carries no meaning at all: reordering or inserting is safe, and a saved
 * name reloads to the same stall regardless of position.
 */
export const FOODHALL_SUBTYPES = [
  "Ramen Bar",
  "Taco Stand",
  "Bubble Tea",
  "Poke Bowl",
  "Deli Counter",
  "Coffee Cart",
] as const;

/**
 * The attractions a Modern Amusements hall can present. Like the Food Hall
 * roster above, these are Modern-only and carry NO ordinal: a Modern tower is
 * never exported to the 1994 `.TDT` format, and the native save persists the
 * attraction by NAME, not by index, so order carries no meaning.
 */
export const AMUSEMENTS_SUBTYPES = [
  "Classic Arcade",
  "VR Lounge",
  "Claw Parlor",
  "Mini Golf",
] as const;

/**
 * The trades a Modern Boutique Bay can present. Like the other Modern container
 * rosters, these are Modern-only and carry NO ordinal: a Modern tower is never
 * exported to the 1994 `.TDT` format, and the native save persists the trade by
 * NAME, not by index, so order carries no meaning.
 */
export const BOUTIQUE_SUBTYPES = [
  "Florist",
  "Barber",
  "Phone Repair",
  "Vintage",
  "Tattoo",
  "Record Store",
  "Gallery",
] as const;

/**
 * The formats a Modern Fitness Club can present. Like the other Modern container
 * rosters, these are Modern-only and carry NO ordinal: a Modern tower is never
 * exported to the 1994 `.TDT` format, and the native save persists the format by
 * NAME, not by index, so order carries no meaning.
 */
export const FITNESS_SUBTYPES = [
  "Weight Floor",
  "Yoga Studio",
  "Spin Studio",
  "Boxing Gym",
  "Climbing Wall",
] as const;

/**
 * The practices a Modern Clinic can present. Like the other Modern container
 * rosters, these are Modern-only and carry NO ordinal: a Modern tower is never
 * exported to the 1994 `.TDT` format, and the native save persists the practice
 * by NAME, not by index, so order carries no meaning.
 */
export const CLINIC_SUBTYPES = [
  "Dental",
  "Urgent Care",
  "Optometry",
  "Pharmacy",
  "Physio",
] as const;

/**
 * The subtype (stall/variant) name list for `kind`, or null when the kind
 * carries none. The canon retail kinds (shop / fastFood / restaurant) return
 * their 1994 lists; the Modern-only Food Hall returns its (non-canon) stall
 * roster. Callers use the null return as the pre-RNG-draw short-circuit: a
 * Classic tower whose diet skips retail must NOT touch `sim.rng`, or its seeded
 * rent/event stream would drift. Mirrors the `Simulation.rollCondoRelocations`
 * short-circuit where `chance <= 0` returns before the roll.
 */
export function subtypeListFor(kind: FacilityKind): readonly string[] | null {
  switch (kind) {
    case "restaurant":
      return RESTAURANT_SUBTYPES;
    case "fastFood":
      return FASTFOOD_SUBTYPES;
    case "shop":
      return SHOP_SUBTYPES;
    case "foodHall":
      return FOODHALL_SUBTYPES;
    case "amusements":
      return AMUSEMENTS_SUBTYPES;
    case "boutiqueBay":
      return BOUTIQUE_SUBTYPES;
    case "fitnessClub":
      return FITNESS_SUBTYPES;
    case "clinic":
      return CLINIC_SUBTYPES;
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
