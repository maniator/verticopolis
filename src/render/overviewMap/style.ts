/**
 * How each kind looks on the overview MAP window (#343): a fill and a pattern
 * per kind. Presentation only: no rule lives here, so it sits with the
 * renderer, like `FACILITY_PRESENTATION`. The map has one look in both game
 * modes (owner, 2026-11-04).
 *
 * Kinds are grouped by what they are to the player (work, homes, hotels, food
 * and retail, entertainment, amenities, services, shafts). The room groups
 * each get their own pattern as an accessibility addition, the three elevator
 * kinds get one each, and the plain solid groups (floor, lobby, offices) differ
 * in lightness by a wide margin, so the tower reads without color vision. The
 * room fills are the facility colors the sprites and palette already use,
 * except where one is too dark for the map's backdrop (`MAP_ROOM_FILL`). A
 * kind with no group is a compile error (`KIND_GROUP` is an exhaustive record).
 * A kind the table has never heard of at run time (a forged save, a newer
 * engine) paints as a loud placeholder.
 */
import type { FacilityKind } from "../../engine/types";
import { FACILITY_PRESENTATION } from "../../presentation/facilityPresentation";

/** The marks a pattern tile is built from. `solid` is a plain fill. */
export type MapPattern = "solid" | "dots" | "diagonal" | "horizontal" | "grid" | "checker" | "outline";

/** What a kind is to the player, for the patterns and for picking the shafts out. */
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

/** The shaft fills, kept clear of every room color (style.test.ts measures
 *  each pair) and at least 3:1 against the backdrop's sky and ground, since a
 *  shaft can run past the top floor or over the lot's edge onto them. */
export const SHAFT_FILL: Readonly<Partial<Record<MapGroup, string>>> = {
  stairs: "#6c7484",
  elevatorStandard: "#9aa3b2",
  elevatorService: "#f05458",
  elevatorExpress: "#4a8cf0",
};

/** The map's own fill for a room whose facility color falls under 3:1 against
 *  the backdrop (#1803). Each stays close to its facility color, so the room
 *  reads as the same thing it is in the main view. The main view keeps the
 *  facility colors: its backdrop is not the map's. */
const MAP_ROOM_FILL: Readonly<Partial<Record<FacilityKind, string>>> = {
  parkingRamp: "#7c706c",
  security: "#5474a4",
};

export interface MapKindStyle {
  readonly fill: string;
  readonly pattern: MapPattern;
}

/** What a kind the table does not know paints as. */
export const UNKNOWN_KIND_STYLE: MapKindStyle = { fill: "#ff00ff", pattern: "outline" };

/** The fill and pattern for a kind. An unknown kind at run time reads as the
 *  placeholder, never throws. */
export function mapStyleFor(kind: FacilityKind): MapKindStyle {
  if (!Object.prototype.hasOwnProperty.call(KIND_GROUP, kind)) return UNKNOWN_KIND_STYLE;
  const group = KIND_GROUP[kind];
  const shaft = SHAFT_FILL[group];
  return { fill: shaft ?? MAP_ROOM_FILL[kind] ?? FACILITY_PRESENTATION[kind].color, pattern: GROUP_PATTERN[group] };
}
