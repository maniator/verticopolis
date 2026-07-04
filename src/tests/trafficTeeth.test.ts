import { describe, it, expect } from "vitest";
import { Simulation } from "../engine/Simulation";
import { GRID } from "../engine/facilities";

const W = GRID.width;
const C = Math.floor(W / 2);
const DAY = 60 * 24;

function layFull(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

/**
 * A tower whose floor 40 is *served* (connected to the lobby through a chain of
 * shafts) but only via THREE rides — so it violates the two-ride rule and draws
 * no visitors. A shop sits on floor 40. Mirrors legibility.test.ts.
 */
function strandedShopTower(seed: number): Simulation {
  const sim = Simulation.newGame(seed);
  sim.money = 1e12;
  layFull(sim, "lobby", 1);
  for (let f = 2; f <= 45; f++) layFull(sim, "floor", f);
  sim.tower.placeTransport("elevatorStandard", C, 1, 15); // A: 1→15
  sim.tower.placeTransport("elevatorStandard", C + 6, 15, 30); // B: transfer at 15
  sim.tower.placeTransport("elevatorStandard", C + 12, 30, 45); // C: transfer at 30
  const r = sim.tower.place("shop", 40, C + 30); // 3 rides up
  sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
  return sim;
}

describe("Two-ride teeth — stranded commercial earns no visitor income", () => {
  it("a stranded (3-ride) shop records no positive visitor income; reachability turns it on", () => {
    const sim = strandedShopTower(21);
    // Precondition: floor 40 is connected but not reachable within two rides.
    expect(sim.tower.isFloorServed(40)).toBe(true);
    expect(sim.floorReachable(40)).toBe(false);

    // Run out a week of open hours. No visitors reach the shop, so its retail
    // line never takes a positive cent — it only ever carries the shop's own
    // overhead (≤ 0). Under the old isFloorServed gate this shop would have
    // earned full traffic income while the game told the player none would come.
    for (let d = 0; d < 6; d++) sim.tick(DAY);
    const strandedRetail = sim.incomeBreakdown().averages.retail;
    expect(strandedRetail).toBeLessThanOrEqual(0);

    // Add a shaft that reaches 40 in one transfer (1→15→40): now two-ride
    // reachable, so the same shop starts drawing patrons — the retail line rises
    // above its stranded (overhead-only) level.
    expect(sim.tower.placeTransport("elevatorStandard", C - 10, 15, 45).ok).toBe(true);
    expect(sim.floorReachable(40)).toBe(true);
    for (let d = 0; d < 6; d++) sim.tick(DAY);
    expect(sim.incomeBreakdown().averages.retail).toBeGreaterThan(strandedRetail);
  });

  it("a stranded shop earns strictly less than the identical shop made reachable", () => {
    // Same seed ⇒ same everything except reachability, isolating the teeth.
    const stranded = strandedShopTower(22);
    const reachable = strandedShopTower(22);
    reachable.tower.placeTransport("elevatorStandard", C - 10, 15, 45); // 1→15→40
    expect(stranded.floorReachable(40)).toBe(false);
    expect(reachable.floorReachable(40)).toBe(true);

    for (let d = 0; d < 8; d++) {
      stranded.tick(DAY);
      reachable.tick(DAY);
    }
    expect(reachable.incomeBreakdown().averages.retail).toBeGreaterThan(
      stranded.incomeBreakdown().averages.retail,
    );
  });
});
