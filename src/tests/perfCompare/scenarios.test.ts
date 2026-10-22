import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { DEFAULT_SCENARIOS, SCENARIO_NAMES, buildScenarios, buildSmallTower, loadFixtureSave, unknownScenarios } from "./scenarios";

/** The busiest the crowd gets over one in-game day (720 steps of 2 minutes). */
function crowdPeakOverADay(sim: Simulation): { peak: number; end: number } {
  let peak = 0;
  for (let i = 0; i < 720; i++) {
    sim.tick(2);
    peak = Math.max(peak, sim.crowd.people.length);
  }
  return { peak, end: sim.crowd.people.length };
}

describe("the small scenario", () => {
  // Issue #972 named split-tower.vctower as the small tower. Its crowd stays
  // tiny, so its ticks would exercise little of the crowd simulation; the
  // synthetic tower replaces it. docs/performance/ts-vs-wasm.md quotes these
  // figures, so a crowd change that fails this test means updating the doc.
  it("moves a real crowd where split-tower.vctower barely moves one", () => {
    const split = crowdPeakOverADay(Simulation.deserialize(loadFixtureSave("conformance/fixtures/split-tower.vctower")));
    const small = crowdPeakOverADay(buildSmallTower());
    expect(split).toEqual({ peak: 25, end: 0 });
    expect(small.peak).toBe(140);
  });
});

describe("choosing scenarios (#1270)", () => {
  it("builds the three default towers when none are named, as before", () => {
    expect(buildScenarios().map((s) => s.name)).toEqual(["small", "medium", "large"]);
    expect(buildScenarios(null).map((s) => s.name)).toEqual([...DEFAULT_SCENARIOS]);
  });

  it("builds only the named towers, in size order, whatever order they are named in", () => {
    expect(buildScenarios(["many-unit", "bracket-a"]).map((s) => s.name)).toEqual(["bracket-a", "many-unit"]);
  });

  it("lists every kind and flags a name it does not know", () => {
    expect(SCENARIO_NAMES).toEqual(["small", "bracket-a", "bracket-b", "medium", "large", "many-unit", "hotel-heavy"]);
    expect(unknownScenarios(["small", "huge", "many-unit"])).toEqual(["huge"]);
    expect(unknownScenarios([])).toEqual([]);
  });

  it("sizes the bracket towers between small and medium and the many-unit tower near large by units", () => {
    const [small, a, b, medium, , many] = buildScenarios(SCENARIO_NAMES);
    expect(a.population).toBeGreaterThan(small.population);
    expect(b.population).toBeGreaterThan(a.population);
    expect(medium.population).toBeGreaterThan(b.population);
    expect(many.population).toBeLessThan(1000);
    expect(many.units).toBeGreaterThan(40_000);
    expect(many.transports).toBe(24 + 64);
  });
});
