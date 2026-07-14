import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { buildStatsHtml } from "../statsHtml";
import { statsTemplate } from "./stats";
import { renderToFragment, assertDomEquivalent } from "../testing/litTestUtils";

/**
 * The Tower Statistics dialog body (E3-S5, the worst string-composition case).
 * Package: the transitional `assertDomEquivalent` guard against `buildStatsHtml`
 * across an empty tower, a built Classic tower with an elevator, a fresh Modern
 * tower (household empty-state), a Modern tower with a sold household (populated
 * size mix), plus the auto-escaped tower name. Because both `buildStatsHtml` and
 * `statsTemplate` are pure functions of the sim, the guard proves the lit body is
 * byte-for-byte equivalent to the string builder the rest of the stats tests
 * already pin.
 */

/** A small built Classic tower with a lobby row, a floor, an occupied office,
 *  and one standard elevator (so the elevator/tenancy sections are non-empty). */
function builtTower(): Simulation {
  const sim = new Simulation();
  for (let x = 10; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let x = 10; x < 30; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
  const r = sim.tower.place("office", 2, 12);
  expect(r.ok).toBe(true);
  sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
  expect(sim.buildTransport("elevatorStandard", 10, 1, 2).ok).toBe(true);
  return sim;
}

/** A Modern tower with one present, sold condo carrying a 4-person household, so
 *  the Households section renders its populated size mix. Lay a lobby + floor
 *  across the grid (tolerating the starter tower's existing tiles), then place a
 *  condo near center and force it occupied with a household. */
function modernWithHousehold(): Simulation {
  const sim = Simulation.newGame(3, "modern");
  const C = Math.floor(GRID.width / 2);
  for (let x = 0; x < GRID.width; x++) sim.tower.place("lobby", 1, x);
  for (let x = 0; x < GRID.width; x++) sim.tower.place("floor", 2, x);
  const r = sim.tower.place("condo", 2, C + 4);
  expect(r.ok).toBe(true);
  const condo = sim.tower.units.find((u) => u.id === r.unitId)!;
  condo.state = "occupied";
  condo.everOccupied = true;
  condo.residents = 4;
  return sim;
}

/** Four passenger shafts, so the elevator section's two-column split renders
 *  with more than one row per column (the built tower has only one shaft, which
 *  leaves the second column empty). */
function manyShafts(): Simulation {
  const sim = new Simulation();
  for (let x = 0; x < GRID.width; x++) sim.tower.place("lobby", 1, x);
  for (let f = 2; f <= 5; f++) for (let x = 0; x < GRID.width; x++) sim.tower.place("floor", f, x);
  expect(sim.buildTransport("elevatorStandard", 10, 1, 3).ok).toBe(true);
  expect(sim.buildTransport("elevatorStandard", 14, 1, 4).ok).toBe(true);
  expect(sim.buildTransport("elevatorStandard", 18, 2, 5).ok).toBe(true);
  expect(sim.buildTransport("elevatorStandard", 22, 1, 5).ok).toBe(true);
  return sim;
}

/** A built tower ticked until the income ledger has a trailing-quarter average,
 *  so the Income section renders its rows, its two columns, and the Net line. */
function withIncome(): Simulation {
  const sim = builtTower();
  sim.money = 1e9; // never go bankrupt mid-run
  for (let i = 0; i < 24 * 120 && !sim.incomeBreakdown().hasData; i++) sim.tick(60);
  return sim;
}

describe("statsTemplate structure", () => {
  it("renders the stats grid with the Overview section", () => {
    const frag = renderToFragment(statsTemplate(builtTower()));
    expect(frag.querySelector(".stats-grid")).not.toBeNull();
    expect(frag.textContent).toContain("Overview");
    expect(frag.textContent).toContain("Tower name");
  });

  it("escapes a hostile tower name as text, injecting no element", () => {
    const sim = builtTower();
    sim.tower.towerName = `<img src=x onerror="alert(1)">`;
    const frag = renderToFragment(statsTemplate(sim));
    expect(frag.querySelector("img")).toBeNull();
    expect(frag.textContent).toContain(`<img src=x onerror="alert(1)">`);
  });
});

describe("statsTemplate matches the legacy buildStatsHtml structure", () => {
  it("holds for an empty tower (most sections collapse to nothing)", () => {
    const sim = new Simulation();
    expect(() => assertDomEquivalent(buildStatsHtml(sim), statsTemplate(sim))).not.toThrow();
  });

  it("holds for a built Classic tower with an elevator and an occupied office", () => {
    const sim = builtTower();
    expect(() => assertDomEquivalent(buildStatsHtml(sim), statsTemplate(sim))).not.toThrow();
  });

  it("holds for a fresh Modern tower (Households empty-state placeholder)", () => {
    const sim = Simulation.newGame(3, "modern");
    expect(() => assertDomEquivalent(buildStatsHtml(sim), statsTemplate(sim))).not.toThrow();
  });

  it("holds for a Modern tower with a sold household (populated size mix)", () => {
    const sim = modernWithHousehold();
    expect(() => assertDomEquivalent(buildStatsHtml(sim), statsTemplate(sim))).not.toThrow();
  });

  it("holds for a fresh Classic tower (no Households section)", () => {
    const sim = Simulation.newGame(3, "classic");
    expect(() => assertDomEquivalent(buildStatsHtml(sim), statsTemplate(sim))).not.toThrow();
  });

  it("holds for a multi-shaft tower (Elevators two-column split, both columns filled)", () => {
    const sim = manyShafts();
    // Guard the fixture: enough shafts to fill both columns of the split.
    expect(sim.elevatorStats().length).toBeGreaterThan(2);
    expect(() => assertDomEquivalent(buildStatsHtml(sim), statsTemplate(sim))).not.toThrow();
  });

  it("holds for a tower with income history (Income rows, two columns, and Net)", () => {
    const sim = withIncome();
    // Guard the fixture: the Income section only renders once there's data.
    expect(sim.incomeBreakdown().hasData).toBe(true);
    expect(() => assertDomEquivalent(buildStatsHtml(sim), statsTemplate(sim))).not.toThrow();
  });
});
