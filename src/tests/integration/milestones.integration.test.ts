import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { MILESTONES } from "../../engine/milestones";
import { GRID, FACILITIES } from "../../engine/facilities";

const predicate = (id: string) => MILESTONES.find((m) => m.id === id)!.test;

const W = GRID.width;
const C = Math.floor(W / 2);
const DAY = 60 * 24;

function layFull(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

/** Fill a floor with occupied offices from x=0, leaving `rightClear` tiles free. */
function fillOffices(sim: Simulation, floor: number, rightClear = 0): number {
  const w = FACILITIES.office.width;
  let n = 0;
  for (let x = 0; x + w <= W - rightClear; x += w) {
    const r = sim.tower.place("office", floor, x);
    if (r.ok) {
      sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
      n++;
    }
  }
  return n;
}

const done = (sim: Simulation, label: string): boolean =>
  sim.milestoneProgress().list.find((m) => m.label === label)?.done ?? false;

describe("Milestones (optional goals)", () => {
  it("fires once, is announced once, and shows in progress", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1_000_000_000;
    layFull(sim, "lobby", 1);
    for (const f of [2, 3, 4]) {
      layFull(sim, "floor", f);
      fillOffices(sim, f, 6); // leave the right edge for the elevator
    }
    sim.tower.placeTransport("elevatorStandard", W - 4, 1, 4); // serve the floors so tenants stay
    expect(sim.population).toBeGreaterThanOrEqual(500);
    expect(sim.population).toBeLessThan(2000); // only the pop-500 milestone is eligible

    expect(done(sim, "Getting Started")).toBe(false);
    sim.tick(DAY); // crosses a day boundary → onDay → checkMilestones
    expect(done(sim, "Getting Started")).toBe(true);

    // Fires exactly once: the achieved set doesn't grow on a further day.
    const achieved = sim.milestoneProgress().achieved;
    sim.tick(DAY);
    expect(sim.milestoneProgress().achieved).toBe(achieved);
  });

  it("achievements survive save/reload (no re-announce)", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1_000_000_000;
    layFull(sim, "lobby", 1);
    for (const f of [2, 3, 4]) {
      layFull(sim, "floor", f);
      fillOffices(sim, f, 6);
    }
    sim.tower.placeTransport("elevatorStandard", W - 4, 1, 4);
    sim.tick(DAY);
    expect(done(sim, "Getting Started")).toBe(true);

    const reloaded = Simulation.deserialize(sim.serialize());
    expect(done(reloaded, "Getting Started")).toBe(true); // restored, still achieved
    const achieved = reloaded.milestoneProgress().achieved;
    reloaded.tick(DAY); // already achieved → must not re-announce
    expect(reloaded.milestoneProgress().achieved).toBe(achieved);
  });

  it("well-served fires for a large, fully-reachable tower", () => {
    const sim = Simulation.newGame(2);
    sim.money = 1_000_000_000;
    layFull(sim, "lobby", 1);
    for (let f = 2; f <= 25; f++) {
      layFull(sim, "floor", f);
      fillOffices(sim, f, 6); // leave the right edge clear for the elevator
    }
    // One standard elevator serving floors 1..25 makes every occupied floor reachable.
    expect(sim.tower.placeTransport("elevatorStandard", W - 4, 1, 25).ok).toBe(true);
    expect(sim.population).toBeGreaterThanOrEqual(5000);

    expect(done(sim, "Smooth Operator")).toBe(false); // not evaluated until a day passes
    sim.tick(DAY);
    expect(done(sim, "Smooth Operator")).toBe(true);
  });
});

describe("Milestone review follow-ups", () => {
  it("full-house counts vacant condos/hotels, not just offices (M1)", () => {
    // Test the predicate directly — no tick — so under-provisioned transport can't
    // evict offices and confound the vacancy check. This is purely M1's logic:
    // an empty condo/hotel is a vacancy too, not only empty offices.
    const sim = Simulation.newGame(3);
    sim.money = 1_000_000_000;
    layFull(sim, "lobby", 1);
    for (let f = 2; f <= 12; f++) {
      layFull(sim, "floor", f);
      fillOffices(sim, f); // all occupied → no empty offices
    }
    layFull(sim, "floor", 13);
    const condo = sim.tower.place("condo", 13, 0); // an unsold (empty) condo on its own floor
    expect(condo.ok).toBe(true);
    expect(sim.population).toBeGreaterThanOrEqual(2000);

    const fullHouse = predicate("full-house");
    expect(fullHouse(sim)).toBe(false); // the empty condo is a vacancy (office-only vacant would miss it)
    sim.tower.removeUnit(condo.unitId!); // remove the only vacant leasable unit
    expect(fullHouse(sim)).toBe(true);
  });

  it("adopts already-satisfied milestones silently on load, without a burst (I2)", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1_000_000_000;
    layFull(sim, "lobby", 1);
    for (const f of [2, 3, 4]) {
      layFull(sim, "floor", f);
      fillOffices(sim, f, 6);
    }
    sim.tower.placeTransport("elevatorStandard", W - 4, 1, 4);
    expect(sim.population).toBeGreaterThanOrEqual(500);

    // Simulate a pre-feature save: no milestones field, none yet announced.
    const data = sim.serialize();
    delete data.milestones;
    const reloaded = Simulation.deserialize(data);

    expect(done(reloaded, "Getting Started")).toBe(true); // adopted at load, not announced
    expect(reloaded.log.some((e) => e.text.includes("🏅"))).toBe(false); // no burst headline
  });
});
