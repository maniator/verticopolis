import { catalogFacility, catalogResidents } from "../../catalog/catalogTypes";
import { isPresent, isTenanted, type FacilityKind, type Unit } from "../../shared/types";
import { catalogFor } from "../catalogFixture";

/** The facility facts the walk reads (population, household, commercial,
 *  hotel), from the engine's Modern catalog, which lists every kind. */
const facility = (kind: FacilityKind) => catalogFacility(catalogFor("modern"), kind);

/** The kinds whose census is the count the room carries from the day before:
 *  the daily-visitor venues and the set-audience halls. Mirrors
 *  `census_follows_the_day` in engine-rs/src/economy/visitors.rs. */
const CENSUS_FOLLOWS_THE_DAY: ReadonlySet<FacilityKind> = new Set<FacilityKind>(["shop", "fastFood", "restaurant", "partyHall", "cinema"]);

/** The people a unit counts in the census: yesterday's count for a venue that
 *  keeps one, the live customer tally for any other trading venue with a
 *  population, and the household or the catalog population for everyone else. */
function censusCount(u: Unit): number {
  if (CENSUS_FOLLOWS_THE_DAY.has(u.kind)) return u.visitorsYest ?? 0;
  const f = facility(u.kind);
  if (f.commercial && f.population > 0) return u.customersIn ?? 0;
  return catalogResidents(f, u.residents);
}

/** The HUD's room counts as `stats()` computed them before it read the rooms
 *  list or kept counts: a walk over every unit, the population summed over
 *  every unit as well, so no memoized list or kept count stands behind it.
 *  Any holder of the units will do, such as an engine's save. */
export function walkedStats(sim: { tower: { units: readonly Unit[] } }) {
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
    } else if (facility(u.kind).hotel) {
      c.hotelRooms++;
      if (u.state === "asleep") c.occupiedHotel++;
      if (u.state === "dirty") c.dirty++;
    } else if (u.kind === "shop") c.shops++;
    else if (u.kind === "restaurant" || u.kind === "fastFood") c.restaurants++;
    else if (u.kind === "parking") c.parkingSpaces++;
  }
  return c;
}
