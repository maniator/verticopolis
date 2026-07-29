import { describe, it, expect } from "vitest";
import { html } from "lit-html";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { rentConfig } from "../../engine/econConfig";
import type { FacilityKind, Unit } from "../../engine/types";
import { facilityDiagnostics } from "../../game/facilityDiagnostics";
import { renderToFragment } from "../../ui/testing/litTestUtils";

/**
 * The lease amenities (fitnessClub/clinic) in the Main-gripe surface (#667).
 * Before the fix the amenity kinds were missing from the guard in
 * facilityDiagnostics, so a gouged amenity eroded to its notice with no card
 * line naming the cause (its rent drain, over * 0.07, outruns SERVED_RECOVERY
 * at the band max). The gate half of #667 is pinned in satisfactionStep.test.ts.
 */

const C = Math.floor(GRID.width / 2);

/** Assert a place/build call succeeded, surfacing its reason on failure. */
function expectOk<T extends { ok: boolean; reason?: string }>(r: T): T {
  expect(r.ok, r.reason).toBe(true);
  return r;
}

/** Lay a full floor of `kind`, center-outward (the connectivity order). */
function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  const put = (x: number): void => {
    if (sim.tower.structureKindAt(floor, x) === kind) return;
    expectOk(sim.tower.place(kind, floor, x));
  };
  for (let x = C; x < GRID.width; x++) put(x);
  for (let x = C - 1; x >= 0; x--) put(x);
}

/** Place a unit, assert its construction, and return the live Unit. */
function placeUnit(sim: Simulation, kind: FacilityKind, floor: number, x: number): Unit {
  const r = expectOk(sim.tower.place(kind, floor, x));
  const unit = sim.tower.units.find((u) => u.id === r.unitId);
  expect(unit, `no unit for placed ${kind} at floor ${floor}, x ${x}`).toBeDefined();
  return unit!;
}

function diagText(sim: Simulation, u: Unit): string {
  return renderToFragment(html`<div>${facilityDiagnostics(sim, u)}</div>`).textContent ?? "";
}

describe("the lease-amenity Main gripe line (#667)", () => {
  it("a gouged fitness club names rent before its notice ever fires", () => {
    const sim = Simulation.newGame(1, "modern");
    sim.money = 1e9;
    sim.star = 5; // clear the star gate on the Modern amenity kinds
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    expectOk(sim.buildTransport("elevatorStandard", C, 1, 2));
    const club = placeUnit(sim, "fitnessClub", 2, C + 4);
    sim.star = 1;
    club.state = "occupied";
    club.rent = rentConfig("fitnessClub")!.max;
    club.satisfaction = 0.5; // unhappy but not yet on notice
    expect(sim.dominantGripe(club)).toBe("rent");
    const text = diagText(sim, club);
    expect(text).toContain("Main gripe:");
    expect(text).toContain("rent is above the going rate");
  });
});
