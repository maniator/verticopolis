import type { SimContext } from "./SimContext";
import { REAL_WORLD } from "./calendar";
import { MODERN_RULES } from "./gameRules";
import { isOperational, isTenanted } from "./types";
import { ECON, rentOf, isOverheadKind } from "./econConfig";
import { FACILITIES, attendanceCap, isCommercialKind, isElevatorKind, isHotelKind, isOpenAt, openHoursPerDay, syncAttendanceOccupants } from "./facilities";
import { ledgerCatFor, type LedgerCat } from "./Ledger";
import { subtypeListFor } from "./retailSubtypes";
import { Housekeeping } from "./economy/housekeeping";
import { computeDemandMap } from "./sim/demand";

/** Canon "commercial must be near a lobby": a shop/food venue more than this many
 *  floors from the nearest (sky) lobby draws far fewer shoppers (W3). Exported so
 *  the inspector's "too far from a lobby" line reads the exact same threshold. */
export const COMMERCIAL_LOBBY_FLOORS = 2;
/** Share of normal traffic income a commercial unit earns when it is beyond
 *  {@link COMMERCIAL_LOBBY_FLOORS} of a lobby — poor placement starves its trade,
 *  the same way an unserved floor already earns nothing. */
const COMMERCIAL_LOBBY_FAR_MULT = 0.5;

/** Each open hour multiplies a venue's take by a foot-traffic factor drawn
 *  uniformly in [MIN, MIN + SPAN). It is pure day-to-day noise, so its mean is
 *  what a venue earns "on an average day". The inspector normalizes patronage
 *  against that mean (see {@link TRAFFIC_FACTOR_MEAN}) so its verdict measures
 *  the levers a player controls (appeal, placement, weather), not the dice. */
export const TRAFFIC_FACTOR_MIN = 0.6;
export const TRAFFIC_FACTOR_SPAN = 0.4;
/** Expected foot-traffic factor over a full trading day (the midpoint of the
 *  draw's range). A venue at full appeal, well placed, on a dry day settles
 *  here, so it is the reference the inspector scores against. */
export const TRAFFIC_FACTOR_MEAN = TRAFFIC_FACTOR_MIN + TRAFFIC_FACTOR_SPAN / 2;

/** The housekeeping day shift: guests check out at its start and dispatch
 *  keeps sending crews each hour through its end. The two hours are coupled
 *  (checkout must open the shift), so they live side by side here. */
export const HK_SHIFT_START = 8;
export const HK_SHIFT_END = 19;

/**
 * The money loop — rent, foot-traffic income, hotel revenue, housekeeping and
 * maintenance — pulled out of {@link Simulation} so the economy can be reasoned
 * about and tested on its own against a {@link SimContext}. The Simulation still
 * decides *when* each runs (hourly / daily / monthly / quarterly); this just
 * holds the *what*.
 */
export class EconomySystem {
  /** Hotel housekeeping dispatch (friend module owning the transient shift
   *  ledger). Driven from {@link hotelCheckout} and the hourly dispatch. Built
   *  in the constructor body (not a field initializer) so it never reads `sim`
   *  before the parameter property is assigned, whatever the compile target. */
  private readonly housekeeping: Housekeeping;

  constructor(private readonly sim: SimContext) {
    this.housekeeping = new Housekeeping(sim);
  }

  /** Cinemas showing a blockbuster this month (booked in payMaintenance): they
   * cost more to book but draw bigger crowds. Serialized so a mid-month reload
   * keeps the boost that was already paid for. */
  private blockbusters = new Set<number>();

  /** Snapshot / restore the blockbuster bookings across save/load. */
  get blockbusterIds(): number[] {
    return [...this.blockbusters];
  }

  /** Live read-only view of the bookings (no copy), for the sim loop to prime
   *  the crowd's venue-visit weighting each step. */
  get blockbusterSet(): ReadonlySet<number> {
    return this.blockbusters;
  }
  restoreBlockbusters(ids: number[]): void {
    this.blockbusters = new Set(ids.filter((n) => typeof n === "number" && Number.isFinite(n)));
  }

  /** True if a finished, intact unit of `kind` exists (ignores under-construction
   * / on-fire) — so income effects key off an OPERATIONAL metro/recycling. */
  private hasOperational(kind: string): boolean {
    return this.sim.tower.units.some(
      (u) => u.kind === kind && isOperational(u),
    );
  }

  /** Quarterly office rent from occupied, reachable offices — a tenant on
   *  notice (`vacating`) is still in the space and keeps paying until they go. */
  collectRent(): void {
    let total = 0;
    let count = 0;
    for (const u of this.sim.tower.units) {
      if (u.kind === "office" && isTenanted(u) && this.sim.tower.isFloorServed(u.floor)) {
        total += rentOf(u);
        count++;
      }
    }
    // Income-invariant calendar rescale: rent collects once per quarter, so a
    // shorter quarter must pay proportionally less to keep a tower's income per
    // in-game day unchanged. Canon's 3-day quarter pays 3/90 = 1/30 of a
    // real-world collection, thirty times as often. The divisor is
    // REAL_WORLD.quarterDays (not a bare 90) so the real-world factor is
    // structurally exactly 1 (byte-identical) and can't drift if that constant
    // is ever retuned. Round once on the summed total so per-office rounding
    // can't accumulate (`total` is a sum of integer rents). See
    // gdd/arch-classic-calendar-parity-2026-07-08.
    const collected = Math.round((total * this.sim.clock.calendar.quarterDays) / REAL_WORLD.quarterDays);
    if (collected > 0) {
      this.sim.money += collected;
      this.sim.recordMoney?.("offices", collected);
      this.sim.emit(`Quarterly office rent collected: $${collected.toLocaleString()} (${count} offices).`, "money");
    }
  }

  /** Hourly food/retail/entertainment takings, scaled by foot traffic. */
  collectTrafficIncome(): void {
    // Per-venue demand fractions replace the old tower-wide appeal scalar: each
    // reachable venue earns a share of its daily figure driven by the connected
    // census split across the reachable venues (commercial demand pools). Pure
    // and deterministic, so it adds no draw to the seeded economy stream.
    const demandMap = computeDemandMap(this.sim);
    // Visitor income obeys the two-ride rule: a floor more than two rides from
    // the lobby draws no patrons (the same "no visitors will come" condition the
    // stranded-floor advisory reports), so its commercial rooms earn nothing —
    // the transport puzzle has real economic teeth, not just a warning. This is
    // stricter than mere connectivity (`isFloorServed`): a floor with no
    // admissible two-ride route (3+ rides, or a Classic express transfer away
    // from any lobby) is served but unreachable to visitors, and earns $0.
    // Memoized per call since the route BFS isn't free and rooms share floors.
    const reachCache = new Map<number, boolean>();
    const drawsVisitors = (floor: number): boolean => {
      const cached = reachCache.get(floor);
      if (cached !== undefined) return cached;
      // Two-ride reachability when the context provides it (the real sim);
      // minimal test contexts without a crowd fall back to plain connectivity.
      const hit = this.sim.floorReachable
        ? this.sim.floorReachable(floor)
        : this.sim.tower.isFloorServed(floor);
      reachCache.set(floor, hit);
      return hit;
    };
    // Whether a metro softens rain's hit to traffic is a tower-wide fact, so
    // resolve it once here rather than per unit inside the loop below.
    const rainMetroRelief = this.sim.weather === "rain" && this.hasOperational("metro");
    // Weekday/weekend is a tower-wide, deterministic fact too (#398): resolve the
    // rule-set and the calendar phase once, then read the per-kind multiplier per
    // venue below. Draws no RNG, so the seeded economy stream is unperturbed.
    const rules = this.sim.rules ?? MODERN_RULES;
    const isWeekend = this.sim.clock.isWeekend;
    for (const u of this.sim.tower.units) {
      const daily = ECON.dailyTrafficIncome[u.kind];
      if (daily === undefined) continue;
      if (!isOperational(u)) continue; // gutted/burning/under-construction earn nothing (and must not be revived to "occupied" below)
      // Attendance venues (cinema / party hall) keep occupants owned by the
      // live-attendance mirror on every path below: a stranded or closed
      // house drains through its visitors' departures, never a stamped 0
      // over people still inside, and the open-hour stamp must not write the
      // catalog population (0) over a mid-show mirror.
      // `attendanceCap(kind)` IS `FACILITIES[kind].attendance`; using the named
      // helper keeps this classification identical to the one `demand.ts` uses to
      // drop attendance venues from the pool, so a venue can never be excluded from
      // the pool on one side yet read a pool fraction on the other.
      const attendanceCapV = attendanceCap(u.kind);
      const attends = attendanceCapV !== undefined;
      if (!drawsVisitors(u.floor)) {
        // Unreachable within two rides (stranded, or not connected at all) → no
        // patrons. Clear any lingering occupancy so a newly-stranded venue reads
        // empty instead of frozen at its last busy state.
        if (u.state === "occupied") {
          if (attends) syncAttendanceOccupants(u);
          else u.occupants = 0;
        }
        continue;
      }
      if (!isOpenAt(u.kind, this.sim.clock.hour)) {
        // Closed for the night: no patrons.
        if (u.state === "occupied") {
          if (attends) syncAttendanceOccupants(u);
          else u.occupants = 0;
        }
        continue;
      }
      u.state = "occupied";
      // Stamp the ambient crowd at the flip too: updatePresence ran earlier in
      // this same onHour and saw a newly built or newly reachable venue still
      // `empty`, so without this the first open hour has dark windows, a cold
      // heatmap cell, and no statistical elevator demand until the next hour
      // (review P2). Idempotent for already-occupied venues: it writes the
      // same value updatePresence just did.
      if (attends) syncAttendanceOccupants(u);
      else u.occupants = FACILITIES[u.kind].population;
      // This venue's demand share (0..1), the per-venue replacement for the old
      // tower-wide appeal. Retail venues read the connected-census demand pool.
      // Attendance venues (cinema / party hall) read their own live-attendance
      // fill instead (#424): their take tracks how full the house is, clamped to
      // [0, 1], rather than diluting, or being diluted by, the retail pool they are
      // no longer part of. The clamp guards both ends: `max(0, ...)` so a forged
      // negative counter cannot pay negative income, and `min(1, ...)` so an
      // over-full house never beats a sold-out one. The `> 0` cap guard mirrors the
      // retail `spend > 0` guard below, so a forged 0 cap cannot divide. A booked
      // blockbuster raises this fill (its bigger drawn crowd) AND the `filmMult`
      // below, so the premium compounds in an under-filled house, but the `min(1,
      // ...)` cap holds a sold-out blockbuster to exactly `filmMult` times the
      // advertised figure, so income can never run away. The retail `?? 0` is a
      // guard, not an expected path (a reachable, open retail venue always has a
      // map entry).
      const frac =
        attendanceCapV !== undefined
          ? attendanceCapV > 0
            ? Math.min(1, Math.max(0, u.customersIn ?? 0) / attendanceCapV)
            : 0
          : (demandMap.fractionByUnit.get(u.id) ?? 0);
      // Rain keeps shoppers away (canon) — it bites fast food hardest; a metro
      // (underground visitors) softens the blow. Cosmetic-only on non-rainy days.
      // Any venue with an attendance cap (`attendanceCapV !== undefined`) is
      // excluded (#430): those are the live-fill kinds (cinema and party hall
      // today), whose income reads the live-attendance `frac` above, and rain now
      // thins that crowd at the spawn layer (GameRules.rainCrowdFactor), so a flat
      // multiplier here would double-count the weather. Rain reaches an attendance
      // house through its emptier seats, the one source of truth. Keying on the cap
      // (not a kind list) also covers any future attendance kind, and wedding hall,
      // which has a cap but no `dailyTrafficIncome` and so returns above before it
      // ever reaches this line. Retail income is statistical (it does not read the
      // drawn crowd), so retail keeps rainMult as its only rain channel.
      const rainMult =
        this.sim.weather === "rain" && attendanceCapV === undefined
          ? (rainMetroRelief ? 0.7 : 0.5) * (u.kind === "fastFood" ? 0.6 : 1)
          : 1;
      // A cinema showing a blockbuster this month draws a much bigger crowd — it
      // has to more than cover the doubled booking fee at healthy traffic (a
      // +70% bump never could, since appeal is capped at 1), so a blockbuster is
      // a genuine upside in a busy tower and a gamble in a quiet one.
      const filmMult = u.kind === "cinema" && this.blockbusters.has(u.id) ? 2.2 : 1;
      // W3 commercial-near-lobby: a canon commercial venue (fast food, restaurant,
      // shop, cinema — NOT partyHall, which is outside the canon set) more than two
      // floors from any (sky) lobby draws far fewer shoppers — poor placement
      // starves its traffic without evicting it (commercial has no lease). Ground
      // (floor 1) always anchors as a lobby, so floors 1–3 are always fine; deeper
      // commercial needs a sky lobby.
      const lobbyMult =
        isCommercialKind(u.kind) &&
        this.sim.tower.nearestLobbyFloorDistance(u.floor) > COMMERCIAL_LOBBY_FLOORS
          ? COMMERCIAL_LOBBY_FAR_MULT
          : 1;
      // Spread the headline DAILY take across the venue's actual open hours so a
      // full day earns ≈ `daily * appeal`, not a per-hour multiple of it. (Before,
      // dividing by a flat 8 while open 9–15 h/day inflated income 2–3x.)
      // Weekday/weekend retail swing (#398): Classic matches the 1994 targets
      // (retail busier on weekends), Modern reads a realistic rhythm (fast food
      // quiets, restaurants and shops pick up). A weekday, or a non-retail kind,
      // reads 1.0. Attendance venues (cinema, party hall) are excluded on purpose:
      // their `frac` is the live-attendance fill, which the crowd already spawns
      // with a weekday/weekend rhythm (#424), so a flat multiplier here would
      // double-count the weekend.
      const weekendMult =
        attendanceCapV !== undefined ? 1 : rules.weekendMultiplier(u.kind, isWeekend);
      const trafficFactor = TRAFFIC_FACTOR_MIN + this.sim.rng.next() * TRAFFIC_FACTOR_SPAN;
      const openH = openHoursPerDay(u.kind);
      const hourly =
        (daily / openH) *
        frac *
        rainMult *
        filmMult *
        lobbyMult *
        weekendMult *
        trafficFactor;
      u.pendingIncome += hourly;
      // Retail-only "today's patronage" for the inspector card. The one RNG
      // draw above feeds BOTH the money loop and the customer estimate, so the
      // stream stays byte-identical: this accumulator must not perturb the
      // seeded economy. Cinema/partyHall have traffic income but no canon
      // subtype, so they skip this seam too. Guard on `spend > 0` (not just
      // `!== undefined`) so a config forgery of 0 can't emit `Infinity` into
      // the field.
      const spend = ECON.retailSpendPerCustomer[u.kind];
      const isRetail = subtypeListFor(u.kind) !== null && spend !== undefined && spend > 0;
      if (isRetail) {
        const custPerHourAtBaseline = daily / (spend * openH);
        u.patronageToday =
          (u.patronageToday ?? 0) +
          custPerHourAtBaseline * frac * rainMult * lobbyMult * weekendMult * trafficFactor;
      }
      if (u.pendingIncome >= 1) {
        const earned = Math.floor(u.pendingIncome);
        u.pendingIncome -= earned;
        this.sim.money += earned;
        const cat = ledgerCatFor(u.kind);
        if (cat) this.sim.recordMoney?.(cat, earned);
        // Sum the flushed integer dollars (never the pre-flush float) so
        // "Yesterday's profit" mirrors the day's actual ledger contribution
        // to the penny, not a fractional projection. A shop whose hourly take
        // stays under $1 all day banks $0 and reads $0, honest.
        if (isRetail) u.profitToday = (u.profitToday ?? 0) + earned;
      }
    }
  }

  /** Morning hotel checkout: collect revenue and mark rooms dirty. Cleaning is
   *  NOT instant: housekeepers are dispatched through the day and a room only
   *  turns over when one physically arrives (see {@link dispatchHousekeepers}). */
  hotelCheckout(): void {
    // Report yesterday's shift and breed overnight cockroaches BEFORE this
    // morning's checkouts mark their rooms dirty.
    this.housekeeping.beforeCheckout();
    let revenue = 0;
    for (const u of this.sim.tower.units) {
      if (!isHotelKind(u.kind)) continue;
      if (u.state === "asleep") {
        revenue += rentOf(u);
        // Guest leaves; the room is now DIRTY and cannot be re-let until
        // housekeeping services it.
        u.state = "dirty";
        u.occupants = 0;
      }
    }
    if (revenue > 0) {
      this.sim.money += revenue;
      this.sim.recordMoney?.("hotels", revenue);
      this.sim.emit(`Hotel guests checked out: $${revenue.toLocaleString()} earned overnight.`, "money");
    }
    // Fresh shift after the checkouts: each crew re-seeds with full capacity on
    // its first dispatch today (also how crews built mid-shift join the day).
    this.housekeeping.resetShift();
  }

  /** Send housekeepers to dirty rooms (delegated to the housekeeping module).
   *  Called each hour through the day shift. */
  dispatchHousekeepers(): void {
    this.housekeeping.dispatch();
  }

  /** A dispatched housekeeper finished (delegated to the housekeeping module). */
  onHousekeeperResult(roomId: number, ok: boolean): void {
    this.housekeeping.onResult(roomId, ok);
  }

  /** Monthly upkeep for elevator cars and staffed service facilities. */
  payMaintenance(): void {
    let cost = 0;
    // Fresh film bookings each month: drop last month's blockbusters (incl. any
    // on now-removed or on-fire cinemas) before re-rolling below.
    this.blockbusters.clear();
    // Transport upkeep and staffed-service upkeep both land in the ledger's
    // `upkeep` line; revenue-room carrying costs (overhead, condo tax, film
    // bookings) are charged against that room's own category so each revenue
    // line reads NET. rec() mirrors every cost into the breakdown as it accrues.
    const rec = (cat: LedgerCat, amount: number) => this.sim.recordMoney?.(cat, -amount);
    // Income-invariant calendar rescale (mirrors collectRent): maintenance rides
    // the calendar's period, so a shorter period charges proportionally less to
    // keep per-in-game-day upkeep unchanged. Canon's 3-day period pays 3/30 =
    // 1/10, ten times as often; real-world's period is REAL_WORLD.maintPeriodDays
    // so the factor is structurally exactly 1 (byte-identical), not a bare 30
    // that could drift from the constant. `charge` rounds per item so `cost`
    // (money) always equals the sum mirrored into the ledger; every shipped
    // maintenance constant is a multiple of 10, so the canon 1/10 stays exact.
    // See gdd/arch-classic-calendar-parity.
    const scale = this.sim.clock.calendar.maintPeriodDays / REAL_WORLD.maintPeriodDays;
    const charge = (cat: LedgerCat, raw: number): void => {
      const a = Math.round(raw * scale);
      cost += a;
      rec(cat, a);
    };
    for (const t of this.sim.tower.transports) {
      if (isElevatorKind(t.kind)) {
        charge("upkeep", t.cars * ECON.maintenancePerCarMonthly);
      }
    }
    // The Modern-only economy sinks read through the rule-set, constant for the
    // whole maintenance run, so resolve it once outside the per-unit loop. A
    // minimal hand-rolled test context may omit `rules`; fall back to Modern (the
    // pre-split "all towers charged" behavior) so nothing silently changes.
    const rules = this.sim.rules ?? MODERN_RULES;
    const taxRate = rules.condoHoldTaxRate();
    const overhead = rules.operatingOverheadPerUnit();
    for (const u of this.sim.tower.units) {
      const m = ECON.serviceMaintenanceMonthly[u.kind];
      if (m && u.state !== "gutted") {
        charge("upkeep", m); // a gutted service room is destroyed — no upkeep
      }
      const operational = isOperational(u);
      // Property tax on an unsold condo: a real carrying cost for holding out
      // for a premium sale (scales with the asking price). Modern-only sink;
      // Classic's rate is 0 (the original had no such tax).
      if (taxRate > 0 && u.kind === "condo" && !u.everOccupied && operational) {
        charge("condos", Math.ceil(rentOf(u) * taxRate));
      }
      // Operating overhead on space HELD (regardless of occupancy/served) — makes
      // a vacant or unserved floor pure carrying cost. Sold condos are exempt:
      // their income was a one-time sale already banked, so a permanent per-month
      // drain on them would be punitive rather than a live decision. Modern-only
      // sink; Classic's overhead is 0 (pixel-faithful late-game economy).
      if (overhead > 0 && operational && isOverheadKind(u.kind) && !(u.kind === "condo" && u.everOccupied)) {
        charge(ledgerCatFor(u.kind) ?? "upkeep", overhead);
      }
      // A cinema books a film each month (canon: 150k average / 300k
      // blockbuster). The player sets a per-cinema policy; only "auto" consumes
      // RNG (in the same order as before), so default cinemas are stream-identical.
      // On fire / under construction it books nothing (flag cleared above).
      if (u.kind === "cinema" && operational) {
        const policy = u.filmPolicy ?? "auto";
        const blockbuster =
          policy === "blockbuster" ? true : policy === "feature" ? false : this.sim.rng.chance(0.4);
        const booking = blockbuster ? ECON.cinemaBookingBlockbuster : ECON.cinemaBookingMonthly;
        if (blockbuster) this.blockbusters.add(u.id);
        charge("entertainment", booking);
      }
    }
    if (cost > 0) {
      this.sim.money -= cost;
      // Real-world's period genuinely is a 30-day month, so it keeps the exact
      // "Monthly maintenance paid" string (byte-identical). Canon has no month (a
      // year is 12 days), so it drops the word rather than lie.
      const monthly = this.sim.clock.calendar.maintPeriodDays === REAL_WORLD.maintPeriodDays;
      this.sim.emit(`${monthly ? "Monthly maintenance" : "Maintenance"} paid: $${cost.toLocaleString()}.`, "money");
    }
  }
}
