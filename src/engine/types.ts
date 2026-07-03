/**
 * Core type definitions for the SimTower clone engine.
 *
 * The tower is modelled as a grid of cells. Each floor is a row; columns are
 * "tiles". A facility occupies a contiguous run of tiles on a single floor.
 */

/** Cosmetic sky weather, derived deterministically from the day. */
export type WeatherKind = "clear" | "cloudy" | "rain";

/** Category groups used for the build toolbar and evaluation rules. */
export type FacilityCategory =
  | "structure"
  | "transport"
  | "office"
  | "residential"
  | "hotel"
  | "food"
  | "retail"
  | "entertainment"
  | "service"
  | "special";

/** Every buildable facility kind. */
export type FacilityKind =
  | "lobby"
  | "floor"
  | "office"
  | "condo"
  | "hotelSingle"
  | "hotelDouble"
  | "hotelSuite"
  | "fastFood"
  | "restaurant"
  | "shop"
  | "cinema"
  | "partyHall"
  | "stairs"
  | "escalator"
  | "elevatorStandard"
  | "elevatorService"
  | "elevatorExpress"
  | "parkingRamp"
  | "parking"
  | "security"
  | "medical"
  | "housekeeping"
  | "recycling"
  | "metro"
  | "weddingHall";

/** Occupancy / activity state of a unit. */
export type UnitState =
  | "construction" // under construction, not yet usable
  | "empty" // built, awaiting a tenant
  | "occupied" // has a tenant / in service
  | "moving_in"
  | "vacating" // tenant leaving due to dissatisfaction
  | "asleep" // hotel room with sleeping guest (night)
  | "dirty" // hotel room awaiting housekeeping after checkout
  | "fire" // unit ablaze during a fire emergency
  | "gutted"; // burned-out shell — no income, no tenants; must be bulldozed & rebuilt

const UNIT_STATES: ReadonlySet<string> = new Set([
  "construction",
  "empty",
  "occupied",
  "moving_in",
  "vacating",
  "asleep",
  "dirty",
  "fire",
  "gutted",
] satisfies UnitState[]);

/** Guard for untrusted input (hand-edited / foreign saves): a forged `state`
 *  string would otherwise flow into UI innerHTML and state-machine compares. */
export function isUnitState(v: unknown): v is UnitState {
  return typeof v === "string" && UNIT_STATES.has(v);
}

/** Why a dissatisfied tenant is leaving — attributed from the dominant
 *  satisfaction drain at the moment it bottoms out, so the notice/departure
 *  toast names the real cause instead of always blaming "poor access". Office
 *  noise is deliberately NOT a cause: it only caps satisfaction at 0.6, never
 *  drains it to zero, so it can annoy but never on its own evict. */
export type VacateReason = "access" | "congestion" | "rent";

/** Player-facing phrase for each departure cause (toasts + inspector). Kept
 *  transport-neutral: a floor is "served" by any route to the lobby (elevator,
 *  stairs, or escalator) and congestion capacity counts them all, so the copy
 *  must not single out elevators. */
export const VACATE_REASON_TEXT: Record<VacateReason, string> = {
  access: "no route to the lobby",
  congestion: "overcrowded elevators & stairs",
  rent: "rent set too high",
};

/** Guard for a persisted departure cause from an untrusted save. */
export function isVacateReason(v: unknown): v is VacateReason {
  return v === "access" || v === "congestion" || v === "rent";
}

/** A unit that is live: not under construction, ablaze, or a burned-out shell.
 *  The single predicate every "is this room working?" check should route through
 *  so a new inert state (like `gutted`) is honored everywhere at once. */
export function isOperational(u: { state: UnitState }): boolean {
  return u.state !== "construction" && u.state !== "fire" && u.state !== "gutted";
}

/** People are physically present (the canon "counts as live population" rule):
 *  working, sleeping, mid move-in, or on notice. A `vacating` tenant hasn't
 *  actually left yet — they still live/work there through the notice period —
 *  so they keep counting until the departure resolves. */
export function isPresent(u: { state: UnitState }): boolean {
  return (
    u.state === "occupied" ||
    u.state === "asleep" ||
    u.state === "moving_in" ||
    u.state === "vacating"
  );
}

/** State-based: a unit that is settled (`occupied`) or on notice (`vacating`) —
 *  i.e. still in residence, not yet gone. Purely a `state` check, so it applies
 *  to any unit the caller iterates (population, crowd, events), not just leases;
 *  today only office/condo leases ever reach `vacating`, but the predicate makes
 *  no such assumption. Both states pay rent, count toward population, and
 *  commute — a vacating tenant merely carries a pending departure a timely fix
 *  can still rescind — so routing through this keeps the grace-period state
 *  honored everywhere at once. */
export function isTenanted(u: { state: UnitState }): boolean {
  return u.state === "occupied" || u.state === "vacating";
}

/** Nobody home and nothing to simulate — the per-tick presence/satisfaction
 *  loops skip these. NOT the inverse of {@link isOperational}: an operational
 *  `empty` room is still dormant, and fire has its own loop elsewhere. */
export function isDormant(u: { state: UnitState }): boolean {
  return u.state === "empty" || u.state === "construction" || u.state === "fire" || u.state === "gutted";
}

export interface Facility {
  kind: FacilityKind;
  category: FacilityCategory;
  name: string;
  /** Width in tiles. */
  width: number;
  /** Height in floors (1 unless the facility spans several stories). */
  floors?: number;
  /** Build cost in dollars. */
  cost: number;
  /** Star rating required to unlock (1..5). */
  minStar: number;
  /** Population this facility contributes when fully occupied. */
  population: number;
  /** Hex color used by the procedural sprite renderer. */
  color: string;
  /** True for vertical transport (occupies multiple floors). */
  transport?: boolean;
  /** True for transports that carry only tower staff (housekeepers), never
   * tenants or visitors — excluded from passenger routing, serving, capacity
   * and dispatch demand. */
  staffOnly?: boolean;
  /** True if the facility may only be built underground (basement floors). */
  basement?: boolean;
  description: string;
}

/** A placed facility instance in the tower. */
export interface Unit {
  id: number;
  kind: FacilityKind;
  floor: number;
  /** Left-most tile column. */
  x: number;
  width: number;
  state: UnitState;
  /** 0..1 satisfaction; low values cause tenants to leave. */
  satisfaction: number;
  /** Current number of occupants present right now. */
  occupants: number;
  /** Whether this unit has ever been rented/sold (for one-time income). */
  everOccupied: boolean;
  /** Accumulated income not yet collected (offices/condos). */
  pendingIncome: number;
  /** Player-set price for this unit — office quarterly rent, hotel nightly
   *  rate, or condo sale price. Undefined falls back to the kind's default. */
  rent?: number;
  /** Name shown when inspected (e.g. tenant company / guest). */
  label: string;
  /** Why the current tenant gave notice — set while `state === "vacating"`, and
   *  cleared when they either leave or rescind. Undefined on a settled unit. */
  vacateReason?: VacateReason;
  /** Game-clock minute at which a `vacating` tenant actually leaves unless their
   *  satisfaction recovers first (the notice period). */
  vacateAt?: number;
  /** Per-cinema film-booking policy. `undefined` ⇒ "auto" (the legacy 40% roll),
   *  so old saves and demo towers behave identically. */
  filmPolicy?: "auto" | "feature" | "blockbuster";
  /** Game-clock minute at which construction finishes (for the build phase). */
  completeAt?: number;
}

/** A vertical transport instance (elevator shaft / stairs / escalator). */
export interface Transport {
  id: number;
  kind: FacilityKind;
  x: number;
  width: number;
  /** Lowest floor served (inclusive). */
  bottom: number;
  /** Highest floor served (inclusive). */
  top: number;
  /** Number of cars (elevators only). */
  cars: number;
  /** Animated car positions (continuous floor value) for rendering. */
  carPositions: number[];
  /** Direction of each car: -1 down, 0 idle, 1 up. */
  carDir: number[];
  /** Passengers currently aboard each car (for rendering riders). */
  carLoad?: number[];
  /** Number of riders currently in transit through this transport. */
  load: number;
  /** Floors this transport is configured NOT to stop at (express service). */
  skipFloors?: number[];
}

export interface SerializedGame {
  version: number;
  seed: number;
  money: number;
  star: number;
  minutes: number;
  units: Unit[];
  transports: Transport[];
  nextId: number;
  towerName: string;
  builtWeddingHall: boolean;
  evaluatedTower: boolean;
  /** Scheduled day of the pending VIP inspection (-1 if none). Optional for
   * backward compatibility with saves written before it was persisted. */
  vipVisitDay?: number;
  /** Whether a VIP has given a favorable suite review (a 4★ gate). */
  vipFavorable?: boolean;
  /** Seasonal-event state (Santa guard + dedicated RNG position). Optional for
   * backward compatibility with saves written before it was persisted. */
  events?: {
    lastSantaYear: number;
    rngState: number;
    pending?: { kind: "fireRescue" | "bombThreat"; cost: number; message: string } | null;
  };
  /** Buried-treasure finds so far (capped), persisted so reload can't reset it. */
  treasuresFound?: number;
  /** Basement tiles already excavated ("floor:x"), so buried treasure stays a
   * one-time find per tile across save/reload. Optional for older saves. */
  excavated?: string[];
  /** Cinema unit ids showing a blockbuster this month (paid at booking), so a
   * mid-month reload keeps the boost. Optional for older saves. */
  blockbusters?: number[];
  /** Ids of optional milestones already achieved, so reload doesn't
   * re-announce them. Optional for older saves. */
  milestones?: string[];
}

/** Result of attempting to place a facility. */
export interface PlaceResult {
  ok: boolean;
  reason?: string;
  unitId?: number;
  transportId?: number;
}
