/**
 * How each kind looks on the overview MAP window (#343): a fill and a pattern
 * per kind, for Classic and for Modern. Presentation only: no rule lives here,
 * so it sits with the renderer, like `FACILITY_PRESENTATION`.
 *
 * Kinds are grouped by what they are to the player (work, homes, hotels, food
 * and retail, entertainment, amenities, services, shafts). The room groups each
 * get their own pattern, the three elevator kinds get one each, and the plain
 * solid groups (floor, lobby, offices) differ in lightness by a wide margin, so
 * the tower reads without color vision. A kind with no group is a compile error
 * (`KIND_GROUP` is an exhaustive record). A kind the table has never heard of
 * at run time (a forged save, a newer engine) paints as a loud placeholder.
 *
 * Patterns are an accessibility addition to the original's plain look, shown
 * in both themes. The Classic column here is provisional: it follows the
 * manual and the wiki (a gray tower with the elevators picked out by kind:
 * express blue, standard gray, service red). The retail capture (SPEC,
 * "Retail capture findings") shows a flat gray silhouette with no rooms and
 * 1 px shaft lines, and slice S2b applies that to Classic. Modern borrows the
 * facility colors the sprites and palette already use.
 */
import type { FacilityKind } from "../../engine/types";
import { FACILITY_PRESENTATION } from "../../presentation/facilityPresentation";

export type MapTheme = "classic" | "modern";

/** The marks a pattern tile is built from. `solid` is a plain fill. */
export type MapPattern = "solid" | "dots" | "diagonal" | "horizontal" | "grid" | "checker" | "outline";

/** What a kind is to the player, for patterns and for Classic's grays. */
export type MapGroup =
  | "ground"
  | "lobby"
  | "work"
  | "homes"
  | "hotels"
  | "foodAndRetail"
  | "entertainment"
  | "amenities"
  | "services"
  | "stairs"
  | "elevatorStandard"
  | "elevatorService"
  | "elevatorExpress";

export const KIND_GROUP: Readonly<Record<FacilityKind, MapGroup>> = {
  floor: "ground",
  lobby: "lobby",
  office: "work",
  condo: "homes",
  rentalStudio: "homes",
  rentalApartment: "homes",
  hotelSingle: "hotels",
  hotelDouble: "hotels",
  hotelSuite: "hotels",
  fastFood: "foodAndRetail",
  restaurant: "foodAndRetail",
  foodHall: "foodAndRetail",
  shop: "foodAndRetail",
  boutiqueBay: "foodAndRetail",
  skyBar: "foodAndRetail",
  cinema: "entertainment",
  partyHall: "entertainment",
  amusements: "entertainment",
  nightclub: "entertainment",
  aquaticCenter: "entertainment",
  weddingHall: "entertainment",
  fitnessClub: "amenities",
  clinic: "amenities",
  spa: "amenities",
  daycare: "amenities",
  parking: "services",
  parkingRamp: "services",
  security: "services",
  medical: "services",
  housekeeping: "services",
  recycling: "services",
  metro: "services",
  stairs: "stairs",
  escalator: "stairs",
  elevatorStandard: "elevatorStandard",
  elevatorService: "elevatorService",
  elevatorExpress: "elevatorExpress",
};

export const GROUP_PATTERN: Readonly<Record<MapGroup, MapPattern>> = {
  ground: "solid",
  lobby: "solid",
  work: "solid",
  homes: "dots",
  hotels: "diagonal",
  foodAndRetail: "horizontal",
  entertainment: "grid",
  amenities: "checker",
  services: "outline",
  stairs: "diagonal",
  elevatorStandard: "solid",
  elevatorService: "dots",
  elevatorExpress: "grid",
};

/** Classic's fills: the tower in grays, the shafts by kind. */
export const CLASSIC_FILL: Readonly<Record<MapGroup, string>> = {
  ground: "#6e6e6e",
  lobby: "#d4d4d4",
  work: "#bcbcbc",
  homes: "#a6a6a6",
  hotels: "#b2b2b2",
  foodAndRetail: "#c6c6c6",
  entertainment: "#9c9c9c",
  amenities: "#b8b8b8",
  services: "#a0a0a0",
  stairs: "#505050",
  elevatorStandard: "#8a8a8a",
  elevatorService: "#d23c3c",
  elevatorExpress: "#2f6fdb",
};

/** Relative luminance of a `#rrggbb` color (0 to 1), or null for any other
 *  string. */
export function hexLuminance(color: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two relative luminances, 1 to 21. */
export function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const INK_DARK = "#1c1c1c";
const INK_LIGHT = "#f2f2f2";

/** The color of a pattern's marks on a fill: dark on a light fill and light on
 *  a dark one, so the pattern shows whatever the fill. A fill that is not a
 *  `#rrggbb` color gets dark ink. */
export function patternInk(fill: string): string {
  const lum = hexLuminance(fill);
  if (lum === null) return INK_DARK;
  const dark = hexLuminance(INK_DARK)!;
  const light = hexLuminance(INK_LIGHT)!;
  return contrastRatio(lum, light) > contrastRatio(lum, dark) ? INK_LIGHT : INK_DARK;
}

/** Modern's shaft fills, kept clear of the room colors. */
const MODERN_SHAFT_FILL: Readonly<Partial<Record<MapGroup, string>>> = {
  stairs: "#59606c",
  elevatorStandard: "#9aa3b2",
  elevatorService: "#e0544e",
  elevatorExpress: "#4a8cf0",
};

export interface MapKindStyle {
  readonly fill: string;
  readonly pattern: MapPattern;
}

/** What a kind the table does not know paints as. */
export const UNKNOWN_KIND_STYLE: MapKindStyle = { fill: "#ff00ff", pattern: "outline" };

/** The fill and pattern for a kind in a theme. An unknown kind or theme at run
 *  time reads as the placeholder and as Modern, never throws. */
export function mapStyleFor(kind: FacilityKind, theme: MapTheme): MapKindStyle {
  if (!Object.prototype.hasOwnProperty.call(KIND_GROUP, kind)) return UNKNOWN_KIND_STYLE;
  const group = KIND_GROUP[kind];
  const pattern = GROUP_PATTERN[group];
  if (theme === "classic") return { fill: CLASSIC_FILL[group], pattern };
  const shaft = MODERN_SHAFT_FILL[group];
  return { fill: shaft ?? FACILITY_PRESENTATION[kind].color, pattern };
}
