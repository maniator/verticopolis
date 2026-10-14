import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { buildSmallTower, loadFixtureSave } from "./scenarios";

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
    const split = crowdPeakOverADay(Simulation.deserialize(loadFixtureSave("src/tests/fixtures/split-tower.vctower")));
    const small = crowdPeakOverADay(buildSmallTower());
    expect(split).toEqual({ peak: 25, end: 0 });
    expect(small.peak).toBe(140);
  });
});
