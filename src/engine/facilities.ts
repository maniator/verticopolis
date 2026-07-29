/**
 * Facility tuning: the single source of truth for the catalog, geometry, canon
 * caps, kind predicates, and the population census.
 *
 * This file is a barrel. The definitions live in cohesive siblings and are
 * re-exported here so every existing `import { … } from "./facilities"` keeps
 * working unchanged:
 *   - `facilitiesData.ts`: LOT_WIDTH, GRID, the FACILITIES catalog, ALL_KINDS,
 *                          isFacilityKind.
 *   - `facilityPredicates.ts`: kind predicates, build minutes, open hours.
 *   - `facilityCaps.ts`: canon build caps + transport capacity/spans
 *                        (BUILD_CAPS, POOLED_CAPS, MAX_CARS, maxSpanFor …),
 *                        the single home for the 1994 caps.
 *   - `census.ts`: residentCount/censusCount + the star/population
 *                  thresholds and service-demand constants.
 */
export { LOT_WIDTH, FACILITIES, ALL_KINDS, isFacilityKind, GRID } from "./facilitiesData";
export {
  isHotelKind,
  isLeaseAmenityKind,
  isUnmetDemandKind,
  facilityFloors,
  buildMinutes,
  isOpenAt,
  openHoursPerDay,
  isCommercialKind,
  hasBusinessHours,
  attendanceCap,
  isElevatorKind,
  isStaffOnlyTransport,
  isStaffTransportKind,
} from "./facilityPredicates";
export {
  TRANSPORT_CAPACITY,
  transportCarCapacity,
  MAX_CARS,
  maxCarsFor,
  BUILD_CAPS,
  POOLED_CAPS,
  maxSpanFor,
  isFixedSpanTransport,
  WALKWAY_WILLINGNESS,
} from "./facilityCaps";
export {
  residentCount,
  censusCount,
  syncAttendanceOccupants,
  STAR_THRESHOLDS,
  TOWER_POPULATION,
  RECYCLING_POP_PER_CENTER,
  GARBAGE_COLLECT_HOUR,
  PARKING_WORKERS_PER_SPACE,
} from "./census";
