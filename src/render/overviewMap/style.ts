/**
 * How each kind looks on the overview MAP window (#343): a fill and a pattern
 * per kind, for Classic (one gray plus shaft lines) and for Modern (per-group
 * patterns and facility colors). Presentation only: no rule lives here,
 * so it sits with the renderer, like `FACILITY_PRESENTATION`.
 *
 * Kinds are grouped by what they are to the player (work, homes, hotels, food
 * and retail, entertainment, amenities, services, shafts). In Modern the room
 * groups each get their own pattern, the three elevator kinds get one each, and
 * the plain solid groups (floor, lobby, offices) differ in lightness by a wide
 * margin, so the tower reads without color vision. A kind with no group is a
 * compile error (`KIND_GROUP` is an exhaustive record). A kind the table has never heard of
 * at run time (a forged save, a newer engine) paints as a loud placeholder.
 *
 * Classic follows what the retail game's Edit tab draws, measured on the PC
 * harness (SPEC, "Retail capture findings"): one flat light-gray silhouette for
 * every structure run and room, with the shafts picked out as lines (black
 * standard elevators, red service, blue express; stairs and escalators are not
 * drawn). It carries no pattern, since the original does not tell kinds apart
 * there. Modern keeps the per-kind groups: the room
 * groups get a pattern each as an accessibility addition, and the fills are the
 * facility colors the sprites and palette already use.
 */
import type { FacilityKind } from "../../engine/types";
import { FACILITY_PRESENTATION } from "../../presentation/facilityPresentation";

export type MapTheme = "classic" | "modern";

/** The marks a pattern tile is built from. `solid` is a plain fill. */
export type MapPattern = "solid" | "dots" | "diagonal" | "horizontal" | "grid" | "checker" | "outline";

/** What a kind is to the player, for Modern's patterns and for picking the shafts out. */
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

/** Classic's tower: one flat light gray for every structure run and room (the
 *  elevators are colored lines, and stairs and escalators are not drawn). */
export const CLASSIC_TOWER_FILL = "#cccccc";

/** Classic's elevator lines, confirmed against the retail saves: each shaft's
 *  tile position lands on a line of its kind's color (black standard, red
 *  service, blue express). Stairs and escalators are not drawn on the original
 *  map: `drawsOnMap` leaves them out of a Classic paint. */
export const CLASSIC_SHAFT_FILL: Readonly<Partial<Record<MapGroup, string>>> = {
  elevatorStandard: "#000000",
  elevatorService: "#c41a1a",
  elevatorExpress: "#2f4fd0",
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
 *  time reads as the placeholder and as Modern, never throws. It answers for
 *  every kind, including the ones a theme leaves off the map: ask `drawsOnMap`
 *  first (a legend or a view that paints marks must, or Classic stairs would
 *  show as gray marks in the sky). */
export function mapStyleFor(kind: FacilityKind, theme: MapTheme): MapKindStyle {
  if (!Object.prototype.hasOwnProperty.call(KIND_GROUP, kind)) return UNKNOWN_KIND_STYLE;
  const group = KIND_GROUP[kind];
  if (theme === "classic") return { fill: CLASSIC_SHAFT_FILL[group] ?? CLASSIC_TOWER_FILL, pattern: "solid" };
  const shaft = MODERN_SHAFT_FILL[group];
  return { fill: shaft ?? FACILITY_PRESENTATION[kind].color, pattern: GROUP_PATTERN[group] };
}

/** Groups the original map does not draw at all: Classic skips them, so a stair
 *  that overhangs a floor's end leaves no mark in the sky and none over a room. */
const CLASSIC_UNDRAWN_GROUPS: ReadonlySet<MapGroup> = new Set<MapGroup>(["stairs"]);

/** Whether a kind is painted in a theme. Modern draws everything; Classic leaves
 *  stairs and escalators out, as the retail map does. A kind the table does not
 *  know is drawn, as the placeholder. */
export function drawsOnMap(kind: FacilityKind, theme: MapTheme): boolean {
  if (theme !== "classic") return true;
  if (!Object.prototype.hasOwnProperty.call(KIND_GROUP, kind)) return true;
  return !CLASSIC_UNDRAWN_GROUPS.has(KIND_GROUP[kind]);
}
