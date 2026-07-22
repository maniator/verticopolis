/**
 * Core type definitions for the SimTower clone engine.
 *
 * The tower is modelled as a grid of cells. Each floor is a row; columns are
 * "tiles". A facility occupies a contiguous run of tiles on a single floor.
 */

import type { ElevatorSchedule } from "./elevatorSchedule";

/** Cosmetic sky weather, derived deterministically from the day. */
export type WeatherKind = "clear" | "cloudy" | "rain";

/**
 * Rule-set a tower is founded under. Chosen once at tower creation and immutable
 * for that save's life (never a runtime toggle), so no simulation code ever has
 * to ask "did the player switch mid-game?".
 *
 * - `classic` — pixel-faithful 1994 SimTower: every condo houses a flat family
 *   of 3. This is the ONLY mode a save can have if it predates the mode field,
 *   so a legacy tower's population census loads unchanged (its condos stay flat
 *   3s). Note the price-band re-anchor and the owner buy-back are 1994-canon
 *   fixes that apply to EVERY tower regardless of mode — they aren't gated here;
 *   only behavior the original never had is.
 * - `modern` — Classic plus opt-in divergences the original couldn't do. Today
 *   that means *variant households* (a condo draws a 2–5 person family that
 *   drives its price and how demanding it is). Future Modern features layer in
 *   the same way, each behind this one flag.
 */
export type GameMode = "classic" | "modern";

/** Guard for a persisted mode from an untrusted/older save (absent ⇒ classic). */
export function isGameMode(v: unknown): v is GameMode {
  return v === "classic" || v === "modern";
}

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
  | "foodHall"
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
  | "infested" // hotel room dirty too long: cockroaches. No longer cleanable (Classic: bulldoze; Modern: exterminator). Earns nothing, still spreads.
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
  "infested",
  "fire",
  "gutted",
] satisfies UnitState[]);

/** Guard for untrusted input (hand-edited / foreign saves): a forged `state`
 *  string would otherwise flow into UI innerHTML and state-machine compares. */
export function isUnitState(v: unknown): v is UnitState {
  return typeof v === "string" && UNIT_STATES.has(v);
}

/** Why a dissatisfied tenant is leaving, attributed from the dominant
 *  satisfaction drain when it bottoms out, so the toast names the real cause
 *  rather than always blaming "poor access". `noise`: a noise-sensitive room
 *  (office, hotel, condo) worn down by a same-floor neighbor over sustained
 *  exposure (W2 erosion). `transportFar`: an office whose nearest stairs/elevator
 *  sits past the walking tolerance (79 tiles) on its floor (W1). `lobbyFar`: a
 *  tenant deep in the very-far band from the nearest (sky)lobby (fix: a sky
 *  lobby, not a nearer stair/elevator). `unmetDemand`: a served office/hotel/condo
 *  whose reachable shops/eateries can't cover demand (Modern evicts, Classic caps). */
export type VacateReason =
  | "access" | "congestion" | "rent" | "noise" | "transportFar" | "lobbyFar" | "unmetDemand" | "relocation";

/** Player-facing phrase for each departure cause (toasts + inspector). Kept
 *  transport-neutral: a floor is "served" by any route to the lobby (elevator,
 *  stairs, or escalator) and congestion capacity counts them all, so the copy
 *  must not single out elevators. */
export const VACATE_REASON_TEXT: Record<VacateReason, string> = {
  access: "no route to the lobby",
  congestion: "overcrowded vertical transport",
  rent: "rent set too high",
  noise: "a noisy neighbor nearby",
  transportFar: "too far from a stairway, escalator, or passenger elevator",
  lobbyFar: "too far from a lobby or sky lobby",
  unmetDemand: "too few shops or restaurants within reach",
  relocation: "the household is relocating",
};

/** Guard for a persisted departure cause from an untrusted save. Derived from
 *  {@link VACATE_REASON_TEXT} so the two can never drift as causes are added. */
const VACATE_REASONS: ReadonlySet<string> = new Set(Object.keys(VACATE_REASON_TEXT));
export function isVacateReason(v: unknown): v is VacateReason {
  return typeof v === "string" && VACATE_REASONS.has(v);
}

/** A unit that is live: not under construction, ablaze, or a burned-out shell.
 *  The single predicate every "is this room working?" check should route through
 *  so a new inert state (like `gutted`) is honored everywhere at once. */
export function isOperational(u: { state: UnitState }): boolean {
  return u.state !== "construction" && u.state !== "fire" && u.state !== "gutted";
}

/** People are physically present (the canon "counts as live population" rule):
 *  a settled/working tenant, a sleeping guest, or a lease on notice (`vacating`)
 *  — who hasn't actually left yet and so keeps counting until the departure
 *  resolves. (`moving_in` is a reserved lifecycle state the sim never currently
 *  assigns; it stays in the set so it would count if a move-in phase is added.) */
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

/** Nobody home and nothing to simulate: the per-tick loops skip these (NOT the
 *  inverse of {@link isOperational}; an operational `empty` is dormant). `infested` is here so a roach-ruined room isn't dragged through the satisfaction loop and self-vacated to a free `empty`, bypassing its bulldoze/exterminator recovery. */
export function isDormant(u: { state: UnitState }): boolean {
  const s = u.state;
  return s === "empty" || s === "construction" || s === "fire" || s === "gutted" || s === "infested";
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
  /** Modern-only content: a facility the 1994 game never had. Gated out of
   *  Classic entirely (unbuildable, hidden from the Classic palette), so a
   *  Classic tower stays pixel-faithful. Absent (falsy) for every canon kind. */
  modernOnly?: boolean;
  /** True for vertical transport (occupies multiple floors). */
  transport?: boolean;
  /** True for transports that carry only tower staff (housekeepers), never
   * tenants or visitors — excluded from passenger routing, serving, capacity
   * and dispatch demand. */
  staffOnly?: boolean;
  /** True if the facility may only be built underground (basement floors). */
  basement?: boolean;
  /** Visible seat capacity for routed attendance visitors at population-0
   *  entertainment venues (cinema / party hall / wedding hall). Live
   *  attendance (`Unit.customersIn`) is clamped here and mirrored into
   *  `occupants` for the occupancy-gated interior art; it never enters the
   *  census (the kind's `population` stays 0, keeping `censusCount`'s
   *  commercial gate closed). Design tuning, not a canon figure. */
  attendance?: number;
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
  /** Transient count of the people currently at this venue: meal customers
   *  eating at a commercial venue (fastFood / restaurant / shop, where the
   *  count clamps at the catalog population and feeds the census), or routed
   *  attendance visitors at a population-0 entertainment venue (cinema /
   *  partyHall / weddingHall, where it clamps at the catalog `attendance`
   *  cap, mirrors into `occupants` for the interior art, and never enters
   *  the census). Not persisted: the field is omitted from serialization, so
   *  after a reload it is `undefined` and census reads treat it as 0 via
   *  `?? 0`; round-trippers rebuild the count organically. Incremented when
   *  a person enters the `dwelling` state at this venue; decremented when
   *  they leave. See {@link isCommercialKind} and `attendanceCap`. */
  customersIn?: number;
  /** Transient subset of {@link customersIn}: how many of the current eaters
   *  came from a HOTEL origin. The 4-star-plus rating census excludes hotel
   *  guests, so a guest eating at a fastFood must not re-enter it through the
   *  venue's customer tally; `occupantPopulation()` subtracts this. Same
   *  lifecycle as `customersIn`: not persisted, stripped on load, rebuilt by
   *  the live crowd, and always at most `customersIn`. */
  hotelCustomersIn?: number;
  /** Transient count of workers/residents currently out on a meal round-trip
   *  originating from THIS unit. Not persisted (a save reload resets it to 0
   *  and the next `updatePresence` hour boundary re-baselines `occupants`).
   *  The renderer and pop census read
   *  `visibleOccupants(u) = max(0, occupants - outForMeal)`. Incremented at
   *  meal-round-trip spawn; decremented at return arrival, guarded so a
   *  bulldozed origin does not ghost-decrement a fresh unit built on the
   *  same floor after. See `arch-person-meal-round-trips-2026-07-09` §1-2. */
  outForMeal?: number;
  /** Household size of a sold condo — the number of people who actually LIVE
   *  here, set once when the condo sells. Undefined ⇒ the kind's flat population
   *  (the 1994 default of 3), so Classic towers and every pre-variant save read
   *  identically. Only Modern towers populate it (a 2–5 person family). For any
   *  POPULATION / OCCUPANCY count, read it via {@link residentCount} (which falls
   *  back to the flat catalog value) rather than the raw field; the rule-set's
   *  pricing/churn and the Households readout read it directly on purpose. */
  residents?: number;
  /** "Taken" marker whose lifecycle differs by kind:
   *  - **Offices & condos** — the CURRENTLY-leased/sold predicate: set on move-in
   *    or sale, and CLEARED again on vacate or gut (and, on load, for any
   *    empty/construction/gutted shell), so the unit returns to the market — a
   *    re-let office, or a bought-back condo that can re-sell. It gates the
   *    one-time condo sale income, blocks repricing a sold condo, exempts a sold
   *    condo from overhead, and drives the owner buy-back on eviction.
   *  - **Hotels** — set on the first check-in and never cleared (nightly turnover
   *    runs through `state`: asleep → dirty → empty), so for a hotel room it reads
   *    as "has ever been booked", not "booked right now".
   *  Either way it is NOT a live-occupancy signal — who is present right now is
   *  `state` / {@link isTenanted} / {@link isPresent}, never this. */
  everOccupied: boolean;
  /** Accumulated income not yet collected (offices/condos). */
  pendingIncome: number;
  /** Player-set price for this unit — office quarterly rent, hotel nightly
   *  rate, or condo sale price. Undefined falls back to the kind's default. */
  rent?: number;
  /** A unit deliberately off the rental market, charging nothing (SimTower's
   *  "No Rate", rent class 4). `undefined`/`false` = on market at `rent`/default.
   *  Routed through `rentOf`, so a No-Rate unit yields $0 for every income site
   *  (office rent, hotel checkout, condo sale, condo hold-tax). Any explicit
   *  reprice clears it, returning the unit to the market. */
  noRate?: boolean;
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
  /** Canon retail variant name for shop / fastFood / restaurant only (per
   *  `docs/canon/tdt-format.md` §7 lists). `undefined` on every other kind,
   *  and on legacy retail units from saves that predate this field, so they
   *  keep the generic name. Cosmetic-only: the economy never reads it. */
  subtype?: string;
  /** Retail-only running totals for today's inspector card: customer estimate
   *  and gross traffic income earned so far this day. Reset in `Simulation.onDay`
   *  after being rolled into `*Yest`, and by `EventSystem.gut`. `undefined` on
   *  every non-retail kind, and on legacy retail units from saves that predate
   *  the field. Display-only: the money loop never reads them back. */
  patronageToday?: number;
  patronageYest?: number;
  profitToday?: number;
  profitYest?: number;
  /** Game-clock minute at which construction finishes (for the build phase). */
  completeAt?: number;
  /** Hotel-only: consecutive DAYS `dirty` (counted at checkout); at `INFEST_DAYS`
   *  it escalates to `infested`. Absent = 0; persisted so a reload can't reset it. */
  dirtyDays?: number;
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
  /** Optional per-shaft manual schedule (elevator-scheduling, #305); absent means today's automatic dispatch. Type and helpers live in the `elevatorSchedule` leaf. */
  schedule?: ElevatorSchedule;
}

/**
 * A unit as it appears in a save. Since save v3 the writer omits fields whose
 * value equals the loader's fallback (see `serializeUnit` in Simulation.ts, which
 * mirrors the `deserialize` coercion table): `state` "empty", `satisfaction` 1,
 * `occupants` 0, `everOccupied` false, `pendingIncome` 0, `label` at the catalog
 * name, and `width` for width-1 floor/lobby tiles only. Every reader must treat
 * these as optional; `Simulation.deserialize` restores the defaults. Older saves
 * (v1/v2) always carry the full shape.
 */
export interface SerializedUnit extends Omit<Unit, "width" | "state" | "satisfaction" | "occupants" | "everOccupied" | "pendingIncome" | "label"> {
  width?: number;
  state?: UnitState;
  satisfaction?: number;
  occupants?: number;
  everOccupied?: boolean;
  pendingIncome?: number;
  label?: string;
}

/** One bulletin-log line. Lives here (not in Simulation.ts) because the save
 *  schema below carries a log tail; Simulation re-exports it for the UI. */
export interface LogEntry {
  minute: number;
  text: string;
  kind: "info" | "good" | "bad" | "money";
}

/** Camera zoom bounds (screen pixels per world pixel). Owned here because the
 *  save schema clamps a restored zoom at the deserialize trust boundary; the
 *  renderer re-exports these as its own MIN_ZOOM/MAX_ZOOM so the range exists
 *  in exactly one place.
 *
 *  `VIEW_ZOOM_MIN` is the absolute HARD floor: low enough that the tallest legal
 *  tower fits even a small phone held in LANDSCAPE (the manifest allows any
 *  orientation, so a short viewport must still frame the whole tower). The span
 *  that has to fit is the 110 buildable floors (basement B10 up to floor 100)
 *  plus `fitZoom`'s own 6-floor sky headroom (FIT_SKY_FLOORS), i.e. 116 floors
 *  (this is the renderer's fit-span, not clampCameraY's dirt-margin math): ~116
 *  floors x 44px x 0.06 is about 306px, under any real device height. It is not
 *  the everyday
 *  zoom-out limit a player feels; the renderer layers a tower-aware fit floor on
 *  top of it (see `fitZoom` in render/cameraBounds), so pinch/wheel/keyboard
 *  zoom-out stops when the whole tower plus a breath of sky is in frame rather
 *  than drifting into empty void. This constant only guards the trust boundary
 *  (a forged or foreign save's zoom) and backstops the dynamic floor. */
export const VIEW_ZOOM_MIN = 0.06;
export const VIEW_ZOOM_MAX = 3;

/**
 * The camera view carried inside a save: the camera CENTER in grid units
 * (tile across, floor up; fractional values are fine) plus the zoom. Inert
 * UI cargo: the simulation never reads it; it only rides along so a save
 * opened on another device restores the same view. Zoom is optional because
 * the 1994 TDT format has no zoom to bring over.
 */
export interface SerializedView {
  tile: number;
  floor: number;
  zoom?: number;
}

// The save-file wire format lives in serializedGame.ts (this file hit the
// size ceiling); the re-export keeps "./types" the single doorway for it.
export type { SerializedGame } from "./serializedGame";

/** Result of attempting to place a facility. */
export interface PlaceResult {
  ok: boolean;
  reason?: string;
  unitId?: number;
  transportId?: number;
}
