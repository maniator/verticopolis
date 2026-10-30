import type { Facility, FacilityKind } from "./types";
import { RENTAL_FACILITIES } from "./residentialRentals";

/**
 * Facility catalog. Costs and sizes are tuned to mirror the scale and balance
 * of the 1994 SimTower (Maxis/OpenBook). Widths are in grid tiles.
 *
 * In the original, a single office is the base unit of "width". We use a tile
 * grid where the smallest commercial unit is a few tiles wide.
 */
/** The buildable lot width in tiles, the canon 1994 map is 375 segments wide.
 *  Shared by {@link GRID}.width and the full-lot metro so the two can't drift. */
export const LOT_WIDTH = 375;

export const FACILITIES: Record<FacilityKind, Facility> = {
  lobby: {
    kind: "lobby",
    category: "structure",
    name: "Lobby",
    width: 1,
    cost: 5000,
    minStar: 1,
    population: 0,
  },
  floor: {
    kind: "floor",
    category: "structure",
    name: "Floor",
    width: 1,
    cost: 500,
    minStar: 1,
    population: 0,
  },
  office: {
    kind: "office",
    category: "office",
    name: "Office",
    width: 9,
    cost: 40000,
    minStar: 1,
    population: 6,
  },
  condo: {
    kind: "condo",
    category: "residential",
    name: "Condominium",
    width: 16,
    cost: 80000,
    minStar: 1,
    population: 3,
  },
  hotelSingle: {
    kind: "hotelSingle",
    category: "hotel",
    name: "Single Room",
    width: 4,
    cost: 20000,
    minStar: 2,
    population: 1,
  },
  hotelDouble: {
    kind: "hotelDouble",
    category: "hotel",
    name: "Double Room",
    width: 6,
    cost: 50000,
    minStar: 3,
    population: 2,
  },
  hotelSuite: {
    kind: "hotelSuite",
    category: "hotel",
    name: "Suite",
    width: 10,
    cost: 100000,
    minStar: 3,
    // The 1994 original counts 2 guests in a suite, the same as a double: the
    // finance block's suite line is 2 per checked-in room in all nine real saves.
    population: 2,
  },
  fastFood: {
    kind: "fastFood",
    category: "food",
    name: "Fast Food",
    width: 16,
    cost: 100000,
    minStar: 1,
    population: 25,
  },
  restaurant: {
    kind: "restaurant",
    category: "food",
    name: "Restaurant",
    width: 24,
    cost: 200000,
    minStar: 3,
    population: 35,
  },
  foodHall: {
    kind: "foodHall",
    category: "food",
    name: "Food Hall",
    width: 24,
    cost: 250000,
    minStar: 3,
    population: 40,
    modernOnly: true,
  },
  shop: {
    kind: "shop",
    category: "retail",
    name: "Retail Shop",
    width: 12,
    cost: 100000,
    minStar: 3,
    population: 20,
  },
  cinema: {
    kind: "cinema",
    category: "entertainment",
    name: "Cinema",
    width: 31,
    floors: 2,
    cost: 500000,
    minStar: 3,
    population: 0,
    attendance: 30,
  },
  partyHall: {
    kind: "partyHall",
    category: "entertainment",
    name: "Party Hall",
    width: 24,
    floors: 2,
    cost: 100000,
    minStar: 3,
    population: 0,
    attendance: 20,
  },
  amusements: {
    kind: "amusements",
    category: "entertainment",
    name: "Amusements",
    width: 12,
    cost: 180000,
    minStar: 3,
    population: 25,
    modernOnly: true,
  },
  boutiqueBay: {
    kind: "boutiqueBay",
    category: "retail",
    name: "Boutique Bay",
    width: 12,
    cost: 150000,
    minStar: 3,
    population: 22,
    modernOnly: true,
  },
  fitnessClub: {
    kind: "fitnessClub",
    category: "entertainment",
    name: "Fitness Club",
    width: 16,
    cost: 220000,
    minStar: 3,
    population: 20,
    modernOnly: true,
  },
  clinic: {
    kind: "clinic",
    category: "retail",
    name: "Clinic",
    width: 8,
    cost: 120000,
    minStar: 3,
    population: 12,
    modernOnly: true,
  },
  nightclub: {
    kind: "nightclub",
    category: "entertainment",
    name: "Nightclub",
    width: 20,
    cost: 350000,
    minStar: 3,
    population: 30,
    modernOnly: true,
  },
  spa: {
    kind: "spa",
    category: "entertainment",
    name: "Spa",
    width: 14,
    cost: 200000,
    minStar: 3,
    population: 18,
    modernOnly: true,
  },
  skyBar: {
    kind: "skyBar",
    category: "entertainment",
    name: "Sky Bar",
    width: 12,
    cost: 260000,
    minStar: 3,
    population: 22,
    modernOnly: true,
  },
  aquaticCenter: {
    kind: "aquaticCenter",
    category: "entertainment",
    name: "Aquatic Center",
    width: 28,
    floors: 2,
    cost: 450000,
    minStar: 3,
    population: 0,
    attendance: 24,
    modernOnly: true,
  },
  daycare: {
    kind: "daycare",
    category: "retail",
    name: "Daycare",
    width: 12,
    cost: 160000,
    minStar: 3,
    population: 14,
    modernOnly: true,
  },
  stairs: {
    kind: "stairs",
    category: "transport",
    name: "Stairway",
    width: 8,
    cost: 5000,
    minStar: 1,
    population: 0,
    transport: true,
  },
  escalator: {
    kind: "escalator",
    category: "transport",
    name: "Escalator",
    width: 8,
    cost: 20000,
    minStar: 3,
    population: 0,
    transport: true,
  },
  elevatorStandard: {
    kind: "elevatorStandard",
    category: "transport",
    name: "Standard Elevator",
    // Canon footprint: 4 tiles, the same as the service elevator (a service
    // elevator is a staff-only standard elevator, not a reduced one). The car
    // draws 4 tiles wide against a floor 4.5 tiles tall, so it is TALLER than
    // it is wide, as the original's is: measured off a retail render, its car
    // is 32 x 36. An earlier note here claimed a floor was 4 tiles (44px) and
    // the car therefore square; both were wrong, and `render/scale.test.ts`
    // now pins the real proportion.
    width: 4,
    cost: 200000,
    minStar: 1,
    population: 0,
    transport: true,
  },
  elevatorService: {
    kind: "elevatorService",
    category: "transport",
    name: "Service Elevator",
    width: 4,
    cost: 100000,
    minStar: 2,
    population: 0,
    transport: true,
    staffOnly: true,
  },
  elevatorExpress: {
    kind: "elevatorExpress",
    category: "transport",
    name: "Express Elevator",
    // Canon footprint: 6 tiles, wider than the standard/service elevators (both
    // 4). The 1994 retail game builds the express at 6 tiles; harness pixel
    // measurement confirms standard 4, service 4, express 6. The TDT format
    // carries no width field, so the exporter reconstructs footprint from this
    // catalog value: a 6 here is what keeps a round-tripped express from losing
    // shafts to a too-tight reconstruction.
    width: 6,
    cost: 400000,
    minStar: 3,
    population: 0,
    transport: true,
  },
  parkingRamp: {
    kind: "parkingRamp",
    category: "service",
    name: "Parking Ramp",
    width: 16,
    cost: 50000,
    minStar: 3,
    population: 0,
    basement: true,
  },
  parking: {
    kind: "parking",
    category: "service",
    name: "Parking Space",
    width: 4,
    cost: 3000,
    minStar: 3,
    population: 0,
    basement: true,
  },
  security: {
    kind: "security",
    category: "service",
    name: "Security",
    width: 8,
    cost: 100000,
    // Buildable at 2★, it is the facility that GATES 3★, so it must be placeable
    // before the tower is 3★ or the rating deadlocks at 2★ forever.
    minStar: 2,
    population: 0,
  },
  medical: {
    kind: "medical",
    category: "service",
    name: "Medical Center",
    width: 16,
    cost: 500000,
    minStar: 3,
    population: 0,
  },
  housekeeping: {
    kind: "housekeeping",
    category: "service",
    name: "Housekeeping",
    width: 8,
    cost: 50000,
    minStar: 2,
    population: 0,
  },
  recycling: {
    kind: "recycling",
    category: "service",
    name: "Recycling Center",
    width: 20,
    floors: 2,
    cost: 500000,
    minStar: 3,
    population: 0,
    basement: true,
  },
  metro: {
    kind: "metro",
    category: "special",
    name: "Metro Station",
    // Spans the full lot width and THREE deep-basement floors (B8–B10 in the
    // original), so it must be placed at the bottom of the basement.
    width: LOT_WIDTH,
    floors: 3,
    cost: 1000000,
    minStar: 4,
    population: 0,
    basement: true,
  },
  weddingHall: {
    kind: "weddingHall",
    category: "special",
    name: "Wedding Hall",
    width: 16,
    cost: 3000000,
    minStar: 5,
    population: 0,
    attendance: 12,
  },
  // Modern rental living (Studio + Apartment): catalog entries live in their own
  // module so this file stays under the size ceiling. The spread keeps the
  // Record<FacilityKind, Facility> completeness check (a missing kind still errors).
  ...RENTAL_FACILITIES,
};

export const ALL_KINDS: FacilityKind[] = Object.keys(FACILITIES) as FacilityKind[];

const KIND_SET = new Set<string>(ALL_KINDS);

/**
 * Runtime guard for facility kinds. TypeScript's string-literal union gives us
 * compile-time safety; this closes the runtime hole at trust boundaries (loaded
 * saves, imported JSON) so an invalid kind can never enter the model.
 */
export function isFacilityKind(value: unknown): value is FacilityKind {
  return typeof value === "string" && KIND_SET.has(value);
}

/** Tower geometry constants. */
export const GRID = {
  /** Highest above-ground floor. */
  maxFloor: 100,
  /**
   * Floor numbering is continuous so basements sit directly under the ground
   * floor: floor 1 = ground, floor 0 = B1, -1 = B2 … -9 = B10 (no gap at 0).
   */
  minFloor: -9,
  /** Total buildable width in tiles, the canon 1994 map is 375 segments wide. */
  width: LOT_WIDTH,
  /** Floors between required (sky) lobbies. */
  lobbyInterval: 15,
} as const;
