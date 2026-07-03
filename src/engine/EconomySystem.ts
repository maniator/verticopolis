import type { SimContext } from "./SimContext";
import { isOperational } from "./types";
import { ECON, rentOf, isOverheadKind } from "./econConfig";
import { RECYCLING_POP_PER_CENTER, isElevatorKind, isHotelKind, isOpenAt, openHoursPerDay } from "./facilities";

/** Rooms one housekeeping crew can turn over per day. */
const HK_ROOMS_PER_CREW = 20;
/** Housekeepers a single crew keeps in transit at once (jobs queue behind). */
const HK_MAX_IN_FLIGHT = 4;
/** The housekeeping day shift: guests check out at its start and dispatch
 *  keeps sending crews each hour through its end. The two hours are coupled —
 *  checkout must open the shift — so they live side by side here. */
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
  constructor(private readonly sim: SimContext) {}

  /** Cinemas showing a blockbuster this month (booked in payMaintenance): they
   * cost more to book but draw bigger crowds. Serialized so a mid-month reload
   * keeps the boost that was already paid for. */
  private blockbusters = new Set<number>();

  /** Snapshot / restore the blockbuster bookings across save/load. */
  get blockbusterIds(): number[] {
    return [...this.blockbusters];
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

  /** Quarterly office rent from occupied, reachable offices. */
  collectRent(): void {
    let total = 0;
    let count = 0;
    for (const u of this.sim.tower.units) {
      if (u.kind === "office" && u.state === "occupied" && this.sim.tower.isFloorServed(u.floor)) {
        total += rentOf(u);
        count++;
      }
    }
    if (total > 0) {
      this.sim.money += total;
      this.sim.emit(`Quarterly office rent collected: $${total.toLocaleString()} (${count} offices).`, "money");
    }
  }

  /** Hourly food/retail/entertainment takings, scaled by foot traffic. */
  collectTrafficIncome(): void {
    const appeal = this.trafficAppeal();
    for (const u of this.sim.tower.units) {
      const daily = ECON.dailyTrafficIncome[u.kind];
      if (daily === undefined) continue;
      if (!isOperational(u)) continue; // gutted/burning/under-construction earn nothing (and must not be revived to "occupied" below)
      if (!this.sim.tower.isFloorServed(u.floor)) continue;
      if (!isOpenAt(u.kind, this.sim.clock.hour)) {
        // Closed for the night — no patrons.
        if (u.state === "occupied") u.occupants = 0;
        continue;
      }
      u.state = "occupied";
      // Rain keeps shoppers away (canon) — it bites fast food hardest; a metro
      // (underground visitors) softens the blow. Cosmetic-only on non-rainy days.
      const rainMult =
        this.sim.weather === "rain"
          ? (this.hasOperational("metro") ? 0.7 : 0.5) * (u.kind === "fastFood" ? 0.6 : 1)
          : 1;
      // A cinema showing a blockbuster this month draws a much bigger crowd — it
      // has to more than cover the doubled booking fee at healthy traffic (a
      // +70% bump never could, since appeal is capped at 1), so a blockbuster is
      // a genuine upside in a busy tower and a gamble in a quiet one.
      const filmMult = u.kind === "cinema" && this.blockbusters.has(u.id) ? 2.2 : 1;
      // Spread the headline DAILY take across the venue's actual open hours so a
      // full day earns ≈ `daily * appeal`, not a per-hour multiple of it. (Before,
      // dividing by a flat 8 while open 9–15 h/day inflated income 2–3x.)
      const hourly =
        (daily / openHoursPerDay(u.kind)) * appeal * rainMult * filmMult * (0.6 + this.sim.rng.next() * 0.4);
      u.pendingIncome += hourly;
      if (u.pendingIncome >= 1) {
        const earned = Math.floor(u.pendingIncome);
        u.pendingIncome -= earned;
        this.sim.money += earned;
      }
    }
  }

  /**
   * 0..1 demand-share: what fraction of a venue's headline daily take it
   * actually earns, driven by foot traffic. It is a SHARE (capped at 1), not a
   * population multiplier, so commercial income can never exceed its advertised
   * daily figure. A metro pulls in outside visitors and a recycling centre keeps
   * the tower clean and attractive — both lift trade, the classic reasons to dig
   * down to the subway / run recycling in the original.
   */
  private trafficAppeal(): number {
    const pop = this.sim.tower.totalPopulation();
    const metro = this.hasOperational("metro") ? 0.25 : 0;
    // F14: a real effect for the centre — scaled by how much of the tower's
    // waste the centers can actually process (canon fill model): an
    // overflowing recycling plant stops flattering the tower, so the bonus
    // shrinks as population outgrows capacity until more centers go in.
    let recycling = 0;
    let centers = 0;
    for (const u of this.sim.tower.units) if (u.kind === "recycling" && isOperational(u)) centers++;
    if (centers > 0) {
      const capacity = centers * RECYCLING_POP_PER_CENTER;
      recycling = 0.1 * Math.min(1, capacity / Math.max(1, pop));
    }
    return Math.min(1, 0.35 + pop / 8000 + metro + recycling);
  }

  /** Morning hotel checkout: collect revenue and mark rooms dirty. Cleaning is
   *  NOT instant — housekeepers are dispatched through the day and a room only
   *  turns over when one physically arrives (see {@link dispatchHousekeepers}). */
  hotelCheckout(): void {
    // Yesterday's shift report, before today's ledger resets.
    if (this.hkCleanedToday > 0) {
      this.sim.emit(`Housekeeping cleaned ${this.hkCleanedToday} hotel room(s).`, "info");
    }
    this.hkCleanedToday = 0;
    // Cockroaches breed in rooms left dirty overnight — spread BEFORE this
    // morning's checkouts go dirty, so a hotel whose housekeeping kept up
    // yesterday never seeds an infestation (and a tower with NO housekeeping
    // is the worst case, not immune).
    this.spreadCockroaches();
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
      this.sim.emit(`Hotel guests checked out: $${revenue.toLocaleString()} earned overnight.`, "money");
    }
    // Fresh shift: yesterday's ledger is dropped (its travelers have long
    // since despawned); each crew re-seeds with full capacity on the first
    // dispatch below (also how crews built mid-shift join the same day).
    this.hkCapacity.clear();
    this.hkAssignedRoom.clear();
  }

  // ---- Housekeeping dispatch ---------------------------------------------
  // The daily shift ledger. Transient by design: crews (re-)seed with a full
  // day's capacity on the first dispatch that sees them, so both a mid-day
  // save load and a crew built at noon join the current shift.
  /** Crew unit id → rooms it can still take on today. */
  private hkCapacity = new Map<number, number>();
  /** Dirty-room unit id → crew unit id handling it (avoids double dispatch;
   *  a crew's in-flight count is derived from this map). */
  private hkAssignedRoom = new Map<number, number>();
  /** Rooms turned over so far today (reported at the next checkout). */
  private hkCleanedToday = 0;
  /** Day the "can't reach" nudge last fired, so it warns once per day. */
  private hkNudgedDay = -1;
  /** Day the "at capacity" nudge last fired, so it warns once per day. */
  private hkStarvedDay = -1;

  /** Housekeepers a crew currently has en route, derived from assignments. */
  private hkInFlight(crewId: number): number {
    let n = 0;
    for (const c of this.hkAssignedRoom.values()) if (c === crewId) n++;
    return n;
  }

  /**
   * Send housekeepers to dirty rooms. Called each hour through the day shift:
   * a room is cleaned only when its housekeeper ARRIVES (the crowd walks/rides
   * them over the staff network — service elevators, stairs and escalators,
   * never the passenger elevators), exactly like the original where you watch
   * the staff work the hotel floors. Rooms with no staff-connected crew stay
   * dirty and the player is told why, once a day.
   */
  dispatchHousekeepers(): void {
    const tower = this.sim.tower;
    // Operational crews only — a burning or still-under-construction
    // housekeeping room has no staff to send.
    const crews = tower.units.filter((u) => u.kind === "housekeeping" && isOperational(u));
    if (crews.length === 0) return;
    for (const crew of crews) {
      if (!this.hkCapacity.has(crew.id)) this.hkCapacity.set(crew.id, HK_ROOMS_PER_CREW);
    }
    let unreachable = 0;
    let starved = 0;
    for (const room of tower.units) {
      if (!isHotelKind(room.kind) || room.state !== "dirty") continue;
      if (this.hkAssignedRoom.has(room.id)) continue; // someone's already on it
      let reachable = false;
      let transient = false; // in-flight/pool limits — retries will get there
      let outOfCapacity = false; // a crew's DAILY quota is spent
      let noRoute = false;
      for (const crew of crews) {
        if (!tower.staffConnected(crew.floor, room.floor)) continue;
        reachable = true;
        const left = this.hkCapacity.get(crew.id) ?? 0;
        if (left <= 0) {
          outOfCapacity = true;
          continue;
        }
        if (this.hkInFlight(crew.id) >= HK_MAX_IN_FLIGHT) {
          transient = true;
          continue;
        }
        // An absent hook (bare test contexts without a crowd) is a transient
        // condition, not a broken staff network — never report it as
        // unreachable.
        const sent = this.sim.spawnStaffTrip?.(crew.floor, room.floor, room.x + room.width / 2, room.id) ?? "full";
        if (sent === "full") {
          transient = true; // staff pool at cap — retry next hour
          break;
        }
        if (sent === "no-route") {
          noRoute = true; // shouldn't happen while connected — try another crew
          continue;
        }
        this.hkAssignedRoom.set(room.id, crew.id);
        this.hkCapacity.set(crew.id, left - 1);
        break;
      }
      if (this.hkAssignedRoom.has(room.id)) continue;
      // "Unreachable" covers both no staff-connected crew at all AND the
      // belt-and-suspenders case where a connected crew failed to route (a
      // reachability/routing drift) — either way the player must be told
      // rather than dispatch retrying silently forever. Drift outranks the
      // capacity message: "build another" is no fix for a broken network.
      if (!reachable || (noRoute && !transient)) unreachable++;
      // Every connected crew has spent its daily quota: the hotel has outgrown
      // its housekeeping. Without this message the only symptom is the daily
      // cockroach alert, which reads as a bug when a unit already exists.
      else if (outOfCapacity && !transient) starved++;
    }
    if (unreachable > 0 && this.hkNudgedDay !== this.sim.clock.day) {
      this.hkNudgedDay = this.sim.clock.day;
      this.sim.emit(
        `🧹 Housekeeping can't reach ${unreachable} dirty room(s) — staff travel by service elevator, stairs or escalator, not passenger elevators.`,
        "bad",
      );
    }
    if (starved > 0 && this.hkStarvedDay !== this.sim.clock.day) {
      this.hkStarvedDay = this.sim.clock.day;
      this.sim.emit(
        `🧹 Housekeeping is at capacity — ${starved} dirty room(s) must wait until tomorrow. One Housekeeping unit cleans ~${HK_ROOMS_PER_CREW} rooms a day; build another.`,
        "bad",
      );
    }
  }

  /**
   * A dispatched housekeeper finished. Only an arrival that actually turns the
   * room over consumes the crew's capacity — a failed trip (gave up, shaft
   * bulldozed mid-ride) or a wasted one (the room burned down or was sold
   * while they rode) refunds it so a later dispatch can retry real work.
   */
  onHousekeeperResult(roomId: number, ok: boolean): void {
    const crewId = this.hkAssignedRoom.get(roomId);
    this.hkAssignedRoom.delete(roomId);
    const room = this.sim.tower.units.find((u) => u.id === roomId);
    if (ok && room?.state === "dirty") {
      room.state = "empty";
      room.satisfaction = 1;
      this.hkCleanedToday++;
    } else if (crewId !== undefined) {
      this.hkCapacity.set(crewId, (this.hkCapacity.get(crewId) ?? 0) + 1);
    }
  }

  /** Rooms left dirty breed cockroaches that creep into the adjacent room along
   * the hotel run (canon) — under-provision housekeeping and the infestation
   * spreads, soiling clean/occupied neighbours until you scale up cleaning. */
  private spreadCockroaches(): void {
    const dirty = this.sim.tower.units.filter((u) => isHotelKind(u.kind) && u.state === "dirty");
    if (dirty.length === 0) return;
    let spread = 0;
    for (const u of dirty) {
      // Check BOTH neighbours; a non-hotel room on one side shouldn't block
      // infestation of a hotel room on the other.
      for (const neighbor of [
        this.sim.tower.roomAt(u.floor, u.x + u.width),
        this.sim.tower.roomAt(u.floor, u.x - 1),
      ]) {
        if (neighbor && isHotelKind(neighbor.kind) && (neighbor.state === "asleep" || neighbor.state === "empty")) {
          neighbor.state = "dirty";
          neighbor.occupants = 0;
          spread++;
        }
      }
    }
    if (spread > 0) {
      this.sim.emit(`🪳 Cockroaches spread from unserviced rooms into ${spread} more — add housekeeping!`, "bad");
    }
  }

  /** Monthly upkeep for elevator cars and staffed service facilities. */
  payMaintenance(): void {
    let cost = 0;
    // Fresh film bookings each month: drop last month's blockbusters (incl. any
    // on now-removed or on-fire cinemas) before re-rolling below.
    this.blockbusters.clear();
    for (const t of this.sim.tower.transports) {
      if (isElevatorKind(t.kind)) cost += t.cars * ECON.maintenancePerCarMonthly;
    }
    for (const u of this.sim.tower.units) {
      const m = ECON.serviceMaintenanceMonthly[u.kind];
      if (m && u.state !== "gutted") cost += m; // a gutted service room is destroyed — no upkeep
      const operational = isOperational(u);
      // Property tax on an unsold condo: a real carrying cost for holding out
      // for a premium sale (scales with the asking price).
      if (u.kind === "condo" && !u.everOccupied && operational) {
        cost += Math.ceil(rentOf(u) * ECON.condoMonthlyTaxRate);
      }
      // Operating overhead on space HELD (regardless of occupancy/served) — makes
      // a vacant or unserved floor pure carrying cost. Sold condos are exempt:
      // their income was a one-time sale already banked, so a permanent per-month
      // drain on them would be punitive rather than a live decision.
      if (operational && isOverheadKind(u.kind) && !(u.kind === "condo" && u.everOccupied)) {
        cost += ECON.overheadPerLeasableUnitMonthly;
      }
      // A cinema books a film each month (canon: 150k average / 300k
      // blockbuster). The player sets a per-cinema policy; only "auto" consumes
      // RNG (in the same order as before), so default cinemas are stream-identical.
      // On fire / under construction it books nothing (flag cleared above).
      if (u.kind === "cinema" && operational) {
        const policy = u.filmPolicy ?? "auto";
        const blockbuster =
          policy === "blockbuster" ? true : policy === "feature" ? false : this.sim.rng.chance(0.4);
        if (blockbuster) {
          this.blockbusters.add(u.id);
          cost += ECON.cinemaBookingBlockbuster;
        } else {
          cost += ECON.cinemaBookingMonthly;
        }
      }
    }
    if (cost > 0) {
      this.sim.money -= cost;
      this.sim.emit(`Monthly maintenance paid: $${cost.toLocaleString()}.`, "money");
    }
  }
}
