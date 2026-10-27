import { censusCount } from "../../engine/census";
import { isHotelKind } from "../../engine/facilities";
import type { Simulation } from "../../engine/Simulation";
import { isPresent, isTenanted } from "../../engine/types";

/** The HUD's room counts as `stats()` computed them before it read the rooms
 *  list or kept counts: a walk over every unit, the population summed over
 *  every unit as well, so no memoized list or kept count stands behind it. */
export function walkedStats(sim: Simulation) {
  const c = { offices: 0, occupiedOffices: 0, condos: 0, soldCondos: 0, hotelRooms: 0, occupiedHotel: 0, dirty: 0, shops: 0, restaurants: 0, vacant: 0, vacantNoRate: 0, parkingSpaces: 0, population: 0 };
  for (const u of sim.tower.units) {
    if (isPresent(u)) c.population += censusCount(u);
    if (u.kind === "office") {
      c.offices++;
      if (isTenanted(u)) c.occupiedOffices++;
      if (u.state === "empty") {
        c.vacant++;
        if (u.noRate) c.vacantNoRate++;
      }
    } else if (u.kind === "condo") {
      c.condos++;
      if (u.everOccupied) c.soldCondos++;
    } else if (isHotelKind(u.kind)) {
      c.hotelRooms++;
      if (u.state === "asleep") c.occupiedHotel++;
      if (u.state === "dirty") c.dirty++;
    } else if (u.kind === "shop") c.shops++;
    else if (u.kind === "restaurant" || u.kind === "fastFood") c.restaurants++;
    else if (u.kind === "parking") c.parkingSpaces++;
  }
  return c;
}
