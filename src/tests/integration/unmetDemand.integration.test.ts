import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import type { FacilityKind } from "../../engine/types";
import { UNMET_DEMAND_CAP, UNMET_DEMAND_FLOOR } from "../../engine/sim/constants";
import { computeDemandMap } from "../../engine/sim/demand";
import { unmetCoverage, dominantGripe } from "../../engine/sim/gripe";

/**
 * Unmet local-demand satisfaction pressure (#395): a served office/condo/hotel
 * whose reachable shops and eateries cannot cover the tower's demand is capped
 * (Classic) or, in Modern, eroded once it can reach none. A tower with no retail
 * at all is the baseline, exempt. Coupled to the demand-pool machinery (#393).
 */

const W = GRID.width;
const MID = Math.floor(W / 2);

/** Place one structure tile, asserting it either lands or is already the
 *  intended kind. A full-width lay (or strip) overlaps the pre-built starting
 *  lobby, so an "already here" collision on a tile that is ALREADY the intended
 *  kind is tolerated; any other failure reason (bounds, missing support) is a
 *  real fixture break and throws, per the AGENTS.md fixture-assertion rule. */
function placeStructure(sim: Simulation, kind: "floor" | "lobby", floor: number, x: number): void {
  const r = sim.tower.place(kind, floor, x);
  if (r.ok) return;
  const existing = sim.tower.unitAt(floor, x);
  expect(existing?.kind, `place(${kind}, ${floor}, ${x}) failed: ${r.reason ?? "unknown"}`).toBe(kind);
}

/** Lay one full-width story, spreading outward from the tower center so every
 *  tile stays connected to the starting lobby. */
function lay(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = MID; x < W; x++) placeStructure(sim, kind, floor, x);
  for (let x = MID - 1; x >= 0; x--) placeStructure(sim, kind, floor, x);
}

function unit(sim: Simulation, id: number | undefined) {
  const u = sim.tower.units.find((x) => x.id === id);
  if (!u) throw new Error(`placement failed (id ${id})`);
  return u;
}

/** Place a room and assert its construction (surfacing `reason` on failure),
 *  then return the live unit, so a fixture-critical placement can never silently
 *  build a different tower (AGENTS.md fixture-assertion rule). */
function placeUnit(sim: Simulation, kind: FacilityKind, floor: number, x: number) {
  const r = sim.tower.place(kind, floor, x);
  expect(r.ok, `place(${kind}, ${floor}, ${x}) failed: ${r.reason ?? "unknown"}`).toBe(true);
  return unit(sim, r.unitId);
}

describe("W-new: unmet local demand (#395)", () => {
  /** A well-shafted tower (many parallel elevators, so no congestion and no W1
   *  far-walk) whose occupied-office demand dwarfs its lone reachable food venue,
   *  so retail coverage sits below the floor. Optionally omit the venue for the
   *  no-retail baseline. Returns the sim, a sample office near a shaft, and the
   *  measured coverage so a test can assert its precondition before ticking. */
  function denseOfficeTower(
    mode: "classic" | "modern",
    withFood: boolean,
    top = 5,
  ): { sim: Simulation; office: ReturnType<typeof unit>; coverage: number | null } {
    const sim = Simulation.newGame(30, mode);
    sim.money = 1e12;
    sim.star = 5;
    lay(sim, "lobby", 1);
    for (let f = 2; f <= top; f++) lay(sim, "floor", f);
    // Parallel shafts every 40 tiles: capacity for the whole floor, and no office
    // is ever more than ~20 tiles from one, so neither congestion nor the W1
    // far-walk penalty can confound the unmet-demand drain under test.
    for (let sx = 10; sx < W - 10; sx += 40) expect(sim.buildTransport("elevatorStandard", sx, 1, top).ok).toBe(true);
    if (withFood) {
      // One fast food (capacity 2000) near the right edge: the only reachable retail.
      expect(sim.tower.place("fastFood", 2, W - 30).ok).toBe(true);
      sim.tower.units.find((u) => u.kind === "fastFood")!.state = "occupied";
    }
    let first: ReturnType<typeof unit> | undefined;
    for (let f = 2; f <= top; f++) {
      for (let x = 14; x + 9 <= W - 40; x += 11) {
        const r = sim.tower.place("office", f, x);
        if (!r.ok) continue;
        const o = unit(sim, r.unitId);
        o.state = "occupied";
        o.satisfaction = 1;
        if (!first) first = o;
      }
    }
    expect(first, "denseOfficeTower placed no offices (placement rules changed?)").toBeDefined();
    const office = first!;
    return { sim, office, coverage: unmetCoverage(computeDemandMap(sim), office) };
  }

  it("caps an office in an under-served tower at the unmet-demand ceiling without evicting it (Classic)", () => {
    const { sim, office, coverage } = denseOfficeTower("classic", true, 3);
    expect(coverage).not.toBeNull();
    expect(coverage!).toBeLessThan(UNMET_DEMAND_FLOOR); // precondition: genuinely under-served
    for (let i = 0; i < 40; i++) sim.tick(60);
    expect(office.satisfaction).toBeLessThanOrEqual(UNMET_DEMAND_CAP + 1e-9);
    expect(office.satisfaction).toBeGreaterThan(0); // capped, not eroded to nothing (Classic never evicts)
    expect(office.state).toBe("occupied");
    // Cap-only unmet demand (Classic caps but never erodes) is still named as the
    // dominant gripe, so the inspector shows an actionable line instead of leaving
    // the office pinned at the ceiling in silence (the cap-only noise case reports
    // the same way).
    expect(dominantGripe(sim, office)).toBe("unmetDemand");
  }, 30000);

  it("leaves a tower with no reachable retail untouched (baseline: no shops is not a problem)", () => {
    // The same dense office tower but with NO food venue: share is 0, so unmet
    // demand is exempt and the well-served offices stay happy.
    const { sim, office, coverage } = denseOfficeTower("modern", false, 3);
    expect(coverage).toBeNull(); // exempt: no retail at all in the tower
    for (let i = 0; i < 20; i++) sim.tick(60);
    expect(office.satisfaction).toBeGreaterThan(0.9);
    expect(office.state).toBe("occupied");
  }, 30000);

  it("names unmet demand as the dominant gripe for a reachable tenant when all retail is on a disconnected island (Modern)", () => {
    // Reachability is uncapped in Modern now, so a tenant is served iff reachable
    // (no "served but too far" state). To get 0 reachable retail coverage for a
    // SERVED tenant, strand the RETAIL instead: the tower has retail, but it sits
    // on a disconnected elevator island the tenant cannot reach. Coverage 0 with
    // retail present ⇒ unmet demand, not an access gripe (the tenant's own floor
    // is reachable) and not "no retail at all".
    const sim = Simulation.newGame(21, "modern");
    sim.money = 1e12;
    sim.star = 5;
    const X0 = MID - 15;
    const X1 = MID + 45;
    const strip = (kind: "floor" | "lobby", f: number) => {
      for (let x = X0; x <= X1; x++) placeStructure(sim, kind, f, x);
    };
    strip("lobby", 1);
    for (let f = 2; f <= 40; f++) strip("floor", f);
    // A ground elevator makes the floor-2 tenants reachable.
    expect(sim.tower.placeTransport("elevatorStandard", MID, 1, 30).ok).toBe(true);
    // A DISCONNECTED retail island: an elevator serving 35..40 only, with no shaft
    // bridging 30..35, so floor 40 never connects to the ground lobby (neither
    // served nor reachable). Modern has no walk budget, so a disconnected island
    // is the only way to make its retail unreachable.
    expect(sim.tower.placeTransport("elevatorStandard", MID + 12, 35, 40).ok).toBe(true);
    // The tenants under test: reachable ground offices (their own floor is fine).
    for (const x of [X0, MID + 18]) placeUnit(sim, "office", 2, x).state = "occupied";
    const tenant = sim.tower.units.find((u) => u.kind === "office" && u.floor === 2)!;
    // The tower's only retail sits on the unreachable island.
    placeUnit(sim, "fastFood", 40, MID + 30).state = "occupied";
    expect(sim.tower.isFloorServed(2)).toBe(true);
    expect(sim.floorReachable(2)).toBe(true); // the tenant is reachable (no access drain)
    expect(sim.floorReachable(40)).toBe(false); // ...but the retail island is not
    expect(unmetCoverage(computeDemandMap(sim), tenant)).toBe(0); // retail exists, tenant reaches none
    // The tenant is served, uncongested, market-rent, near a shaft, un-noisy, and
    // near the ground lobby, so unmet demand is the dominant, attributable gripe.
    const cong = sim.simModel === "v2" ? (sim.spatialCongestionByFloor().get(2) ?? 0) : sim.congestion();
    expect(dominantGripe(sim, tenant, true, cong, false, false, false)).toBe("unmetDemand");
  }, 30000);
});
