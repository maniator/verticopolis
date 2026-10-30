import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalogFor } from "../engine/catalog";
import { ALL_KINDS, facilityFloors as tableFloors, hasBusinessHours as tableHasHours, isCommercialKind as tableCommercial, isElevatorKind as tableElevator, isHotelKind as tableHotel, isLeaseAmenityKind as tableLease, isOpenAt as tableOpenAt, isUnmetDemandKind as tableUnmet } from "../engine/facilities";
import { bindViewKinds, facilityFloors, hasBusinessHours, isCommercialKind, isElevatorKind, isHotelKind, isLeaseAmenityKind, isOpenAt, isUnmetDemandKind, resetViewKindsForTests } from "./viewKinds";

describe("the view's kind facts", () => {
  beforeEach(() => bindViewKinds(catalogFor("modern")));
  afterEach(() => bindViewKinds(catalogFor("modern")));

  it("answer as the engine's own rules do, kind by kind and hour by hour", () => {
    for (const mode of ["classic", "modern"] as const) {
      bindViewKinds(catalogFor(mode));
      for (const kind of ALL_KINDS) {
        expect(isCommercialKind(kind), `${mode} ${kind} commercial`).toBe(tableCommercial(kind));
        expect(isHotelKind(kind), `${mode} ${kind} hotel`).toBe(tableHotel(kind));
        expect(isLeaseAmenityKind(kind), `${mode} ${kind} lease`).toBe(tableLease(kind));
        expect(isUnmetDemandKind(kind), `${mode} ${kind} unmet`).toBe(tableUnmet(kind));
        expect(isElevatorKind(kind), `${mode} ${kind} elevator`).toBe(tableElevator(kind));
        expect(hasBusinessHours(kind), `${mode} ${kind} hours`).toBe(tableHasHours(kind));
        expect(facilityFloors(kind), `${mode} ${kind} floors`).toBe(tableFloors(kind));
        for (let hour = 0; hour < 24; hour++) expect(isOpenAt(kind, hour), `${mode} ${kind} at ${hour}`).toBe(tableOpenAt(kind, hour));
      }
    }
  });

  it("refuse to answer before they are bound, and for a kind the catalog does not list", () => {
    expect(() => isHotelKind("nothing" as never)).toThrow(/lists no nothing/);
    resetViewKindsForTests();
    expect(() => isHotelKind("hotelSingle")).toThrow(/not bound yet/);
  });
});
