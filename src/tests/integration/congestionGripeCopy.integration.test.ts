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

  it("falls back to transport-neutral wording when nothing serves the floor (defensive)", () => {
    // Unreachable through dominantGripe today (a fired congestion gripe needs a
    // served floor, which needs a stopping passenger transport), but the
    // resolver must stay honest if that serving invariant ever weakens.
    const sim = Simulation.newGame(6);
    const office = bareOffice(sim); // no transports built at all
    expect(gripeLineText(sim, office, "congestion")).toContain("overcrowded vertical transport");
  });

  it("names escalators, and both kinds together, when they are what serves the floor", () => {
    // Modern mode, because Classic refuses escalators on office floors (canon)
    // and this case exercises the copy branch rather than the placement rule.
    const sim = Simulation.newGame(5, "modern");
    const office = bareOffice(sim);
    sim.star = 3; // escalators unlock at 3 stars; no ticks run, so no event risk
    expectOk(sim.buildTransport("escalator", C, 1, 2));
    expect(gripeLineText(sim, office, "congestion")).toContain("crowded escalators");
    expectOk(sim.buildTransport("stairs", C + 20, 1, 2));
    expect(gripeLineText(sim, office, "congestion")).toContain("crowded stairs and escalators");
  });
});

/**
 * #701 follow-up: the copy names the BINDING shaft, the model's own worst
 * serving shaft for the floor, not merely any kind that stops there. A stair
 * link cross-loaded by a stairs-only neighbor floor can bind a floor that a
 * healthy elevator also serves; "add cars" cannot clear that reading, so the
 * copy must name the stairs. Ties (the default for shafts serving identical
 * floor sets, by the capacity-proportional split) keep the elevator wording,
 * so the flip needs a STRICTLY worse walkway and can never ride float noise
 * or build order.
 */
describe("the congestion gripe names the binding shaft (#701)", () => {
  /** Floor 2 served by an elevator (floors 1-2 only) plus a stair chain that
   *  continues to floor 3; floor 3 is stairs-only. With floor 3 populated the
   *  2-3 stair link carries floor 3's whole demand and strictly binds floor 2. */
  function crossLoadedFloor(sim: Simulation, populateUpstairs: boolean): Unit {
    sim.money = 1e9;
    sim.star = 1;
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    lay(sim, "floor", 3);
    expectOk(sim.buildTransport("elevatorStandard", C + 20, 1, 2));
    expectOk(sim.buildTransport("stairs", C, 1, 2));
    expectOk(sim.buildTransport("stairs", C, 2, 3));
    const office = placeUnit(sim, "office", 2, C - 30);
    office.state = "occupied";
    office.satisfaction = 1;
    if (populateUpstairs) {
      for (const x of [C - 30, C - 21, C - 12]) {
        const up = placeUnit(sim, "office", 3, x);
        up.state = "occupied";
      }
    }
    return office;
  }

  it("names the stairs when a cross-loaded stair link binds an elevator-served floor", () => {
    const sim = Simulation.newGame(7);
    const office = crossLoadedFloor(sim, true);
    // The seam the copy depends on: the 2-3 stair link carries floor 3's whole
    // demand, so it reads strictly worse than the elevator at floor 2.
    expect(sim.congestionAt(3)).toBeGreaterThan(sim.congestionAt(2) * 0.999);
    const text = gripeLineText(sim, office, "congestion");
    expect(text).toContain("crowded stairs");
    expect(text).toContain("floors no elevator stops at");
    expect(text).not.toContain("crowded elevators");
    expect(text).not.toContain("Add cars");
  });

  it("keeps the elevator wording on a tie (same topology, upstairs empty)", () => {
    const sim = Simulation.newGame(8);
    const office = crossLoadedFloor(sim, false);
    // Every shaft serving floor 2 carries only floor 2's split, so the ratios
    // tie and the flip must not fire.
    const text = gripeLineText(sim, office, "congestion");
    expect(text).toContain("crowded elevators");
    expect(text).toContain("Add cars or a parallel shaft");
  });

  it("names escalators the same way when they are the cross-loaded binder", () => {
    // Modern, because Classic refuses escalators on office floors (canon).
    const sim = Simulation.newGame(9, "modern");
    sim.money = 1e9;
    sim.star = 3; // escalators unlock at 3 stars; no ticks run, so no event risk
    lay(sim, "lobby", 1);
    lay(sim, "floor", 2);
    lay(sim, "floor", 3);
    expectOk(sim.buildTransport("elevatorStandard", C + 20, 1, 2));
    expectOk(sim.buildTransport("escalator", C, 1, 2));
    expectOk(sim.buildTransport("escalator", C, 2, 3));
    const office = placeUnit(sim, "office", 2, C - 30);
    office.state = "occupied";
    for (const x of [C - 30, C - 21, C - 12]) {
      const up = placeUnit(sim, "office", 3, x);
      up.state = "occupied";
    }
    const text = gripeLineText(sim, office, "congestion");
    expect(text).toContain("crowded escalators");
    expect(text).toContain("floors no elevator stops at");
    expect(text).not.toContain("crowded elevators");
  });
});
