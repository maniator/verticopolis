import { describe, expect, it } from "vitest";
import { newRenderSim, newViewReader } from "../../game/portAccess";
import { landingTile } from "../../render/excalibur/towerWalkerBuild";
import { look, newEngine, noEngine } from "../portKit/rustEngine";

/**
 * Where the renderer stands a stair's walkers, on the Rust engine's geometry:
 * the leftmost built column under the flight. That this column's run is the
 * one the engine's router lands on (`landing_segs[0]`, #674 and #662) is
 * `engine-rs/src/tower_landing_tests.rs`, on the same three shapes.
 */

/** A lobby across floor 1 at x 6..29, floor tiles on floor 2 over each run, and a stair at x 10. */
function stairOver(runs: [number, number][]) {
  const engine = newEngine(1, "classic");
  const sim = look(engine);
  sim.money = 1e9;
  for (let x = 6; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (const [from, to] of runs) for (let x = from; x < to; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
  const placed = sim.tower.placeTransport("stairs", 10, 1, 2);
  expect(placed.ok, placed.reason).toBe(true);
  const reader = newViewReader(engine);
  reader.update();
  const tower = newRenderSim(engine, reader).tower;
  const t = tower.transports[0]!;
  return (floor: number) => landingTile(tower, t, floor);
}

describe.skipIf(noEngine)("a stair's landing column on the engine", () => {
  it("is the first built column over a gap, its own column over built floor, and the left run of two", () => {
    expect([stairOver([[15, 26]])(2), stairOver([[10, 26]])(2), stairOver([[10, 12], [15, 26]])(2)]).toEqual([15, 10, 10]);
    expect(stairOver([[15, 26]])(1), "the lobby under the whole flight").toBe(10);
  });
});
