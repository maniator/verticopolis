import type { Facility, FacilityKind } from "./types";

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
    color: "#d8d2b0",
    description:
      "Ground-floor and sky lobbies. People pass through to reach elevators. Build every 15 floors.",
  },
  floor: {
    kind: "floor",
    category: "structure",
    name: "Floor",
    width: 1,
    cost: 500,
    minStar: 1,
    population: 0,
    color: "#9a9486",
    description: "Structural floor space. Must exist before placing rooms.",
  },
  office: {
    kind: "office",
    category: "office",
    name: "Office",
    width: 9,
    cost: 40000,
    minStar: 1,
    population: 6,
    color: "#6fb1d6",
    description: "Rents to a company. Workers arrive mornings, leave evenings. Pays quarterly rent.",
  },
  condo: {
    kind: "condo",
    category: "residential",
    name: "Condominium",
    width: 16,
    cost: 80000,
    minStar: 1,
    population: 3,
    color: "#7ec97e",
    description: "Sold once to a resident family for a large lump sum. Residents live here permanently.",
  },
  hotelSingle: {
    kind: "hotelSingle",
    category: "hotel",
    name: "Single Room",
    width: 4,
    cost: 20000,
    minStar: 2,
    population: 1,
    color: "#e0b15e",
    description: "Hotel single. Guests check in at night, out in the morning. Needs housekeeping.",
  },
  hotelDouble: {
    kind: "hotelDouble",
    category: "hotel",
    name: "Double Room",
    width: 6,
    cost: 50000,
    minStar: 3,
    population: 2,
    color: "#e0a94e",
    description: "Hotel double room. Higher nightly income than a single.",
  },
  hotelSuite: {
    kind: "hotelSuite",
    category: "hotel",
    name: "Suite",
    width: 10,
    cost: 100000,
    minStar: 3,
    // A suite houses a larger party than a double, matching the 1994 original
    // (review F36).
    population: 3,
    color: "#d99a2e",
    description: "Luxury hotel suite. Best nightly income, demanding guests.",
  },
  fastFood: {
    kind: "fastFood",
    category: "food",
    name: "Fast Food",
    width: 16,
    cost: 100000,
    minStar: 1,
    population: 25,
    color: "#e87b6e",
    description: "Quick dining. Busy at lunch. Income scales with foot traffic.",
  },
  restaurant: {
    kind: "restaurant",
    category: "food",
    name: "Restaurant",
    width: 24,
    cost: 200000,
    minStar: 3,
    population: 35,
    color: "#d4564a",
    description: "Fine dining, busy at lunch and dinner. Needs good elevator access.",
  },
  foodHall: {
    kind: "foodHall",
    category: "food",
    name: "Food Hall",
    width: 24,
    cost: 250000,
    minStar: 3,
    population: 40,
    color: "#e0965a",
    modernOnly: true,
    description: "Modern: a hall of food stalls. Earns from foot traffic and satisfies many cravings from one spot, so it covers a wide reach of hungry tenants.",
  },
  shop: {
    kind: "shop",
    category: "retail",
    name: "Retail Shop",
    width: 12,
    cost: 100000,
    minStar: 3,
    population: 20,
    color: "#b58ad6",
    description: "Retail. Earns from shoppers passing by. Thrives near lobbies and offices.",
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
    color: "#8a6fd6",
    description: "A two-story movie theater. Draws large evening crowds; demands heavy transport capacity.",
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
    color: "#cf7fb0",
    description: "A two-story rentable function space for events. Guests enter on the lower floor. Periodic income.",
  },
  amusements: {
    kind: "amusements",
    category: "entertainment",
    name: "Amusements",
    width: 12,
    cost: 180000,
    minStar: 3,
    population: 25,
    color: "#d24a9c",
    modernOnly: true,
    description: "Modern: an arcade and amusements hall (classic cabinets, VR, claw machines, mini-golf). Draws teens and families for games and earns from foot traffic, and is busier on weekends.",
  },
  boutiqueBay: {
    kind: "boutiqueBay",
    category: "retail",
    name: "Boutique Bay",
    width: 12,
    cost: 150000,
    minStar: 3,
    population: 22,
    color: "#3aa88c",
    modernOnly: true,
    description: "Modern: a bay of small independent trades (florist, barber, phone repair, vintage, tattoo, record store, gallery). Earns from foot traffic and offers the widest variety of any single build, busier on weekends.",
  },
  fitnessClub: {
    kind: "fitnessClub",
    category: "entertainment",
    name: "Fitness Club",
    width: 16,
    cost: 220000,
    minStar: 3,
    population: 20,
    color: "#4a86c8",
    modernOnly: true,
    description: "Modern: a members' gym (weight floor, yoga, spin, boxing, climbing). Pays a membership lease like an office, and nearby condos are happier for having it close (a capped bonus that fades with distance).",
  },
  clinic: {
    kind: "clinic",
    category: "retail",
    name: "Clinic",
    width: 8,
    cost: 120000,
    minStar: 3,
    population: 12,
    color: "#5ab0c8",
    modernOnly: true,
    description: "Modern: a small health clinic (dental, urgent care, optometry, pharmacy, physio). Pays a lease like an office: a quiet, steady tenant.",
  },
  stairs: {
    kind: "stairs",
    category: "transport",
    name: "Stairway",
    width: 8,
    cost: 5000,
    minStar: 1,
    population: 0,
    color: "#b0a890",
    transport: true,
    description: "Cheap two-floor link: one tap places the whole flight. People will only climb a short distance.",
  },
  escalator: {
    kind: "escalator",
    category: "transport",
    name: "Escalator",
    width: 8,
    cost: 20000,
    minStar: 3,
    population: 0,
    color: "#c8c0a0",
    transport: true,
    description: "Moves crowds between adjacent floors. Great for lobbies, shops and food courts.",
  },
  elevatorStandard: {
    kind: "elevatorStandard",
    category: "transport",
    name: "Standard Elevator",
    // Canon footprint: 4 tiles, the same as the service elevator (a service
    // elevator is a staff-only standard elevator, not a reduced one). The
    // render floor height is 4 tiles (44px) so the car reads square, as in
    // the original.
    width: 4,
    cost: 200000,
    minStar: 1,
    population: 0,
    color: "#5a5a6a",
    transport: true,
    description: "Serves up to 30 floors with several cars. The backbone of any tower.",
  },
  elevatorService: {
    kind: "elevatorService",
    category: "transport",
    name: "Service Elevator",
    width: 4,
    cost: 100000,
    minStar: 2,
    population: 0,
    color: "#4a4a52",
    transport: true,
    staffOnly: true,
    description:
      "Staff-only: housekeepers ride it to reach hotel floors; tenants and visitors never do. Cheap way to link service floors.",
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
    color: "#3a3a8a",
    transport: true,
    description: "Stops only at lobbies and sky lobbies. Essential for very tall towers.",
  },
  parkingRamp: {
    kind: "parkingRamp",
    category: "service",
    name: "Parking Ramp",
    width: 16,
    cost: 50000,
    minStar: 3,
    population: 0,
    color: "#6a6a6a",
    basement: true,
    description: "Basement car-ramp. Parking spaces must chain to a ramp to be usable.",
  },
  parking: {
    kind: "parking",
    category: "service",
    name: "Parking Space",
    width: 4,
    cost: 3000,
    minStar: 3,
    population: 0,
    color: "#888888",
    basement: true,
    description:
      "Basement parking. Must connect to a Parking Ramp. One space serves ~24 office workers (one per four offices), and every hotel suite needs a space of its own (VIPs drive).",
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
    color: "#4f6f9f",
    description: "Security office. Reduces crime/terrorist events and improves evaluation.",
  },
  medical: {
    kind: "medical",
    category: "service",
    name: "Medical Center",
    width: 16,
    cost: 500000,
    minStar: 3,
    population: 0,
    color: "#e0e0e8",
    description: "Handles illness and emergencies. Required for high ratings in large towers.",
  },
  housekeeping: {
    kind: "housekeeping",
    category: "service",
    name: "Housekeeping",
    width: 8,
    cost: 50000,
    minStar: 2,
    population: 0,
    color: "#c0d0c0",
    description:
      "Fields 6 maids who clean hotel rooms through the day shift so they can be rented again. Maids reach rooms by service elevator or stairs (never passenger elevators or escalators), so how many rooms they finish depends on placement and staff transport.",
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
    color: "#7f9f5f",
    basement: true,
    description:
      "Basement facility that fills with the tower's daily waste: one center processes ~2,500 population; build more as you grow. A garbage truck collects each morning. 4★ requires demand met.",
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
    color: "#9f7f5f",
    basement: true,
    description: "A whole-floor deep-basement subway station. Brings huge numbers of visitors to your tower.",
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
    color: "#f3ecdc",
    description: "A grand wedding & events hall atop a 5-star tower (floor 100). Triggers the final TOWER evaluation.",
  },
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
