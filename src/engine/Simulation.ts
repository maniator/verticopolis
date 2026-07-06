import { Clock } from "./Clock";
import { Crowd, CROWD_SECONDS_PER_MINUTE } from "./Crowd";
import { EconomySystem, HK_SHIFT_START, HK_SHIFT_END } from "./EconomySystem";
import { ECON, rentOf, rentConfig, resaleRefund } from "./econConfig";
import { ElevatorDispatch } from "./ElevatorDispatch";
import { makeRules, householdPrice, type GameRules } from "./gameRules";
import { EventSystem } from "./EventSystem";
import type { SimContext } from "./SimContext";
import { Tower } from "./Tower";
import { Ledger, ledgerCatFor, type LedgerCat } from "./Ledger";
import { RNG } from "./rng";
import { MILESTONES, isTenantFloorUnit } from "./milestones";

export { ECON } from "./econConfig";
import {
  FACILITIES,
  GARBAGE_COLLECT_HOUR,
  GRID,
  PARKING_WORKERS_PER_SPACE,
  RECYCLING_POP_PER_CENTER,
  STAR_THRESHOLDS,
  TOWER_POPULATION,
  buildMinutes,
  facilityFloors,
  isElevatorKind,
  isFacilityKind,
  isStaffOnlyTransport,
  isHotelKind,
  maxCarsFor,
  residentCount,
  transportCarCapacity,
} from "./facilities";
import type { FacilityKind, GameMode, SerializedGame, Unit, VacateReason, WeatherKind } from "./types";
import {
  isDormant,
  isGameMode,
  isOperational,
  isPresent,
  isTenanted,
  isUnitState,
  isVacateReason,
  VACATE_REASON_TEXT,
} from "./types";

/**
 * Current save-format version. `serialize()` always stamps this; `deserialize()`
 * routes every save through {@link migrateSave} first, so the field is read on
 * load — not merely written — and a future format bump has exactly one place to
 * grow.
 */
export const SAVE_VERSION = 1;

/** How long (game minutes) an office/condo tenant stays "on notice" in the
 *  `vacating` state before actually leaving — a grace window the player can use
 *  to fix the cause. Two in-game days. Module-local: only the churn loop reads it. */
const VACATE_NOTICE_MINUTES = 2 * 24 * 60;

/** Satisfaction a vacating tenant must climb back to before they rescind their
 *  notice and stay. Set at 0.40 (not a hair above zero) so a tower that merely
 *  *stabilizes* a unit — nurses it off the floor but never actually makes it a
 *  good place to be — still loses the tenant: "stabilized" ≠ "fixed". A genuine
 *  fix reaches 0.40 in ~8 served hours (recovery is +0.05/hr), well inside the
 *  notice window. Exported because the inspector reads it to show the player the
 *  exact recovery target (the "inform before you hurt them" contract). */
export const VACATE_RESCIND = 0.4;

/** The immediate annoyance ceiling for a hotel/condo sat right beside an office:
 *  moving in next to noise caps satisfaction here at once (canon "office
 *  neighbor is too noisy"). */
const NOISE_CAP = 0.6;

/** Per-hour erosion applied on top of the cap while the office neighbor stays.
 *  It slightly outpaces the +0.05/hr served recovery (net ≈ −0.02/hr), so an
 *  UNADDRESSED noisy neighbor wears the tenant down past the rescind bar and,
 *  eventually, out — a slow, heavily-telegraphed pressure (≈1 day from the cap
 *  to zero, then the 2-day notice), not an instant eviction. Fix it (move the
 *  office or the neighbor) and satisfaction recovers normally. */
const NOISE_EROSION = 0.07;

/** Office-noise erosion for a *sold condo*, gentler than the hotel rate above —
 *  a sold condo is an owner, not a nightly guest, and 1994 condos were "sticky."
 *  A condo owner is annoyed by a noisy neighbor (canon "office neighbor is too
 *  noisy": the unit still reddens on the stats overlay) but only *just* exceeds
 *  the +0.05/hr served recovery, for a shallow net drift of ≈ −0.004/hr: a
 *  *transient* neighbor the player removes within a few days is fully absorbed
 *  and the owner stays, while only *sustained, unaddressed* adjacency wears an
 *  owner down and out — ≈150 game-hours (about a week) from the annoyance cap to
 *  a notice, then the 2-day window: ≈5× the hotel's ≈30-hour fuse. INVARIANT:
 *  keep this strictly above the +0.05/hr served recovery — at or below it the
 *  net drift is non-negative, so a noise-worn condo never reaches the notice
 *  threshold and office noise can never evict an owner at all. Fixing the cause
 *  (move the office or the neighbor) recovers well before. */
const CONDO_NOISE_EROSION = 0.054;

/**
 * The condo sale price BEFORE this build re-anchored the band (old default 2×
 * cost was $120k, now $160k). A pre-mode save's SOLD condo that omitted `rent`
 * sold at this price, so we backfill it on load (see {@link migrateSave}) — the
 * buy-back must mirror what the unit actually sold for, not the new default.
 */
const LEGACY_CONDO_DEFAULT_PRICE = 120_000;

/**
 * The widest condo price band that has ever existed (the pre-re-anchor band was
 * $60k–$240k; the current one is $80k–$200k). A SOLD condo keeps its historical
 * price rather than being re-clamped to the current band — but it's still bounded
 * to this range on load, so a forged/corrupt save can't stamp an absurd `rent`
 * (e.g. $1e9) that the owner buy-back would then reclaim, draining money with no
 * ceiling. Every legitimate sold price (current or legacy) sits inside this range,
 * so nothing real is altered.
 */
const SOLD_CONDO_MIN_PRICE = 60_000;
const SOLD_CONDO_MAX_PRICE = 240_000;

/**
 * Save-format migration seam. Runs before the field-level coercion in
 * {@link Simulation.deserialize}. Beyond normalizing `version`, it backfills the
 * pre-re-anchor condo sale price for legacy saves so an old tower's buy-back
 * still mirrors its historical sale price.
 */
function migrateSave(data: SerializedGame): SerializedGame {
  // A missing/garbled version is normalized so the (future) upgrade chain has a
  // number to branch on; deserialize()'s coercion still hardens every value.
  const version = Number.isFinite(data.version) ? data.version : SAVE_VERSION;
  let migrated: SerializedGame = data.version === version ? data : { ...data, version };
  // A save with no VALID `mode` predates the condo work (or is corrupt) — the same
  // condition under which deserialize() falls back to Classic, so migration must
  // agree (an invalid mode string must be treated as legacy here too, else the
  // save loads Classic yet skips this backfill). A SOLD condo (owned, not an
  // empty/dead shell) that omitted `rent` sold at the OLD default — stamp it so
  // its buy-back mirrors that historical price instead of picking up the new,
  // higher default via rentOf(). Only touch that exact shape; never re-price a
  // condo that already carries a rent, or an unsold/dead one.
  if (!isGameMode(migrated.mode) && Array.isArray(migrated.units)) {
    migrated = {
      ...migrated,
      units: migrated.units.map((u) =>
        u &&
        u.kind === "condo" &&
        u.everOccupied === true &&
        u.rent === undefined &&
        u.state !== "empty" &&
        u.state !== "gutted" &&
        u.state !== "construction"
          ? { ...u, rent: LEGACY_CONDO_DEFAULT_PRICE }
          : u,
      ),
    };
  }
  // Future upgrades chain here in order, each bumping migrated.version, e.g.:
  //   if (migrated.version === 1) migrated = upgradeV1toV2(migrated);
  // A save from a newer build (version > SAVE_VERSION) can't be downgraded, so
  // it loads best-effort — the coercion below guards it — rather than throwing
  // away the player's tower.
  return migrated;
}

/** A single tick advances the crowd by at most this many crowd-seconds so a
 * day-long catch-up step stays bounded (see CROWD_SECONDS_PER_MINUTE, which
 * lives in Crowd.ts so crowd-side constants can be derived from it). */
const CROWD_MAX_STEP = 60;

/** Clamp a target price into its kind's band. */
function clampRent(cfg: { min: number; max: number }, target: number): number {
  return Math.max(cfg.min, Math.min(cfg.max, target));
}

/** Store a clamped price on a unit. The kind default is stored as "no
 *  override" (undefined), so a unit set/nudged back to default never counts
 *  as custom-priced. */
function storeRent(u: Unit, cfg: { default: number }, clamped: number): void {
  u.rent = clamped === cfg.default ? undefined : clamped;
}

export interface LogEntry {
  minute: number;
  text: string;
  kind: "info" | "good" | "bad" | "money";
}

/** The metric the colored stats overlay tints floors by. */
export type HeatmapMode = "congestion" | "occupancy" | "satisfaction";

/** Congestion ratio at which tenants begin leaving (see {@link Simulation.updateSatisfaction},
 *  `cong > 1`) — the overlay paints this AMBER so the color never contradicts the sim. */
export const CONGESTION_CHURN = 1.0;
/** The gridlock boundary of the traffic tiers (`trafficTier` returns gridlock
 *  for congestion strictly above this) — the overlay saturates to RED at and
 *  beyond this ratio, so full red coincides with entering the worst tier. */
export const CONGESTION_GRIDLOCK = 1.6;
/** Severity of the amber ramp stop, kept in sync with the 4-stop `HEAT_STOPS`
 *  palette in the renderer (green 0 · chartreuse ⅓ · amber ⅔ · red 1). Anchoring
 *  churn to this value is what makes "amber = tenants starting to leave" literal. */
const CONGESTION_AMBER_SEVERITY = 2 / 3;

/**
 * Congestion ratio → overlay severity (0 = green/clear … 1 = red/gridlock),
 * anchored to the simulation's own thresholds so the tint never lies about the
 * state it drives: a floor turns AMBER exactly at the churn point
 * ({@link CONGESTION_CHURN}, where tenants start leaving) and fully RED at
 * gridlock ({@link CONGESTION_GRIDLOCK}). The sub-churn range is gamma-lifted so
 * a healthy tower still shows a legible green→yellow gradient — the busiest
 * floors stand out instead of collapsing into one flat green wash — while amber
 * and red stay reserved for genuinely strained transport. Pure (no rendering);
 * it lives beside the congestion model it interprets.
 */
export function congestionSeverity(cong: number): number {
  // A non-finite or non-positive ratio (should never happen — capacity is
  // guarded > 0 — but a corrupt save or future divide could produce NaN or
  // ±Infinity) degrades to green rather than poisoning the ramp index in
  // heatColor and throwing on the draw path. Guard Infinity explicitly: it is
  // > 0, so `cong > 0` alone would let it fall through to the gridlock clamp.
  if (!Number.isFinite(cong) || cong <= 0) return 0;
  if (cong >= CONGESTION_GRIDLOCK) return 1;
  if (cong <= CONGESTION_CHURN) {
    // Expand the lived-in [0, churn) band across most of the green→amber leg.
    return CONGESTION_AMBER_SEVERITY * Math.pow(cong / CONGESTION_CHURN, 0.6);
  }
  // Churn → gridlock climbs amber → red.
  return (
    CONGESTION_AMBER_SEVERITY +
    (1 - CONGESTION_AMBER_SEVERITY) * ((cong - CONGESTION_CHURN) / (CONGESTION_GRIDLOCK - CONGESTION_CHURN))
  );
}

/** One tinted rectangle in the stats overlay: a column span on a floor and how
 *  bad it reads (0 = green/good … 1 = red/bad). Congestion and occupancy emit
 *  one cell per floor (they're floor-level metrics); satisfaction emits one cell
 *  per present tenant unit so a single unhappy suite reddens on its own instead
 *  of being averaged away by content neighbors sharing the floor. */
export interface HeatCell {
  floor: number;
  minX: number;
  maxX: number;
  severity: number;
}

/** Batch-pricing target: an exact price, or "default" to clear the override. */
export type BatchTarget = number | "default";
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

/**
 * Simulation drives time, money, population and ratings. The renderer and UI
 * read its state; they never mutate the model directly except via build/sell.
 */
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
   * Rule-set this tower was founded under — {@link GameMode}. Set once at
   * construction and never reassigned (the field is `readonly`), so the whole
   * engine can branch on it without ever guarding against a mid-game flip. Old
   * saves with no persisted mode deserialize as `classic`, so their condos stay
   * flat 3s and the population census is unchanged. The UI stamps the player's
   * choice at tower creation. This is the persisted IDENTITY; the BEHAVIOR that
   * hangs off it lives in {@link rules}.
   */
  readonly mode: GameMode;

  /**
   * The mode's behavior, resolved once from {@link mode}. Every place Classic and
   * Modern diverge routes through this ({@link GameRules}) — the engine calls
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
  private onHourRuns = 0;
  get hourTicks(): number {
    return this.onHourRuns;
  }
  log: LogEntry[] = [];

  /**
   * Individually-routed commuters. The engine owns and advances them as part of
   * the deterministic tick (the renderer only reads {@link Crowd.people} to draw
   * them), so their stress feeds satisfaction identically in headless runs.
   */
  readonly crowd: Crowd;

  /**
   * 0..1 frustration from the {@link Crowd}: the fraction of real people stuck
   * waiting too long for an elevator. Supplements the aggregate
   * {@link congestion} signal with what's actually happening to the commuters.
   */
  get crowdStress(): number {
    return this.crowd.stress;
  }

  /** Demand-driven elevator dispatch (owns its own waiting/dwell state). */
  private elevators = new ElevatorDispatch();
  /** Fire / bomb-threat emergencies (owns the set of burning units). */
  private events: EventSystem;
  /** Rent, traffic income, hotel revenue, housekeeping and maintenance. */
  private economy: EconomySystem;

  /** Cosmetic sky weather for the day (read by the renderer). Derived purely
   * from the day number, so it never perturbs the gameplay RNG. */
  weather: WeatherKind = "clear";

  /** Cosmetic event-visual signals the renderer polls (see {@link triggerSanta}
   * / {@link triggerExplosion}). Purely visual and transient — bumped when the
   * event fires, never serialized, and with zero effect on gameplay/RNG/save. */
  santaFxSeq = 0;
  explosionFx: { floor: number; x: number; seq: number } = { floor: 0, x: 0, seq: 0 };
  thiefFx: { caught: boolean; floor: number; seq: number } = { caught: false, floor: 1, seq: 0 };
  treasureFx: { floor: number; x: number; seq: number } = { floor: 0, x: 0, seq: 0 };
  vipFxSeq = 0;

  /** Ids of units currently under construction (finalised on the global tick). */
  private constructing = new Set<number>();

  /** Basement tiles already excavated, so buried treasure is a one-time find per
   * tile and can't be farmed by repeatedly building and bulldozing the same spot. */
  private excavated = new Set<string>();
  /** Milestone ids already achieved (announced once); persisted. */
  private achievedMilestones = new Set<string>();
  /** Edge-trigger latch for the "stranded floor" log nudge, so it fires once on
   *  a 0→>0 crossing and re-arms only after the tower is fixed. Advisory only,
   *  intentionally not persisted (re-nudges once after load if still stranded). */
  private strandedNudged = false;

  /** Bookkeeping for period boundaries. */
  private lastDay = 0;
  private lastQuarter = -1;
  private lastMonth = -1;
  private lastHour = -1;
  /** Move-ins since the last daily summary (offices leased, condos sold, hotel
   *  rooms booked) — reported as one quiet log line per day rather than a toast
   *  per tenant, matching SimTower's readout-driven feel. */
  private moveInsToday = { offices: 0, condos: 0, rooms: 0 };
  /** Pending VIP inspection day (for the TOWER rating). */
  private vipVisitDay = -1;
  /** Whether a VIP has given the tower a favorable suite review (a 4★ gate). */
  vipFavorable = false;
  /** Day of the last "VIP underwhelming" nag, so it can't spam the log daily. */
  private lastVipNagDay = -100;
  /** Buried-treasure finds so far. Capped so a basement dug full of cheap parking
   * can't be farmed into tens of millions (the find stays a bounded windfall). */
  private treasuresFound = 0;

  constructor(seed = 12345, mode: GameMode = "classic") {
    this.rng = new RNG(seed);
    this.mode = mode;
    this.rules = makeRules(mode);
    this.crowd = new Crowd(seed);
    this.events = new EventSystem(this, seed);
    this.economy = new EconomySystem(this);
    this.weather = Simulation.weatherFor(this.clock.day);
  }

  /**
   * Deterministic per-day sky weather — a self-contained hash of the day, kept
   * off the gameplay RNG so adding it can't shift any seeded outcome. Mostly
   * clear, sometimes cloudy, occasionally rainy.
   */
  static weatherFor(day: number): WeatherKind {
    // 32-bit integer mixing via Math.imul (plain * would lose precision past 2^53).
    let h = Math.imul(day | 0, 2654435761) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 1274126177) >>> 0;
    const r = ((h >>> 8) & 0xffff) / 0x10000;
    return r < 0.62 ? "clear" : r < 0.85 ? "cloudy" : "rain";
  }

  // ---- Logging -----------------------------------------------------------

  emit(text: string, kind: LogEntry["kind"] = "info"): void {
    this.log.push({ minute: this.clock.minutes, text, kind });
    if (this.log.length > 200) this.log.shift();
  }

  // ---- Build / sell ------------------------------------------------------

  /** Whether a facility kind is currently unlocked by star rating. */
  isUnlocked(kind: FacilityKind): boolean {
    return this.star >= FACILITIES[kind].minStar;
  }

  /** True for kinds that ride on a floor (and so can auto-lay one). */
  private isRoomKind(kind: FacilityKind): boolean {
    return kind !== "floor" && kind !== "lobby" && !FACILITIES[kind].transport;
  }

  /**
   * Non-mutating feasibility + total cost for placing a facility here. Rooms
   * may auto-lay the floor beneath them, so their cost includes the floor tiles
   * that would be created. Used for build previews and by {@link build}.
   */
  canBuild(kind: FacilityKind, floor: number, x: number): { ok: boolean; reason?: string; cost: number } {
    if (!isFacilityKind(kind)) return { ok: false, reason: "Unknown facility.", cost: 0 };
    const f = FACILITIES[kind];
    if (!this.isUnlocked(kind)) return { ok: false, reason: `${f.name} unlocks at ${f.minStar}★.`, cost: f.cost };

    if (!this.isRoomKind(kind)) {
      const c = this.tower.canPlace(kind, floor, x);
      if (!c.ok) return { ok: false, reason: c.reason, cost: f.cost };
      const afford = this.money >= f.cost;
      return { ok: afford, reason: afford ? undefined : "Not enough money.", cost: f.cost };
    }

    const pre = this.tower.canPlaceRoomIgnoringFloor(kind, floor, x);
    if (!pre.ok) return { ok: false, reason: pre.reason, cost: f.cost };
    const hgt = facilityFloors(kind);
    const missing = this.tower.missingFloorCount(floor, x, f.width, hgt);
    if (missing > 0 && !this.tower.spanConnects(floor, x, f.width, hgt)) {
      const reason =
        floor >= 2
          ? "Rooms must sit on the floor below — no floating overhangs."
          : "Build next to the tower — you can't build in midair.";
      return { ok: false, reason, cost: f.cost };
    }
    const cost = f.cost + missing * FACILITIES.floor.cost;
    const afford = this.money >= cost;
    return { ok: afford, reason: afford ? undefined : "Not enough money.", cost };
  }

  build(kind: FacilityKind, floor: number, x: number): { ok: boolean; reason?: string } {
    const can = this.canBuild(kind, floor, x);
    if (!can.ok) return { ok: false, reason: can.reason };
    const f = FACILITIES[kind];
    // A room lays its own floor where missing (so you never pre-build bare
    // floors for an office or condo — just drop it next to the tower).
    if (this.isRoomKind(kind)) {
      const ef = this.tower.ensureFloorUnder(floor, x, f.width, facilityFloors(kind));
      if (!ef.ok) return { ok: false, reason: ef.reason };
    }
    const res = this.tower.place(kind, floor, x);
    if (!res.ok) return { ok: false, reason: res.reason };
    this.money -= can.cost;
    // Rooms spend time under construction before they can be used.
    const dur = buildMinutes(kind);
    if (dur > 0 && res.unitId !== undefined) {
      const u = this.tower.getUnit(res.unitId);
      if (u) {
        u.state = "construction";
        u.completeAt = this.clock.minutes + dur;
        this.constructing.add(u.id);
      }
    }
    if (kind === "weddingHall") {
      this.emit("Wedding Hall built! A VIP will inspect your tower soon.", "good");
      this.vipVisitDay = this.clock.day + 3;
    }
    // Excavating the basement occasionally turns up buried treasure, just like
    // digging the foundations in the original. Only real rooms trigger it (not
    // the many single floor tiles), and only on tiles never dug before — so it
    // stays a rare windfall and can't be farmed by build/bulldoze cycling.
    if (floor <= 0 && this.isRoomKind(kind)) {
      let freshGround = false;
      const hgt = facilityFloors(kind);
      for (let fl = floor; fl < floor + hgt; fl++) {
        for (let i = 0; i < f.width; i++) {
          const k = `${fl}:${x + i}`;
          if (!this.excavated.has(k)) {
            freshGround = true;
            this.excavated.add(k);
          }
        }
      }
      // Capped per tower so cheap basement parking can't be farmed for tens of
      // millions — it stays a rare windfall, not an income engine.
      if (freshGround && this.treasuresFound < 3 && this.rng.chance(0.18)) {
        this.treasuresFound++;
        const gold = 400_000 + this.rng.int(0, 200_000); // ~half a million, per the FAQ
        this.money += gold;
        this.emit(`💰 Excavation crews unearthed buried treasure worth $${gold.toLocaleString()}!`, "money");
        this.triggerTreasure(floor, x + Math.floor(f.width / 2)); // sparkle at the dig site (cosmetic)
      }
    }
    return { ok: true };
  }

  buildTransport(
    kind: FacilityKind,
    x: number,
    bottom: number,
    top: number,
  ): { ok: boolean; reason?: string } {
    const f = FACILITIES[kind];
    if (!this.isUnlocked(kind)) {
      return { ok: false, reason: `${f.name} unlocks at ${f.minStar}★.` };
    }
    // Elevators charge per served floor on top of the base price.
    const span = top - bottom;
    const extra = isElevatorKind(kind) ? span * 5_000 : 0;
    const total = f.cost + extra;
    if (this.money < total) return { ok: false, reason: "Not enough money." };
    const res = this.tower.placeTransport(kind, x, bottom, top);
    if (!res.ok) return { ok: false, reason: res.reason };
    this.money -= total;
    return { ok: true };
  }

  /** Bulldoze a unit/transport for a partial refund. */
  sellAt(floor: number, x: number): boolean {
    const t = this.tower.transportAt(floor, x);
    const u = this.tower.unitAt(floor, x);
    // Prefer removing a room over the transport/floor beneath it.
    if (u && u.kind !== "floor" && u.kind !== "lobby") {
      // Can't sell a burning unit — the bulldozer is post-fire cleanup, not a
      // way to end a blaze and skip the rescue fee. Mirrors the UI-side guards
      // so every removal path upholds the anti-cheat.
      if (u.state === "fire") return false;
      this.tower.removeUnit(u.id);
      // A gutted shell has no salvage value; everything else refunds half.
      this.money += u.state === "gutted" ? 0 : resaleRefund(u.kind);
      // If the last Wedding Hall is gone before the VIP arrived, cancel the
      // pending inspection so it can't keep re-failing and spamming the log.
      if (u.kind === "weddingHall" && !this.tower.builtWeddingHall && !this.evaluatedTower) {
        this.vipVisitDay = -1;
      }
      return true;
    }
    if (t) {
      this.tower.removeTransport(t.id);
      this.money += resaleRefund(t.kind);
      return true;
    }
    if (u) {
      // A floor/lobby tile that holds up the story above can't be pulled out —
      // that would leave the structure above hanging in midair.
      if (this.tower.removalReason(u.id)) return false;
      this.tower.removeUnit(u.id);
      this.money += resaleRefund(u.kind);
      return true;
    }
    return false;
  }

  // ---- Main tick ---------------------------------------------------------

  /** Advance the world by `dtMinutes` of game time. */
  tick(dtMinutes: number): void {
    if (this.simModel === "v2") {
      // Decompose into ≤30-min sub-steps that never skip an hour boundary, so
      // onHour/onDay fire for EVERY elapsed hour/day and the integrators get a
      // bounded step — headless then matches the (pre-chunked) browser. (F4)
      const EPS = 1e-6;
      let remaining = dtMinutes;
      while (remaining > EPS) {
        const toNextHour = 60 - (this.clock.minuteOfDay % 60);
        // Guarantee forward progress: when we're sitting essentially on an hour
        // boundary (toNextHour ≈ 0, possible with fractional minutes from the
        // browser loop's accumulator) take a normal step instead of a vanishing
        // one, so the loop can't stall in tiny increments. (review/Copilot F4-2)
        const cap = toNextHour > EPS ? Math.min(30, toNextHour) : 30;
        const step = Math.min(remaining, cap);
        this.advanceStep(step);
        remaining -= step;
      }
      return;
    }
    this.advanceStep(dtMinutes);
  }

  /** One integration step: move time, cars and crowd, finalise construction, and
   * fire the hour/day boundary handlers exactly once if crossed. */
  private advanceStep(dtMinutes: number): void {
    this.clock.advance(dtMinutes);
    // Cars and the drawn crowd (tenants and staff alike) interact through
    // boarding windows only a fraction of a game-minute wide, so they advance
    // TOGETHER in short chunks even when the outer step is coarse (fast game
    // speeds) — a car that teleports 16 floors in one 20-minute step passes
    // every waiter unboardable and every rider's floor unalightable. Cars
    // answer the drawn people's calls too (hall calls where waiters stand,
    // cab stops where riders are headed), not just the statistical demand —
    // see ElevatorDispatch.update. The unit-list scans (statistical demand,
    // trip spawning) run once for the whole step; only the cheap car/person
    // movement runs per chunk.
    const rush = this.rushFactor();
    this.elevators.accumulate(this.tower, dtMinutes, rush);
    // The crowd runs on its own seconds — a few per game-minute — capped so a
    // huge outer tick still can't teleport (or mass-spawn) everyone at once.
    this.crowd.spawn(Math.min(CROWD_MAX_STEP, dtMinutes * CROWD_SECONDS_PER_MINUTE), this.tower, this.clock);
    // The movement loop honors the same cap IN TOTAL: a month-long catch-up
    // tick (legacy v1 model) advances cars/people by at most CROWD_MAX_STEP
    // crowd-seconds of motion, not a month of thousands of chunks.
    const moveMinutes = Math.min(dtMinutes, CROWD_MAX_STEP / CROWD_SECONDS_PER_MINUTE);
    for (let left = moveMinutes; left > 0; ) {
      const chunk = Math.min(left, 2.5);
      this.elevators.moveCars(this.tower, chunk, this.crowd.elevatorCalls(this.tower));
      this.crowd.advance(chunk * CROWD_SECONDS_PER_MINUTE, this.tower);
      left -= chunk;
    }
    // Housekeepers who reached (or abandoned) their room since the last step:
    // the room is cleaned on ARRIVAL, never instantly — you can watch them go.
    for (const job of this.crowd.takeStaffResults()) {
      this.economy.onHousekeeperResult(job.unitId, job.ok);
    }
    this.finishConstruction();

    const hour = this.clock.hour;
    if (hour !== this.lastHour) {
      this.lastHour = hour;
      this.onHour();
    }

    const day = this.clock.day;
    if (day !== this.lastDay) {
      this.lastDay = day;
      this.onDay();
    }
  }

  /** Finalise any units whose construction period has elapsed. */
  private finishConstruction(): void {
    if (this.constructing.size === 0) return;
    for (const id of [...this.constructing]) {
      const u = this.tower.getUnit(id);
      if (!u || u.state !== "construction") {
        this.constructing.delete(id);
        continue;
      }
      if (this.clock.minutes >= (u.completeAt ?? 0)) {
        u.state = "empty";
        u.completeAt = undefined;
        this.constructing.delete(id);
        this.emit(`${FACILITIES[u.kind].name} on ${this.floorLabel(u.floor)} is now open for business.`, "good");
      }
    }
  }

  /** Hourly: presence, move-ins, satisfaction, traffic income. */
  private onHour(): void {
    this.onHourRuns++;
    this.updatePresence();
    // Guests check out in the morning (not at midnight), so overnight hotel
    // population is still present at the midnight TOWER/VIP evaluation.
    if (this.clock.hour === HK_SHIFT_START) this.economy.hotelCheckout();
    // Housekeeping works a day shift: dispatch keeps sending crews to dirty
    // rooms through the day (retrying jobs that failed or were over capacity).
    if (this.clock.hour >= HK_SHIFT_START && this.clock.hour <= HK_SHIFT_END) {
      this.economy.dispatchHousekeepers();
    }
    this.updateSatisfaction();
    this.attemptMoveIns();
    this.economy.collectTrafficIncome();
    this.sampleElevatorUtil();
    this.evaluateStar();
  }

  /** Per-shaft utilization EMA (0..1), keyed by transport id — how full each
   *  passenger elevator's cars run on average. Sampled hourly off the hot path;
   *  transient (warms up after load, not serialized). */
  private elevatorUtil = new Map<number, number>();

  /** Fold this hour's car occupancy into each passenger elevator's running
   *  utilization average, and forget shafts that have been removed. */
  private sampleElevatorUtil(): void {
    const alive = new Set<number>();
    for (const t of this.tower.transports) {
      if (!isElevatorKind(t.kind) || isStaffOnlyTransport(t.kind)) continue;
      alive.add(t.id);
      const cap = t.cars * transportCarCapacity(t.kind);
      const load = (t.carLoad ?? []).reduce((sum, n) => sum + n, 0);
      const frac = cap > 0 ? Math.min(1, load / cap) : 0;
      const prev = this.elevatorUtil.get(t.id);
      // Slow EMA so the figure reflects a typical day, not the current instant.
      this.elevatorUtil.set(t.id, prev === undefined ? frac : 0.15 * frac + 0.85 * prev);
    }
    for (const id of [...this.elevatorUtil.keys()]) if (!alive.has(id)) this.elevatorUtil.delete(id);
  }

  /** Average utilization (0..1) of a passenger elevator, or undefined for a
   *  non-passenger transport or one not yet sampled. */
  elevatorUtilization(id: number): number | undefined {
    return this.elevatorUtil.get(id);
  }

  /**
   * Colored-overlay cells — severity (0 = good/green … 1 = bad/red) plus the
   * column extent each tint covers — for the stats overlay (the original's
   * evaluation maps). NOT a 1:1 floor mapping: `congestion`/`occupancy` emit one
   * cell per floor (spanning its built extent), while `satisfaction` emits one
   * cell per present tenant unit (spanning that unit's footprint), so a floor can
   * carry several satisfaction cells. Only cells with data for the chosen mode
   * are returned. Scans the unit list once; the renderer caches it (hourly), so
   * it's off the per-frame path.
   *
   * - `congestion`: how jammed the floor's transport is (per-floor congestion).
   * - `occupancy`:  the floor's vacant share (red = empty, green = fully leased).
   * - `satisfaction`: per-unit tenant unhappiness (red = a tenant near leaving).
   */
  floorHeatmap(mode: HeatmapMode): HeatCell[] {
    if (mode === "satisfaction") {
      // Per-unit, not per-floor: tint each present tenant's own footprint by its
      // unhappiness. Averaging a floor would let one miserable suite (near
      // leaving) vanish behind content neighbors — exactly the tenant the player
      // opened this overlay to find — so each unit reddens on its own. Only
      // judge units with someone actually present right now (an empty suite has
      // no happiness signal; its vacancy is the occupancy map's job).
      const out: HeatCell[] = [];
      for (const u of this.tower.units) {
        const rentable = FACILITIES[u.kind].population > 0 || isHotelKind(u.kind);
        if (!rentable || !isPresent(u)) continue;
        out.push({ floor: u.floor, minX: u.x, maxX: u.x + u.width - 1, severity: 1 - u.satisfaction });
      }
      return out;
    }

    const ext = new Map<number, { min: number; max: number }>();
    // Per-floor tenancy accumulator for occupancy. `present` is the live-tenant
    // count (offices/condos read present whenever leased, hotels only while a
    // guest is in); occupancy grades vacancy against it.
    const acc = new Map<number, { total: number; present: number }>();
    for (const u of this.tower.units) {
      const right = u.x + u.width - 1;
      for (let fl = u.floor; fl < u.floor + facilityFloors(u.kind); fl++) {
        const e = ext.get(fl);
        if (!e) ext.set(fl, { min: u.x, max: right });
        else {
          if (u.x < e.min) e.min = u.x;
          if (right > e.max) e.max = right;
        }
      }
      if (mode === "occupancy") {
        const rentable = FACILITIES[u.kind].population > 0 || isHotelKind(u.kind);
        if (rentable) {
          const a = acc.get(u.floor) ?? { total: 0, present: 0 };
          a.total++;
          if (isPresent(u)) a.present++;
          acc.set(u.floor, a);
        }
      }
    }
    // Build the congestion source ONCE, not per floor. congestionAt(floor) in v2
    // rebuilds the whole spatial map on every call, so reading it inside the loop
    // below would be O(F²) map builds per refresh; the v1 scalar is likewise
    // read once. (Off the frame path — the renderer caches this hourly — but the
    // quadratic build is still needless.)
    const congMap = mode === "congestion" && this.simModel === "v2" ? this.spatialCongestionByFloor() : null;
    const congScalar = mode === "congestion" && this.simModel !== "v2" ? this.congestion() : 0;

    const out: HeatCell[] = [];
    for (const [floor, e] of ext) {
      let severity: number;
      if (mode === "congestion") {
        // Sim-anchored ramp: amber at the churn threshold, red at gridlock, with
        // the sub-churn band spread out so a healthy tower's busiest floors are
        // still legible instead of a flat green wash (see congestionSeverity).
        severity = congestionSeverity(congMap ? (congMap.get(floor) ?? 0) : congScalar);
      } else {
        const a = acc.get(floor);
        if (!a || a.total === 0) continue; // no tenancy here → don't tint
        severity = 1 - a.present / a.total; // vacant share
      }
      out.push({ floor, minX: e.min, maxX: e.max, severity });
    }
    return out;
  }

  /** Per-passenger-elevator utilization report for the stats screen, busiest
   *  first: each shaft's served range, car count, capacity/trip and average
   *  fullness. Excludes staff-only service elevators (no passenger load). */
  elevatorStats(): { id: number; kind: FacilityKind; bottom: number; top: number; cars: number; capacity: number; utilization: number }[] {
    const out = [];
    for (const t of this.tower.transports) {
      if (!isElevatorKind(t.kind) || isStaffOnlyTransport(t.kind)) continue;
      out.push({
        id: t.id,
        kind: t.kind,
        bottom: t.bottom,
        top: t.top,
        cars: t.cars,
        capacity: t.cars * transportCarCapacity(t.kind),
        utilization: this.elevatorUtil.get(t.id) ?? 0,
      });
    }
    return out.sort((a, b) => b.utilization - a.utilization);
  }

  /** Daily: rent, maintenance, events, VIP. (Hotel checkout is hourly @08:00.) */
  private onDay(): void {
    this.weather = Simulation.weatherFor(this.clock.day);

    const month = Math.floor(this.clock.day / 30);
    if (month !== this.lastMonth) {
      this.lastMonth = month;
      this.economy.payMaintenance();
    }

    const q = this.clock.quarter;
    if (q !== this.lastQuarter) {
      this.lastQuarter = q;
      this.economy.collectRent();
    }

    this.events.maybeRandomEvent();
    this.maybeVipStay();
    this.checkVip();
    this.reportMoveIns();
    this.checkMilestones();
    this.nudgeStranded();
    this.nudgeServiceShortfalls();
    // Close the day's ledger so the income breakdown averages over whole days.
    this.ledger.endDay();
  }

  /** Edge-triggered log bulletins (same latch pattern as {@link nudgeStranded})
   *  for the two demand-scaled services: recycling capacity and suite parking.
   *  Each fires once when its shortfall first appears and re-arms only after the
   *  shortfall clears — so a tower that outgrows its centers again gets told
   *  again. Evaluated once per day (called from {@link onDay}), not day-latched. */
  private wasteNudged = false;
  private suiteParkingNudged = false;
  private nudgeServiceShortfalls(): void {
    const wasteShort = this.star >= 3 && !this.recyclingDemandMet();
    if (wasteShort && !this.wasteNudged) {
      const pop = this.tower.totalPopulation();
      const need = Math.ceil(pop / RECYCLING_POP_PER_CENTER);
      this.emit(
        `♻️ Garbage is piling up: ${pop.toLocaleString()} population needs ${need} Recycling Center${need === 1 ? "" : "s"} (you have ${this.recyclingCenters()}). 4★ requires demand met.`,
        "info",
      );
    }
    this.wasteNudged = wasteShort;

    const suiteShort = this.star >= 3 && this.suiteParkingShort();
    if (suiteShort && !this.suiteParkingNudged) {
      const d = this.parkingDemand();
      this.emit(
        `🚗 Hotel suites need a working parking space each — ${d.suites} suite${d.suites === 1 ? "" : "s"}, ${this.tower.functionalParkingSpots()} space(s) chained to a ramp.`,
        "info",
      );
    }
    this.suiteParkingNudged = suiteShort;
  }

  /** Once-per-day, edge-triggered log nudge when a leased floor is 3+ rides from
   *  the lobby (invisible otherwise). Log-only (never a toast); de-duped by a
   *  latch so it can't repeat while the condition persists. */
  private nudgeStranded(): void {
    const stranded = this.strandedFloors().length > 0;
    if (stranded && !this.strandedNudged) {
      // "info", not "bad": the UI toasts every good/bad log entry, and this
      // advisory is meant to be log-only (a quiet bulletin line, not a toast).
      this.emit(
        "A leased floor is 3+ elevator rides from the lobby — no visitors will come. Check it in the inspector.",
        "info",
      );
    }
    this.strandedNudged = stranded; // re-arms only after the condition clears
  }

  /** Announce any newly-satisfied optional milestones — once each, then persisted.
   *  Recognition-only (no cash): they're pacing goals, not an income source. */
  private checkMilestones(): void {
    for (const m of MILESTONES) {
      if (this.achievedMilestones.has(m.id)) continue;
      if (!m.test(this)) continue;
      this.achievedMilestones.add(m.id);
      this.emit(`🏅 Milestone: ${m.label}`, "good");
    }
  }

  /** Milestone progress for the UI (achieved count + per-milestone done flags). */
  milestoneProgress(): { achieved: number; total: number; list: { label: string; desc: string; done: boolean }[] } {
    const list = MILESTONES.map((m) => ({ label: m.label, desc: m.desc, done: this.achievedMilestones.has(m.id) }));
    return { achieved: list.filter((m) => m.done).length, total: MILESTONES.length, list };
  }

  /** One quiet log line summarising the day's tenancy churn, so the player feels
   *  the building filling up without a toast per individual tenant. */
  private reportMoveIns(): void {
    const m = this.moveInsToday;
    const parts: string[] = [];
    if (m.offices) parts.push(`${m.offices} office${m.offices > 1 ? "s" : ""} leased`);
    if (m.condos) parts.push(`${m.condos} condo${m.condos > 1 ? "s" : ""} sold`);
    if (m.rooms) parts.push(`${m.rooms} hotel room${m.rooms > 1 ? "s" : ""} booked`);
    if (parts.length) this.emit(`New tenants: ${parts.join(", ")}.`, "good");
    this.moveInsToday = { offices: 0, condos: 0, rooms: 0 };
  }

  // ---- Presence (who is physically in each unit right now) ---------------

  private updatePresence(): void {
    const weekend = this.clock.isWeekend;
    for (const u of this.tower.units) {
      const f = FACILITIES[u.kind];
      if (isDormant(u)) {
        u.occupants = 0;
        continue;
      }
      switch (u.kind) {
        case "office":
          // Offices staffed on weekday working hours.
          u.occupants =
            !weekend && this.clock.hour >= 8 && this.clock.hour < 18 ? f.population : 0;
          break;
        case "condo":
          // Residents home in evenings/night/weekends — the whole household
          // (its real size in Modern, the flat 3 in Classic); one person stays
          // home during the weekday workday.
          u.occupants =
            this.clock.isNight() || this.clock.isEvening() || weekend ? residentCount(u) : 1;
          break;
        case "hotelSingle":
        case "hotelDouble":
        case "hotelSuite":
          u.occupants = u.state === "asleep" ? f.population : 0;
          break;
        default:
          u.occupants = u.state === "occupied" ? f.population : 0;
      }
    }
  }

  // ---- Satisfaction & churn ---------------------------------------------

  private updateSatisfaction(): void {
    // v2 (review F3): congestion is SPATIAL — each floor is stressed only by the
    // shafts that actually serve it, so layout/zoning/parallel shafts matter.
    // v1: one tower-wide scalar applied to everyone (the shipped behavior).
    const congMap = this.simModel === "v2" ? this.spatialCongestionByFloor() : null;
    const globalCong = congMap
      ? Math.max(0, ...[0, ...congMap.values()])
      : this.congestion();
    // Warn the player when their elevators can't keep up.
    if (globalCong > 1.4 && this.clock.hour === 9 && this.rng.chance(0.5)) {
      this.emit("Tenants are complaining of long elevator waits — add cars or shafts.", "bad");
    }
    // New notices this tick are batched into one toast (like move-ins) so a
    // tower-wide problem raises a single alarm, not one per unit.
    const notices: { floor: number; kind: FacilityKind; reason: VacateReason }[] = [];
    for (const u of this.tower.units) {
      if (isDormant(u)) continue;
      const served = this.tower.isFloorServed(u.floor);
      const cong = congMap ? (congMap.get(u.floor) ?? 0) : globalCong;
      // A bigger Modern household leans harder on the tower: scale only the
      // NEGATIVE access/congestion pressures, never the recovery, so a well-served
      // big family is just as happy as a small one — the size only bites when the
      // tower is failing them. The rule-set returns 1 in Classic (and for
      // flat/unsold condos), so those towers are untouched.
      const churn = this.rules.churnMultiplier(u.residents);
      if (!served) {
        u.satisfaction = Math.max(0, u.satisfaction - 0.15 * churn);
      } else if (u.floor !== 1 && cong > 1) {
        // Overcrowded vertical transport stresses everyone, more so the worse it
        // is — but tenants on the ground floor (floor 1) never ride an elevator,
        // so elevator congestion can't possibly bother them.
        u.satisfaction = Math.max(0, u.satisfaction - 0.04 * Math.min(3, cong - 1) * churn);
      } else {
        u.satisfaction = Math.min(1, u.satisfaction + 0.05);
      }
      // Rent pressure: charging an office above the going rate erodes
      // satisfaction (and so retention); undercutting it keeps tenants happy.
      // The coefficient is tuned to exceed the +0.05 served-recovery near the
      // top of the band, so a gouged office trends to a net-negative drift and
      // eventually vacates — otherwise rent would be free money (fill cheap,
      // then crank to max with no downside).
      if (u.kind === "office" && served) {
        const cfg = rentConfig("office")!;
        const over = (rentOf(u) - cfg.default) / cfg.default; // <0 cheap, >0 pricey
        u.satisfaction = Math.max(0, Math.min(1, u.satisfaction - over * 0.07));
      }
      // Office noise (canon "Office neighbor is too noisy"): a hotel room or condo
      // with an office immediately beside it on the same floor is worn down in two
      // phases — an immediate annoyance CEILING (NOISE_CAP), then, if the neighbor
      // is never dealt with, a slow EROSION past it (NOISE_EROSION outpaces the
      // served recovery). Sustained, unaddressed exposure therefore drives the
      // tenant below the rescind bar and ultimately out (cause: "noise"); moving
      // the office or the neighbor lets satisfaction recover normally.
      // Erode THEN clamp to the cap (not clamp-then-erode): a freshly-exposed
      // unit lands exactly on 0.6 rather than overshooting to 0.53, and the
      // steady-state stays a true net ≈ −0.02/hr (this tick's +0.05 recovery is
      // preserved, not discarded by the cap).
      if ((isHotelKind(u.kind) || u.kind === "condo") && served && this.officeAdjacent(u)) {
        // A *sold* condo (everOccupied) is an owner, not a nightly guest, so it
        // erodes at the gentler condo rate — sticky against a transient neighbor
        // the player removes in time, worn out only by sustained, unaddressed
        // adjacency. Hotels (and any not-yet-sold condo) keep the steeper rate;
        // gating on everOccupied matches the "sold" predicate the rest of the
        // condo logic uses (priceUnit, overhead) and is robust to a corrupt save
        // with an occupied-but-unsold condo. The annoyance cap is shared, so both
        // still redden on the stats overlay from the moment of exposure.
        const erosion = u.kind === "condo" && u.everOccupied ? CONDO_NOISE_EROSION : NOISE_EROSION;
        u.satisfaction = Math.max(0, Math.min(u.satisfaction - erosion, NOISE_CAP));
      }
      // NOTE: the individually-routed crowd's frustration is exposed read-only via
      // {@link crowdStress} for the HUD, but is deliberately NOT written back into
      // satisfaction — its value depends on frame/step cadence, so feeding it into
      // the authoritative, persisted satisfaction would make the headless and
      // browser runs diverge. The aggregate congestion model above is the single
      // authoritative stress driver.
      // Tenants abandon a unit that stays unbearable. Offices and condos are
      // long-term leases, so a bottomed-out satisfaction first puts them "on
      // notice" — the `vacating` grace period — rather than evicting instantly;
      // fix the cause in time and they rescind and stay. Hotel guests have no
      // lease to give notice on (and a room cycles nightly), so a chronically
      // miserable room simply fails to hold its guest right away (review F25).
      // Commercial venues aren't here: their income already requires a served
      // floor, so poor access starves them directly rather than via move-out.
      const leaseTenant = u.kind === "office" || u.kind === "condo";
      if (leaseTenant && u.state === "vacating") {
        if (u.satisfaction >= VACATE_RESCIND) {
          // Conditions recovered inside the notice window — they quietly stay.
          // No toast: "silence when correct", and a per-tick good/bad pair on a
          // unit that flaps around the threshold would be pure noise. The
          // clearing inspector/ribbon is the (pull) cue that the fix worked.
          u.state = "occupied";
          u.vacateReason = undefined;
          u.vacateAt = undefined;
        } else if (this.clock.minutes >= (u.vacateAt ?? 0)) {
          // Notice ran out and it's still unbearable — they leave for good.
          this.vacate(u, u.vacateReason ?? "access");
        }
      } else if (leaseTenant && u.satisfaction <= 0) {
        // Give notice: enter the grace period with the attributed cause.
        u.state = "vacating";
        u.vacateReason = this.vacateCause(u, served, cong);
        u.vacateAt = this.clock.minutes + VACATE_NOTICE_MINUTES;
        notices.push({ floor: u.floor, kind: u.kind, reason: u.vacateReason });
      } else if (u.satisfaction <= 0 && isHotelKind(u.kind)) {
        this.vacate(u, this.vacateCause(u, served, cong));
      }
    }
    this.emitNotices(notices);
  }

  /** Announce this tick's fresh notices as a single toast: a named unit when
   *  just one gave notice, or a per-cause tally when several did at once — so a
   *  tower-wide access/congestion problem is one alarm, not a flood. */
  private emitNotices(notices: { floor: number; kind: FacilityKind; reason: VacateReason }[]): void {
    if (notices.length === 0) return;
    if (notices.length === 1) {
      const n = notices[0];
      this.emit(
        `${FACILITIES[n.kind].name} on ${this.floorLabel(n.floor)} gave notice — ${VACATE_REASON_TEXT[n.reason]}. Fix it before they leave.`,
        "bad",
      );
      return;
    }
    const byReason = new Map<VacateReason, number>();
    for (const n of notices) byReason.set(n.reason, (byReason.get(n.reason) ?? 0) + 1);
    const parts = [...byReason].map(([r, n]) => `${n} × ${VACATE_REASON_TEXT[r]}`);
    this.emit(`${notices.length} tenants gave notice — ${parts.join(", ")}. Fix the flagged units before they leave.`, "bad");
  }

  /**
   * Attribute a tenant's departure to the dominant satisfaction drain at the
   * moment it bottomed out, so the toast/inspector names the real cause instead
   * of always blaming access. The order mirrors the drains in
   * {@link updateSatisfaction}: an unreachable floor is harshest, then elevator
   * crowding, then an over-market office rent, and finally — for a served,
   * uncongested hotel/condo — sustained office-noise erosion. `access` remains
   * the catch-all for the rare emergency-driven bottom-out.
   */
  private vacateCause(u: Unit, served: boolean, cong: number): VacateReason {
    if (!served) return "access";
    if (u.floor !== 1 && cong > 1) return "congestion";
    if (u.kind === "office") {
      const cfg = rentConfig("office");
      if (cfg && rentOf(u) > cfg.default) return "rent";
      return "access";
    }
    // A served, uncongested hotel/condo that still bottomed out did so through
    // sustained office-noise erosion — the only remaining satisfaction sink.
    if (this.officeAdjacent(u)) return "noise";
    return "access";
  }

  /** True when a same-floor office sits immediately to either side of `u` — the
   *  single office-noise adjacency test, shared by the noise erosion and its
   *  cause attribution so the two can never disagree. */
  private officeAdjacent(u: Unit): boolean {
    const left = this.tower.roomAt(u.floor, u.x - 1);
    const right = this.tower.roomAt(u.floor, u.x + u.width);
    return left?.kind === "office" || right?.kind === "office";
  }

  /**
   * Ratio of moving population to total vertical-transport capacity. Above 1.0
   * the elevators/stairs are overcrowded and tenants get stressed. Capacity is
   * cars × per-car capacity (plus stairs/escalators), times a headroom factor
   * for the many trips made across a rush.
   */
  congestion(): number {
    if (this.simModel === "v2") {
      // Population-weighted average of the per-floor spatial congestion — a single
      // HUD-friendly summary of a model that is really per-floor.
      const map = this.spatialCongestionByFloor();
      if (map.size === 0) return 0;
      let sum = 0, n = 0;
      for (const c of map.values()) { sum += c; n++; }
      return n > 0 ? sum / n : 0;
    }
    let capacity = 0;
    for (const t of this.tower.transports) {
      // Staff-only: a service elevator carries no tenants, so it adds nothing
      // to passenger capacity (its payoff is the housekeeping staff network).
      if (isStaffOnlyTransport(t.kind)) continue;
      const per = transportCarCapacity(t.kind);
      if (isElevatorKind(t.kind)) capacity += t.cars * per;
      else capacity += per; // stairs / escalator
    }
    // Metro stations and basement parking move commuters in and out without
    // ever touching the passenger elevators, easing the crunch — the very
    // reason you build them in the original.
    for (const u of this.tower.units) {
      // Operational only — a metro under construction / on fire moves nobody
      // (matches the v2 spatial model).
      if (u.kind === "metro" && isOperational(u)) capacity += 60;
    }
    capacity += 4 * this.tower.functionalParkingSpots(); // only ramp-chained spaces help
    const pop = this.tower.totalPopulation();
    if (capacity <= 0) return pop > 0 ? 3 : 0;
    // Demand swings with the day: a heavy morning/evening commute can overwhelm
    // shafts that cope fine at midday, and the tower nearly empties overnight —
    // the rush-hour rhythm the original is built around.
    return (pop * this.rushFactor()) / (capacity * 12);
  }

  /** Multiplier on moving demand by time of day (rush hours vs. overnight). */
  private rushFactor(): number {
    const c = this.clock;
    if (c.isMorning() || c.isEvening()) return 1.45; // peak commute
    if (c.isLunch()) return 1.15; // lunch crowd
    if (c.isNight()) return 0.35; // tower mostly asleep
    return 0.8;
  }

  /** Capacity of a single transport (riders served per trip). */
  transportCapacity(t: { kind: FacilityKind; cars: number }): number {
    const per = transportCarCapacity(t.kind);
    return isElevatorKind(t.kind) ? t.cars * per : per;
  }

  /** Congestion ratio for a specific floor: per-floor in the spatial v2 model,
   * the global scalar in v1. Exposed for the inspector and tests. */
  congestionAt(floor: number): number {
    if (this.simModel === "v2") return this.spatialCongestionByFloor().get(floor) ?? 0;
    return this.congestion();
  }

  /** The single busiest floor's congestion ratio (0 = clear). The overlay legend
   *  reads this to report the tower's worst pressure point in one number, so a
   *  healthy all-green map still communicates its headroom (e.g. "24% of
   *  capacity"). Computes the per-floor map once rather than per-floor. */
  peakCongestion(): number {
    if (this.simModel === "v2") {
      let peak = 0;
      for (const c of this.spatialCongestionByFloor().values()) if (c > peak) peak = c;
      return peak;
    }
    return this.congestion();
  }

  /**
   * Spatial congestion (v2, review F3): a per-floor ratio of the travelling
   * population that must pass through a floor's serving shafts to those shafts'
   * capacity. A floor's population is split across every ground-connected shaft
   * that stops there, so adding a parallel shaft genuinely relieves it, and two
   * separately-served office clusters don't pool their load the way the old
   * single tower-wide scalar did. Metro/parking drain commuters near the lobbies
   * (a global demand relief). Returns floor -> congestion ratio (>1 == stressed).
   */
  private spatialCongestionByFloor(): Map<number, number> {
    const HEADROOM = 12;
    const rush = this.rushFactor();
    const result = new Map<number, number>();

    const popByFloor = new Map<number, number>();
    let metro = 0;
    for (const u of this.tower.units) {
      if (u.kind === "metro" && isOperational(u)) metro++;
      if (isPresent(u)) {
        const p = residentCount(u);
        if (p > 0 && u.floor !== 1) popByFloor.set(u.floor, (popByFloor.get(u.floor) ?? 0) + p);
      }
    }
    if (popByFloor.size === 0) return result;
    const parking = this.tower.functionalParkingSpots(); // only ramp-chained spaces relieve demand
    const relief = Math.max(0.4, 1 - metro * 0.25 - parking * 0.02);

    const served = this.tower.servedFloorSet();
    // Ground-connected shafts and the served floors each one stops at.
    const shaftsByFloor = new Map<number, { id: number; cap: number }[]>();
    for (const t of this.tower.transports) {
      // Staff-only service elevators carry no passenger load.
      if (isStaffOnlyTransport(t.kind)) continue;
      let active = false;
      for (let f = t.bottom; f <= t.top; f++) {
        if (this.tower.stopsAt(t, f) && served.has(f)) { active = true; break; }
      }
      if (!active) continue;
      const cap = this.transportCapacity(t);
      for (let f = t.bottom; f <= t.top; f++) {
        if (f === 1) continue;
        if (this.tower.stopsAt(t, f) && served.has(f)) {
          const arr = shaftsByFloor.get(f) ?? [];
          arr.push({ id: t.id, cap });
          shaftsByFloor.set(f, arr);
        }
      }
    }

    // Split each floor's travelling population across the shafts that serve it,
    // **in proportion to each shaft's capacity** — riders prefer the higher-
    // throughput shaft. This is the load-balancing a real bank does, and it is
    // what makes adding ANY parallel shaft (even a weak one) strictly increase
    // total capacity and therefore REDUCE a floor's congestion. (An equal split
    // would wrongly route half the load onto a weak car and raise congestion.)
    const loadByShaft = new Map<number, number>();
    for (const [f, pop] of popByFloor) {
      const shafts = shaftsByFloor.get(f);
      if (!shafts || shafts.length === 0) continue; // unserved → handled by reachability
      const totalCap = shafts.reduce((sum, s) => sum + s.cap, 0);
      if (totalCap <= 0) continue;
      const demand = pop * relief;
      for (const s of shafts) {
        const sShare = demand * (s.cap / totalCap);
        loadByShaft.set(s.id, (loadByShaft.get(s.id) ?? 0) + sShare);
      }
    }

    // Each floor's congestion is its worst serving shaft (loads ~balanced by the split).
    for (const [f, shafts] of shaftsByFloor) {
      if (!popByFloor.has(f)) continue;
      let c = 0;
      for (const s of shafts) {
        const cong = s.cap > 0 ? ((loadByShaft.get(s.id) ?? 0) * rush) / (s.cap * HEADROOM) : 99;
        if (cong > c) c = cong;
      }
      result.set(f, c);
    }
    return result;
  }

  private vacate(u: Unit, reason: VacateReason): void {
    // The 1994 buy-back sting: when an OWNER leaves a sold condo, you don't just
    // lose a tenant — you repurchase the unit at what it sold for and hold it as
    // empty inventory to sell again. (A never-sold condo just goes back on the
    // market at no cost.) Charging the full sale price makes losing an owner to
    // sustained neglect genuinely hurt, exactly as it did in the original, and
    // resetting everOccupied lets the repurchased unit re-sell. Do this BEFORE the
    // everOccupied reset below reads it.
    // householdPrice reverses the sale exactly — the size-scaled price in Modern
    // (the household is still set here, before the reset below), the flat asking
    // price in Classic (residents undefined). 0 for anything that wasn't an owned
    // condo (offices, never-sold condos: they cost nothing back).
    let buyback = 0;
    if (u.kind === "condo" && u.everOccupied) {
      buyback = householdPrice(rentOf(u), u.residents);
      this.money -= buyback;
      this.recordMoney("condos", -buyback);
    }
    u.state = "empty";
    u.occupants = 0;
    // Return the unit to market by clearing the "currently leased/sold" flag — a
    // repurchased condo can then sell fresh, a vacated office re-lease. But
    // `vacate()` is ALSO the path a miserable HOTEL room loses its guest (the F25
    // branch in updateSatisfaction), and for a hotel everOccupied means "ever
    // booked" and must survive turnover (it's tracked by `state`, not this flag) —
    // so never clear it for hotels, or a previously-booked room would read as
    // brand new. `residents` is a condo-only field, so clearing it is a no-op
    // elsewhere and keeps a re-sold condo drawing a fresh household.
    if (!isHotelKind(u.kind)) u.everOccupied = false;
    u.residents = undefined;
    // A condo returning to market re-lists in the CURRENT band: clamp away any
    // legacy/out-of-band asking price it carried while sold (e.g. a $240k
    // old-max), so it can't re-sell above the current ceiling — or, in Modern,
    // above it after household scaling. The buy-back charge above already used
    // the pre-clamp price, so it still mirrors the historical sale.
    if (u.kind === "condo" && u.rent !== undefined) {
      const band = rentConfig("condo")!;
      u.rent = Math.max(band.min, Math.min(band.max, u.rent));
    }
    u.label = FACILITIES[u.kind].name;
    u.vacateReason = undefined;
    u.vacateAt = undefined;
    // One toast per departure. A bought-back owner's line carries the cost and
    // the cause together; every other tenant just gets the plain "left" notice.
    this.emit(
      buyback > 0
        ? `The owner left ${FACILITIES[u.kind].name} on ${this.floorLabel(u.floor)} (${VACATE_REASON_TEXT[reason]}) — you bought it back for $${buyback.toLocaleString()}.`
        : `A tenant left ${FACILITIES[u.kind].name} on ${this.floorLabel(u.floor)} (${VACATE_REASON_TEXT[reason]}).`,
      "bad",
    );
  }

  // ---- Move-ins ----------------------------------------------------------

  // ---- Waste management & parking demand ----------------------------------

  /** Operational Recycling Centers (finished, not on fire). */
  recyclingCenters(): number {
    return this.countOperational("recycling");
  }

  /** Population whose daily garbage the tower can process. */
  recyclingCapacity(): number {
    return this.recyclingCenters() * RECYCLING_POP_PER_CENTER;
  }

  /** The canon 4★ recycling gate: DEMAND MET, not merely built — one center
   *  per ~{@link RECYCLING_POP_PER_CENTER} population, so the requirement keeps
   *  growing with the tower exactly as in the original. */
  recyclingDemandMet(): boolean {
    return this.tower.totalPopulation() <= this.recyclingCapacity();
  }

  /**
   * How full every recycling center is right now, 0..1 (centers share the
   * tower's load). Garbage accumulates through the day from the pre-dawn
   * truck collection ({@link GARBAGE_COLLECT_HOUR}); a tower over capacity
   * hits 100% before the day is out — the original's "it filled up, build
   * more". Derived from the clock and population — never persisted.
   */
  recyclingFill(): number {
    const cap = this.recyclingCapacity();
    if (cap === 0) return 0;
    const sinceCollect = (this.clock.minuteOfDay - GARBAGE_COLLECT_HOUR * 60 + 1440) % 1440;
    return Math.min(1, (this.tower.totalPopulation() / cap) * (sinceCollect / 1440));
  }

  /** Functional parking spaces the tower NEEDS: one per ~12 office workers
   *  (canon: offices demand parking from 3★) plus one per hotel suite (canon:
   *  suite guests — and the VIP — arrive by car). */
  parkingDemand(): { officePop: number; offices: number; suites: number; total: number } {
    let officePop = 0;
    let suites = 0;
    for (const u of this.tower.units) {
      if (u.kind === "office" && isTenanted(u)) officePop += FACILITIES.office.population;
      else if (u.kind === "hotelSuite" && isOperational(u)) suites++;
    }
    const offices = Math.ceil(officePop / PARKING_WORKERS_PER_SPACE);
    return { officePop, offices, suites, total: offices + suites };
  }

  /** True when there aren't enough working spaces for one-per-suite (the VIP
   *  and suite guests drive — canon "need a parking spot per suite"). */
  suiteParkingShort(): boolean {
    const d = this.parkingDemand();
    return d.suites > 0 && this.tower.functionalParkingSpots() < d.suites;
  }

  /** True when the tower is 3★+ and lacks enough parking for its office workforce
   * (each parking space serves ~12 workers) — offices then demand parking.
   * Suites reserve their one-space-each FIRST (canon), so a lot full of suite
   * cars gives the offices nothing. */
  private officeParkingShort(): boolean {
    if (this.star < 3) return false;
    const d = this.parkingDemand();
    // Only ramp-chained spaces count (canon), and suites reserve theirs first —
    // clamp at 0 so a suite-heavy lot leaves offices "0 spaces", never a
    // negative that would read as short even with no office workers (officePop 0).
    const forOffices = Math.max(0, this.tower.functionalParkingSpots() - d.suites);
    return forOffices * PARKING_WORKERS_PER_SPACE < d.officePop;
  }

  /**
   * Fraction of WORKING parking spaces holding a car right now (0..1) — the
   * garage's display model, shared by the renderer and the inspector. Office
   * workers' cars fill the lot through weekday working hours; suite guests'
   * cars stand overnight. Dead (unchained) spaces never show cars — a car
   * couldn't have gotten there.
   */
  parkingUsage(spots: number = this.tower.functionalParkingSpots()): number {
    if (spots === 0) return 0;
    const h = this.clock.hour;
    const d = this.parkingDemand();
    const officeCars = !this.clock.isWeekend && h >= 8 && h < 18 ? d.offices : 0;
    let suiteCars = 0;
    if (h >= 19 || h < 8) {
      for (const u of this.tower.units) if (u.kind === "hotelSuite" && u.state === "asleep") suiteCars++;
    }
    return Math.min(1, (officeCars + suiteCars) / spots);
  }

  private attemptMoveIns(): void {
    const weekend = this.clock.isWeekend;
    // From 3★, office workers demand parking (canon). When the tower is short on
    // parking, fewer firms will move in — demand pressure, not eviction, so it
    // never destabilizes a built-out tower.
    const parkingPenalty = this.officeParkingShort() ? 0.5 : 1;
    for (const u of this.tower.units) {
      if (u.state !== "empty") continue;
      const f = FACILITIES[u.kind];
      if (f.population === 0 && !isHotelKind(u.kind)) continue; // non-tenant facility
      if (!this.tower.isFloorServed(u.floor)) continue; // nobody moves to an unreachable floor

      const demand = this.demandFactor(u);
      if (u.kind === "office") {
        if (!weekend && this.rng.chance(0.25 * demand * parkingPenalty)) this.moveIn(u);
      } else if (u.kind === "condo") {
        if (this.rng.chance(0.18 * demand)) this.moveIn(u);
      } else if (isHotelKind(u.kind)) {
        // Hotel rooms fill in the evening only and must be clean.
        if (this.clock.isEvening() && this.rng.chance(0.5 * demand)) {
          u.state = "asleep";
          u.everOccupied = true;
          this.moveInsToday.rooms++;
        }
      }
    }
  }

  /** How a unit's chosen price shifts demand: 1 at the going rate, higher when
   *  it undercuts, lower when it gouges (clamped). 1 for un-priced kinds. */
  private demandFactor(u: Unit): number {
    const cfg = rentConfig(u.kind);
    if (!cfg) return 1;
    const ratio = rentOf(u) / cfg.default;
    return Math.max(0.15, Math.min(1.6, 2 - ratio));
  }

  /** Set one unit's price to a clamped target, honoring the condo-sold gate.
   *  The single choke point for every price write (nudge and batch), so the
   *  band clamp and the "can't reprice a sold condo" rule live in one place.
   *  Returns the new price, or null if the unit isn't repriceable. */
  private priceUnit(u: Unit, target: number): number | null {
    const cfg = rentConfig(u.kind);
    if (!cfg) return null;
    if (!Number.isFinite(target)) return null; // guard NaN/Infinity from any caller
    if (u.kind === "condo" && u.everOccupied) return null; // already sold
    const clamped = clampRent(cfg, target);
    storeRent(u, cfg, clamped);
    return clamped;
  }

  /** Nudge a unit's price one step within its band — offices/hotels any time,
   *  condos only while unsold. Returns the new price, or null if not adjustable. */
  adjustRent(id: number, dir: 1 | -1): number | null {
    const u = this.tower.getUnit(id);
    if (!u) return null;
    const cfg = rentConfig(u.kind);
    if (!cfg) return null;
    return this.priceUnit(u, rentOf(u) + dir * cfg.step);
  }

  /**
   * Set the price of EVERY unit of one priced kind at once. `target` is an exact
   * price or "default" (clears the per-unit override). With `onlyDefaultPriced`,
   * units the player has hand-tuned are left alone. Sold condos are always
   * skipped. `preview` computes the result without mutating; `apply` writes it —
   * both run the same core, so what you preview is exactly what commits. Returns
   * null for a non-priced kind. Pure (no RNG / clock) and save-safe (writes only
   * the existing `Unit.rent`). */
  previewRentBatch(kind: FacilityKind, target: BatchTarget, opts: BatchRentOptions = {}): BatchRentResult | null {
    return this.computeBatch(kind, target, opts, false);
  }
  applyRentBatch(kind: FacilityKind, target: BatchTarget, opts: BatchRentOptions = {}): BatchRentResult | null {
    return this.computeBatch(kind, target, opts, true);
  }

  private computeBatch(
    kind: FacilityKind,
    target: BatchTarget,
    opts: BatchRentOptions,
    mutate: boolean,
  ): BatchRentResult | null {
    const cfg = rentConfig(kind);
    if (!cfg) return null; // not a priced kind
    if (target !== "default" && !Number.isFinite(target)) return null; // guard NaN/Infinity
    const onlyDefault = opts.onlyDefaultPriced ?? false;
    const r: BatchRentResult = {
      matched: 0,
      eligible: 0,
      changed: 0,
      skippedSold: 0,
      skippedCustom: 0,
      customOverwritten: 0,
      clampedLow: 0,
      clampedHigh: 0,
    };
    for (const u of this.tower.units) {
      if (u.kind !== kind) continue;
      r.matched++;
      if (u.kind === "condo" && u.everOccupied) {
        r.skippedSold++;
        continue;
      }
      // Treat an override equal to the kind default as default-priced too, so a
      // legacy save (or older adjustRent) that stored the default explicitly isn't
      // mis-counted as custom.
      if (onlyDefault && u.rent !== undefined && u.rent !== cfg.default) {
        r.skippedCustom++;
        continue;
      }
      r.eligible++;
      // With the protect toggle off, a custom-priced unit here is about to be
      // overwritten — count it so the preview can warn (skippedCustom only counts
      // the toggle-ON case where they're left alone).
      if (u.rent !== undefined && u.rent !== cfg.default) r.customOverwritten++;
      const before = rentOf(u);
      if (target === "default") {
        if (before !== cfg.default) r.changed++;
        if (mutate) u.rent = undefined; // clear the override → falls back to default
      } else {
        if (target < cfg.min) r.clampedLow++;
        else if (target > cfg.max) r.clampedHigh++;
        const clamped = clampRent(cfg, target);
        if (before !== clamped) r.changed++;
        if (mutate) storeRent(u, cfg, clamped);
      }
    }
    return r;
  }

  /** Set a cinema's monthly film-booking policy. Returns the new policy, or null
   *  if the unit isn't a cinema. */
  setFilmPolicy(id: number, policy: "auto" | "feature" | "blockbuster"): "auto" | "feature" | "blockbuster" | null {
    const u = this.tower.getUnit(id);
    if (!u || u.kind !== "cinema") return null;
    u.filmPolicy = policy;
    return policy;
  }

  /** Whether a cinema is currently showing a blockbuster (this month's booking). */
  isShowingBlockbuster(id: number): boolean {
    return this.economy.blockbusterIds.includes(id);
  }

  private moveIn(u: Unit): void {
    u.state = "occupied";
    u.satisfaction = 1;
    // A fresh tenant carries no prior eviction — clear any leftover notice
    // bookkeeping so a recycled unit can never present stale departure data.
    u.vacateReason = undefined;
    u.vacateAt = undefined;
    if (u.kind === "condo" && !u.everOccupied) {
      u.everOccupied = true;
      // The rule-set decides who buys and for how much: Classic → flat 3 at the
      // asking price; Modern → a 2–5 person household that scales the price. The
      // asking price the player set still drives HOW FAST it sells (via move-in
      // demand); the rule-set decides WHAT it fetches and who moves in.
      const asking = rentOf(u);
      const { price, residents } = this.rules.sellCondo(asking, this.rng);
      if (residents !== undefined) u.residents = residents;
      // Stamp the asking price the sale was struck at, so a later buy-back mirrors
      // THIS price even if the kind's default moves in a future build (rentOf
      // would otherwise pick up the new default for an un-priced condo). A sold
      // condo can't be repriced, so this stays fixed for the unit's owned life.
      u.rent = asking;
      this.money += price;
      this.recordMoney("condos", price);
      this.moveInsToday.condos++;
      const who = residents ? ` to a household of ${residents}` : "";
      this.emit(`Condominium on ${this.floorLabel(u.floor)} sold${who} for $${price.toLocaleString()}.`, "money");
    }
    if (u.kind === "office") {
      u.everOccupied = true;
      u.label = this.companyName();
      this.moveInsToday.offices++;
    }
  }

  private companyName(): string {
    const a = ["Apex", "Nimbus", "Vertex", "Cobalt", "Atlas", "Orion", "Pioneer", "Summit", "Delta", "Vista"];
    const b = ["Holdings", "Systems", "Partners", "Industries", "Group", "Labs", "Trading", "Capital"];
    return `${this.rng.pick(a)} ${this.rng.pick(b)}`;
  }

  // ---- Income (delegated to EconomySystem) -------------------------------

  /** Count of hotel rooms still awaiting cleaning. */
  dirtyRooms(): number {
    return this.tower.units.filter((u) => isHotelKind(u.kind) && u.state === "dirty").length;
  }

  // ---- Star rating -------------------------------------------------------

  evaluateStar(): void {
    if (this.star >= 6) return;
    const pop = this.ratingPopulation();
    let target = this.star;
    for (let s = 5; s >= 1; s--) {
      if (pop >= STAR_THRESHOLDS[s]) {
        target = s;
        break;
      }
    }
    // Extra gates beyond raw population, matching the original's ladder. A
    // facility only counts once it is actually operational (not still under
    // construction, not on fire).
    if (target >= 3 && !this.hasOperational("security")) target = Math.min(target, 2);
    // 4★ wants the full amenity set: Medical, Recycling DEMAND MET (one center
    // per ~2,500 population — see {@link recyclingDemandMet}), more than one
    // Hotel Suite, and a favorable VIP review (see {@link maybeVipStay}) — per canon.
    if (
      target >= 4 &&
      !(
        this.hasOperational("medical") &&
        this.recyclingDemandMet() &&
        this.countOperational("hotelSuite") >= 2 &&
        this.vipFavorable
      )
    ) {
      target = Math.min(target, 3);
    }
    // 5★ needs a Metro Station (canon) — it was previously only checked at the
    // TOWER stage.
    if (target >= 5 && !this.hasOperational("metro")) target = Math.min(target, 4);

    if (target > this.star) {
      this.star = target;
      this.emit(`Congratulations! Your tower reached ${this.star} stars.`, "good");
    }
  }

  /** Population that counts toward the star/TOWER thresholds. Per the original,
   * hotel guests count only while climbing to 3★; once the tower is 3★ they no
   * longer count toward 4★/5★/TOWER (the displayed {@link population} still
   * includes them). */
  ratingPopulation(): number {
    if (this.star < 3) return this.tower.totalPopulation();
    let pop = 0;
    for (const u of this.tower.units) {
      if (isPresent(u) && !isHotelKind(u.kind)) {
        pop += residentCount(u);
      }
    }
    return pop;
  }

  hasAny(kind: FacilityKind): boolean {
    return this.tower.units.some((u) => u.kind === kind);
  }

  /** Send a staff member (housekeeper) over the staff network — see
   *  {@link Crowd.spawnStaff}. Exposed on the context so the economy subsystem
   *  can dispatch crews without owning the crowd. */
  spawnStaffTrip(from: number, to: number, destX: number, cleanUnitId: number): "sent" | "full" | "no-route" {
    return this.crowd.spawnStaff(this.tower, from, to, destX, cleanUnitId);
  }

  /** Whether hotel guests currently count toward the star rating (they stop at 3★). */
  hotelsCountTowardRating(): boolean {
    return this.star < 3;
  }

  /**
   * True when a commuter can actually reach `floor` from the ground lobby in ≤2
   * transport rides (the {@link Crowd.route} cap). A floor can be
   * {@link Tower.isFloorServed} yet return false here — connected, but 3+ rides
   * out, so no commuter ever spawns for it. Runs a fresh bounded (≤2-ride) BFS
   * each call — only Crowd's ADJACENCY graph is cached by `tower.revision`, not
   * the route result. Keep it off the per-FRAME/HUD path. The hourly economy
   * (`collectTrafficIncome`, gating commercial visitor income) does call it, but
   * dedupes per distinct floor within the call, so it's one small bounded BFS
   * per commercial floor per game-hour, not per unit — an acceptable tick cost.
   */
  floorReachable(floor: number): boolean {
    if (floor === 1) return true;
    return this.crowd.route(this.tower, 1, floor) !== null;
  }

  /**
   * Above-ground floors carrying a real tenant that are served (connected) but
   * NOT ≤2-ride reachable — "stranded": they earn rating credit but draw no
   * visitors. BFS-bearing — call only on modal-open or once/day, NEVER in
   * {@link stats} or the tick loop.
   */
  strandedFloors(): number[] {
    // Collect candidate floors first, so the ≤2-ride BFS runs once PER FLOOR,
    // not once per tenant unit (many units share a floor).
    const candidates = new Set<number>();
    for (const u of this.tower.units) {
      if (!isTenantFloorUnit(u)) continue;
      if (!this.tower.isFloorServed(u.floor)) continue; // "not connected" is a separate, inspector-reported state
      candidates.add(u.floor);
    }
    const out: number[] = [];
    for (const floor of candidates) if (!this.floorReachable(floor)) out.push(floor);
    return out.sort((a, b) => a - b);
  }

  /** Like {@link hasAny} but only counts a facility that is finished and intact
   * (not under construction, not on fire). Used by the rating/TOWER gates. */
  hasOperational(kind: FacilityKind): boolean {
    return this.countOperational(kind) > 0;
  }

  /** Count of operational (finished, not-on-fire) units of a kind. */
  countOperational(kind: FacilityKind): number {
    let n = 0;
    for (const u of this.tower.units) {
      if (u.kind === kind && isOperational(u)) n++;
    }
    return n;
  }

  /** A VIP periodically stays in a suite; a favorable review is a 4★ prerequisite
   * (canon). The VIP only stays in an operational, reachable Hotel Suite and is
   * pleased when that suite is genuinely well-run (served + high satisfaction). */
  private maybeVipStay(): void {
    if (this.vipFavorable || this.star < 3) return;
    // The VIP must actually STAY: a suite with a guest in it tonight (asleep) on
    // a served floor, and a happy one. A never-occupied/empty/dirty suite can't
    // earn the review just by existing.
    const suites = this.tower.units.filter(
      (u) => u.kind === "hotelSuite" && u.state === "asleep" && this.tower.isFloorServed(u.floor),
    );
    if (suites.length === 0) return;
    const happy = suites.some((s) => s.satisfaction >= 0.7);
    // Canon: every suite needs a parking space of its own — the VIP arrives by
    // car, and a suite hotel without valet parking never earns the review.
    if (happy && !this.suiteParkingShort()) {
      this.vipFavorable = true;
      this.emit("A VIP enjoyed their suite — your tower earned a favorable review (4★ unlocked).", "good");
      this.triggerVip(); // the VIP's limo pulls up (cosmetic)
    } else if (this.clock.day - this.lastVipNagDay >= 5) {
      // Throttle the nag lines so they can't spam the log every day.
      this.lastVipNagDay = this.clock.day;
      this.emit(
        happy
          ? "🚗 The VIP circled the block and left — every hotel suite needs a working parking space (chained to a ramp)."
          : "A VIP's suite stay was underwhelming. Improve suite access and try again.",
        "info",
      );
    }
  }

  // ---- VIP / TOWER rating ------------------------------------------------

  /** Run the pending VIP/TOWER inspection if its day has arrived. Driven by
   *  `onDay()` in play; public so an end-to-end test can trigger the inspection
   *  directly on a deterministic population (without the crowd sim in the loop). */
  checkVip(): void {
    if (this.evaluatedTower || this.vipVisitDay < 0) return;
    // If the Wedding Hall is gone before the inspection (sold via ANY path —
    // the editor and bulldoze tool call tower.removeUnit directly, not sellAt),
    // cancel the pending visit so it can't keep re-failing and spamming the log.
    if (!this.tower.builtWeddingHall) {
      this.vipVisitDay = -1;
      return;
    }
    if (this.clock.day < this.vipVisitDay) return;
    this.vipVisitDay = -1;
    this.triggerVip(); // the inspecting VIP arrives by limo (cosmetic)
    const pop = this.ratingPopulation();
    const ok =
      this.hasOperational("weddingHall") &&
      this.star >= 5 &&
      this.hasOperational("metro") && // re-checked: selling the metro after 5★ must not allow the win
      pop >= TOWER_POPULATION;
    if (ok) {
      this.star = 6;
      this.evaluatedTower = true;
      this.emit("The VIP was impressed! Your building is now a TOWER. You win!", "good");
    } else {
      this.emit("The VIP was unimpressed. Grow your population and amenities, then rebuild interest.", "bad");
      this.vipVisitDay = this.clock.day + 5;
    }
  }

  // ---- Random events (delegated to EventSystem) --------------------------

  /** Number of units currently on fire (for the UI / stats). */
  get fires(): number {
    return this.events.count;
  }

  /** Human floor label: "floor 5" above ground, "B1"/"B2"… below (floor 0 = B1). */
  floorLabel(floor: number): string {
    return floor >= 1 ? `floor ${floor}` : `B${1 - floor}`;
  }

  /** Ignite a random room (exposed for the debug/event hooks and tests). */
  startFire(): void {
    this.events.startFire();
  }

  /** A bomb scare (exposed for the debug/event hooks and tests). */
  bombThreat(): void {
    this.events.bombThreat();
  }

  /** Cosmetic event-visual hooks the {@link EventSystem} fires (SimContext).
   * They only bump a transient counter the renderer polls — no gameplay, RNG,
   * or save effect — so headless contexts can omit them entirely. */
  triggerSanta(): void {
    this.santaFxSeq++;
  }
  triggerExplosion(floor: number, xTile: number): void {
    this.explosionFx = { floor, x: xTile, seq: this.explosionFx.seq + 1 };
  }
  triggerThief(caught: boolean, floor: number): void {
    this.thiefFx = { caught, floor, seq: this.thiefFx.seq + 1 };
  }
  triggerTreasure(floor: number, xTile: number): void {
    this.treasureFx = { floor, x: xTile, seq: this.treasureFx.seq + 1 };
  }
  triggerVip(): void {
    this.vipFxSeq++;
  }

  /** The player decision awaiting an answer (fire rescue / bomb ransom), or null.
   * The UI renders this and calls {@link resolveChoice}. */
  get pendingChoice(): { kind: "fireRescue" | "bombThreat"; cost: number; message: string } | null {
    return this.events.pending;
  }

  /** Answer the pending event choice: `accept` pays, `decline` takes the default. */
  resolveChoice(option: "accept" | "decline"): void {
    this.events.resolveChoice(option);
  }

  /** Probability a fire on `floor` is contained per day — spatial in v2 (depends
   * on Security/Medical coverage of that floor), tower-wide in v1. */
  fireContainmentChance(floor: number): number {
    return this.events.controlChance(floor);
  }

  /** Daily probability a new fire breaks out, after the fire-defense reductions
   * from any operational Security / Medical center. */
  fireIgnitionChance(): number {
    return this.events.fireChance();
  }

  // ---- Derived stats for UI ---------------------------------------------

  /** Tag money to a stats-breakdown category (positive income, negative
   *  expense). The single funnel EconomySystem and the sale paths route through
   *  so the income breakdown stays in lockstep with `money`. */
  recordMoney(cat: LedgerCat, amount: number): void {
    this.ledger.record(cat, amount);
  }

  /** Record a facility's income/expense against its own report category (net),
   *  a no-op for kinds with no operational money line. */
  recordMoneyFor(kind: FacilityKind, amount: number): void {
    const cat = ledgerCatFor(kind);
    if (cat) this.ledger.record(cat, amount);
  }

  /** The income breakdown for the stats screen: average $/day per category over
   *  the trailing quarter, plus whether any data has accrued yet. */
  incomeBreakdown(): { averages: Record<LedgerCat, number>; hasData: boolean } {
    return { averages: this.ledger.averagePerDay(), hasData: this.ledger.hasData() };
  }

  get population(): number {
    return this.tower.totalPopulation();
  }

  get nextStarThreshold(): number | null {
    if (this.star >= 5) return null;
    return STAR_THRESHOLDS[this.star + 1];
  }

  stats() {
    let offices = 0,
      occupiedOffices = 0,
      condos = 0,
      soldCondos = 0,
      hotelRooms = 0,
      occupiedHotel = 0,
      dirty = 0,
      shops = 0,
      restaurants = 0,
      vacant = 0,
      parkingSpaces = 0;
    for (const u of this.tower.units) {
      if (u.kind === "office") {
        offices++;
        if (isTenanted(u)) occupiedOffices++; // a lame-duck on notice still holds the space
        if (u.state === "empty") vacant++;
      } else if (u.kind === "condo") {
        condos++;
        if (u.everOccupied) soldCondos++;
      } else if (isHotelKind(u.kind)) {
        hotelRooms++;
        if (u.state === "asleep") occupiedHotel++;
        if (u.state === "dirty") dirty++;
      } else if (u.kind === "shop") shops++;
      else if (u.kind === "restaurant" || u.kind === "fastFood") restaurants++;
      else if (u.kind === "parking") parkingSpaces++;
    }
    return {
      population: this.population,
      // Cheap loop-counter field only. The modal-only diagnostics that need a
      // full scan / flood-fill (ratingPopulation, functional parking count) are
      // computed in buildStatsHtml at modal-build time — NOT here, since stats()
      // runs on the ~6 Hz HUD refresh (UI.update).
      parkingSpaces,
      money: this.money,
      star: this.star,
      offices,
      occupiedOffices,
      condos,
      soldCondos,
      hotelRooms,
      occupiedHotel,
      dirty,
      shops,
      restaurants,
      vacant,
      floors: this.tower.highestFloor,
      basements: Math.max(0, 1 - this.tower.lowestFloor),
      elevators: this.tower.transports.filter((t) => isElevatorKind(t.kind)).length,
      transports: this.tower.transports.length,
      fires: this.events.count,
    };
  }

  // ---- Serialization -----------------------------------------------------

  serialize(): SerializedGame {
    return {
      version: SAVE_VERSION,
      seed: this.rng.seed,
      money: this.money,
      star: this.star,
      minutes: this.clock.minutes,
      mode: this.mode,
      units: this.tower.units.map((u) => ({ ...u })),
      transports: this.tower.transports.map((t) => ({
        ...t,
        // Deep-copy every per-car/array field so a retained snapshot can't be
        // mutated later by in-place updates (carLoad is written each tick).
        carPositions: [...t.carPositions],
        carDir: [...t.carDir],
        carLoad: t.carLoad ? [...t.carLoad] : undefined,
        skipFloors: t.skipFloors ? [...t.skipFloors] : undefined,
      })),
      nextId: this.tower.getNextId(),
      towerName: this.tower.towerName,
      builtWeddingHall: this.tower.builtWeddingHall,
      evaluatedTower: this.evaluatedTower,
      vipVisitDay: this.vipVisitDay,
      vipFavorable: this.vipFavorable,
      treasuresFound: this.treasuresFound,
      events: this.events.saveState(),
      excavated: [...this.excavated],
      blockbusters: this.economy.blockbusterIds,
      milestones: [...this.achievedMilestones],
      ledger: this.ledger.serialize(),
    };
  }

  static deserialize(raw: SerializedGame): Simulation {
    // Run the save through the version seam first, then harden every field below.
    const data = migrateSave(raw);
    // Mode is founded at creation and immutable, so it comes straight from the
    // save. A save that predates the fork (or a forged value) has no valid mode
    // ⇒ classic, keeping every legacy tower pixel-faithful with no migration.
    const sim = new Simulation(data.seed, isGameMode(data.mode) ? data.mode : "classic");
    sim.money = data.money;
    sim.star = data.star;
    sim.clock = new Clock(data.minutes);
    sim.evaluatedTower = data.evaluatedTower;
    // Restore the pending VIP inspection so saving during the post-Wedding-Hall
    // window doesn't permanently cancel the TOWER evaluation.
    sim.vipVisitDay = data.vipVisitDay ?? -1;
    sim.vipFavorable = data.vipFavorable ?? false;
    // Clamp ≥0 (untrusted save): a negative value would keep `treasuresFound < 3`
    // true forever and re-open the treasure farm.
    sim.treasuresFound = Math.max(
      0,
      typeof data.treasuresFound === "number" && Number.isFinite(data.treasuresFound) ? data.treasuresFound : 0,
    );
    // Restore excavation history so buried treasure stays one-time per tile across
    // a save/reload (otherwise the build/bulldoze exploit reopens on load).
    if (Array.isArray(data.excavated)) {
      for (const k of data.excavated) if (typeof k === "string") sim.excavated.add(k);
    }
    // Restore this month's blockbuster bookings (already paid for pre-save).
    if (Array.isArray(data.blockbusters)) sim.economy.restoreBlockbusters(data.blockbusters);
    // Restore achieved milestones so reload doesn't re-announce them.
    if (Array.isArray(data.milestones)) {
      for (const id of data.milestones) if (typeof id === "string") sim.achievedMilestones.add(id);
    }
    // Restore the income-breakdown ledger (absent in pre-ledger saves → empty,
    // warming up as play continues).
    sim.ledger = Ledger.restore(data.ledger);
    // Reject any unit/transport with an unrecognized kind from untrusted saves,
    // and coerce the numeric fields that drive the loop to finite values so a
    // hand-edited or foreign save can't poison the math with NaN/undefined.
    const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
    sim.tower.units = (data.units ?? [])
      .filter((u) => isFacilityKind(u.kind))
      .map((u) => {
        // Coerce geometry to finite integers, and keep the whole FOOTPRINT on
        // the lot (not just the origin): forged floor/x/width would otherwise
        // flow into renderer math (silhouette edges, lobby variant indexing,
        // actor positions) as NaN/Infinity, make a per-tile draw loop iterate
        // an absurd width, or hang a span/multi-story room off the lot edge.
        const stories = facilityFloors(u.kind);
        const floor = Math.max(GRID.minFloor, Math.min(GRID.maxFloor - (stories - 1), Math.round(num(u.floor, 1))));
        const x = Math.max(0, Math.min(GRID.width - 1, Math.round(num(u.x, 0))));
        const width = Math.max(1, Math.min(GRID.width - x, Math.round(num(u.width, FACILITIES[u.kind].width))));
        // Coerce the free-form state first (a forged `state` would flow into UI
        // innerHTML and state-machine compares); the sold/leased flag below reads it.
        const state = isUnitState(u.state) ? u.state : "empty";
        // Harden the "currently sold/leased" flag at the trust boundary: only a
        // literal `true` counts (a forged "yes" must not mark a condo sold), AND —
        // for a LEASE/SALE unit (office, condo), whose everOccupied means "currently
        // leased/sold" — a shell state (empty, construction, gutted) is definitionally
        // NOT currently owned, so the flag is normalized to false even if the save
        // left it true. That rescues a LEGACY "dead" condo whose owner left back when
        // `vacate()` kept `everOccupied` set (else it reloads sold-but-empty and, since
        // sales require `!everOccupied`, sits off-market forever) and blocks a forged
        // shell from doing the same. (A sold unit that's on fire IS still owned, so
        // `fire` is not cleared.) HOTELS are exempt: their everOccupied means "ever
        // booked" and legitimately stays true while the room sits `empty` between
        // guests (turnover runs through `state`, not this flag).
        const notOwned = state === "empty" || state === "construction" || state === "gutted";
        const everOccupied = u.everOccupied === true && !(notOwned && !isHotelKind(u.kind));
        const soldCondo = u.kind === "condo" && everOccupied;
        // Player-set price, coerced to a finite number, then bounded for condos.
        // An UNSOLD condo re-enters the current band ($80k–$200k) so a legacy save
        // priced at the old min/max ($60k/$240k) can't sell below build cost or
        // above the new ceiling (or render past the slider ends). A SOLD condo
        // keeps its historical price so the buy-back mirrors what it sold for, but
        // is still bounded to the widest-ever band so a forged `rent` can't drive
        // an unbounded buy-back money drain.
        let rent = u.rent === undefined ? undefined : num(u.rent, rentConfig(u.kind)?.default ?? 0);
        if (rent !== undefined && u.kind === "condo") {
          const band = rentConfig("condo")!;
          const lo = soldCondo ? SOLD_CONDO_MIN_PRICE : band.min;
          const hi = soldCondo ? SOLD_CONDO_MAX_PRICE : band.max;
          rent = Math.max(lo, Math.min(hi, rent));
        }
        return {
          ...u,
          floor,
          x,
          width,
          everOccupied,
          // A non-string `label` would crash the escaping at render.
          state,
          label: typeof u.label === "string" ? u.label : FACILITIES[u.kind].name,
          satisfaction: Math.max(0, Math.min(1, num(u.satisfaction, 1))),
          occupants: Math.max(0, num(u.occupants, 0)),
          // Household size — only kept for a CURRENTLY-sold condo, and sanitized by
          // the rule-set (Classic strips it so its condos read the flat 3; Modern
          // clamps into the 2..5 generator band). A not-sold condo (legacy dead
          // unit, empty/gutted, or a hand-edited save) carries none, so a stale
          // household can't leak into the census or a per-unit occupancy readout;
          // the next sale draws fresh.
          residents: soldCondo ? sim.rules.coerceResidents(u.residents) : undefined,
          pendingIncome: num(u.pendingIncome, 0),
          rent,
          // Coerce the film policy so a hand-edited save can't inject a bad value
          // (undefined ⇒ auto, the legacy behavior).
          filmPolicy:
            u.filmPolicy === "feature" || u.filmPolicy === "blockbuster" || u.filmPolicy === "auto"
              ? u.filmPolicy
              : undefined,
          // Preserve an in-progress eviction across save/reload, hardened like
          // every other loop-driving field: an out-of-set reason or a non-finite
          // deadline from a forged save must not reach the toast / state machine.
          vacateReason: isVacateReason(u.vacateReason) ? u.vacateReason : undefined,
          vacateAt: u.vacateAt === undefined ? undefined : num(u.vacateAt, 0),
        };
      });
    sim.tower.transports = (data.transports ?? [])
      .filter((t) => isFacilityKind(t.kind))
      .map((t) => {
        // Coerce car counts/positions from an untrusted save: a NaN/negative/huge
        // `cars` would otherwise reach `new Array(cars)` in the dispatcher and
        // throw a RangeError (or OOM) on the very next tick.
        const maxCars = isElevatorKind(t.kind) ? maxCarsFor(t.kind) : 0;
        const cars = Math.max(0, Math.min(maxCars, Math.floor(num(t.cars, 0))));
        // Clamp the span to the lot: an unbounded forged bottom/top would give
        // the shaft an absurd height (its banded graphic loop scales with it).
        // Bottom caps at maxFloor - 1 so the top > bottom rule below can't be
        // forced past maxFloor by a forged bottom.
        const bottom = Math.max(GRID.minFloor, Math.min(GRID.maxFloor - 1, Math.round(num(t.bottom, 1))));
        // A transport must have height (validateTransport requires top > bottom);
        // never deserialize a zero-height shaft from a corrupt save.
        const top = Math.max(bottom + 1, Math.min(GRID.maxFloor, Math.round(num(t.top, bottom + 1))));
        const fixLen = (arr: unknown, fill: number) =>
          Array.from({ length: cars }, (_, i) =>
            Array.isArray(arr) ? num(arr[i], fill) : fill,
          );
        return {
          ...t,
          // Same geometry hardening as units: keep the shaft's whole width on
          // the lot (shaft width is fixed per kind, not save-controlled).
          x: Math.max(0, Math.min(GRID.width - FACILITIES[t.kind].width, Math.round(num(t.x, 0)))),
          bottom,
          top,
          cars,
          carPositions: fixLen(t.carPositions, bottom),
          carDir: fixLen(t.carDir, 0),
          carLoad: t.carLoad ? fixLen(t.carLoad, 0) : undefined,
          skipFloors: Array.isArray(t.skipFloors)
            ? t.skipFloors.filter((n) => typeof n === "number" && Number.isFinite(n))
            : undefined,
        };
      });
    // Ids drive every by-id lookup — and the renderer keys its retained actors
    // by them — so they must be sane and unique, and the id counter must sit
    // above them all (a corrupt/hand-edited nextId would otherwise mint
    // duplicates for new placements, permanently drawing the wrong room).
    // "Sane" is stricter than finite: a forged id near/past 2^53 would make
    // the ++ repair (and allocateId later) a precision no-op that re-mints the
    // same id forever, so ids must be positive integers under a bound no legit
    // tower approaches. Max over the SANE ids only, then hand each corrupt or
    // duplicated id a fresh one.
    const ID_CAP = 2 ** 31; // ~2.1e9 placements — far past any real save
    const saneId = (n: unknown): n is number =>
      typeof n === "number" && Number.isInteger(n) && n > 0 && n < ID_CAP;
    const entities: { id: number }[] = [...sim.tower.units, ...sim.tower.transports];
    let maxLoadedId = 0;
    for (const e of entities) if (saneId(e.id) && e.id > maxLoadedId) maxLoadedId = e.id;
    const seenIds = new Set<number>();
    for (const e of entities) {
      if (!saneId(e.id) || seenIds.has(e.id)) e.id = ++maxLoadedId;
      seenIds.add(e.id);
    }
    // The saved counter gets the same sanity gate: a forged huge nextId would
    // otherwise win the max and park the counter where ++ stops incrementing.
    const savedNextId = saneId(data.nextId) ? data.nextId : 0;
    sim.tower.setNextId(Math.max(savedNextId, maxLoadedId + 1));
    sim.tower.towerName = data.towerName;
    sim.tower.builtWeddingHall = data.builtWeddingHall;
    sim.tower.reindex();
    // Resume any in-progress construction and ongoing fires.
    for (const u of sim.tower.units) {
      if (u.state === "construction") sim.constructing.add(u.id);
    }
    sim.events.restore(sim.tower.units.filter((u) => u.state === "fire").map((u) => u.id));
    // Resume the seasonal-event RNG and Santa's once-a-year guard so a save can't
    // make Santa re-visit (or thieves replay) the same in-game year.
    sim.events.loadState(data.events);
    // Recompute today's sky so a freshly loaded game doesn't show stale weather
    // until the next day boundary.
    sim.weather = Simulation.weatherFor(sim.clock.day);
    sim.lastDay = sim.clock.day;
    sim.lastQuarter = sim.clock.quarter;
    sim.lastMonth = Math.floor(sim.clock.day / 30);
    sim.lastHour = sim.clock.hour;
    // Silently adopt any milestone already satisfied at load time (e.g. a save
    // that predates this feature) so the next day doesn't spam a burst of
    // headlines for goals the player already earned. Runs last — after the tower,
    // transports and clock are fully restored — so the predicates read real state.
    for (const m of MILESTONES) if (!sim.achievedMilestones.has(m.id) && m.test(sim)) sim.achievedMilestones.add(m.id);
    return sim;
  }

  /** Convenience for the initial empty lot (ground lobby seed). The `mode`
   *  chosen at the New Tower screen is baked in here, at creation, and is
   *  immutable for the tower's life. */
  static newGame(seed = 12345, mode: GameMode = "classic"): Simulation {
    const sim = new Simulation(seed, mode);
    // Seed a starter ground-floor lobby strip so the player has a base.
    const startX = Math.floor(GRID.width / 2) - 20;
    for (let i = 0; i < 40; i++) {
      sim.tower.place("lobby", 1, startX + i);
    }
    sim.emit("Welcome! Build floors, add elevators, and attract tenants.", "info");
    return sim;
  }
}
