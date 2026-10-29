import { it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { MILESTONES } from "../../engine/milestones";
import { GRID, FACILITIES } from "../../engine/facilities";
import { PortSim, describeEngines, type Leg } from "../portKit/portSim";

const predicate = (id: string) => MILESTONES.find((m) => m.id === id)!.test;

const W = GRID.width;
const C = Math.floor(W / 2);
const DAY = 60 * 24;

function layFull(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

/** Fill a floor with offices from x=0, leaving `rightClear` tiles free. They
 *  are stamped occupied unless `occupy` is false, which leaves them for the
 *  engine's own move-ins. */
function fillOffices(sim: Simulation, floor: number, rightClear = 0, occupy = true): number {
  const w = FACILITIES.office.width;
  let n = 0;
  for (let x = 0; x + w <= W - rightClear; x += w) {
    const r = sim.tower.place("office", floor, x);
    if (r.ok) {
      if (occupy) sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
      n++;
    }
  }
  return n;
}

const done = (sim: PortSim, label: string): boolean =>
  sim.state.milestoneProgress().list.find((m) => m.label === label)?.done ?? false;

/** A founded tower with three office floors and a standard elevator on the
 *  right edge, enough to clear the 500-population milestone. The last
 *  `vacantFloors` floors are built but not stamped occupied. A load adopts any
 *  milestone it already satisfies, so a test that watches a milestone fire
 *  starts below the bar and lets the engine's move-ins cross it. The draft is
 *  the fixture's authoring copy; the engine starts from its save. */
function startedTower(vacantFloors = 0): Simulation {
  const draft = Simulation.newGame(1);
  draft.money = 1_000_000_000;
  layFull(draft, "lobby", 1);
  for (const f of [2, 3, 4]) {
    layFull(draft, "floor", f);
    fillOffices(draft, f, 6, f <= 4 - vacantFloors); // leave the right edge for the elevator
  }
  expect(draft.tower.placeTransport("elevatorStandard", W - 4, 1, 4).ok).toBe(true); // serve the floors so tenants stay
  return draft;
}

describeEngines("Milestones (optional goals)", (leg: Leg) => {
  it("fires once, is announced once, and shows in progress", () => {
    const sim = new PortSim(leg, startedTower(1)); // the top floor is left for move-ins
    expect(sim.state.population).toBeLessThan(500); // below the bar at load, so the load adopts nothing

    expect(done(sim, "Getting Started")).toBe(false);
    sim.tick(DAY); // crosses a day boundary → onDay → checkMilestones
    expect(sim.state.population).toBeGreaterThanOrEqual(500);
    expect(sim.state.population).toBeLessThan(2000); // only the pop-500 milestone is eligible
    expect(done(sim, "Getting Started")).toBe(true);

    // Fires exactly once: the achieved set doesn't grow on a further day.
    const achieved = sim.state.milestoneProgress().achieved;
    sim.tick(DAY);
    expect(sim.state.milestoneProgress().achieved).toBe(achieved);
  });

  it("achievements survive save/reload (no re-announce)", () => {
    const sim = new PortSim(leg, startedTower());
    sim.tick(DAY);
    expect(done(sim, "Getting Started")).toBe(true);

    const reloaded = new PortSim(leg, sim.save());
    expect(done(reloaded, "Getting Started")).toBe(true); // restored, still achieved
    const achieved = reloaded.state.milestoneProgress().achieved;
    reloaded.tick(DAY); // already achieved → must not re-announce
    expect(reloaded.state.milestoneProgress().achieved).toBe(achieved);
  });

  it("well-served fires for a large, fully-reachable tower", () => {
    const draft = Simulation.newGame(2);
    draft.money = 1_000_000_000;
    layFull(draft, "lobby", 1);
    for (let f = 2; f <= 25; f++) {
      layFull(draft, "floor", f);
      fillOffices(draft, f, 6); // leave the right edge clear for the elevator
    }
    // The elevator stops one floor short, so floor 25 is occupied but unreachable
    // and the load adopts nothing; the engine extends it to serve every floor.
    const shaft = draft.tower.placeTransport("elevatorStandard", W - 4, 1, 24);
    expect(shaft.ok).toBe(true);
    const sim = new PortSim(leg, draft);
    expect(sim.state.population).toBeGreaterThanOrEqual(5000);

    expect(done(sim, "Smooth Operator")).toBe(false); // floor 25 is not served yet
    // One standard elevator serving floors 1..25 makes every occupied floor reachable.
    expect(sim.extendShaft(sim.state.tower.transports[0].id, true, 25).ok).toBe(true);
    sim.tick(DAY);
    expect(done(sim, "Smooth Operator")).toBe(true);
  });
});

describeEngines("Milestone review follow-ups", (leg: Leg) => {
  it("full-house counts vacant condos/hotels, not just offices (M1)", () => {
    // Test the predicate directly — no tick — so under-provisioned transport can't
    // evict offices and confound the vacancy check. This is purely M1's logic:
    // an empty condo/hotel is a vacancy too, not only empty offices.
    const draft = Simulation.newGame(3);
    draft.money = 1_000_000_000;
    layFull(draft, "lobby", 1);
    for (let f = 2; f <= 12; f++) {
      layFull(draft, "floor", f);
      fillOffices(draft, f); // all occupied → no empty offices
    }
    layFull(draft, "floor", 13);
    const condo = draft.tower.place("condo", 13, 0); // an unsold (empty) condo on its own floor
    expect(condo.ok).toBe(true);
    const sim = new PortSim(leg, draft);
    expect(sim.state.population).toBeGreaterThanOrEqual(2000);

    const fullHouse = predicate("full-house");
    expect(fullHouse(sim.readOnlySimulation)).toBe(false); // the empty condo is a vacancy (office-only vacant would miss it)
    expect(sim.demolish(condo.unitId!)).toBe(true); // remove the only vacant leasable unit
    expect(fullHouse(sim.readOnlySimulation)).toBe(true);
  });

  it("adopts already-satisfied milestones silently on load, without a burst (I2)", () => {
    const sim = new PortSim(leg, startedTower());
    expect(sim.state.population).toBeGreaterThanOrEqual(500);

    // Simulate a pre-feature save: no milestones field, none yet announced.
    const data = JSON.parse(sim.save()) as { milestones?: unknown };
    delete data.milestones;
    const reloaded = new PortSim(leg, JSON.stringify(data));

    expect(done(reloaded, "Getting Started")).toBe(true); // adopted at load, not announced
    expect(reloaded.state.log.some((e) => e.text.includes("🏅"))).toBe(false); // no burst headline
  });
});
