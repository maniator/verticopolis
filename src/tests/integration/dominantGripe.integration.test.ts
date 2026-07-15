import { describe, it, expect } from "vitest";
import { html } from "lit-html";
import { Simulation } from "../../engine/Simulation";
import { dominantGripe, vacateCause } from "../../engine/sim/satisfaction";
import { GRID } from "../../engine/facilities";
import type { Unit } from "../../engine/types";
import { facilityDiagnostics } from "../../game/facilityDiagnostics";
import { renderToFragment } from "../../ui/testing/litTestUtils";

/**
 * The pre-notice "Main gripe" inspector line and its engine read model
 * `dominantGripe`, which shares its attribution ladder with `vacateCause`
 * (vacateCause is dominantGripe with an "access" catch-all), so the two can
 * never disagree on which cause wins.
 */

const C = Math.floor(GRID.width / 2);

function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = 0; x < GRID.width; x++) sim.tower.place(kind, floor, x);
}

/** An occupied office on floor 2, served by an elevator and sitting near it
 *  (so it is not transport-far), with default rent and no noisy neighbor: a
 *  content tenant with nothing dragging it down until the test perturbs it. */
function servedOffice(sim: Simulation): Unit {
  sim.money = 1e9;
  sim.star = 1; // no random fire/bomb events to perturb the run
  lay(sim, "lobby", 1);
  lay(sim, "floor", 2);
  sim.buildTransport("elevatorStandard", C, 1, 2);
  const r = sim.tower.place("office", 2, C - 12);
  const office = sim.tower.units.find((u) => u.id === r.unitId)!;
  office.state = "occupied";
  office.satisfaction = 1;
  return office;
}

/** Rendered text of a unit's diagnostics lines. */
function diagText(sim: Simulation, u: Unit): string {
  return renderToFragment(html`<div>${facilityDiagnostics(sim, u)}</div>`).textContent ?? "";
}

describe("dominantGripe (the pre-notice main gripe)", () => {
  it("returns null for a content, served, uncongested tenant", () => {
    const sim = Simulation.newGame(1);
    const office = servedOffice(sim);
    expect(sim.dominantGripe(office)).toBeNull();
    // vacateCause still resolves the same state to its "access" catch-all.
    expect(sim.vacateCause(office, sim.tower.isFloorServed(office.floor), sim.congestionAt(office.floor))).toBe("access");
  });

  it("returns access for an unserved tenant, matching vacateCause", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1e9;
    sim.star = 1;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    // No transport built: floor 2 is not served.
    const r = sim.tower.place("office", 2, C);
    const office = sim.tower.units.find((u) => u.id === r.unitId)!;
    office.state = "occupied";
    expect(sim.tower.isFloorServed(2)).toBe(false);
    expect(sim.dominantGripe(office)).toBe("access");
    expect(sim.vacateCause(office, false, 0)).toBe("access");
  });

  it("returns rent for a served office priced above the going rate", () => {
    const sim = Simulation.newGame(1);
    const office = servedOffice(sim);
    office.rent = 20_000; // office default is 10,000
    expect(sim.dominantGripe(office)).toBe("rent");
    expect(sim.vacateCause(office, true, 0)).toBe("rent");
  });

  it("returns congestion for a served tenant on a crowded floor (above rent/noise)", () => {
    const sim = Simulation.newGame(1);
    const office = servedOffice(sim);
    office.rent = 20_000; // an over-market rent that congestion must outrank
    // The engine passes the congestion ratio it already computed this tick; a
    // ratio above 1.0 is the crowded-elevator drain, harsher than everything but
    // an unreachable floor, so it wins over the over-market rent below it.
    expect(dominantGripe(sim, office, true, 2)).toBe("congestion");
    expect(vacateCause(sim, office, true, 2)).toBe("congestion");
  });

  it("returns noise for a served, uncongested condo beside an office", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1e9;
    sim.star = 1;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    sim.buildTransport("elevatorStandard", C, 1, 2);
    // An office and a condo a few tiles apart on the same served floor: the
    // office noise carries across the built floor into the condo's 21-tile band.
    sim.tower.place("office", 2, C - 12);
    const cr = sim.tower.place("condo", 2, C + 4);
    const condo = sim.tower.units.find((u) => u.id === cr.unitId)!;
    condo.state = "occupied";
    condo.satisfaction = 0.5; // unhappy but not yet on notice
    expect(sim.noiseAfflicted(condo)).toBe(true);
    expect(sim.dominantGripe(condo)).toBe("noise");
    const text = diagText(sim, condo);
    expect(text).toContain("Main gripe:");
    expect(text).toContain("noisy neighbor");
  });
});

describe("the Main gripe inspector line", () => {
  it("names an unhappy tenant's dominant drain (rent) before any notice", () => {
    const sim = Simulation.newGame(1);
    const office = servedOffice(sim);
    office.rent = 20_000;
    office.satisfaction = 0.5; // unhappy but not yet on notice
    const text = diagText(sim, office);
    expect(text).toContain("Main gripe:");
    expect(text).toContain("rent is above the going rate");
  });

  it("stays silent for a content tenant (satisfaction above the annoyance ceiling)", () => {
    const sim = Simulation.newGame(1);
    const office = servedOffice(sim); // satisfaction 1, default rent
    expect(diagText(sim, office)).not.toContain("Main gripe:");
  });

  it("defers to the dedicated long-walk line for transportFar (no duplicate Main gripe)", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1e9;
    sim.star = 1;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    // Shaft mid-lot, office at the far right: the floor is served but the
    // office's nearest shaft sits well past the walk tolerance (W1).
    sim.buildTransport("elevatorStandard", C, 1, 2);
    const r = sim.tower.place("office", 2, GRID.width - 12);
    const office = sim.tower.units.find((u) => u.id === r.unitId)!;
    office.state = "occupied";
    office.satisfaction = 0.5;
    expect(sim.dominantGripe(office)).toBe("transportFar");
    const text = diagText(sim, office);
    // The far walk has its own always-on line; the Main gripe line does not repeat it.
    expect(text).toContain("Long walk to transport");
    expect(text).not.toContain("Main gripe:");
  });

  it("defers to the dedicated line for access (no duplicate Main gripe)", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1e9;
    sim.star = 1;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    const r = sim.tower.place("office", 2, C);
    const office = sim.tower.units.find((u) => u.id === r.unitId)!;
    office.state = "occupied";
    office.satisfaction = 0.5;
    const text = diagText(sim, office);
    // Access has its own actionable line; the Main gripe line does not repeat it.
    expect(text).toContain("Access:");
    expect(text).not.toContain("Main gripe:");
  });
});
