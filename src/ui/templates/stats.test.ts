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
 *  and one standard elevator (so the elevator/tenancy sections are non-empty).
 *  One milestone is forced achieved so the Milestones `done` (✓ / `ms-done`)
 *  markup and a non-zero progress-bar width render (both builders read the same
 *  `milestoneProgress`, so the equivalence guard covers that branch). */
function builtTower(): Simulation {
  const sim = new Simulation();
  for (let x = 10; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let x = 10; x < 30; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
  const r = sim.tower.place("office", 2, 12);
  expect(r.ok).toBe(true);
  sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
  expect(sim.buildTransport("elevatorStandard", 10, 1, 2).ok).toBe(true);
  sim.achievedMilestones.add("pop-500");
  return sim;
}

/** A Modern tower with two present, sold condos carrying DIFFERENT household
 *  sizes (4 and 2), so the Households "Size mix" line joins more than one size
 *  with " · ". Lay a lobby + floor across the grid (tolerating the starter
 *  tower's existing tiles), then place the condos and force them occupied. */
function modernWithHousehold(): Simulation {
  const sim = Simulation.newGame(3, "modern");
  const C = Math.floor(GRID.width / 2);
  for (let x = 0; x < GRID.width; x++) sim.tower.place("lobby", 1, x);
  for (let x = 0; x < GRID.width; x++) sim.tower.place("floor", 2, x);
  const occupy = (col: number, size: number): void => {
    const r = sim.tower.place("condo", 2, col);
    expect(r.ok).toBe(true);
    const condo = sim.tower.units.find((u) => u.id === r.unitId)!;
    condo.state = "occupied";
    condo.everOccupied = true;
    condo.residents = size;
  };
  occupy(C + 4, 4);
  occupy(C + 24, 2);
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

/** The VIP row's value cell (the span after the "VIP visits" key), so tests can
 *  assert the verdict COLOR directly; the builder-vs-builder equivalence guard
 *  alone would pass a wrong color applied identically to both builders. */
function vipCell(sim: Simulation): HTMLElement | null {
  const frag = renderToFragment(statsTemplate(sim));
  const key = [...frag.querySelectorAll("span.k")].find((k) => k.textContent === "VIP visits");
  return (key?.nextElementSibling as HTMLElement) ?? null;
}

describe("statsTemplate structure", () => {
  it("renders the stats grid with the Overview section", () => {
    const frag = renderToFragment(statsTemplate(builtTower()));
    expect(frag.querySelector(".stats-grid")).not.toBeNull();
    expect(frag.textContent).toContain("Overview");
    expect(frag.textContent).toContain("Tower name");
  });

  it("shows the VIP visits row from 3★ and reflects the earned review", () => {
    const sim = builtTower();
    expect(renderToFragment(statsTemplate(sim)).textContent).not.toContain("VIP visits");
    sim.star = 3;
    let frag = renderToFragment(statsTemplate(sim));
    expect(frag.textContent).toContain("VIP visits");
    expect(frag.textContent).toContain("None yet");
    sim.vipVisits = 3;
    sim.vipFavorable = true;
    frag = renderToFragment(statsTemplate(sim));
    expect(frag.textContent).toContain("3 · review earned");
    // The verdict trusts the flag alone: favorable with no recorded visits
    // (fixtures, tampered saves) still reads earned, never a muted "None yet".
    sim.vipVisits = 0;
    frag = renderToFragment(statsTemplate(sim));
    expect(frag.textContent).toContain("Review earned");
    expect(frag.textContent).not.toContain("None yet");
  });

  it("colors the VIP verdict by the earned flag alone: good when earned, muted otherwise", () => {
    const sim = builtTower();
    sim.star = 3;
    // No visits, no review: muted "None yet".
    expect(vipCell(sim)!.getAttribute("style")).toContain("var(--muted)");
    // Visits without the review: still muted, with the not-yet wording.
    sim.vipVisits = 2;
    const struggling = vipCell(sim)!;
    expect(struggling.textContent).toContain("2 · review not yet earned");
    expect(struggling.getAttribute("style")).toContain("var(--muted)");
    // The review alone flips the color, even with zero visits, and the flag
    // alone keeps the row visible below 3★.
    sim.vipFavorable = true;
    sim.vipVisits = 0;
    sim.star = 1;
    const earned = vipCell(sim)!;
    expect(earned.textContent).toContain("Review earned");
    expect(earned.getAttribute("style")).toContain("var(--good)");
  });

  it("hides the parking demand row until parking unlocks at 3★", () => {
    const sim = builtTower(); // occupied office at 1★, no parking buildable yet
    expect(renderToFragment(statsTemplate(sim)).textContent).not.toContain("Parking demand");
    sim.star = 3;
    expect(renderToFragment(statsTemplate(sim)).textContent).toContain("Parking demand");
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

  it("holds for a 3★ tower with no VIP visit yet (VIP row empty state)", () => {
    const sim = builtTower();
    sim.star = 3;
    expect(() => assertDomEquivalent(buildStatsHtml(sim), statsTemplate(sim))).not.toThrow();
  });

  it("holds for a tower with VIP visits and the earned review (VIP row populated)", () => {
    const sim = builtTower();
    sim.star = 3;
    sim.vipVisits = 2;
    sim.vipFavorable = true;
    expect(() => assertDomEquivalent(buildStatsHtml(sim), statsTemplate(sim))).not.toThrow();
  });

  it("holds for a tower with visits but no review yet (the struggling 3★ state)", () => {
    const sim = builtTower();
    sim.star = 3;
    sim.vipVisits = 2;
    expect(() => assertDomEquivalent(buildStatsHtml(sim), statsTemplate(sim))).not.toThrow();
  });

  it("holds for a favorable review with no recorded visits (fixture/tampered state)", () => {
    const sim = builtTower();
    sim.star = 3;
    sim.vipFavorable = true;
    expect(() => assertDomEquivalent(buildStatsHtml(sim), statsTemplate(sim))).not.toThrow();
  });
});
