import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { FACILITIES, GRID, TOWER_POPULATION } from "../../engine/facilities";

/**
 * End-to-end "can you actually win?" tests covering the original SimTower
 * progression: star gates (population + required facilities), the VIP
 * inspection, and the final TOWER rating. These exercise the whole loop a
 * player follows to the endgame.
 */
describe("Gameplay parity: rating progression & the TOWER win", () => {
  const W = GRID.width;
  const OW = FACILITIES.office.width;
  const perFloor = Math.floor(W / OW);

  /**
   * Build a tower `topStruct` floors tall, packing offices on floors 2…
   * topStruct-1 and leaving the top floor clear for services / the wedding
   * hall. Returns the sim and that clear top floor.
   */
  function buildTower(officeTop: number, structTop: number): { sim: Simulation; topFloor: number } {
    const sim = Simulation.newGame(1);
    // These are constructed-tower rating/VIP-gate checks with no transport, so
    // they pin the legacy v1 (sampled, global) model. The honest, served, v2
    // organic-progression win is covered in src/tests/integration/phase2.integration.test.ts (Step 5).
    sim.simModel = "v1";
    sim.money = 1_000_000_000;
    // Ground lobby across the lot, extended outward from the starter strip so
    // each new tile stays connected.
    const c = Math.floor(W / 2);
    for (let x = c; x < W; x++) sim.tower.place("lobby", 1, x);
    for (let x = c - 1; x >= 0; x--) sim.tower.place("lobby", 1, x);
    // Floor structure up to structTop; offices fill 2…officeTop, leaving the
    // floors above clear for services / the wedding hall.
    for (let f = 2; f <= structTop; f++) for (let x = 0; x < W; x++) sim.tower.place("floor", f, x);
    for (let f = 2; f <= officeTop; f++) {
      for (let x = 0; x + OW <= W; x += OW) {
        const r = sim.tower.place("office", f, x);
        if (r.ok) {
          const u = sim.tower.units.find((uu) => uu.id === r.unitId)!;
          u.state = "occupied";
          u.everOccupied = true;
        }
      }
    }
    return { sim, topFloor: structTop };
  }

  it("gates stars on population AND the required services", () => {
    const { sim, topFloor } = buildTower(12, 13); // ~1,450 residents
    expect(sim.population).toBeGreaterThanOrEqual(1000);

    sim.evaluateStar();
    expect(sim.star).toBe(2); // blocked at 2★ without a Security office

    expect(sim.tower.place("security", topFloor, 0).ok).toBe(true);
    sim.evaluateStar();
    expect(sim.star).toBe(3); // Security unlocks 3★ at this population
  });

  it("reaches the TOWER rating via population, Wedding Hall, metro and the VIP", () => {
    // Enough office floors for the population, with structure up to floor 100.
    const officeTop = 1 + Math.ceil(TOWER_POPULATION / (perFloor * FACILITIES.office.population));
    const { sim, topFloor } = buildTower(officeTop, GRID.maxFloor);
    expect(sim.population).toBeGreaterThanOrEqual(TOWER_POPULATION);

    // Required services + a deep-basement metro.
    expect(sim.tower.place("security", topFloor, 0).ok).toBe(true);
    expect(sim.tower.place("medical", topFloor, 20).ok).toBe(true);
    for (let fl = 0; fl >= -2; fl--) for (let x = 0; x < W; x++) sim.tower.place("floor", fl, x);
    expect(sim.tower.place("metro", -2, 0).ok).toBe(true); // 3-floor metro (-2/-1/0)

    sim.star = 5;
    // The Wedding Hall crowns floor 100 and summons the VIP inspection.
    const wh = sim.build("weddingHall", GRID.maxFloor, Math.floor(W / 2));
    expect(wh.ok).toBe(true);
    expect(sim.tower.builtWeddingHall).toBe(true);

    // Run several days so the VIP arrives and judges the finished tower.
    for (let day = 0; day < 8 && !sim.evaluatedTower; day++) sim.tick(60 * 24);

    expect(sim.evaluatedTower).toBe(true);
    expect(sim.star).toBe(6); // 6 == TOWER
    expect(sim.log.some((e) => e.text.includes("TOWER"))).toBe(true);
  });
});
