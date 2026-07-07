import type { Facility, FacilityKind, Unit } from "./types";

/**
 * Facility catalog. Costs and sizes are tuned to mirror the scale and balance
 * of the 1994 SimTower (Maxis/OpenBook). Widths are in grid tiles.
 *
 * In the original, a single office is the base unit of "width". We use a tile
 * grid where the smallest commercial unit is a few tiles wide.
 */
/** The buildable lot width in tiles — the canon 1994 map is 375 segments wide.
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
    // A suite houses a larger party than a double — matching the 1994 original
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
    population: 0,
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
    population: 0,
    color: "#d4564a",
    description: "Fine dining, busy at lunch and dinner. Needs good elevator access.",
  },
  shop: {
    kind: "shop",
    category: "retail",
    name: "Retail Shop",
    width: 12,
    cost: 100000,
    minStar: 3,
    population: 0,
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
    color: "#8a6fd6",
    description: "A two-story movie theater. Draws large evening crowds; demands heavy transport capacity.",
  },
  partyHall: {
    kind: "partyHall",
    category: "entertainment",
    name: "Party Hall",
    width: 24,
    cost: 100000,
    minStar: 3,
    population: 0,
    color: "#cf7fb0",
    description: "Rentable function space for events. Periodic income.",
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
    // 3 tiles ≈ one floor tall (3·11 ≈ 34), so the car is square as in the
    // original, rather than the previous wide 4-tile cab.
    width: 3,
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
    width: 4,
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
    // Buildable at 2★ — it is the facility that GATES 3★, so it must be placeable
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
      "Cleans hotel rooms each day so they can be rented again. One per ~20 rooms. Staff reach rooms by service elevator, stairs or escalator (never passenger elevators).",
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

/**
 * The number of people a unit contributes to the population census — the SINGLE
 * seam every "how many live/work here" count routes through (total population,
 * star-rating census, per-floor congestion). Almost always the kind's flat
 * catalog `population`; the one exception is a Modern-mode condo that sold to a
 * variable-size household, which carries its own `residents`. Classic towers and
 * every pre-variant save leave `residents` undefined and so read the flat value
 * — keeping their numbers byte-identical. Take a partial so callers can pass a
 * bare `{kind, residents}` without a full Unit.
 */
export function residentCount(u: Pick<Unit, "kind"> & { residents?: number }): number {
  // Gate the override on condos: `residents` is only ever a condo household, so
  // a forged save that stamps it on an office can't inflate that office's head
  // count. Everything else — and any condo without a household set — reads the
  // flat catalog population.
  if (u.kind === "condo" && u.residents !== undefined) return u.residents;
  return FACILITIES[u.kind].population;
}

/**
 * Star-rating population thresholds — the canonical 1994 values
 * (300 / 1,000 / 5,000 / 10,000). Above 3★ the rating counts only non-hotel
 * occupants (offices/condos); the lot is the canon 375 tiles wide so a well-zoned
 * tower holds well over 15,000 of those, keeping the canonical 10,000 (5★) and
 * 15,000 (TOWER) genuinely reachable.
 */
export const STAR_THRESHOLDS: Record<number, number> = {
  1: 0,
  2: 300,
  3: 1000,
  4: 5000,
  5: 10000,
};

/**
 * Population needed for the final TOWER rating (above 5 stars). Same metric as
 * the 1994 original — a census of OCCUPANTS (office workers + condo residents;
 * hotel guests count only while climbing to 3★, then drop out per canon);
 * commercial/visitor traffic never counts. The canonical 15,000: the lot is the
 * canon 375 tiles wide so a well-zoned 100-floor tower comfortably reaches it
 * (with express + banded locals).
 */
export const TOWER_POPULATION = 15000;

/**
 * Waste-management balance (canon: the FAQ's "Recycle Center … fills daily;
 * required for 4★" means DEMAND MET, not merely built). One operational center
 * processes this much population's daily garbage; beyond it the centers
 * overflow, the 4★ gate closes and commercial appeal sags. 2,500/center makes
 * the canonical ladder demand 2 centers by 4★ (5,000 pop), 4 by 5★ (10,000)
 * and 6 by TOWER (15,000) — the original's "keep adding them as you grow".
 */
export const RECYCLING_POP_PER_CENTER = 2500;

/** Hour of the daily garbage-truck collection that empties every center.
 *  Pre-dawn, like the original — you see the truck if you're watching early. */
export const GARBAGE_COLLECT_HOUR = 5;

/** Office workers one functional parking space serves (canon: offices demand
 *  parking from 3★). The 1994 original asks for one space per **four offices**;
 *  an office holds 6 workers, so one space serves 24 workers. Shared by the
 *  move-in penalty, the UI and the tests. */
export const PARKING_WORKERS_PER_SPACE = 24;

/** Tower geometry constants. */
export const GRID = {
  /** Highest above-ground floor. */
  maxFloor: 100,
  /**
   * Floor numbering is continuous so basements sit directly under the ground
   * floor: floor 1 = ground, floor 0 = B1, -1 = B2 … -9 = B10 (no gap at 0).
   */
  minFloor: -9,
  /** Total buildable width in tiles — the canon 1994 map is 375 segments wide. */
  width: LOT_WIDTH,
  /** Floors between required (sky) lobbies. */
  lobbyInterval: 15,
} as const;

export function isHotelKind(kind: FacilityKind): boolean {
  return kind === "hotelSingle" || kind === "hotelDouble" || kind === "hotelSuite";
}

/** Height of a facility in floors (1 for ordinary single-story rooms). */
export function facilityFloors(kind: FacilityKind): number {
  return FACILITIES[kind].floors ?? 1;
}

/**
 * How long a facility takes to build, in in-game minutes. Structure goes up
 * instantly; rooms take a while (bigger/pricier → longer), like the original's
 * construction phase. Driven entirely by the global clock — no per-room timers.
 */
export function buildMinutes(kind: FacilityKind): number {
  const f = FACILITIES[kind];
  if (kind === "floor" || kind === "lobby") return 0;
  return Math.min(8 * 60, Math.round(60 + f.width * 8 + f.cost / 5000));
}

/** Opening hours by facility, shared by the economy and the renderer. */
export function isOpenAt(kind: FacilityKind, hour: number): boolean {
  switch (kind) {
    case "fastFood":
      return hour >= 7 && hour < 22;
    case "restaurant":
      return (hour >= 11 && hour < 14) || (hour >= 17 && hour < 23);
    case "shop":
      return hour >= 10 && hour < 21;
    case "cinema":
      return hour >= 12 && hour < 24;
    case "partyHall":
      return hour >= 17 && hour < 24;
    default:
      return true;
  }
}

/** Number of hours per day a venue is open (used to spread its daily take so
 * total income over a day ≈ the headline daily figure, not a per-open-hour
 * multiple of it). */
export function openHoursPerDay(kind: FacilityKind): number {
  let h = 0;
  for (let hr = 0; hr < 24; hr++) if (isOpenAt(kind, hr)) h++;
  return h || 1;
}

/** The canon foot-traffic commercial kinds — fast food, restaurant, retail
 *  (shop), cinema. This is the exact set the 1994 noise (W2) and lobby-proximity
 *  (W3) rules name. `partyHall` earns traffic income too but is deliberately NOT
 *  in the canon commercial set, so it is exempt from both — keep W2 and W3 keyed
 *  off this one predicate so they can never drift apart. */
export function isCommercialKind(kind: FacilityKind): boolean {
  return kind === "fastFood" || kind === "restaurant" || kind === "shop" || kind === "cinema";
}

/** True for facilities that keep posted business hours (can be "closed"). */
export function hasBusinessHours(kind: FacilityKind): boolean {
  return (
    kind === "fastFood" ||
    kind === "restaurant" ||
    kind === "shop" ||
    kind === "cinema" ||
    kind === "partyHall"
  );
}

export function isElevatorKind(kind: FacilityKind): boolean {
  return (
    kind === "elevatorStandard" ||
    kind === "elevatorService" ||
    kind === "elevatorExpress"
  );
}

/** True for staff-only transports (no tenants/visitors ever ride them). The
 *  single source of truth for every passenger-side exclusion — routing,
 *  serving, capacity, dispatch demand. */
export function isStaffOnlyTransport(kind: FacilityKind): boolean {
  return FACILITIES[kind]?.staffOnly === true;
}

/** True for transports STAFF travel on: the staff-only elevators plus everything
 *  walkable (stairs, escalators). The single source of truth for the staff
 *  network, shared by Tower.staffConnected and Crowd's staff routing so the
 *  two can never disagree about reachability. */
export function isStaffTransportKind(kind: FacilityKind): boolean {
  return isStaffOnlyTransport(kind) || kind === "stairs" || kind === "escalator";
}

/** Passengers a single car of each transport type holds per trip. */
export const TRANSPORT_CAPACITY: Record<string, number> = {
  elevatorStandard: 21,
  elevatorService: 16,
  elevatorExpress: 42, // canon: PC 1.0 express car carries 42 (standard 21)
  escalator: 30, // continuous flow, treated as per-shaft
  stairs: 8,
};

/**
 * Per-car passenger capacity for a transport kind. The single source of truth
 * for the whole engine — dispatch load-clamping, the simulation's capacity /
 * congestion math, and the renderer's rider-fill / FULL indicator all route
 * through here, so they can never disagree on the number (an unknown kind
 * conservatively carries nobody). Distinct from `Simulation.transportCapacity`,
 * which is the whole shaft's total: cars × this per-car number.
 */
export function transportCarCapacity(kind: FacilityKind): number {
  return TRANSPORT_CAPACITY[kind] ?? 0;
}

/** Maximum cars allowed per shaft, by elevator type. Canon: every elevator kind
 *  supports up to 8 cars per shaft in the 1994 original — service is not an
 *  exception (it is a staff-only standard elevator: same 8 cars, same 30-floor
 *  span). */
export const MAX_CARS: Record<string, number> = {
  elevatorStandard: 8,
  elevatorService: 8,
  elevatorExpress: 8,
};

/** Max cars for a shaft kind. The single home for the missing-kind fallback,
 *  so the editor's guards and the engine's clamp can't drift apart. */
export function maxCarsFor(kind: string): number {
  return MAX_CARS[kind] ?? 8;
}

/**
 * Hard per-tower build limits, mirroring the 1994 original's caps. A kind absent
 * here is uncapped. Elevator shafts (all three kinds) share a single 24-shaft
 * pool; stairs and escalators share a 64-link pool — see {@link POOLED_CAPS}.
 */
export const BUILD_CAPS: Partial<Record<FacilityKind, number>> = {
  metro: 1,
  weddingHall: 1,
  security: 10,
  medical: 10,
  cinema: 16,
  partyHall: 16,
};

/** Pooled caps shared across several kinds (elevators, walkways). */
export const POOLED_CAPS: { kinds: FacilityKind[]; cap: number; label: string }[] = [
  { kinds: ["elevatorStandard", "elevatorService", "elevatorExpress"], cap: 24, label: "elevator shafts" },
  { kinds: ["stairs", "escalator"], cap: 64, label: "stairs/escalators" },
];

/** Maximum floors a transport may span (a span is the gap between bottom and top,
 * so floors served is span + 1). Stairs/escalators link one floor; standard and
 * service elevators cap at 30; express has **no effective limit** in the original,
 * so it may span the entire buildable height of the tower (derived from GRID, not
 * a magic number). */
export function maxSpanFor(kind: FacilityKind): number {
  if (kind === "stairs" || kind === "escalator") return 1;
  if (kind === "elevatorExpress") return GRID.maxFloor - GRID.minFloor; // whole tower height
  return 30;
}

/** True for transports that are a FIXED two-floor unit (stairs, escalators):
 *  placed with one tap, never dragged to size, never extended. The single
 *  home for the concept — placement, gestures, ghosts, editor buttons and
 *  span messages all key off this, so a new kind can't flip half of them. */
export function isFixedSpanTransport(kind: FacilityKind): boolean {
  return FACILITIES[kind]?.transport === true && maxSpanFor(kind) === 1;
}
