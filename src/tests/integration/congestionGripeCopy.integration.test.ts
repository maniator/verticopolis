import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import type { FacilityKind, Unit } from "../../engine/types";
import { gripeLineText } from "../../game/gripeCopy";

/**
 * The congestion gripe names the transport that is actually crowded (#699).
 * Congestion capacity counts every passenger transport kind (the types.ts
 * transport-neutral copy rule), so a stairs-only floor genuinely crowds; the
 * copy must name the stairs and a remedy that applies there, never "add cars"
 * on a floor no elevator stops at. Classification routes through
 * `Tower.stopsAt`, so a shaft that spans the floor but skips it (the #699
 * save: both elevators skip floors 2-5) does not count as serving it.
 * Split from dominantGripe.integration.test.ts for the file-size guard; the
 * fixture helpers mirror that file's.
 */

const C = Math.floor(GRID.width / 2);

/** Assert a place/build/transport call actually succeeded, surfacing its
 *  `reason` on failure so a fixture never silently builds a different tower
 *  than the scenario describes (AGENTS.md fixture-construction rule). */
function expectOk<T extends { ok: boolean; reason?: string }>(r: T): T {
  expect(r.ok, r.reason).toBe(true);
  return r;
}

/** Lay a full floor of `kind`, building outward from the center so every tile
 *  is adjacent to an already-placed one (the connectivity order the tower
 *  requires). Tiles the new-game seed already laid as this kind are skipped. */
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

/** Lobby + floor 2 with an occupied office and NO transport yet; each case
 *  adds exactly the transports whose wording it is about. */
function bareOffice(sim: Simulation): Unit {
  sim.money = 1e9;
  sim.star = 1; // no random fire/bomb events to perturb the run
  lay(sim, "lobby", 1);
  lay(sim, "floor", 2);
  const office = placeUnit(sim, "office", 2, C - 30);
  office.state = "occupied";
  office.satisfaction = 1;
  return office;
}

describe("the congestion gripe names the transport that is actually crowded (#699)", () => {
  it("keeps the elevator wording on an elevator-served floor", () => {
    const sim = Simulation.newGame(1);
    const office = bareOffice(sim);
    expectOk(sim.buildTransport("elevatorStandard", C, 1, 2));
    const text = gripeLineText(sim, office, "congestion");
    expect(text).toContain("crowded elevators");
    expect(text).toContain("Add cars or a parallel shaft");
  });

  it("names the stairs on a stairs-only floor (the #699 repro shape)", () => {
    const sim = Simulation.newGame(2);
    const office = bareOffice(sim);
    expectOk(sim.buildTransport("stairs", C, 1, 2));
    expect(sim.tower.isFloorServed(2)).toBe(true);
    const text = gripeLineText(sim, office, "congestion");
    expect(text).toContain("crowded stairs");
    expect(text).toContain("elevator stop");
    expect(text).not.toContain("crowded elevators");
    expect(text).not.toContain("Add cars");
  });

  it("does not count an elevator whose skip list drops this floor (the #699 seam)", () => {
    const sim = Simulation.newGame(3);
    const office = bareOffice(sim);
    lay(sim, "floor", 3);
    expectOk(sim.buildTransport("stairs", C, 1, 2));
    expectOk(sim.buildTransport("elevatorStandard", C + 20, 1, 3));
    const shaft = sim.tower.transports.find((t) => t.kind === "elevatorStandard")!;
    expect(sim.tower.setStop(shaft.id, 2, false)).toBe(true);
    expect(sim.tower.stopsAt(shaft, 2)).toBe(false); // the seam: spans 1-3, skips 2
    const text = gripeLineText(sim, office, "congestion");
    expect(text).toContain("crowded stairs");
    expect(text).not.toContain("crowded elevators");
    // Undo the skip: the same shaft now serves the floor, so the copy flips back
    // (the shift out of the failing condition, per the regression rule).
    expect(sim.tower.setStop(shaft.id, 2, true)).toBe(true);
    expect(gripeLineText(sim, office, "congestion")).toContain("crowded elevators");
  });

  it("does not let a staff-only service elevator flip the wording to elevators", () => {
    const sim = Simulation.newGame(4);
    const office = bareOffice(sim);
    expectOk(sim.buildTransport("stairs", C, 1, 2));
    sim.star = 2; // service elevators unlock at 2 stars; no ticks run, so no event risk
    expectOk(sim.buildTransport("elevatorService", C + 20, 1, 2));
    const text = gripeLineText(sim, office, "congestion");
    expect(text).toContain("crowded stairs");
    expect(text).not.toContain("crowded elevators");
  });

  it("names escalators, and both kinds together, when they are what serves the floor", () => {
    // Modern: Classic refuses escalators on office floors (canon), and this case
    // is about the copy, not the placement rule.
    const sim = Simulation.newGame(5, "modern");
    const office = bareOffice(sim);
    sim.star = 3; // escalators unlock at 3 stars; no ticks run, so no event risk
    expectOk(sim.buildTransport("escalator", C, 1, 2));
    expect(gripeLineText(sim, office, "congestion")).toContain("crowded escalators");
    expectOk(sim.buildTransport("stairs", C + 20, 1, 2));
    expect(gripeLineText(sim, office, "congestion")).toContain("crowded stairs and escalators");
  });
});
