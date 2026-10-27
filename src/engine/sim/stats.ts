import type { Simulation } from "../Simulation";

import { ledgerCatFor, type LedgerCat } from "../Ledger";

import { isElevatorKind } from "../facilities";
import { roomCounts } from "../tower/rooms";
import type { FacilityKind } from "../types";
import type { LogEntry } from "../types";

import { LOG_RING_CAP } from "./constants";

/** Stats panel, ledger, log emit for the Simulation, as friend functions taking the
 * instance. Extracted from `Simulation.ts`; the class keeps thin delegations. */

export function stats(sim: Simulation) {
  // The room counts are kept as the rooms change (`roomCounts`), so this HUD
  // refresh, about 6 a second, reads them without a pass over the rooms: a
  // read recounts only the rooms written since the last one, and counts them
  // all once after a build command, a load or a merge.
  const {
    population,
    parkingSpaces,
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
    vacantNoRate,
  } = roomCounts(sim.tower);
  return {
    population,
    // A kept count only. The modal-only diagnostics that need a full scan or
    // flood fill (ratingPopulation, the functional parking count) are
    // computed for the stats report when the modal opens
    // (`src/simport/tsPanels.ts`), since stats() runs on the ~6 Hz HUD refresh
    // (UI.update).
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
    vacantNoRate,
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
