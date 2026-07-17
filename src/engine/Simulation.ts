import { Clock } from "./Clock";
import { resolveCalendar, type CalendarKind } from "./calendar";
import { Crowd } from "./Crowd";
import { EconomySystem } from "./EconomySystem";
import { ECON } from "./econConfig";
import { ElevatorDispatch } from "./ElevatorDispatch";
import { makeRules, type GameRules } from "./gameRules";
import { EventSystem } from "./EventSystem";
import type { SimContext } from "./SimContext";
import { Tower } from "./Tower";
import { Ledger, type LedgerCat } from "./Ledger";
import { RNG } from "./rng";

export { ECON } from "./econConfig";

import type { FacilityKind, GameMode, SerializedGame, SerializedView, Unit, VacateReason, WeatherKind } from "./types";
import type { LogEntry } from "./types";

// The save-version constant + migration seam are extracted to ./saveMigration.
import { SAVE_VERSION } from "./saveMigration";
export { SAVE_VERSION };
import * as loop from "./sim/loop";
import * as serialization from "./sim/serialization";
import * as rent from "./sim/rent";
import * as satisfaction from "./sim/satisfaction";
import * as gripe from "./sim/gripe";
import * as churn from "./sim/churn";
import * as congestion from "./sim/congestion";
import * as build from "./sim/build";
import * as star from "./sim/star";
import * as services from "./sim/services";
import * as events from "./sim/events";
import * as demand from "./sim/demand";
import type { DemandMap } from "./sim/demand";
import * as stats from "./sim/stats";

import type { HeatmapMode, HeatCell, BatchTarget, BatchRentOptions, BatchRentResult } from "./sim/constants";
export type { LogEntry } from "./types";
export {
  VACATE_RESCIND,
  TRANSPORT_FAR_TILES,
  GRIPE_WARN,
  LOG_SAVE_CAP,
  CONGESTION_CHURN,
  CONGESTION_GRIDLOCK,
  congestionSeverity,
} from "./sim/constants";
export type {
  HeatmapMode,
  HeatCell,
  BatchTarget,
  BatchRentOptions,
  BatchRentResult,
} from "./sim/constants";
export { serializeUnit } from "./sim/coerce";

export class Simulation implements SimContext {
  tower = new Tower();
  clock = new Clock();
  rng: RNG;
  money: number = ECON.startingMoney;
  /** Rolling per-category income/expense record for the stats breakdown. */
  ledger = new Ledger();
  /** 1..5 stars, 6 == TOWER. */
  star = 1;
  evaluatedTower = false;
  /**
   * Where the player was looking when the save was written: inert UI cargo
   * (see {@link SerializedView}). The engine NEVER reads it: the UI layer
   * stamps it right before a save/export and the renderer restores it after a
   * load. Null for fresh towers and pre-view saves (the renderer then centers
   * as it always has).
   */
  view: SerializedView | null = null;

  /**
   * Rule-set this tower was founded under, {@link GameMode}. Set once at
   * construction and never reassigned (the field is `readonly`), so the whole
   * engine can branch on it without ever guarding against a mid-game flip. Old
   * saves with no persisted mode deserialize as `classic`, so their condos stay
   * flat 3s and the population census is unchanged. The UI stamps the player's
   * choice at tower creation. This is the persisted IDENTITY; the BEHAVIOR that
   * hangs off it lives in {@link rules}.
   */
  readonly mode: GameMode;

  /**
   * A Modern tower's calendar choice, made at New Tower and persisted. Only
   * meaningful for Modern (Classic ALWAYS runs the canon calendar); a Classic
   * tower stores the harmless default. The resolved model lives on
   * {@link clock}.calendar (see `resolveCalendar`); read the calendar there, not
   * this raw choice. Old saves without the field coerce to `realWorld`, so a
   * legacy Modern tower keeps the shipped 7/90/360 behavior.
   */
  readonly modernCalendar: CalendarKind;

  /**
   * The mode's behavior, resolved once from {@link mode}. Every place Classic and
   * Modern diverge routes through this ({@link GameRules}), the engine calls
   * `this.rules.<x>()` and never re-tests the mode string, so mode-specific logic
   * stays in one strategy object instead of smeared across the codebase.
   */
  readonly rules: GameRules;

  /**
   * Simulation model selector (Phase 2, review F4). `v1` is the shipped behavior:
   * a single `tick(dt)` samples the clock once, firing `onHour`/`onDay` at most
   * once per call and handing the full `dt` to every integrator. `v2` decomposes
   * each `tick(dt)` into ≤30-minute sub-steps aligned to hour boundaries, so the
   * headless engine integrates exactly like the browser (which pre-chunks). Kept
   * behind a flag so the suite could grow incrementally; now that the spatial
   * model is in, **v2 is the default** (the real, browser-matching game). v1 is
   * retained for the handful of tests that pin the old sampled/global behavior.
   */
  simModel: "v1" | "v2" = "v2";

  /** Number of times {@link onHour} has run this session (test/diagnostic hook). */
  onHourRuns = 0;
  get hourTicks(): number { return loop.hourTicks(this); }
  /** The bulletin log ring (capped at LOG_RING_CAP by {@link emit}). Its
   *  trailing LOG_SAVE_CAP entries ride every save so a loaded tower keeps
   *  its message history; see serialize/deserialize. */
  log: LogEntry[] = [];
  /** Monotonic count of {@link emit} calls this session, the UI's "new entries"
   *  cursor (see emit). NOT `log.length`, which the capped shift pins once the
   *  ring is full. Transient/not serialized (unlike the log tail): it resets
   *  to 0 on load, and the UI rebases its cursor on adopt (resetLog), so a
   *  restored log repopulates the panel without replaying any toast. */
  logSeq = 0;

  /**
   * Individually-routed commuters. The engine owns and advances them as part of
   * the deterministic tick (the renderer only reads {@link Crowd.people} to draw
   * them), so their stress feeds satisfaction identically in headless runs.
   */
  readonly crowd: Crowd;

  get crowdStress(): number { return congestion.crowdStress(this); }

  /** Demand-driven elevator dispatch (owns its own waiting/dwell state). */
  elevators = new ElevatorDispatch();
  /** Fire / bomb-threat emergencies (owns the set of burning units). */
  events: EventSystem;
  /** Rent, traffic income, hotel revenue, housekeeping and maintenance. */
  economy: EconomySystem;

  /** Cosmetic sky weather for the day (read by the renderer). Derived purely
   * from the day number, so it never perturbs the gameplay RNG. */
  weather: WeatherKind = "clear";

  /** Cosmetic event-visual signals the renderer polls (see {@link triggerSanta}
   * / {@link triggerExplosion}). Purely visual and transient, bumped when the
   * event fires, never serialized, and with zero effect on gameplay/RNG/save. */
  santaFxSeq = 0;
  explosionFx: { floor: number; x: number; seq: number } = { floor: 0, x: 0, seq: 0 };
  thiefFx: { caught: boolean; floor: number; seq: number } = { caught: false, floor: 1, seq: 0 };
  treasureFx: { floor: number; x: number; seq: number } = { floor: 0, x: 0, seq: 0 };
  vipFxSeq = 0;

  /** Ids of units currently under construction (finalised on the global tick). */
  constructing = new Set<number>();

  /** Basement tiles already excavated, so buried treasure is a one-time find per
   * tile and can't be farmed by repeatedly building and bulldozing the same spot. */
  excavated = new Set<string>();
  /** Milestone ids already achieved (announced once); persisted. */
  achievedMilestones = new Set<string>();
  /** Edge-trigger latch for the "stranded floor" log nudge, so it fires once on
   *  a 0→>0 crossing and re-arms only after the tower is fixed. Advisory only,
   *  intentionally not persisted (re-nudges once after load if still stranded). */
  strandedNudged = false;
  /** Edge-trigger latch for the "metro platform cut off" log nudge, so it fires
   *  once when an operational metro has no passenger transport to its platform
   *  and re-arms only when the cut-off condition clears (the platform becomes
   *  served, or the metro stops being operational). Advisory only, intentionally
   *  not persisted (re-nudges once after load if still cut off). */
  metroPlatformNudged = false;

  /** Bookkeeping for period boundaries. */
  lastDay = 0;
  lastQuarter = -1;
  /** Balance entering the current quarter, snapshotted at each quarter rollover
   *  before rent is collected. Feeds the TDT header's `lastQuarterMoney`. Starts
   *  at 0 (no snapshot yet), so a fresh tower that has not crossed a quarter
   *  boundary exports 0 there, matching the real game. */
  lastQuarterMoney = 0;
  lastMonth = -1;
  lastHour = -1;
  /** Move-ins since the last daily summary (offices leased, condos sold, hotel
   *  rooms booked), reported as one quiet log line per day rather than a toast
   *  per tenant, matching SimTower's readout-driven feel. */
  moveInsToday = { offices: 0, condos: 0, rooms: 0 };
  /** Pending VIP inspection day (for the TOWER rating). */
  vipVisitDay = -1;
  /** Whether a VIP has given the tower a favorable suite review (a 4★ gate). */
  vipFavorable = false;
  /** VIP visits the player has been told about: the favorable suite stay, each
   * unfavorable visit that produced a bulletin (at most one per 5-day nag
   * window; the suppressed nightly retries in between are not counted), and
   * every TOWER inspection. A recognition stat for the stats dialog, so the
   * count matches the bulletin events rather than inflating silently each day. */
  vipVisits = 0;
  /** Day of the last "VIP underwhelming" nag, so it can't spam the log daily. */
  lastVipNagDay = -100;
  /** Buried-treasure finds so far. Capped so a basement dug full of cheap parking
   * can't be farmed into tens of millions (the find stays a bounded windfall). */
  treasuresFound = 0;
  /** Modern only: the day a booked exterminator's treatment lands (persisted),
   *  and the infested room ids it was billed for (transient; a mid-booking save
   *  loses them and resolution then clears every infested room instead). */
  exterminationDueDay?: number;
  exterminationRoomIds?: number[];

  constructor(seed = 12345, mode: GameMode = "classic", modernCalendar: CalendarKind = "realWorld") {
    this.rng = new RNG(seed);
    this.mode = mode;
    this.rules = makeRules(mode);
    // Hand the tower the same strategy object, so mode-dependent placement
    // checks (the Classic-only escalator/office rule) agree with the sim.
    this.tower.rules = this.rules;
    // Classic ALWAYS runs canon, so the modernCalendar field is meaningless
    // for it. Clamp the persisted value to the harmless default so a
    // hand-edited or UI-drifted "canon" hint can never survive on disk in a
    // Classic save and quietly contradict the "Classic stores the harmless
    // default" contract. Modern honors the player's choice as passed.
    this.modernCalendar = mode === "classic" ? "realWorld" : modernCalendar;
    // Resolve the calendar once and hand it to the clock (Classic = canon,
    // Modern = the player's choice). The field-initialized real-world clock is
    // replaced here before any tick reads a date.
    this.clock = new Clock(0, resolveCalendar(mode, this.modernCalendar));
    this.crowd = new Crowd(seed);
    this.events = new EventSystem(this, seed);
    this.economy = new EconomySystem(this);
    this.weather = Simulation.weatherFor(this.clock.day);
  }

  static weatherFor(day: number): WeatherKind { return build.weatherFor(day); }

  // ---- Logging -----------------------------------------------------------

  emit(text: string, kind: LogEntry["kind"] = "info"): void { stats.emit(this, text, kind); }

  // ---- Build / sell ------------------------------------------------------

  isUnlocked(kind: FacilityKind): boolean { return build.isUnlocked(this, kind); }

  isRoomKind(kind: FacilityKind): boolean { return build.isRoomKind(this, kind); }

  canBuild(kind: FacilityKind, floor: number, x: number): { ok: boolean; reason?: string; cost: number } { return build.canBuild(this, kind, floor, x); }

  build(kind: FacilityKind, floor: number, x: number): { ok: boolean; reason?: string } { return build.build(this, kind, floor, x); }

  buildTransport( kind: FacilityKind, x: number, bottom: number, top: number, ): { ok: boolean; reason?: string } { return build.buildTransport(this, kind, x, bottom, top); }

  sellAt(floor: number, x: number): boolean { return build.sellAt(this, floor, x); }

  // ---- Main tick ---------------------------------------------------------

  tick(dtMinutes: number): void { loop.tick(this, dtMinutes); }

  advanceStep(dtMinutes: number): void { loop.advanceStep(this, dtMinutes); }

  finishConstruction(): void { loop.finishConstruction(this); }

  onHour(): void { loop.onHour(this); }

  /** Per-shaft utilization EMA (0..1), keyed by transport id, how full each
   *  passenger elevator's cars run on average. Sampled hourly off the hot path;
   *  transient (warms up after load, not serialized). */
  elevatorUtil = new Map<number, number>();

  /** Lazy noise-adjacency memo by unit id, valid for exactly one
   *  tower.revision (strict equality; -1 forces the first fill). Noise is a
   *  pure function of layout and every layout mutation bumps revision, so a
   *  hit is exact; unit STATE (fire, gut, occupancy) is deliberately not an
   *  input, see the functionalParkingSet precedent in tower/routing.ts.
   *  Transient like elevatorUtil: never serialized, and load/undo build a
   *  fresh Simulation, so no stale memo can survive a restore. */
  noiseMemo = new Map<number, boolean>();
  noiseMemoRev = -1;

  /** Lazy commercial-demand-map memo, valid for one `(tower.revision, hour)`
   *  key. Transient like {@link noiseMemo}: never serialized, and load/undo build
   *  a fresh Simulation, so no stale memo survives a restore. */
  demandMemo: DemandMap | null = null;
  demandMemoKey = "";

  /** The per-venue commercial demand fractions and per-origin venue coverage for
   *  the current census and layout (memoized). The hourly income loop computes
   *  the map directly; this accessor serves the inspector's per-hover reads. */
  demandMap(): DemandMap { return demand.demandMap(this); }

  sampleElevatorUtil(): void { congestion.sampleElevatorUtil(this); }

  elevatorUtilization(id: number): number | undefined { return congestion.elevatorUtilization(this, id); }

  floorHeatmap(mode: HeatmapMode): HeatCell[] { return congestion.floorHeatmap(this, mode); }

  elevatorStats(): { id: number; kind: FacilityKind; bottom: number; top: number; cars: number; capacity: number; utilization: number }[] { return congestion.elevatorStats(this); }

  onDay(): void { loop.onDay(this); }

  rollOverRetailDay(): void { satisfaction.rollOverRetailDay(this); }

  /** Edge-triggered log bulletins (same latch pattern as {@link nudgeStranded})
   *  for the two demand-scaled services: recycling capacity and suite parking.
   *  Each fires once when its shortfall first appears and re-arms only after the
   *  shortfall clears, so a tower that outgrows its centers again gets told
   *  again. Evaluated once per day (called from {@link onDay}), not day-latched. */
  wasteNudged = false;
  suiteParkingNudged = false;
  nudgeServiceShortfalls(): void { services.nudgeServiceShortfalls(this); }

  nudgeStranded(): void { services.nudgeStranded(this); }

  nudgeMetroPlatform(): void { services.nudgeMetroPlatform(this); }

  checkMilestones(): void { star.checkMilestones(this); }

  milestoneProgress(): { achieved: number; total: number; list: { label: string; desc: string; done: boolean }[] } { return star.milestoneProgress(this); }

  /** Requirements for the next star (population + facility gates), for the
   *  stats "Next star" checklist. Null once the tower is a TOWER. */
  nextStarRequirements(): star.NextStarProgress | null { return star.nextStarRequirements(this); }

  reportMoveIns(): void { churn.reportMoveIns(this); }

  // ---- Presence (who is physically in each unit right now) ---------------

  updatePresence(): void { satisfaction.updatePresence(this); }

  // ---- Satisfaction & churn ---------------------------------------------

  updateSatisfaction(): void { satisfaction.updateSatisfaction(this); }

  emitNotices(notices: { floor: number; kind: FacilityKind; reason: VacateReason }[]): void { satisfaction.emitNotices(this, notices); }

  vacateCause(u: Unit, served: boolean, cong: number, farWalk?: boolean, noisy?: boolean, lobbyFar?: boolean, unmetDemand?: boolean): VacateReason { return gripe.vacateCause(this, u, served, cong, farWalk, noisy, lobbyFar, unmetDemand); }

  /** The dominant active satisfaction drain on a tenant right now (or null when
   *  content), for the inspector's pre-notice "Main gripe" line. */
  dominantGripe(u: Unit): VacateReason | null { return gripe.dominantGripe(this, u); }

  nearestKindWithin( u: Unit, isSource: (kind: FacilityKind) => boolean, maxTiles: number, ): boolean { return satisfaction.nearestKindWithin(this, u, isSource, maxTiles); }

  noiseAfflicted(u: Unit): boolean { return satisfaction.noiseAfflicted(this, u); }

  congestion(): number { return congestion.congestion(this); }

  rushFactor(): number { return congestion.rushFactor(this); }

  transportCapacity(t: { kind: FacilityKind; cars: number }): number { return congestion.transportCapacity(this, t); }

  congestionAt(floor: number): number { return congestion.congestionAt(this, floor); }

  peakCongestionHotspot(): { ratio: number; floor: number | null } { return congestion.peakCongestionHotspot(this); }

  peakCongestion(): number { return congestion.peakCongestion(this); }

  peakCongestionFloor(): number | null { return congestion.peakCongestionFloor(this); }

  spatialCongestionByFloor(): Map<number, number> { return congestion.spatialCongestionByFloor(this); }

  rollRetailSubtype(kind: FacilityKind): string | undefined { return churn.rollRetailSubtype(this, kind); }

  rerollSubtype(id: number): string | undefined { return churn.rerollSubtype(this, id); }

  rollCondoRelocations(): void { churn.rollCondoRelocations(this); }

  vacate(u: Unit, reason: VacateReason): void { churn.vacate(this, u, reason); }

  // ---- Move-ins ----------------------------------------------------------

  // ---- Waste management & parking demand ----------------------------------

  recyclingCenters(): number { return services.recyclingCenters(this); }

  recyclingCapacity(): number { return services.recyclingCapacity(this); }

  recyclingDemandMet(): boolean { return services.recyclingDemandMet(this); }

  recyclingFill(): number { return services.recyclingFill(this); }

  parkingDemand(): { officePop: number; offices: number; suites: number; total: number } { return services.parkingDemand(this); }

  suiteParkingShort(): boolean { return services.suiteParkingShort(this); }

  officeParkingShort(): boolean { return services.officeParkingShort(this); }

  parkingUsage(spots: number = this.tower.functionalParkingSpots()): number { return services.parkingUsage(this, spots); }

  // Housekeeping coverage + the Modern paid exterminator (see sim/services.ts).
  housekeepingCoverage(): services.HousekeepingCoverage { return services.housekeepingCoverage(this); }
  callExterminator(): services.ExterminatorResult { return services.callExterminator(this); }
  resolveExtermination(): void { services.resolveExtermination(this); }

  attemptMoveIns(): void { churn.attemptMoveIns(this); }

  demandFactor(u: Unit): number { return rent.demandFactor(this, u); }

  priceUnit(u: Unit, target: number): number | null { return rent.priceUnit(this, u, target); }

  setNoRate(id: number): boolean { return rent.setNoRate(this, id); }

  adjustRent(id: number, dir: 1 | -1): number | null { return rent.adjustRent(this, id, dir); }

  previewRentBatch(kind: FacilityKind, target: BatchTarget, opts: BatchRentOptions = {}): BatchRentResult | null { return rent.previewRentBatch(this, kind, target, opts); }
  applyRentBatch(kind: FacilityKind, target: BatchTarget, opts: BatchRentOptions = {}): BatchRentResult | null { return rent.applyRentBatch(this, kind, target, opts); }

  computeBatch( kind: FacilityKind, target: BatchTarget, opts: BatchRentOptions, mutate: boolean, ): BatchRentResult | null { return rent.computeBatch(this, kind, target, opts, mutate); }

  setFilmPolicy(id: number, policy: "auto" | "feature" | "blockbuster"): "auto" | "feature" | "blockbuster" | null { return events.setFilmPolicy(this, id, policy); }

  isShowingBlockbuster(id: number): boolean { return events.isShowingBlockbuster(this, id); }

  moveIn(u: Unit): void { churn.moveIn(this, u); }

  companyName(): string { return churn.companyName(this); }

  // ---- Income (delegated to EconomySystem) -------------------------------

  dirtyRooms(): number { return satisfaction.dirtyRooms(this); }

  // ---- Star rating -------------------------------------------------------

  evaluateStar(): void { star.evaluateStar(this); }

  ratingPopulation(): number { return star.ratingPopulation(this); }

  occupantPopulation(): number { return star.occupantPopulation(this); }

  hasAny(kind: FacilityKind): boolean { return star.hasAny(this, kind); }

  spawnStaffTrip(from: number, to: number, destX: number, cleanUnitId: number, cleanMinutes: number): "sent" | "full" | "no-route" { return services.spawnStaffTrip(this, from, to, destX, cleanUnitId, cleanMinutes); }

  hotelsCountTowardRating(): boolean { return star.hotelsCountTowardRating(this); }

  floorReachable(floor: number): boolean { return services.floorReachable(this, floor); }

  strandedFloors(scope: "leased" | "rentable" = "leased"): number[] { return services.strandedFloors(this, scope); }

  isStrandedCandidate(u: Unit, scope: "leased" | "rentable"): boolean { return services.isStrandedCandidate(this, u, scope); }

  hasOperational(kind: FacilityKind): boolean { return services.hasOperational(this, kind); }

  countOperational(kind: FacilityKind): number { return services.countOperational(this, kind); }

  maybeVipStay(): void { events.maybeVipStay(this); }

  // ---- VIP / TOWER rating ------------------------------------------------

  checkVip(): void { events.checkVip(this); }

  // ---- Random events (delegated to EventSystem) --------------------------

  get fires(): number { return events.fires(this); }

  floorLabel(floor: number): string { return events.floorLabel(this, floor); }

  startFire(): void { events.startFire(this); }

  bombThreat(): void { events.bombThreat(this); }

  triggerSanta(): void { events.triggerSanta(this); }
  triggerExplosion(floor: number, xTile: number): void { events.triggerExplosion(this, floor, xTile); }
  triggerThief(caught: boolean, floor: number): void { events.triggerThief(this, caught, floor); }
  triggerTreasure(floor: number, xTile: number): void { events.triggerTreasure(this, floor, xTile); }
  triggerVip(): void { events.triggerVip(this); }

  get pendingChoice(): { kind: "fireRescue" | "bombThreat"; cost: number; message: string } | null { return events.pendingChoice(this); }

  resolveChoice(option: "accept" | "decline"): void { events.resolveChoice(this, option); }

  fireContainmentChance(floor: number): number { return events.fireContainmentChance(this, floor); }

  fireIgnitionChance(): number { return events.fireIgnitionChance(this); }

  // ---- Derived stats for UI ---------------------------------------------

  recordMoney(cat: LedgerCat, amount: number): void { stats.recordMoney(this, cat, amount); }

  recordMoneyFor(kind: FacilityKind, amount: number): void { stats.recordMoneyFor(this, kind, amount); }

  incomeBreakdown(): { averages: Record<LedgerCat, number>; hasData: boolean } { return stats.incomeBreakdown(this); }

  get population(): number { return star.population(this); }

  get nextStarThreshold(): number | null { return star.nextStarThreshold(this); }

  stats() { return stats.stats(this); }

  // ---- Serialization -----------------------------------------------------

  serialize(): SerializedGame { return serialization.serialize(this); }

  static deserialize(raw: SerializedGame): Simulation { return serialization.deserialize(raw); }

  static newGame(seed = 12345, mode: GameMode = "classic", modernCalendar: CalendarKind = "realWorld"): Simulation { return serialization.newGame(seed, mode, modernCalendar); }
}
