import type { Simulation } from "../Simulation";
import { FACILITIES, isOpenAt, residentCount, syncAttendanceOccupants } from "../facilities";
import { isDormant } from "../types";

/**
 * Per-hour occupancy (`u.occupants`) for every unit, split out of
 * `satisfaction.ts` so that file stays under the size guard. It writes the
 * canonical head count each unit contributes to the census, presence heatmap,
 * and lit-window sprites; the satisfaction sweep and crowd model both read it.
 * Moved out of `satisfaction.ts` unchanged (including the rental Studio/Apartment
 * occupancy cases added alongside it); no behavior change from the extraction.
 */
export function updatePresence(sim: Simulation): void {
  const weekend = sim.clock.isWeekend;
  for (const u of sim.tower.units) {
    const f = FACILITIES[u.kind];
    if (isDormant(u)) {
      // The wedding hall is never tenanted, so its lifetime state is "empty"
      // (dormant); mirror its live routed attendance rather than stamping 0
      // over a mid-wedding house. Real dormancy (construction / fire /
      // gutted) still zeroes: the spawn side gates on isOperational, so no
      // new guest can be inside one.
      if (u.state === "empty" && f.attendance !== undefined) syncAttendanceOccupants(u);
      else u.occupants = 0;
      continue;
    }
    switch (u.kind) {
      case "office":
        // Offices staffed on weekday working hours.
        u.occupants = !weekend && sim.clock.hour >= 8 && sim.clock.hour < 18 ? f.population : 0;
        break;
      case "condo":
        // Residents home in evenings/night/weekends, the whole household
        // (its real size in Modern, the flat 3 in Classic); one person stays
        // home during the weekday workday.
        u.occupants = sim.clock.isNight() || sim.clock.isEvening() || weekend ? residentCount(u) : 1;
        break;
      case "rentalStudio":
        // A single renter: home evenings/nights/weekends, out at work on weekdays.
        u.occupants = sim.clock.isNight() || sim.clock.isEvening() || weekend ? f.population : 0;
        break;
      case "rentalApartment":
        // A renting household, like a condo: home evenings/nights/weekends (the
        // whole household), one member home during the weekday workday.
        u.occupants = sim.clock.isNight() || sim.clock.isEvening() || weekend ? residentCount(u) : 1;
        break;
      case "hotelSingle":
      case "hotelDouble":
      case "hotelSuite":
        u.occupants = u.state === "asleep" ? f.population : 0;
        break;
      default:
        // Attendance venues (cinema / party hall / wedding hall): occupants
        // mirrors the live routed attendance, never the catalog population
        // (0). The mirror is also written at every tally change; this hourly
        // write keeps presence from stamping 0 over a mid-show house.
        if (f.attendance !== undefined) {
          syncAttendanceOccupants(u);
          break;
        }
        // Every kind without its own case above takes this open-hours gate.
        // It only changes behavior for commercial venues (fastFood,
        // restaurant, shop): they show their ambient crowd only while open,
        // so a tenanted but closed venue reads zero and the heatmap and
        // lit-window sprite go dark after closing time. Kinds without
        // business hours pass isOpenAt unconditionally.
        u.occupants = u.state === "occupied" && isOpenAt(u.kind, sim.clock.hour) ? f.population : 0;
    }
  }
}
