import type { FacilityKind } from "./types";
import { FACILITIES } from "./facilitiesData";

export function isHotelKind(kind: FacilityKind): boolean {
  return kind === "hotelSingle" || kind === "hotelDouble" || kind === "hotelSuite";
}

/** The kinds the unmet-local-demand coverage drain reads (#661): the demand
 *  tenants whose coverage `unmetCoverage` computes. One predicate for every
 *  site that asks the question (the live drain guard, the gate's demand-map
 *  skip, the gripe ladder and its coverage recompute, the inspector's coverage
 *  mirror), so a future kind lands on the same side of all of them. The
 *  forgiving Studio and the lease amenities are deliberately outside it. */
export function isUnmetDemandKind(kind: FacilityKind): boolean {
  return kind === "office" || kind === "condo" || kind === "rentalApartment" || isHotelKind(kind);
}

/** The Modern lease amenities: office-like lease tenants that erode on unserved
 *  placement and on an over-market rent, so they are gated by the move-in
 *  sustainability gate and surfaced by the Main-gripe line like offices (#667).
 *  One predicate so the gate, the gripe guard, and the satisfaction step can
 *  never drift on which kinds count. */
export function isLeaseAmenityKind(kind: FacilityKind): boolean {
  return kind === "fitnessClub" || kind === "clinic";
}

/** Height of a facility in floors (1 for ordinary single-story rooms). */
export function facilityFloors(kind: FacilityKind): number {
  return FACILITIES[kind].floors ?? 1;
}

/**
 * The number of in-game minutes a facility takes to build. Structure goes up
 * instantly; rooms take a while (bigger/pricier → longer), like the original's
 * construction phase. Driven entirely by the global clock, no per-room timers.
 */
export function buildMinutes(kind: FacilityKind): number {
  const f = FACILITIES[kind];
  if (kind === "floor" || kind === "lobby") return 0;
  return Math.min(8 * 60, Math.round(60 + f.width * 8 + f.cost / 5000));
}

/** Opening hours by facility, shared by the economy and the renderer. */
export function isOpenAt(kind: FacilityKind, hour: number): boolean {
  switch (kind) {
    case "fastFood":
      return hour >= 7 && hour < 22;
    case "restaurant":
      return (hour >= 11 && hour < 14) || (hour >= 17 && hour < 23);
    case "foodHall":
      // A food court trades all day, breakfast through late dinner.
      return hour >= 10 && hour < 22;
    case "shop":
      return hour >= 10 && hour < 21;
    case "amusements":
      // An arcade opens late morning and runs to midnight.
      return hour >= 10 && hour < 24;
    case "nightclub":
      // Night only: the club fills after the office crowd leaves, 8pm to 2am.
      return hour >= 20 || hour < 2;
    case "boutiqueBay":
      // A bay of small shops keeps ordinary retail hours, like the shop.
      return hour >= 10 && hour < 21;
    case "spa":
      // A wellness spa keeps long daytime-into-evening hours.
      return hour >= 9 && hour < 21;
    case "skyBar":
      // A rooftop bar opens late afternoon and runs to midnight.
      return hour >= 16 && hour < 24;
    case "daycare":
      // A daycare keeps working-day childcare hours.
      return hour >= 7 && hour < 19;
    case "cinema":
      return hour >= 12 && hour < 24;
    case "partyHall":
      return hour >= 17 && hour < 24;
    case "aquaticCenter":
      // A public pool keeps long daytime-into-evening hours.
      return hour >= 8 && hour < 22;
    default:
      return true;
  }
}

/** Number of hours per day a venue is open (used to spread its daily take so
 * total income over a day ≈ the headline daily figure, not a per-open-hour
 * multiple of it). */
export function openHoursPerDay(kind: FacilityKind): number {
  let h = 0;
  for (let hr = 0; hr < 24; hr++) if (isOpenAt(kind, hr)) h++;
  return h || 1;
}

/** Foot-traffic commercial kinds: the canon 1994 set (fast food, restaurant,
 *  retail shop, cinema) plus the Modern-only Food Hall and Amusements, which are
 *  shopper-drawing footfall venues and so feel the same noise (W2) and
 *  lobby-proximity (W3) rules. A Classic tower never holds either, so Classic
 *  stays the exact 1994 set. `partyHall` earns traffic income too but is
 *  deliberately NOT commercial, so it is exempt from both; keep W2 and W3 keyed
 *  off this one predicate so they can never drift apart. */
export function isCommercialKind(kind: FacilityKind): boolean {
  return (
    kind === "fastFood" ||
    kind === "restaurant" ||
    kind === "foodHall" ||
    kind === "amusements" ||
    kind === "boutiqueBay" ||
    kind === "nightclub" ||
    kind === "spa" ||
    kind === "skyBar" ||
    kind === "daycare" ||
    kind === "shop" ||
    kind === "cinema"
  );
}

/** True for facilities that keep posted business hours (can be "closed"). */
export function hasBusinessHours(kind: FacilityKind): boolean {
  return (
    kind === "fastFood" ||
    kind === "restaurant" ||
    kind === "foodHall" ||
    kind === "amusements" ||
    kind === "boutiqueBay" ||
    kind === "nightclub" ||
    kind === "spa" ||
    kind === "skyBar" ||
    kind === "daycare" ||
    kind === "shop" ||
    kind === "cinema" ||
    kind === "partyHall" ||
    kind === "aquaticCenter"
  );
}

/** Visible seat capacity for routed attendance visitors at population-0
 *  entertainment venues (cinema / party hall / wedding hall), or undefined for
 *  every other kind. Attendance venues track live visitors in `customersIn`
 *  clamped at this cap and mirrored into `occupants` for the interior art;
 *  the tally is census-inert (their catalog `population` stays 0, which keeps
 *  `censusCount`'s commercial gate closed). */
export function attendanceCap(kind: FacilityKind): number | undefined {
  return FACILITIES[kind].attendance;
}

export function isElevatorKind(kind: FacilityKind): boolean {
  return (
    kind === "elevatorStandard" ||
    kind === "elevatorService" ||
    kind === "elevatorExpress"
  );
}

/** True for staff-only transports (no tenants/visitors ever ride them). The
 *  single source of truth for every passenger-side exclusion, routing,
 *  serving, capacity, dispatch demand. */
export function isStaffOnlyTransport(kind: FacilityKind): boolean {
  return FACILITIES[kind]?.staffOnly === true;
}

/** True for transports STAFF travel on: the staff-only elevators plus stairs.
 *  The single source of truth for the staff network, shared by
 *  Tower.staffConnected and Crowd's staff routing so the two can never disagree
 *  about reachability. Canon (SimTower): housekeeping travels by service
 *  elevator or stairs only, never escalators (escalators move too slowly for a
 *  working maid and were not part of the original staff network). */
export function isStaffTransportKind(kind: FacilityKind): boolean {
  return isStaffOnlyTransport(kind) || kind === "stairs";
}
