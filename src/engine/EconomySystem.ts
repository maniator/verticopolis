import type { SimContext } from "./SimContext";
import { isOperational } from "./types";
import { ECON, rentOf, isOverheadKind } from "./econConfig";
import { isElevatorKind, isHotelKind, isOpenAt, openHoursPerDay } from "./facilities";

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
    const recycling = this.hasOperational("recycling") ? 0.1 : 0; // F14: a real effect for the centre
    return Math.min(1, 0.35 + pop / 8000 + metro + recycling);
  }

  /** Nightly hotel checkout: collect revenue, mark rooms dirty, then clean. */
  hotelCheckout(): void {
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
    this.runHousekeeping();
    // Spread runs unconditionally — a tower with NO housekeeping is the WORST
    // case for roaches, not immune to them (runHousekeeping early-returns when
    // there are zero housekeeping units, so spread can't live inside it).
    this.spreadCockroaches();
  }

  /**
   * Each housekeeping facility services a fixed number of dirty rooms per day.
   * Housekeepers travel the STAFF network — service elevators, stairs and
   * escalators, never the passenger lifts — so a room only gets cleaned when
   * some housekeeping facility is staff-connected to its floor (or on it).
   * Without enough reachable housekeeping, dirty rooms pile up and cannot
   * earn — exactly as in the original, where you scale housekeeping with your
   * hotel and run service elevators up to the room floors.
   */
  private runHousekeeping(): void {
    const capacityPerUnit = 20;
    const tower = this.sim.tower;
    // Each facility is its own crew with its own daily capacity, stationed on
    // its floor. (Gutted shells have no staff to send.)
    const crews = tower.units
      .filter((u) => u.kind === "housekeeping" && u.state !== "gutted")
      .map((u) => ({ floor: u.floor, left: capacityPerUnit }));
    if (crews.length === 0) return;
    let cleaned = 0;
    let unreachable = 0;
    for (const u of tower.units) {
      if (!isHotelKind(u.kind) || u.state !== "dirty") continue;
      const crew = crews.find((c) => c.left > 0 && tower.staffConnected(c.floor, u.floor));
      if (crew) {
        crew.left--;
        u.state = "empty";
        u.satisfaction = 1;
        cleaned++;
      } else if (!crews.some((c) => tower.staffConnected(c.floor, u.floor))) {
        unreachable++; // no crew can get there at all (vs. merely out of capacity)
      }
    }
    if (cleaned > 0) this.sim.emit(`Housekeeping cleaned ${cleaned} hotel room(s).`, "info");
    if (unreachable > 0) {
      this.sim.emit(
        `🧹 Housekeeping can't reach ${unreachable} dirty room(s) — staff travel by service elevator or stairs, not passenger lifts.`,
        "bad",
      );
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
