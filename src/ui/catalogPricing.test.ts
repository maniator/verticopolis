import { describe, expect, it } from "vitest";
import { catalogFor } from "../engine/catalog";
import { ALL_KINDS } from "../engine/facilities";
import { makeRules } from "../engine/gameRules";
import { priceOptionsFor, priceOptionsFromRent } from "./catalogPricing";

describe("price options from the catalog (#921)", () => {
  for (const mode of ["classic", "modern"] as const) {
    it(`match the ${mode} rule set's priceOptions for every kind`, () => {
      const catalog = catalogFor(mode);
      const rules = makeRules(mode);
      for (const kind of ALL_KINDS) expect(priceOptionsFor(catalog, kind), kind).toEqual(rules.priceOptions(kind));
    });
  }

  it("refuses a ladder rung that is not one of the four canon rungs", () => {
    const rung = (level: number, label: string) => ({ shape: "ladder" as const, cadence: "quarterly" as const, default: 1, noRate: true as const, rungs: [{ level, label, value: 1 }] });
    expect(() => priceOptionsFromRent(rung(4, "Very High"))).toThrow(/unknown rung/);
    expect(() => priceOptionsFromRent(rung(0, "Low"))).toThrow(/unknown rung/);
  });
});
