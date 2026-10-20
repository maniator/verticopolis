import { describe, expect, it } from "vitest";
import type { WasmModule } from "../../dualrun/binding";
import { churnBetween, churnUnits, measureChurn } from "./churn";
import type { Scenario } from "./scenarios";

describe("churnUnits", () => {
  it("cuts arrays into elements, objects into properties and the rest whole", () => {
    const u = churnUnits({ units: [{ a: 1 }, { a: 2 }], ledger: { rent: 5, tax: 6 }, money: 10, name: "t" });
    expect([...u.keys()]).toEqual(["units\x000", "units\x001", "ledger\x00rent", "ledger\x00tax", "money", "name"]);
    expect(u.get("units\x001")).toBe('{"a":2}');
    expect(u.get("name")).toBe('"t"');
  });
  it("keeps dotted and bracketed keys from colliding or landing in another section", () => {
    const u = churnUnits({ a: { "b.c": 1 }, "a.b": { c: 2 }, "units[0]": [5] });
    expect(u.size).toBe(3);
    expect(churnBetween(new Map(), u).sections).toEqual({ a: { changed: 1, total: 1 }, "a.b": { changed: 1, total: 1 }, "units[0]": { changed: 1, total: 1 } });
  });
  it("keeps a save that is not an object as one unit", () => {
    expect([...churnUnits([1, 2]).keys()]).toEqual([""]);
    expect([...churnUnits(null).keys()]).toEqual([""]);
  });
});

describe("churnBetween", () => {
  it("counts changed and new units, by characters, per section", () => {
    const prev = churnUnits({ units: [{ a: 1 }, { a: 2 }], money: 10 });
    const next = churnUnits({ units: [{ a: 1 }, { a: 3 }, { a: 4 }], money: 10 });
    const c = churnBetween(prev, next);
    expect(c.total).toBe(`{"a":1}`.length * 3 + 2);
    expect(c.changed).toBe(`{"a":3}`.length * 2);
    expect(c.sections.units).toEqual({ changed: 14, total: 21 });
    expect(c.sections.money).toEqual({ changed: 0, total: 2 });
  });
  it("counts a unit that disappears as changed at its previous size", () => {
    const prev = churnUnits({ units: [{ a: 1 }, { a: 2 }, { a: 3 }], ledger: { rent: 5 }, money: 10 });
    const next = churnUnits({ units: [{ a: 1 }], money: 10 });
    const c = churnBetween(prev, next);
    expect(c.changed).toBe(`{"a":2}`.length * 2 + 1);
    expect(c.total).toBe(`{"a":1}`.length * 3 + 1 + 2);
    expect(c.sections.units).toEqual({ changed: 14, total: 21 });
    expect(c.sections.ledger).toEqual({ changed: 1, total: 1 });
    const gone = churnBetween(prev, new Map());
    expect(gone.changed).toBe(gone.total);
    expect(gone.total).toBeGreaterThan(0);
  });
  it("is zero for an identical save", () => {
    const u = churnUnits({ units: [{ a: 1 }] });
    expect(churnBetween(u, u).changed).toBe(0);
    expect(churnBetween(new Map(), new Map())).toEqual({ changed: 0, total: 0, sections: {} });
  });
});

describe("measureChurn", () => {
  // An engine whose clock moves every tick and whose one unit changes only in hour 2.
  const fake = (): WasmModule => {
    let ticks = 0;
    const engine = {
      tick: () => {
        ticks++;
      },
      serialize: () => JSON.stringify({ minutes: ticks * 30, units: [{ v: ticks >= 4 && ticks < 6 ? 1 : 0 }] }),
      free: () => {},
    };
    return { Engine: { fromSave: () => engine } } as unknown as WasmModule;
  };
  const sc = { name: "s", save: "{}" } as unknown as Scenario;

  it("measures each in-game hour against the one before and reports the spread", () => {
    const r = measureChurn(fake(), sc, 3, 30);
    expect(r.hours).toBe(3);
    // Hour 1 ticks 2 times (minutes 0 to 60) and leaves the unit alone; hour 2 flips it; hour 3 does too.
    expect(r.hourly[0].share).toBeLessThan(r.hourly[1].share);
    const shares = r.hourly.map((h) => h.share).sort((a, b) => a - b);
    expect(r.maxShare).toBe(shares[2]);
    expect(r.medianShare).toBe(shares[1]);
    expect(r.p95Share).toBe(shares[2]);
    expect(r.sections.units.saveShare).toBeGreaterThan(0.4);
    expect(r.sections.minutes.medianChurn).toBe(1);
  });
  it("is the lower middle hour for an even count", () => {
    expect(measureChurn(fake(), sc, 2, 30).medianShare).toBe(Math.min(...measureChurn(fake(), sc, 2, 30).hourly.map((h) => h.share)));
  });
  it("refuses a step that does not divide an hour, so an hour is always 60 minutes", () => {
    for (const dt of [0, -2, 7, 25, 45, 90]) expect(() => measureChurn(fake(), sc, 1, dt)).toThrow(/does not divide an hour/);
    expect(measureChurn(fake(), sc, 1, 60).hourly).toHaveLength(1);
  });
  it("leaves warm-up steps out of hour 1", () => {
    // The fake's unit flips between ticks 4 and 5; two warm-up steps shift hour 1 onto it.
    const cold = measureChurn(fake(), sc, 1, 30);
    const warm = measureChurn(fake(), sc, 1, 30, 2);
    expect(cold.hourly[0].changedChars).toBeLessThan(warm.hourly[0].changedChars);
  });
  it("frees the engine even when the save is unreadable", () => {
    let freed = false;
    const bad = { Engine: { fromSave: () => ({ tick: () => {}, serialize: () => "{", free: () => (freed = true) }) } } as unknown as WasmModule;
    expect(() => measureChurn(bad, sc, 1, 60)).toThrow();
    expect(freed).toBe(true);
  });
});
