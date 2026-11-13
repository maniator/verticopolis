import { describe, expect, it } from "vitest";
import type { CatalogCalendar, CatalogRent } from "../catalog/catalogTypes";
import { catalogFor } from "../tests/catalogFixture";
import { catalogCalendar, priceOptionsFor, priceOptionsFromRent, rentPerCollection, unitPrice } from "./catalogPricing";

/**
 * The price controls and a unit's price, read from a catalog. The engine's
 * half (a fresh build of every priced kind charges what `unitPrice` reads) is
 * `catalogPricing.integration.test.ts`, on the Rust engine.
 */

const BAND: CatalogRent = { shape: "band", cadence: "quarterly", default: 10_000, min: 2_000, max: 20_000, step: 500, noRate: false };
const LADDER: CatalogRent = {
  shape: "ladder",
  cadence: "quarterly",
  default: 20_000,
  noRate: true,
  rungs: [
    { level: 0, label: "Very Low", value: 5_000 },
    { level: 1, label: "Low", value: 10_000 },
    { level: 2, label: "Average", value: 20_000 },
    { level: 3, label: "High", value: 30_000 },
  ],
};

describe("price options from the catalog (#921)", () => {
  it("offer a band as its default, limits and step", () => {
    expect(priceOptionsFromRent(BAND)).toEqual({ shape: "band", band: { default: 10_000, min: 2_000, max: 20_000, step: 500 } });
  });

  it("offer a ladder's rungs with No Rate", () => {
    expect(priceOptionsFromRent(LADDER)).toEqual({
      shape: "ladder",
      noRate: true,
      rungs: [
        { level: 0, label: "Very Low", value: 5_000 },
        { level: 1, label: "Low", value: 10_000 },
        { level: 2, label: "Average", value: 20_000 },
        { level: 3, label: "High", value: 30_000 },
      ],
    });
  });

  it("offer nothing for a kind the mode does not price", () => {
    expect(priceOptionsFromRent(null)).toBeNull();
    expect(priceOptionsFor(catalogFor("classic"), "lobby")).toBeNull();
  });

  it("read the kind's own catalog entry: Classic prices on a ladder, Modern on a band", () => {
    const classic = catalogFor("classic");
    const modern = catalogFor("modern");
    for (const [catalog, shape] of [[classic, "ladder"], [modern, "band"]] as const) {
      const priced = catalog.facilities.filter((f) => f.rent);
      expect(priced.length, `${catalog.mode} prices some kinds`).toBeGreaterThan(3);
      for (const f of priced) {
        expect(priceOptionsFor(catalog, f.key), `${catalog.mode} ${f.key}`).toEqual(priceOptionsFromRent(f.rent));
        expect(priceOptionsFor(catalog, f.key)!.shape, `${catalog.mode} ${f.key}`).toBe(shape);
      }
    }
  });

  it("refuses a ladder rung that is not one of the four canon rungs", () => {
    const rung = (level: number, label: string) => ({ shape: "ladder" as const, cadence: "quarterly" as const, default: 1, noRate: true as const, rungs: [{ level, label, value: 1 }] });
    expect(() => priceOptionsFromRent(rung(4, "Very High"))).toThrow(/unknown rung/);
    expect(() => priceOptionsFromRent(rung(0, "Low"))).toThrow(/unknown rung/);
  });
});

describe("a unit's price from the catalog (#921)", () => {
  it("is nothing off the market, the stored price when set, and the catalog default otherwise", () => {
    for (const mode of ["classic", "modern"] as const) {
      const catalog = catalogFor(mode);
      for (const f of catalog.facilities) {
        if (!f.rent) continue;
        expect(unitPrice(catalog, { kind: f.key, rent: 1234 }), `${mode} ${f.key} stored`).toBe(1234);
        expect(unitPrice(catalog, { kind: f.key, rent: 1234, noRate: true }), `${mode} ${f.key} no rate`).toBe(0);
        expect(unitPrice(catalog, { kind: f.key }), `${mode} ${f.key} unset`).toBe(f.rent.default);
      }
    }
  });

  it("is nothing for a kind the mode does not price", () => {
    expect(unitPrice(catalogFor("classic"), { kind: "lobby" })).toBe(0);
  });
});

describe("the tower's calendar and one collection's rent (#2107)", () => {
  it("finds the calendar a Modern tower chose, and Classic's only calendar whatever the save stores", () => {
    expect(catalogCalendar(catalogFor("modern"), "canon").key).toBe("canon");
    expect(catalogCalendar(catalogFor("modern"), "realWorld").key).toBe("realWorld");
    expect(catalogCalendar(catalogFor("modern"), undefined).key).toBe("realWorld");
    expect(catalogCalendar(catalogFor("classic"), "realWorld").key).toBe("canon");
  });

  const SHORT: CatalogCalendar = { key: "canon", quarterDays: 3, maintenancePeriodDays: 3, maintenanceScale: 0.1, quarterlyRentScale: 1 / 30 };
  const FULL: CatalogCalendar = { ...SHORT, key: "realWorld", maintenanceScale: 1, quarterlyRentScale: 1 };

  it("scales a quarterly rent by the calendar's quarterly scale, rounded to whole dollars", () => {
    expect(rentPerCollection("quarterly", 10_000, SHORT)).toBe(333);
    expect(rentPerCollection("quarterly", 10_000, FULL)).toBe(10_000);
  });

  it("scales a monthly rent by the calendar's maintenance scale", () => {
    expect(rentPerCollection("maintenancePeriod", 2_500, SHORT)).toBe(250);
    expect(rentPerCollection("maintenancePeriod", 2_500, FULL)).toBe(2_500);
  });

  it("leaves a sale price and a nightly rate as they are", () => {
    expect(rentPerCollection("sale", 150_000, SHORT)).toBe(150_000);
    expect(rentPerCollection("nightly", 150, SHORT)).toBe(150);
  });
});
