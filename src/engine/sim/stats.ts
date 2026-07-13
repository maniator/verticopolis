import { Simulation } from "../Simulation";

import { ledgerCatFor, type LedgerCat } from "../Ledger";

import { isElevatorKind, isHotelKind } from "../facilities";
import type { FacilityKind } from "../types";
import type { LogEntry } from "../types";
import { isTenanted } from "../types";

import { LOG_RING_CAP } from "./constants";

/** Stats panel, ledger, log emit for the Simulation, as friend functions taking the
 * instance. Extracted from `Simulation.ts`; the class keeps thin delegations. */

export function stats(sim: Simulation) {
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
  for (const u of sim.tower.units) {
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
    population: sim.population,
    // Cheap loop-counter field only. The modal-only diagnostics that need a
    // full scan / flood-fill (ratingPopulation, functional parking count) are
    // computed in buildStatsHtml at modal-build time, NOT here, since stats()
    // runs on the ~6 Hz HUD refresh (UI.update).
    parkingSpaces,
    money: sim.money,
    star: sim.star,
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
    floors: sim.tower.highestFloor,
    basements: Math.max(0, 1 - sim.tower.lowestFloor),
    elevators: sim.tower.transports.filter((t) => isElevatorKind(t.kind)).length,
    transports: sim.tower.transports.length,
    fires: sim.events.count,
  };
}

/** The income breakdown for the stats screen: average $/day per category over
 *  the trailing quarter, plus whether any data has accrued yet. */
export function incomeBreakdown(sim: Simulation): { averages: Record<LedgerCat, number>; hasData: boolean } {
  return { averages: sim.ledger.averagePerDay(), hasData: sim.ledger.hasData() };
}

/** Tag money to a stats-breakdown category (positive income, negative
 *  expense). The single funnel EconomySystem and the sale paths route through
 *  so the income breakdown stays in lockstep with `money`. */
export function recordMoney(sim: Simulation, cat: LedgerCat, amount: number): void {
  sim.ledger.record(cat, amount);
}

/** Record a facility's income/expense against its own report category (net),
 *  a no-op for kinds with no operational money line. */
export function recordMoneyFor(sim: Simulation, kind: FacilityKind, amount: number): void {
  const cat = ledgerCatFor(kind);
  if (cat) sim.ledger.record(cat, amount);
}

export function emit(sim: Simulation, text: string, kind: LogEntry["kind"] = "info"): void {
  sim.log.push({ minute: sim.clock.minutes, text, kind });
  // Monotonic emit counter. The UI diffs "new entries since I last looked" on
  // THIS, never on log.length, the capped shift below makes length
  // non-monotonic (push+shift pins it at the cap once full), which is what
  // froze the toast/bulletin pump after the cap while cosmetics kept animating.
  // Transient (the log's TAIL is serialized, this cursor is not): resets to
  // 0 on load, and the UI rebases on adopt so nothing replays as a toast.
  sim.logSeq++;
  // Bounded ring, a session's worth of scrollback (the UI renders up to
  // LOG_DOM_CAP of it). Cheap in RAM (~100 bytes/entry); the shift is what
  // makes length non-monotonic, hence the logSeq cursor above.
  if (sim.log.length > LOG_RING_CAP) sim.log.shift();
}
