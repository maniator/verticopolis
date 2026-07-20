import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";

const C = Math.floor(GRID.width / 2);
const DAY = 60 * 24;
// A narrow strip that still spans every column the shafts (C-10 … C+12) and the
// width-12 shop at C+30 (…C+41) need — keeps the tower small so the multi-day
// tick stays well within the CI test timeout (a full-width tower is ~5× larger).
const X0 = C - 15;
const X1 = C + 45;
function layStrip(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = X0; x <= X1; x++) sim.tower.place(kind, floor, x);
}

/**
 * A tower whose floor 40 is *served* (connected to the lobby through the shaft
 * network) but reachably-close only past Classic's walk budget: an elevator
 * reaches floor 30, then a 15-flight stair chain climbs to 45, so floor 40 sits
 * 10 flights above the elevator and no commuter will make the climb. Reachability
 * is uncapped now (#503), so a too-long stair climb is what strands it. A shop
 * sits on floor 40. Narrow, tick-cheap footprint.
 */
function strandedShopTower(seed: number): Simulation {
  const sim = Simulation.newGame(seed);
  sim.money = 1e12;
  layStrip(sim, "lobby", 1);
  for (let f = 2; f <= 45; f++) layStrip(sim, "floor", f);
  expect(sim.tower.placeTransport("elevatorStandard", C, 1, 30).ok).toBe(true); // reaches the demand pool and floor 30
  for (let f = 30; f < 45; f++) expect(sim.tower.placeTransport("stairs", C + 20, f, f + 1).ok).toBe(true);
  // Occupied offices on a reachable low floor give the shop a real demand pool to
  // serve (commercial income is demand-driven: a shop with no reachable
  // population earns nothing regardless of its own reachability). Placed clear of
  // the shaft (C), the stairs (C+20), and the shop column (C+30).
  for (const x of [X0, C + 8]) {
    const o = sim.tower.place("office", 2, x);
    expect(o.ok, o.reason).toBe(true);
    sim.tower.units.find((u) => u.id === o.unitId)!.state = "occupied";
  }
  const r = sim.tower.place("shop", 40, C + 30); // up the long stair climb
  expect(r.ok, r.reason).toBe(true);
  sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
  return sim;
}

describe("Reachability teeth — stranded commercial earns no visitor income", () => {
  it("a stranded (stair-climb) shop records no positive visitor income; reachability turns it on", () => {
    const sim = strandedShopTower(21);
    // Precondition: floor 40 is connected but not reachably-close (10-flight climb).
    expect(sim.tower.isFloorServed(40)).toBe(true);
    expect(sim.floorReachable(40)).toBe(false);

    // A few days of open hours: no visitors reach the shop, so its retail line
    // never takes a positive cent — it only ever carries the shop's own overhead
    // (≤ 0). Under the old isFloorServed gate this shop would have earned full
    // traffic income while the game told the player none would come.
    for (let d = 0; d < 4; d++) sim.tick(DAY);
    const strandedRetail = sim.incomeBreakdown().averages.retail;
    expect(strandedRetail).toBeLessThanOrEqual(0);

    // An elevator 30→45 shortcuts the stair climb (1→30 by A, 30→40 by the new
    // shaft): now reachably-close, so the same shop starts drawing patrons and the
    // retail line rises above its stranded (overhead-only) level.
    expect(sim.tower.placeTransport("elevatorStandard", C - 10, 30, 45).ok).toBe(true);
    expect(sim.floorReachable(40)).toBe(true);
    for (let d = 0; d < 4; d++) sim.tick(DAY);
    expect(sim.incomeBreakdown().averages.retail).toBeGreaterThan(strandedRetail);
  }, 60000);

  it("a stranded shop earns strictly less than the identical shop made reachable", () => {
    // Same seed ⇒ same everything except reachability, isolating the teeth.
    const stranded = strandedShopTower(22);
    const reachable = strandedShopTower(22);
    reachable.tower.placeTransport("elevatorStandard", C - 10, 30, 45); // via elevator 30→45
    expect(stranded.floorReachable(40)).toBe(false);
    expect(reachable.floorReachable(40)).toBe(true);

    for (let d = 0; d < 5; d++) {
      stranded.tick(DAY);
      reachable.tick(DAY);
    }
    expect(reachable.incomeBreakdown().averages.retail).toBeGreaterThan(
      stranded.incomeBreakdown().averages.retail,
    );
  }, 60000);
});
