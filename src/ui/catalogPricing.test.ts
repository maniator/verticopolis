import { describe, expect, it } from "vitest";
import { catalogFor } from "../engine/catalog";
import { ALL_KINDS } from "../engine/facilities";
import { makeRules } from "../engine/gameRules";
import { priceOptionsFor, priceOptionsFromRent, unitPrice } from "./catalogPricing";
import { rentOf } from "../engine/econConfig";
import { Simulation } from "../engine/Simulation";

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

describe("a unit's price from the catalog (#921)", () => {
  it("matches rentOf for a stored price, No Rate, and an unset unit of every kind the mode builds", () => {
    for (const mode of ["classic", "modern"] as const) {
      const catalog = catalogFor(mode);
      for (const f of catalog.facilities) {
        if (!f.available || !f.rent) continue;
        const kind = f.key;
        expect(unitPrice(catalog, { kind, rent: 1234 }), `${mode} ${kind} stored`).toBe(rentOf({ kind, rent: 1234 }));
        expect(unitPrice(catalog, { kind, rent: 1234, noRate: true }), `${mode} ${kind} no rate`).toBe(0);
        // An unset unit charges the catalog default. Where the engine's
        // fallback table differs (Classic hotels and condos), no Classic path
        // leaves the price unset: a build and a load store the Average rung.
        if (mode === "modern" || kind === "office") expect(unitPrice(catalog, { kind }), `${mode} ${kind} unset`).toBe(rentOf({ kind }));
        else expect(unitPrice(catalog, { kind }), `${mode} ${kind} unset`).toBe(f.rent.default);
      }
    }
  });

  it("matches what both modes charge for a fresh build of every priced kind", () => {
    for (const mode of ["classic", "modern"] as const) {
      const catalog = catalogFor(mode);
      const sim = Simulation.newGame(5, mode);
      sim.money = 1e12;
      sim.star = 6;
      for (let x = 150; x < 300; x++) sim.build("lobby", 1, x);
      let floor = 2;
      const eligible = catalog.facilities.filter((f) => f.available && f.rent && !f.transport && !f.basement);
      let built = 0;
      for (const f of eligible) {
        for (let x = 150; x < 300; x++) sim.build("floor", floor, x);
        const res = sim.build(f.key, floor, 152);
        // Every priced kind must build, or the sweep would quietly check fewer.
        expect(res.ok, `${mode} ${f.key}: ${res.ok ? "" : res.reason}`).toBe(true);
        const u = sim.tower.unitAt(floor, 152)!;
        expect(unitPrice(catalog, u), `${mode} ${f.key}`).toBe(rentOf(u));
        built++;
        floor += f.floors;
      }
      expect(built, `${mode}: every priced kind was built`).toBe(eligible.length);
      expect(built, `${mode}: the sweep covers priced kinds`).toBeGreaterThan(3);
    }
  });
});
