import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { TOWER_POPULATION } from "../../engine/facilities";
import { buildWinningTower, runVipInspection, buildWeddingHall } from "../fixtures/winningTower";

/**
 * End-to-end "can a player finish the game?" guarantee. A real, fully-served,
 * fully-occupied tower is built through the public API, then the REAL win logic
 * (evaluateStar + the VIP inspection via checkVip) is run to the TOWER win — and
 * each rung's gate is shown to BLOCK the win when its facility is missing. The
 * rating is driven directly rather than by ticking the crowd sim through in-game
 * years (see the fixture for why: congestion would churn a 17k tower under 15k).
 */
describe("full playthrough → TOWER win", () => {
  const won = (sim: Simulation) => sim.log.some((l) => /you win/i.test(l.text));

  it("the lot genuinely holds ≥15,000 rating occupants (balance guarantee)", () => {
    const sim = new Simulation(1);
    buildWinningTower(sim);
    sim.evaluateStar(); // ≥4★ so ratingPopulation switches to the occupant census
    expect(sim.ratingPopulation()).toBeGreaterThanOrEqual(TOWER_POPULATION);
  });

  it("climbs to 5★, then the Wedding Hall + VIP inspection wins the TOWER", () => {
    const sim = new Simulation(1);
    buildWinningTower(sim);

    sim.evaluateStar();
    expect(sim.star).toBe(5); // all rungs satisfied → jumps straight to 5★

    expect(buildWeddingHall(sim).ok).toBe(true);
    expect(sim.vipVisits).toBe(0); // fixture grants the review directly, no counted stay
    runVipInspection(sim);

    expect(sim.star).toBe(6);
    expect(won(sim)).toBe(true);
    expect(sim.vipVisits).toBe(1); // the winning TOWER inspection is a counted visit
  });

  it("caps at 2★ without Security (3★ gate)", () => {
    const sim = new Simulation(1);
    buildWinningTower(sim, { omit: ["security"] });
    sim.evaluateStar();
    expect(sim.star).toBe(2);
  });

  it("caps at 3★ without the 4★ amenity set (Recycling missing)", () => {
    const sim = new Simulation(1);
    buildWinningTower(sim, { omit: ["recycling"] });
    sim.evaluateStar();
    expect(sim.star).toBe(3);
  });

  it("caps at 4★ without a Metro (5★ gate) and cannot even build the Wedding Hall", () => {
    const sim = new Simulation(1);
    buildWinningTower(sim, { omit: ["metro"] });
    sim.evaluateStar();
    expect(sim.star).toBe(4);
    expect(buildWeddingHall(sim).ok).toBe(false); // locked below 5★
  });

  it("never reaches TOWER without a Wedding Hall (no VIP is scheduled)", () => {
    const sim = new Simulation(1);
    buildWinningTower(sim);
    sim.evaluateStar();
    expect(sim.star).toBe(5);
    runVipInspection(sim);
    expect(sim.star).toBe(5);
    expect(won(sim)).toBe(false);
  });

  it("the VIP is unimpressed below 15,000 occupants (stays 5★, no win)", () => {
    const sim = new Simulation(1);
    buildWinningTower(sim, { officeTop: 55 }); // ≥10k for 5★, but under 15k
    sim.evaluateStar();
    expect(sim.star).toBe(5);
    expect(sim.ratingPopulation()).toBeLessThan(TOWER_POPULATION);
    expect(sim.ratingPopulation()).toBeGreaterThanOrEqual(10_000);

    expect(buildWeddingHall(sim).ok).toBe(true);
    runVipInspection(sim);
    expect(sim.star).toBe(5);
    expect(won(sim)).toBe(false);
    expect(sim.vipVisits).toBe(1); // an unimpressed inspection still counts as a visit
  });

  it("selling the Metro after 5★ blocks the TOWER (the re-check)", () => {
    const sim = new Simulation(1);
    buildWinningTower(sim);
    sim.evaluateStar();
    expect(sim.star).toBe(5);
    expect(buildWeddingHall(sim).ok).toBe(true);

    const metro = sim.tower.units.find((u) => u.kind === "metro")!;
    sim.tower.removeUnit(metro.id);

    runVipInspection(sim);
    expect(sim.star).toBeLessThan(6); // win must refuse without an operational metro
    expect(won(sim)).toBe(false);
  });
});
