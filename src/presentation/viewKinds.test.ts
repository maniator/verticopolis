import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalogFor } from "../tests/catalogFixture";
import { catalogFacility } from "../catalog/catalogTypes";
import { bindViewKinds, hasBusinessHours, isCommercialKind, isElevatorKind, isHotelKind, isLeaseAmenityKind, isOpenAt, isUnmetDemandKind, kindFloors, kindWidth, resetViewKindsForTests, viewKindKeys } from "./viewKinds";
import type { FacilityKind } from "../shared/types";

describe("the view's kind facts", () => {
  beforeEach(() => bindViewKinds(catalogFor("modern")));
  afterEach(() => bindViewKinds(catalogFor("modern")));

  // The kind sets and posted hours the Rust engine states (`engine-rs/src/facilities.rs`:
  // the kind predicates and `Kind::is_open_at`), pinned so a catalog that moved a
  // kind across a line, or a binding that read the wrong field, fails here.
  const SETS: Record<string, { readonly ask: (kind: FacilityKind) => boolean; readonly kinds: readonly FacilityKind[] }> = {
    commercial: { ask: isCommercialKind, kinds: ["fastFood", "restaurant", "foodHall", "shop", "cinema", "amusements", "boutiqueBay", "nightclub", "spa", "skyBar", "daycare"] },
    hotel: { ask: isHotelKind, kinds: ["hotelSingle", "hotelDouble", "hotelSuite"] },
    leaseAmenity: { ask: isLeaseAmenityKind, kinds: ["fitnessClub", "clinic"] },
    unmetDemand: { ask: isUnmetDemandKind, kinds: ["office", "condo", "hotelSingle", "hotelDouble", "hotelSuite", "rentalApartment"] },
    elevator: { ask: isElevatorKind, kinds: ["elevatorStandard", "elevatorService", "elevatorExpress"] },
    businessHours: { ask: hasBusinessHours, kinds: ["fastFood", "restaurant", "foodHall", "shop", "cinema", "partyHall", "amusements", "boutiqueBay", "nightclub", "spa", "skyBar", "aquaticCenter", "daycare"] },
  };

  /** The whole hours from `from` up to, not including, `to`. */
  const span = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, i) => from + i);
  /** Each kind with posted hours and the whole hours it is open. */
  const OPEN_HOURS: Partial<Record<FacilityKind, readonly number[]>> = {
    fastFood: span(7, 22),
    restaurant: [...span(11, 14), ...span(17, 23)],
    foodHall: span(10, 22),
    shop: span(10, 21),
    cinema: span(12, 24),
    partyHall: span(17, 24),
    amusements: span(10, 24),
    boutiqueBay: span(10, 21),
    nightclub: [...span(0, 2), ...span(20, 24)],
    spa: span(9, 21),
    skyBar: span(16, 24),
    aquaticCenter: span(8, 22),
    daycare: span(7, 19),
  };

  it("sort the kinds as the engine does, in both modes", () => {
    for (const mode of ["classic", "modern"] as const) {
      bindViewKinds(catalogFor(mode));
      for (const [name, { ask, kinds }] of Object.entries(SETS)) {
        expect(viewKindKeys().filter(ask), `${mode} ${name}`).toEqual(kinds);
      }
    }
  });

  it("open each kind in the engine's posted hours, reading a fraction or 24 onto its hour", () => {
    for (const mode of ["classic", "modern"] as const) {
      bindViewKinds(catalogFor(mode));
      for (const kind of viewKindKeys()) {
        const open = OPEN_HOURS[kind];
        for (let hour = 0; hour < 24; hour++) {
          expect(isOpenAt(kind, hour), `${mode} ${kind} at ${hour}`).toBe(open === undefined || open.includes(hour));
        }
        for (const [read, as] of [[1.5, 1], [6.99, 6], [13.9, 13], [19.5, 19], [23.75, 23], [24, 0]] as const) {
          expect(isOpenAt(kind, read), `${mode} ${kind} at ${read}`).toBe(isOpenAt(kind, as));
        }
      }
    }
  });

  it("state each kind's footprint as the Modern catalog does", () => {
    // The atlas verifiers bake and compare against the Modern catalog.
    const modern = catalogFor("modern");
    bindViewKinds(modern);
    for (const kind of viewKindKeys()) {
      const f = catalogFacility(modern, kind);
      expect(kindWidth(kind), `${kind} width`).toBe(f.width);
      expect(kindFloors(kind), `${kind} floors`).toBe(f.floors);
    }
  });

  it("refuse to answer before they are bound, and for a kind the catalog does not list", () => {
    expect(() => isHotelKind("nothing" as never)).toThrow(/lists no nothing/);
    resetViewKindsForTests();
    expect(() => isHotelKind("hotelSingle")).toThrow(/not bound yet/);
  });
});
