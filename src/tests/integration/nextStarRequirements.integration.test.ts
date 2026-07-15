import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID, FACILITIES, STAR_THRESHOLDS, TOWER_POPULATION } from "../../engine/facilities";

// Mirrors the harness in milestones.integration.test.ts: fill floors edge to
// edge and stamp occupied offices directly, so population is deterministic
// without running the crowd sim.
const W = GRID.width;
const C = Math.floor(W / 2);

function layFull(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
  // Assert the fixture's own construction (AGENTS.md: "fixtures must assert
  // their own construction"). Rather than check each place().ok (some tiles
  // are legitimately already paved, for example newGame's ground lobby on
  // floor 1), assert the topology claim directly: the whole row ends covered
  // by the intended kind. A silently short build fails here instead of
  // producing misleading downstream assertions.
  for (let x = 0; x < W; x++) {
    expect(sim.tower.unitAt(floor, x)?.kind, `row ${floor} tile ${x} should be ${kind}`).toBe(kind);
  }
}

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

describe("nextStarRequirements (what blocks the next star)", () => {
  it("reports the 2★ population bar on a fresh tower, with no facility gates", () => {
    const sim = Simulation.newGame(1);
    const req = sim.nextStarRequirements()!;
    expect(req.star).toBe(2);
    expect(req.isTower).toBe(false);
    expect(req.popNeed).toBe(STAR_THRESHOLDS[2]);
    expect(req.popMet).toBe(false);
    expect(req.gates).toHaveLength(0);
    expect(req.allMet).toBe(false);
  });

  it("returns null once the tower is a TOWER", () => {
    const sim = Simulation.newGame(1);
    sim.star = 6;
    expect(sim.nextStarRequirements()).toBeNull();
  });

  it("the Security gate at 3★ agrees with evaluateStar (blocked, then promoted)", () => {
    const sim = Simulation.newGame(2);
    sim.money = 1_000_000_000;
    sim.star = 2;
    layFull(sim, "lobby", 1);
    // Enough occupied offices to clear the 3★ population bar; leave the right
    // edge free for the Security office.
    for (let f = 2; f <= 12; f++) {
      layFull(sim, "floor", f);
      fillOffices(sim, f, FACILITIES.security.width);
    }
    expect(sim.tower.totalPopulation()).toBeGreaterThanOrEqual(STAR_THRESHOLDS[3]);

    // Population is met but Security is missing: not ready, and evaluateStar holds at 2.
    let req = sim.nextStarRequirements()!;
    expect(req.star).toBe(3);
    expect(req.popMet).toBe(true);
    expect(req.gates.find((g) => g.label === "Security office")!.met).toBe(false);
    expect(req.allMet).toBe(false);
    sim.evaluateStar();
    expect(sim.star).toBe(2); // promotion refused, matching allMet === false

    // Add an operational Security office: now ready, and evaluateStar promotes.
    const sec = sim.tower.place("security", 2, W - FACILITIES.security.width);
    expect(sec.ok).toBe(true);
    sim.tower.units.find((u) => u.id === sec.unitId)!.state = "occupied";
    req = sim.nextStarRequirements()!;
    expect(req.gates.find((g) => g.label === "Security office")!.met).toBe(true);
    expect(req.allMet).toBe(true);
    sim.evaluateStar();
    expect(sim.star).toBe(3); // promotion granted, matching allMet === true
  });

  it("lists lower-rung gates cumulatively (evaluateStar re-checks them each hour)", () => {
    // evaluateStar re-requires security + the whole 4★ amenity set + metro to
    // promote to 5★, and the star never falls, so the checklist must list the
    // full ladder for the 5★ rung, not just metro. A regression here would let
    // the section read "ready" while promotion is refused (e.g. recycling that
    // outgrew its capacity, or a sold-off security office).
    const sim = Simulation.newGame(1);
    sim.star = 4; // climbing to 5★
    const req = sim.nextStarRequirements()!;
    expect(req.gates.map((g) => g.label)).toEqual([
      "Security office",
      "Medical center",
      "Recycling meets demand",
      "2+ hotel suites",
      "Favorable VIP review",
      "Metro station",
    ]);
    // None of them built on a fresh tower, so not ready (matching evaluateStar,
    // which caps promotion well below 5★ here).
    expect(req.allMet).toBe(false);
  });

  it("lists the TOWER inspection gates and the 15,000 bar at 5★", () => {
    const sim = Simulation.newGame(3);
    sim.star = 5;
    const req = sim.nextStarRequirements()!;
    expect(req.star).toBe(6);
    expect(req.isTower).toBe(true);
    expect(req.popNeed).toBe(TOWER_POPULATION);
    expect(req.gates.map((g) => g.label)).toEqual(["Wedding Hall (floor 100)", "Metro station"]);
    expect(req.allMet).toBe(false); // nothing built yet
  });
});
