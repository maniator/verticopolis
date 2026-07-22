import { describe, expect, it } from "vitest";
import { newSeededGame } from "../fixtures/towerFixtures";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { formatFloors, INFEST_DAYS } from "../../engine/economy/housekeeping";

/**
 * Housekeeping legibility layer (housekeeping-overhaul GDD, epic 3): infestation
 * alerts carry floor locations, the cleanliness overlay separates "infested"
 * (terminal) from "unreached" and shades condos not-applicable, the coverage
 * verdicts key on the OBSERVED shortfall instead of a nominal best case, and
 * maids step out of their own station.
 */

const X0 = Math.floor(GRID.width / 2) - 20;

function baseTower(seed: number): Simulation {
  const sim = newSeededGame(seed);
  sim.star = 2;
  for (let i = 0; i < 30; i++) expect(sim.tower.place("floor", 2, X0 + i).ok).toBe(true);
  expect(sim.buildTransport("elevatorStandard", X0 + 26, 1, 2).ok).toBe(true);
  return sim;
}

function placeRoom(sim: Simulation, floor: number, x: number, state?: "dirty" | "infested") {
  const r = sim.tower.place("hotelSingle", floor, x);
  expect(r.ok).toBe(true);
  const room = sim.tower.units.find((u) => u.id === r.unitId)!;
  if (state) {
    room.state = state;
    if (state === "infested") room.occupants = 0;
  }
  return room;
}

describe("formatFloors", () => {
  it("folds consecutive floors into en-dash ranges, sorted and deduped", () => {
    expect(formatFloors([12])).toBe("12");
    expect(formatFloors([16, 14, 15, 12, 14])).toBe("12, 14–16");
    expect(formatFloors([3, 5, 7])).toBe("3, 5, 7");
    expect(formatFloors([])).toBe("");
  });
});

describe("alerts carry location", () => {
  it("the infestation escalation toast names the floors", () => {
    const sim = baseTower(51);
    for (let i = 0; i < 30; i++) expect(sim.tower.place("floor", 3, X0 + i).ok).toBe(true);
    const a = placeRoom(sim, 2, X0, "dirty");
    const b = placeRoom(sim, 3, X0, "dirty");
    a.dirtyDays = INFEST_DAYS - 1;
    b.dirtyDays = INFEST_DAYS - 1;
    sim.economy.hotelCheckout(); // escalation runs at the checkout boundary
    expect(a.state).toBe("infested");
    expect(b.state).toBe("infested");
    expect(sim.log.some((l) => l.text.includes("on floor(s) 2–3"))).toBe(true);
  });

  it("the spread toast names the floors it crept into", () => {
    const sim = baseTower(52);
    placeRoom(sim, 2, X0, "infested");
    const neighbor = placeRoom(sim, 2, X0 + 4);
    neighbor.state = "empty";
    sim.economy.hotelCheckout();
    expect(neighbor.state).toBe("dirty");
    expect(sim.log.some((l) => l.text.includes("Cockroaches spread") && l.text.includes("on floor(s) 2"))).toBe(true);
  });
});

describe("the cleanliness overlay separates terminal from unreached", () => {
  it("infested rooms carry their own tint, unreached rooms stay on the red ramp, condos read n/a", () => {
    const sim = baseTower(53);
    // Floor 3 exists but no staff transport reaches it: unreached.
    for (let i = 0; i < 30; i++) expect(sim.tower.place("floor", 3, X0 + i).ok).toBe(true);
    expect(sim.tower.place("housekeeping", 2, X0 + 8).ok).toBe(true);
    const infested = placeRoom(sim, 2, X0, "infested");
    const unreached = placeRoom(sim, 3, X0);
    const c = sim.tower.place("condo", 3, X0 + 6);
    expect(c.ok).toBe(true);
    const cells = sim.floorHeatmap("cleanliness");
    const cellFor = (u: { floor: number; x: number }) => cells.find((h) => h.floor === u.floor && h.minX === u.x)!;
    expect(cellFor(infested).tint).toBe("infested");
    const un = cellFor(unreached);
    expect(un.tint).toBeUndefined();
    expect(un.severity).toBe(1);
    const condoUnit = sim.tower.units.find((u) => u.id === c.unitId)!;
    expect(cellFor(condoUnit).tint).toBe("na");
  });
});

describe("the coverage verdict keys on observed shortfall", () => {
  it("housekeepingReport is null before the first checkout and reports cleaned/leftover after", () => {
    const sim = baseTower(54);
    expect(sim.economy.housekeepingReport()).toBeNull();
    placeRoom(sim, 2, X0, "dirty"); // no housekeeping: it survives the shift
    for (let i = 0; i < 25; i++) sim.tick(60); // through the next 8:00 checkout
    const report = sim.economy.housekeepingReport();
    expect(report).not.toBeNull();
    expect(report!.leftover).toBeGreaterThanOrEqual(1);
    expect(sim.log.some((l) => l.text.includes("went unserved"))).toBe(true);
  });
});

describe("maids step out of their own station", () => {
  it("a dispatched maid spawns at the housekeeping unit's footprint, not a random tile", () => {
    const sim = baseTower(55);
    placeRoom(sim, 2, X0, "dirty");
    const hk = sim.tower.place("housekeeping", 2, X0 + 20);
    expect(hk.ok).toBe(true);
    const crew = sim.tower.units.find((u) => u.id === hk.unitId)!;
    sim.clock.minutes = 13 * 60;
    sim.economy.dispatchHousekeepers();
    const maid = sim.crowd.people.find((p) => p.staff)!;
    expect(maid.x).toBe(crew.x + crew.width / 2);
  });
});
