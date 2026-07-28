import { describe, it, expect } from "vitest";
import { Simulation } from "../Simulation";
import type { GameMode, Unit } from "../types";
import { GRID } from "../facilities";
import { buildSatisfactionContext, satisfactionStep, wouldEvictFreshTenant } from "./satisfactionStep";
import { computeDemandMap } from "./demand";
import { NOISE_CAP, NOISE_EROSION, SERVED_RECOVERY, VACATE_RESCIND, LOBBY_FAR_CAP, UNMET_DEMAND_CAP } from "./constants";
import { rentConfig } from "../econConfig";

/**
 * Unit-level pins for the pure {@link satisfactionStep} and the move-in gate
 * predicate: per-sink math, the cap/erosion clamps, and the predicate's early-exit
 * boundaries, asserted directly on single steps rather than through slow multi-day
 * integration runs (which are canaries, not root-cause isolators). The golden
 * master proves the extraction is behavior-identical to the old inline body; these
 * lock the individual sinks so a branch drift fails at the cheapest tier.
 */

const W = GRID.width;
const C = Math.floor(W / 2);

/** A minimal served tower: full ground lobby, floors 2..top, one central shaft. */
function tinyTower(mode: GameMode, top = 4): Simulation {
  const sim = Simulation.newGame(1, mode);
  sim.money = 1e12;
  sim.star = 1;
  for (let x = 0; x < W; x++) sim.tower.place("lobby", 1, x);
  for (let f = 2; f <= top; f++) for (let x = 0; x < W; x++) sim.tower.place("floor", f, x);
  expect(sim.buildTransport("elevatorStandard", C, 1, Math.min(top, 30)).ok).toBe(true);
  sim.tower.setCars(sim.tower.transports[0].id, 8);
  // Assert the topology every case relies on rather than trusting the loops: a
  // grid/cap/catalog change that dropped a placement would otherwise turn a
  // satisfaction-sink case into a silent access-drain case.
  expect(sim.tower.units.filter((u) => u.kind === "lobby" && u.floor === 1).length).toBe(W);
  expect(sim.tower.units.filter((u) => u.kind === "floor" && u.floor === top).length).toBe(W);
  expect(sim.tower.isFloorServed(2)).toBe(true);
  expect(sim.floorReachable(2)).toBe(true);
  return sim;
}

function place(sim: Simulation, kind: "office" | "condo" | "fastFood", floor: number, x: number): Unit {
  const r = sim.tower.place(kind, floor, x);
  expect(r.ok, `place ${kind} f${floor} x${x}`).toBe(true);
  return sim.tower.units.find((u) => u.id === r.unitId)!;
}

describe("satisfactionStep: per-sink math", () => {
  it("a served, undrained unit recovers by SERVED_RECOVERY, clamped at 1", () => {
    const sim = tinyTower("modern");
    const office = place(sim, "office", 2, C + 12); // quiet, near the shaft, near the lobby
    const ctx = buildSatisfactionContext(sim);
    expect(satisfactionStep(sim, office, 0.5, ctx).next).toBeCloseTo(0.5 + SERVED_RECOVERY, 6);
    expect(satisfactionStep(sim, office, 0.98, ctx).next).toBe(1); // clamp, not 1.03
    const r = satisfactionStep(sim, office, 0.5, ctx);
    expect([r.noisy, r.farWalk, r.lobbyFar]).toEqual([false, false, false]);
  });

  it("Modern noise: caps at NOISE_CAP from full, then net-erodes below it", () => {
    const sim = tinyTower("modern");
    place(sim, "fastFood", 2, C - 20); // commercial noise source within OFFICE_NOISE_TILES
    const office = place(sim, "office", 2, C);
    const ctx = buildSatisfactionContext(sim);
    expect(sim.noiseAfflicted(office)).toBe(true);
    expect(satisfactionStep(sim, office, 1, ctx).noisy).toBe(true);
    expect(satisfactionStep(sim, office, 1, ctx).next).toBeCloseTo(NOISE_CAP, 6); // recovery clamped down to the cap
    // Below the cap: recovery then a full NOISE_EROSION subtraction (Modern scale 1).
    expect(satisfactionStep(sim, office, 0.5, ctx).next).toBeCloseTo(0.5 + SERVED_RECOVERY - NOISE_EROSION, 6);
  });

  it("Classic noise: caps at NOISE_CAP but never erodes (scale 0)", () => {
    const sim = tinyTower("classic");
    place(sim, "fastFood", 2, C - 20);
    const office = place(sim, "office", 2, C);
    const ctx = buildSatisfactionContext(sim);
    expect(sim.noiseAfflicted(office)).toBe(true);
    // Below the cap the erosion term is 0, so it is pure recovery, still ceilinged at the cap.
    expect(satisfactionStep(sim, office, 0.5, ctx).next).toBeCloseTo(0.5 + SERVED_RECOVERY, 6);
    expect(satisfactionStep(sim, office, 1, ctx).next).toBeCloseTo(NOISE_CAP, 6);
  });

  it("over-market office rent erodes proportionally; cheap rent lifts", () => {
    const sim = tinyTower("modern");
    const office = place(sim, "office", 2, C + 12); // quiet: rent is the only pressure
    const cfg = rentConfig("office")!;
    const ctx = buildSatisfactionContext(sim);
    // Recovery to 0.55, then the rent term subtracts over-market * 0.07.
    office.rent = cfg.default * 2; // over = +1 -> -0.07
    expect(satisfactionStep(sim, office, 0.5, ctx).next).toBeCloseTo(0.55 - 0.07, 6);
    office.rent = cfg.default * 0.5; // over = -0.5 -> +0.035 (cheap rent is a perk)
    expect(satisfactionStep(sim, office, 0.5, ctx).next).toBeCloseTo(0.55 + 0.035, 6);
  });
});

describe("satisfactionStep: the remaining drains and caps", () => {
  it("an unserved floor drains hard by 0.15 x churn (no recovery)", () => {
    const sim = tinyTower("modern");
    const condo = place(sim, "condo", 2, C);
    condo.residents = 3;
    // Force the served-floor set empty so the unserved branch runs on a real unit.
    const ctx = { ...buildSatisfactionContext(sim), servedSet: new Set<number>() };
    const churn = sim.rules.churnMultiplier(3);
    const r = satisfactionStep(sim, condo, 0.8, ctx);
    expect(r.served).toBe(false);
    expect(r.next).toBeCloseTo(Math.max(0, 0.8 - 0.15 * churn), 6);
  });

  it("elevator congestion above 1 erodes by 0.04 x min(3, cong-1) x churn", () => {
    const sim = tinyTower("modern");
    const condo = place(sim, "condo", 2, C);
    condo.residents = 3;
    const ctx = { ...buildSatisfactionContext(sim), congMap: null, globalCong: 2 };
    const churn = sim.rules.churnMultiplier(3);
    const r = satisfactionStep(sim, condo, 0.8, ctx);
    expect(r.cong).toBe(2);
    expect(r.next).toBeCloseTo(Math.max(0, 0.8 - 0.04 * Math.min(3, 1) * churn), 6);
  });

  it("the Classic FAR lobby band caps at LOBBY_FAR_CAP with no erosion (stabilizes above the bar)", () => {
    // Classic uses the banded cap; Modern ramps continuously, so pin the band here.
    const sim = tinyTower("classic", 12);
    const condo = place(sim, "condo", 9, C); // 8 floors above the only lobby: the FAR band
    const ctx = buildSatisfactionContext(sim);
    expect(satisfactionStep(sim, condo, 1, ctx).next).toBeCloseTo(LOBBY_FAR_CAP, 6);
    expect(satisfactionStep(sim, condo, LOBBY_FAR_CAP, ctx).next).toBeCloseTo(LOBBY_FAR_CAP, 6); // stable
    expect(LOBBY_FAR_CAP).toBeGreaterThan(VACATE_RESCIND);
  });

  it("unmet retail demand caps at UNMET_DEMAND_CAP and flags the drain", () => {
    const sim = tinyTower("modern");
    place(sim, "fastFood", 2, C - 30); // reachable retail, far enough to add no noise
    const condo = place(sim, "condo", 3, C);
    const ctx = buildSatisfactionContext(sim);
    // Retail exists but this tenant reaches none of it (coverage 0), the deepest
    // shortfall, which caps exactly at UNMET_DEMAND_CAP.
    ctx.demandMap = computeDemandMap(sim);
    ctx.demandMap.reachableVenuesByOrigin.set(condo.id, 0);
    const r = satisfactionStep(sim, condo, 1, ctx);
    expect(r.unmetDemand).toBe(true);
    expect(r.next).toBeCloseTo(UNMET_DEMAND_CAP, 6); // capped by the shortage
  });

  it("a Modern amenity halo offsets neighbor noise so the gate allows the tenant", () => {
    const sim = tinyTower("modern");
    place(sim, "fastFood", 2, C - 20); // a commercial noise source next to the condo
    const condo = place(sim, "condo", 2, C);
    expect(sim.noiseAfflicted(condo)).toBe(true);
    // Noise alone net-erodes the condo, so the gate holds the spot vacant.
    expect(wouldEvictFreshTenant(sim, condo, buildSatisfactionContext(sim, true))).toBe(true);
    // A tenanted fitness club on the same served floor: its per-hour halo bonus
    // (0.03) outweighs the noise erosion, so the spot stabilizes at the noise cap
    // (above the leave bar) and the gate now allows the tenant. This is the
    // offsetting case a purely-additive lift check would miss.
    const club = sim.tower.place("fitnessClub", 2, C + 20);
    expect(club.ok).toBe(true);
    sim.tower.units.find((u) => u.id === club.unitId)!.state = "occupied";
    const ctx = buildSatisfactionContext(sim, true);
    expect(ctx.clubFloors).toContain(2); // the gather picked up the tenanted, served club
    expect(wouldEvictFreshTenant(sim, condo, ctx)).toBe(false);
  });
});

describe("wouldEvictFreshTenant: boundaries", () => {
  it("allows a quiet spot and gates a net-eroding one", () => {
    const modern = tinyTower("modern");
    place(modern, "fastFood", 2, C - 20);
    const noisy = place(modern, "office", 2, C);
    const quiet = place(modern, "office", 2, C + 40);
    const ctx = buildSatisfactionContext(modern, true);
    expect(wouldEvictFreshTenant(modern, quiet, ctx)).toBe(false);
    expect(wouldEvictFreshTenant(modern, noisy, ctx)).toBe(true);
  });

  it("Classic noise caps above the leave bar, so it is not gated", () => {
    const classic = tinyTower("classic");
    place(classic, "fastFood", 2, C - 20);
    const noisy = place(classic, "office", 2, C);
    // NOISE_CAP sits above VACATE_RESCIND, so a capped-but-not-eroding spot stabilizes.
    expect(NOISE_CAP).toBeGreaterThan(VACATE_RESCIND);
    expect(wouldEvictFreshTenant(classic, noisy, buildSatisfactionContext(classic, true))).toBe(false);
  });
});
