/**
 * Canon look tables for the food kinds, split out of `food.ts` so the interior
 * draw code has room to grow under the 500-line ceiling without touching this
 * data. Re-exported through `food.ts` and the `pixelSprites.ts` barrel, so
 * `subtypeVisuals` and every importer keep resolving these from there. An
 * undefined or unknown subtype still falls back to the `_DEFAULT` look (the
 * Hamburger room for fast food, the French dining room for restaurants).
 *
 * The look table is a small color-and-discriminant record; the room itself
 * lives in the interior draw body (`food.interiors.ts`). Keys and their ORDER
 * are load-bearing (the TDT variant ordinal in `retailSubtypes.ts`); only the
 * VALUES here are enriched. Every entry stays pairwise-distinct, pinned by
 * `subtypeVisuals.integration.test.ts`.
 */

export interface FastFoodLook {
  band: string;
  stripe: string;
  wall: string;
  /** Dining-floor color and pattern, per subtype (checker for the burger and
   *  parlor rooms, plain seams elsewhere). `interior` is 1:1 with the subtype,
   *  so a `Record`-keyed table stays trivially pairwise-distinct. */
  floor: string;
  floorStyle: "checker" | "plain";
  /** Interior composition: each variety furnishes the room differently; the
   *  sign band above is the one shape every fast food keeps. */
  interior: "classic" | "counterBar" | "teahouse" | "parlor" | "cafe";
}
export const FASTFOOD_DEFAULT: FastFoodLook = {
  band: "#E0452C",
  stripe: "#FFD24A",
  wall: "#EAD8BE",
  floor: "#B85A3A",
  floorStyle: "checker",
  interior: "classic",
};
export const FASTFOOD_LOOKS: Record<string, FastFoodLook> = {
  "Japanese Soba": { band: "#3A4E8C", stripe: "#F4F0E4", wall: "#E6E0CC", floor: "#7A5A3A", floorStyle: "plain", interior: "counterBar" },
  "Chinese Cafe": { band: "#8E2424", stripe: "#E8C14A", wall: "#EEE2C8", floor: "#9A7A52", floorStyle: "plain", interior: "teahouse" },
  "Hamburger Stand": FASTFOOD_DEFAULT,
  "Ice Cream": { band: "#E88AB0", stripe: "#FFFFFF", wall: "#F0E0EA", floor: "#E8B7C8", floorStyle: "checker", interior: "parlor" },
  "Coffee Shop": { band: "#6E4A32", stripe: "#E8DCC8", wall: "#E8DCC6", floor: "#8A6A48", floorStyle: "plain", interior: "cafe" },
};

export interface RestaurantLook {
  wall: string;
  floor: string;
  /** The room's light fixture. Documentation of the interior's dressing; the
   *  interior draw body owns the actual fixture geometry (chandelier, pub
   *  lamps, paired lanterns, steak-house ember, or none for the bright sushi
   *  bar), so the field keeps every entry distinct without a second dispatch. */
  fixture: "chandelier" | "lamps" | "lanterns" | "none" | "ember";
  /** Dining-floor composition: cloth tables, a pub bar, banquet rounds, a
   *  sushi bar, or steak-house booths. */
  interior: "cloth" | "pub" | "banquet" | "sushi" | "booths";
}
export const RESTAURANT_DEFAULT: RestaurantLook = { wall: "#4A2A3A", floor: "#3A2440", fixture: "chandelier", interior: "cloth" };
export const RESTAURANT_LOOKS: Record<string, RestaurantLook> = {
  "English Pub": { wall: "#4A3626", floor: "#33251A", fixture: "lamps", interior: "pub" },
  "French": RESTAURANT_DEFAULT,
  "Chinese": { wall: "#5A2020", floor: "#3A1818", fixture: "lanterns", interior: "banquet" },
  "Sushi Bar": { wall: "#B89A6A", floor: "#8A6E48", fixture: "none", interior: "sushi" },
  "Steak House": { wall: "#4A2A22", floor: "#33201A", fixture: "ember", interior: "booths" },
};

// The Modern Food Hall reuses the restaurant renderer, so each stall gets its
// OWN look and they no longer render identically. `drawRestaurant` dispatches on
// `interior` (the fixture geometry is baked into each interior body, so the
// `fixture` field is documentation only, kept accurate to what the interior
// actually draws). The six stalls spread across the five interior styles (one
// reuse of `cloth`, split by a distinct wall palette). Reusing the restaurant
// interiors is deliberate for now; bespoke stall art is a future refinement.
export const FOODHALL_DEFAULT: RestaurantLook = { wall: "#5A4028", floor: "#3A2A1A", fixture: "lanterns", interior: "banquet" };
export const FOODHALL_LOOKS: Record<string, RestaurantLook> = {
  "Ramen Bar": { wall: "#5A2424", floor: "#3A1818", fixture: "lanterns", interior: "banquet" },
  "Taco Stand": { wall: "#7A5620", floor: "#4A3616", fixture: "ember", interior: "booths" },
  "Bubble Tea": { wall: "#6A3A5A", floor: "#43243A", fixture: "chandelier", interior: "cloth" },
  "Poke Bowl": { wall: "#245A54", floor: "#183A36", fixture: "none", interior: "sushi" },
  "Deli Counter": { wall: "#4A3A26", floor: "#332818", fixture: "lamps", interior: "pub" },
  "Coffee Cart": { wall: "#7A5030", floor: "#523620", fixture: "chandelier", interior: "cloth" },
};
