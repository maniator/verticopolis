import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIOS, SCENARIO_NAMES, buildScenarios, loadScenario, pinnedTowers, unknownScenarios } from "./scenarios";

interface SavedTower {
  mode: string;
  star: number;
  units: { kind: string; floor: number; state?: string }[];
  transports: { kind: string }[];
}

const tower = (name: (typeof SCENARIO_NAMES)[number]): SavedTower => JSON.parse(buildScenarios([name])[0].save) as SavedTower;
const count = <T>(items: readonly T[], keep: (item: T) => boolean): number => items.filter(keep).length;

describe("choosing scenarios (#1270)", () => {
  it("loads the three default towers when none are named, as before", () => {
    expect(buildScenarios().map((s) => s.name)).toEqual(["small", "medium", "large"]);
    expect(buildScenarios(null).map((s) => s.name)).toEqual([...DEFAULT_SCENARIOS]);
  });

  it("loads only the named towers, in size order, whatever order they are named in", () => {
    expect(buildScenarios(["many-unit", "bracket-a"]).map((s) => s.name)).toEqual(["bracket-a", "many-unit"]);
  });

  it("lists every kind and flags a name it does not know", () => {
    expect(SCENARIO_NAMES).toEqual(["small", "bracket-a", "bracket-b", "medium", "large", "many-unit", "hotel-heavy"]);
    expect(unknownScenarios(["small", "huge", "many-unit"])).toEqual(["huge"]);
    expect(unknownScenarios([])).toEqual([]);
  });

  it("sizes the bracket towers between small and medium and the many-unit tower near large by units", () => {
    const [small, a, b, medium, large, many] = buildScenarios(SCENARIO_NAMES);
    expect(a.population).toBeGreaterThan(small.population);
    expect(b.population).toBeGreaterThan(a.population);
    expect(medium.population).toBeGreaterThan(b.population);
    expect(large.population).toBeGreaterThan(10_000);
    expect(many.population).toBeLessThan(1000);
    expect(many.units).toBeGreaterThan(40_000);
    expect(many.transports).toBe(24 + 64);
  });
});

describe("the pinned towers (#1875)", () => {
  it("hash to their records and carry the records' counts", () => {
    const pinned = pinnedTowers();
    expect(Object.keys(pinned)).toEqual([...SCENARIO_NAMES]);
    for (const sc of buildScenarios(SCENARIO_NAMES)) expect({ sha256: sc.sha256, population: sc.population, units: sc.units, transports: sc.transports }, sc.name).toEqual(pinned[sc.name]);
  });

  it("keep the many-unit tower a five-star, 100-floor tower with both transport pools full", () => {
    const many = tower("many-unit");
    expect([many.mode, many.star, Math.max(...many.units.map((u) => u.floor))]).toEqual(["classic", 5, 100]);
    expect(count(many.transports, (t) => t.kind.startsWith("elevator"))).toBe(24);
    expect(count(many.transports, (t) => t.kind === "stairs" || t.kind === "escalator")).toBe(64);
  });

  it("keep the hotel-heavy tower a Modern tower of booked rooms with 24 housekeeping units", () => {
    const hotel = tower("hotel-heavy");
    const rooms = hotel.units.filter((u) => u.kind.startsWith("hotel"));
    expect(hotel.mode).toBe("modern");
    expect(rooms.length).toBeGreaterThan(800);
    expect(rooms.every((u) => u.state === "asleep")).toBe(true);
    expect(count(hotel.units, (u) => u.kind === "housekeeping")).toBe(24);
  });

  it("refuse a tower file that no longer hashes to its record", () => {
    const small = pinnedTowers().small;
    expect(() => loadScenario("small", undefined)).toThrow(/small: towers\/manifest.json has no record/);
    expect(() => loadScenario("small", { ...small, sha256: "0".repeat(64) })).toThrow(/small: src\/tests\/perfCompare\/towers\/small.vctower hashes to [0-9a-f]{64}, but towers\/manifest.json records 0{64}/);
  });
});
