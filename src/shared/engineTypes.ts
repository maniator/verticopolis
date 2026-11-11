/**
 * Plain data types the frontend, the WASM host and the TypeScript reference
 * engine share: schedules, the crowd's person shape and queue view, the
 * pricing ladder, ledger and heatmap categories. They carry no behavior, so
 * they live outside `src/engine/`, which is due for deletion (#1875); the
 * engine modules that once declared them re-export them from here.
 */

// Elevator schedules and the demand history the schedule dialog reads.

/**
 * A per-shaft manual elevator schedule (elevator-scheduling, #305). Every field
 * is optional so a sparse save stores only what the player set; an absent field
 * falls back to today's automatic behavior. Authored state, read deterministically
 * (no RNG). Shared by the engine, the TDT codec and the
 * schedule dialog; `types.ts` imports it for the `Transport.schedule` field.
 * See `_bmad-output/planning-artifacts/design/arch-elevator-scheduling-2026-07-16.md`.
 */
export interface ElevatorSchedule {
  /** Cars running each of the 24 hours, per day type. Each present row is a
   *  length-24 array; entry `h` is clamped to `[0, cars]` on read. An absent row
   *  (or hour) means "all cars run". */
  activeCars?: { weekday?: number[]; weekend?: number[] };
  /** Waiting Car Response: how many floors closer to a call an idle car must be
   *  than the assigned car before it answers. Absent = the dispatcher default. */
  waitingCarResponse?: number;
  /** Standard Floor Departure: seconds a car holds at a served floor before it
   *  departs. Absent = the global dwell default. */
  standardFloorDeparture?: number;
  /** Per-car home/waiting floor; index `i` is car `i`. An absent or short entry
   *  falls back to the derived lowest-lobby idle floor. */
  homeFloors?: number[];
}

/**
 * A shaft's measured hourly demand, split by day type (#466): one 24-slot ring
 * per day of EMA'd load fractions (0..1), so weekend samples never blend into
 * the weekday curve. A slot of 0 means "no positive sample yet": a genuinely
 * zero-load hour also reads 0, so consumers cannot tell the two apart (the
 * conflation is tracked as #474). Transient (never serialized): a fresh load
 * reads empty, never a fabricated curve.
 */
export interface HourlyByDay {
  weekday: number[];
  weekend: number[];
}

// Boarding origins per shaft.

/** One shaft's boarding-origin history: per day type, per hour-of-day, an
 *  origin-floor map of EMA'd boarding counts. Transient, like {@link HourlyByDay}. */
export interface OriginRings {
  weekday: Map<number, number>[];
  weekend: Map<number, number>[];
}

// Calendars.

/** A calendar identity. Also the value persisted for a Modern tower's choice. */
export type CalendarKind = "canon" | "realWorld";

// Ledger report categories.

export type LedgerCat =
  | "offices"
  | "condos"
  | "hotels"
  | "retail"
  | "food"
  | "entertainment"
  | "upkeep";

// The heatmap and batch pricing.

/** The metric the colored stats overlay tints floors by. */
export type HeatmapMode = "congestion" | "occupancy" | "satisfaction" | "cleanliness";

/** One tinted rectangle in the stats overlay: a column span on a floor and how
 *  bad it reads (0 = green/good … 1 = red/bad). Congestion and occupancy emit
 *  one cell per floor (they're floor-level metrics); satisfaction emits one cell
 *  per present tenant unit so a single unhappy suite reddens on its own instead
 *  of being averaged away by content neighbors sharing the floor.
 *
 *  `tint` is an optional SEMANTIC category for cells whose meaning the plain
 *  good-to-bad ramp cannot carry (the engine names the state; the renderer
 *  picks the pixels): `infested` marks a hotel room housekeeping can no longer
 *  clean (terminal, distinct from "unreached"), `na` marks a unit the overlay's
 *  metric does not apply to (a condo on the housekeeping map), so a blank never
 *  reads as an uncovered room. Cells without a tint read the severity ramp.
 *  Numeric consumers aggregating `severity` must SKIP `na` cells (their 0
 *  means "not applicable", never "perfectly covered"); `infested` cells keep
 *  an honest hot severity for anything reading the number alone. */
export interface HeatCell {
  floor: number;
  minX: number;
  maxX: number;
  severity: number;
  tint?: "infested" | "na";
}

/** Batch-pricing target: an exact price, "default" to return to the neutral
 *  anchor (band default / Classic Average rung), or "noRate" to take the kind
 *  off the market (ladder modes only; Modern never holds the No Rate state). */
export type BatchTarget = number | "default" | "noRate";

export interface BatchRentOptions {
  /** Only touch units still on the default price (skip hand-tuned ones). */
  onlyDefaultPriced?: boolean;
}

export interface BatchRentResult {
  matched: number; // priced units of this kind (incl. sold condos)
  eligible: number; // matched − skippedSold − skippedCustom
  changed: number; // units whose effective price actually differs after the write
  skippedSold: number; // condo && everOccupied
  skippedCustom: number; // had a custom price and onlyDefaultPriced was set (left alone)
  customOverwritten: number; // eligible custom-priced units being replaced (protect toggle off)
  clampedLow: number; // eligible units whose target was below the band minimum
  clampedHigh: number; // eligible units whose target was above the band maximum
}

// The pricing ladder and band.

/** One rung of the Classic 4-level rent ladder. `level` doubles as the 1994
 *  TDT rent-class byte (0 Very Low … 3 High; byte 4 is the No Rate sentinel,
 *  carried by the ladder shape itself, not a fifth rung). */
export interface PriceRung {
  readonly level: 0 | 1 | 2 | 3;
  readonly label: "Very Low" | "Low" | "Average" | "High";
  readonly value: number;
}

/**
 * What a mode offers the player for pricing a rentable kind. The consumers
 * (editor, batch dialog, price choke point) switch on the SHAPE of this value,
 * never on the mode string, per the rule-set law above:
 *   - `ladder`: the Classic discrete 4-rung dropdown plus the No Rate
 *     off-market sentinel (`noRate: true` says the mode offers that state);
 *   - `band`: Modern's continuous `{min, default, max, step}` range,
 *     driving the existing stepper/range editors.
 * Both shapes are frozen module-level singletons, so reading them on a
 * per-unit path allocates nothing.
 */
export type PriceOptions =
  | { readonly shape: "ladder"; readonly rungs: readonly PriceRung[]; readonly noRate: true }
  | {
      readonly shape: "band";
      readonly band: { readonly default: number; readonly min: number; readonly max: number; readonly step: number };
    };

// The crowd: a person and the elevator queue view.

export type PersonState = "toShaft" | "waiting" | "riding" | "climbing" | "toDest" | "dwelling" | "done";

export interface Person {
  id: number;
  seed: number;
  state: PersonState;
  /** Discrete current floor (where they're standing / boarding). */
  floor: number;
  /** Continuous floor for rendering while riding a car. */
  fy: number;
  /** Continuous tile x. */
  x: number;
  /** Per-leg transport route: floors[0]=origin … floors[n]=destination. */
  floors: number[];
  /** Immutable origin floor stamped at spawn. `floors[0]` is rewritten for a
   *  round-tripper's return leg (it becomes the venue floor), so the commute-
   *  stress accumulator (#514) keys on THIS instead, keeping a round-trip's wait
   *  attributed to the tenant's true origin rather than the venue they visited. */
  originFloor: number;
  /** shaft id used for leg i (floors[i] → floors[i+1]); always a valid id. An
   *  unreachable destination yields no route at all (routing returns null), so
   *  this array never holds a sentinel. */
  shafts: number[];
  leg: number;
  shaftId: number | null;
  carIndex: number | null;
  /** Tile x to stroll to on the destination floor (within built structure). */
  destX: number;
  /** Seconds spent waiting on the current call (drives stress). */
  wait: number;
  /** Cumulative landing-wait seconds across this whole trip (every leg). Unlike
   *  {@link wait}, which is per-call and zeroed on boarding, this sums each
   *  served call's wait so a multi-transfer commute contributes the wait of
   *  every leg, not just the last. Folded into the per-origin commute-stress
   *  accumulator at {@link finish} (read-only measurement, #514); in-memory
   *  only, like every Person field. */
  tripWait: number;
  /** Total seconds in transit (origin → destination), for the give-up valve. */
  age: number;
  /** Idle timer once arrived, before despawning. */
  linger: number;
  /** True for tower staff (housekeepers): they route over the STAFF network
   *  (service elevators / stairs), never count toward tenant stress, and
   *  render in a work uniform. */
  staff?: boolean;
  /** Unit id this staffer is dispatched to service (a dirty hotel room). */
  cleanUnitId?: number;
  /** Unit id of the meal venue chosen at spawn for a round-trip meal person;
   *  `destX` points inside this unit's footprint. Distinct from `venueUnitId`:
   *  this records the intent (set on spawn), while `venueUnitId` records the
   *  census count actually taken (set on dwell entry), so a give-up before
   *  arrival never decrements a count that was never incremented. */
  mealVenueId?: number;
  /** Unit id of the commercial venue (fastFood / restaurant / shop) where this
   *  person is currently attending. Set when the person enters the
   *  `dwelling` state;
   *  used to decrement `venueUnit.customersIn` when they leave. Undefined for
   *  all non-meal persons and for eaters at non-commercial destinations. */
  venueUnitId?: number;
  /** True when this counted eater came from a HOTEL origin, so finish() also
   *  decrements the venue's `hotelCustomersIn` (the 4-star-plus census
   *  exclusion). Captured at dwell entry, when the origin still exists. */
  countedHotelGuest?: boolean;
  /** Unit id of the ORIGIN room for a round-trip meal person (an office,
   *  condo, or hotel room whose visible occupancy dropped by 1 when this
   *  person spawned outbound). Undefined for lobby-centric commuter trips
   *  and staff dispatches. On return arrival the person decrements
   *  `originUnit.outForMeal`, guarded so a bulldozed origin cannot ghost-
   *  decrement a fresh unit built in the same slot after. */
  originUnitId?: number;
  /** Remaining crowd-seconds in the `dwelling` state (a stationary stay at
   *  the destination floor after the outbound trip's `toDest` completes: a
   *  meal, a showing, a party, a wedding). Only set for round-trippers;
   *  drained in the `advance` loop. */
  dwellSecondsLeft?: number;
  /** True once the outbound arrival has transitioned this person into their
   *  return trip (venue -> origin). Distinguishes the two `toDest` completions
   *  a round-tripper has (outbound arrival triggers the dwell; return arrival
   *  triggers the outForMeal decrement + despawn). */
  returning?: boolean;
  /** Which demographic routine (condo-demographic-routines, #397) spawned this
   *  person: a condo school-run leg or an office sales call. A transient tag
   *  for attribution (tests, future overlays); the waves are purely
   *  statistical, so it names the routine, never an identity, and like every
   *  Person field it is in-memory only (nothing persists who is a child). */
  routine?: "schoolRun" | "salesCall";
  /** Extended arrival linger (crowd-seconds): how long to hold the arrived
   *  pose before despawning. A metro commuter waiting on the platform for
   *  their train. Unset for ordinary trips, which keep the default 2-second
   *  linger; distinct from the venue round-trippers' `dwelling` state and
   *  its `dwellSecondsLeft`. In-memory only, like every Person field. */
  lingerFor?: number;
}

/** One landing's waiting line in an {@link ElevatorQueueView}: how many real
 *  people wait there and a bounded wait-tier (0 content, 1 impatient, 2 fed up),
 *  the max over its waiters. */
export interface QueueLanding {
  count: number;
  tier: 0 | 1 | 2;
}

/**
 * Read-only projection of the waiting crowd and per-car occupancy, sized for
 * the render layer (see `elevatorQueueView`). A VIEW of state the crowd
 * already tracks (the same `waiting` people {@link ElevatorCalls} counts, and
 * each car's drawn occupancy `crowd.carRiders`), so it re-simulates nothing:
 * it surfaces boarding, it does not perform it. Both halves count ONE
 * population, the drawn crowd, so a waiter boarding moves the same figure
 * from a landing into a car. {@link Crowd.queueView} memoizes it once per
 * outer sim step, so a render frame reads it without re-scanning the crowd.
 */
export interface ElevatorQueueView {
  /** Landing queues: shaftId → floor → count and wait-tier. The waiters' stable
   *  order in `crowd.people` is the queue order the render draws; this view
   *  carries the length and tier, not the identities. */
  landings: ReadonlyMap<number, ReadonlyMap<number, QueueLanding>>;
  /** Boarded riders per car: shaftId → carIndex → count, read from
   *  `crowd.carRiders` (the drawn per-car occupancy, the same routed figures
   *  `landings` counts, now aboard). Not the dispatch's statistical `carLoad`. */
  boarded: ReadonlyMap<number, ReadonlyMap<number, number>>;
}

// Star gates.

/** A star gate's stable id: what a panel keys its copy on, and what the Rust
 *  engine's stats report answers (facade slice 6b), so the two engines name
 *  each gate the same way whatever the label says. */
export type StarGateId = "security" | "medical" | "recycling" | "suites" | "vip" | "metro" | "weddingHall";
