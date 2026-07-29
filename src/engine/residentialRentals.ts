import type { Facility, FacilityKind } from "./types";

/**
 * Modern rental-living catalog entries (Studio + Apartment), kept out of
 * `facilitiesData.ts` so that file stays under the size ceiling and the rental
 * pair has a home for the rental-specific data this feature will grow (rent
 * bands, churn sensitivity). Spread into `FACILITIES` from `facilitiesData.ts`.
 *
 * The GDD is `gdd-verticopolis-2026-07-23-modern-rental-living`: recurring
 * MONTHLY rent (player-set) plus the shipped tenant-churn loop, the cashflow
 * counterpart to the condo's one-time sale. Modern-only; Classic stays condo-only.
 */

/** The rental-living facility kinds, as their own key subset so the spread into
 *  `FACILITIES` keeps the `Record<FacilityKind, Facility>` completeness check. */
export type RentalKind = "rentalStudio" | "rentalApartment";

/** True for a Modern rental-living kind (Studio or Apartment). The single
 *  membership test every consumer (rent, churn, satisfaction, render) shares. */
export function isRentalKind(kind: string): kind is RentalKind {
  return kind === "rentalStudio" || kind === "rentalApartment";
}

export const RENTAL_FACILITIES: Record<RentalKind, Facility> = {
  rentalStudio: {
    kind: "rentalStudio",
    category: "residential",
    name: "Studio",
    width: 6,
    cost: 22000,
    minStar: 2,
    population: 1,
    color: "#86c5a8",
    modernOnly: true,
    description:
      "Modern: a small rented studio. Pays monthly rent you set; the easygoing tenant stays unless the tower gets truly bad. Modern only.",
  },
  rentalApartment: {
    kind: "rentalApartment",
    category: "residential",
    name: "Apartment",
    width: 11,
    cost: 60000,
    minStar: 3,
    population: 2,
    color: "#a8c06a",
    modernOnly: true,
    description:
      "Modern: a rented apartment for a small household. Higher monthly rent you set, but noise, a bad commute, or over-high rent drives the tenant out. Modern only.",
  },
};

/** True for a residential kind whose tenant is a rolled HOUSEHOLD rather than a
 *  single occupant. The school run draws on this: a Studio houses one person and
 *  has no children to send. Exported so the spawn bin and the per-unit candidate
 *  filter read the SAME predicate; encoding it twice (once as a deny-list, once as
 *  an allow-list) is how a third rental kind would silently reintroduce #683. */
export function hasHousehold(kind: FacilityKind): boolean {
  return kind === "condo" || kind === "rentalApartment";
}
