/**
 * Canon look tables for the food kinds, split out of `food.ts` so the interior
 * draw code has room to grow under the 500-line ceiling without touching this
 * data. Re-exported through `food.ts` and the `pixelSprites.ts` barrel, so
 * `subtypeVisuals` and every importer keep resolving these from there. Values
 * are byte-identical to their former home in `food.ts`; an undefined or unknown
 * subtype still falls back to the pre-variant `_DEFAULT` look.
 */

export interface FastFoodLook {
  band: string;
  stripe: string;
  wall: string;
  /** Interior composition: each variety furnishes the room differently; the
   *  sign band above is the one shape every fast food keeps. */
  interior: "classic" | "counterBar" | "teahouse" | "parlor" | "cafe";
}
export const FASTFOOD_DEFAULT: FastFoodLook = { band: "#E0452C", stripe: "#FFD24A", wall: "#F0D8B0", interior: "classic" };
export const FASTFOOD_LOOKS: Record<string, FastFoodLook> = {
  "Japanese Soba": { band: "#3A4E8C", stripe: "#F4F0E4", wall: "#EAE2CC", interior: "counterBar" },
  "Chinese Cafe": { band: "#8E2424", stripe: "#E8C14A", wall: "#F0DCB8", interior: "teahouse" },
  "Hamburger Stand": FASTFOOD_DEFAULT,
  "Ice Cream": { band: "#E88AB0", stripe: "#FFFFFF", wall: "#F6ECF0", interior: "parlor" },
  "Coffee Shop": { band: "#6E4A32", stripe: "#E8DCC8", wall: "#EFE4D2", interior: "cafe" },
};

export interface RestaurantLook {
  wall: string;
  floor: string;
  fixture: "chandelier" | "lamps" | "lanterns" | "none" | "ember";
  /** Dining-floor composition: cloth tables, a pub bar, banquet rounds, a
   *  sushi bar, or steak-house booths. */
  interior: "cloth" | "pub" | "banquet" | "sushi" | "booths";
}
export const RESTAURANT_DEFAULT: RestaurantLook = { wall: "#3A2230", floor: "#2B2238", fixture: "chandelier", interior: "cloth" };
export const RESTAURANT_LOOKS: Record<string, RestaurantLook> = {
  "English Pub": { wall: "#4A3626", floor: "#33251A", fixture: "lamps", interior: "pub" },
  "French": RESTAURANT_DEFAULT,
  "Chinese": { wall: "#5A2020", floor: "#3A1818", fixture: "lanterns", interior: "banquet" },
  "Sushi Bar": { wall: "#C8AA78", floor: "#8A6E48", fixture: "none", interior: "sushi" },
  "Steak House": { wall: "#4A2A22", floor: "#33201A", fixture: "ember", interior: "booths" },
};
