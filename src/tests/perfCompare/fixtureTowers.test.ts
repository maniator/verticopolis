import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { POOLED_CAPS } from "../../engine/facilities";
import { buildBracketTower, buildManyUnitTower } from "./fixtureTowers";

const inPool = (sim: Simulation, label: string): number => {
  const pool = POOLED_CAPS.find((p) => p.label === label)!;
  return sim.tower.transports.filter((t) => pool.kinds.includes(t.kind)).length;
};
const sha = (sim: Simulation): string => JSON.stringify(sim.serialize());

describe("the bracket towers", () => {
  const a = buildBracketTower({ seed: 11, floors: 26, population: 1150 });
  const b = buildBracketTower({ seed: 11, floors: 48, population: 1800 });

  it("sit between the small (729) and medium (3,240) towers by people and by units", () => {
    for (const [sim, lo, hi] of [[a, 1150, 1400], [b, 1800, 2100]] as const) {
      expect(sim.population).toBeGreaterThanOrEqual(lo);
      expect(sim.population).toBeLessThan(hi);
    }
    expect(a.tower.units.length).toBeGreaterThan(2_240);
    expect(b.tower.units.length).toBeGreaterThan(a.tower.units.length);
    expect(b.tower.units.length).toBeLessThan(12_062);
  });

  it("are deterministic: the same save text on every build", () => {
    expect(sha(buildBracketTower({ seed: 11, floors: 26, population: 1150 }))).toBe(sha(a));
  });

  it("refuse a target no tower of that height can hold", () => {
    expect(() => buildBracketTower({ seed: 11, floors: 5, population: 100_000 })).toThrow(/short of/);
  });
});

describe("the many-unit low-population tower", () => {
  const sim = buildManyUnitTower({ seed: 13, population: 500 });

  it("has the large tower's unit scale with a population in the hundreds", () => {
    expect(sim.population).toBeGreaterThanOrEqual(500);
    expect(sim.population).toBeLessThan(800);
    expect(sim.tower.units.length).toBeGreaterThan(40_000);
    expect(sim.tower.units.length).toBeLessThan(50_000);
  });

  it("fills the shared 24-shaft elevator pool and the 64-link stairs and escalator pool", () => {
    expect(inPool(sim, "elevator shafts")).toBe(POOLED_CAPS.find((p) => p.label === "elevator shafts")!.cap);
    expect(inPool(sim, "stairs/escalators")).toBe(POOLED_CAPS.find((p) => p.label === "stairs/escalators")!.cap);
  });

  it("is a five-star, 100-floor tower", () => {
    expect(sim.star).toBe(5);
    const floors = sim.tower.units.map((u) => u.floor);
    expect(Math.max(...floors)).toBeGreaterThanOrEqual(100);
  });

  it("is deterministic: the same save text on every build", () => {
    expect(sha(buildManyUnitTower({ seed: 13, population: 500 }))).toBe(sha(sim));
  });
});
