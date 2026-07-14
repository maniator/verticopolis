import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { nothing } from "lit-html";
import { statsTemplate, incomeSection } from "./stats";
import { renderToFragment } from "../testing/litTestUtils";

/**
 * The Tower Statistics dialog body (E3-S5). Package: the window grammar
 * (section strips as .win-title.sm, the solvency-styled Funds cell), the
 * VIP row's visibility/color contract, the parking-demand gate, the 4-star
 * rating divergence row, the Express shaft label, the household size mix,
 * the populated Income and multi-shaft Elevator sections, and the
 * auto-escaped tower name. The lit template was proven structurally
 * equivalent to the retired `buildStatsHtml` by transitional
 * `assertDomEquivalent` guards across all of these fixtures (removed with
 * the string builders in the final sweep; see git history for the guard
 * suite).
 */

/** A small built Classic tower with a lobby row, a floor, an occupied office,
 *  and one standard elevator (so the elevator/tenancy sections are non-empty).
 *  One milestone is forced achieved so the Milestones `done` (✓ / `ms-done`)
 *  markup and a non-zero progress-bar width render. */
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

describe("statsTemplate sections across fixture towers", () => {
  it("renders every section as a mini title bar with the solvency-styled Funds cell", () => {
    // The window grammar the design system reads: section strips use the
    // documented .win-title.sm variant and Funds carries the money class.
    const frag = renderToFragment(statsTemplate(builtTower()));
    for (const section of ["Overview", "Tenancy", "Transport & access", "Milestones"]) {
      expect(frag.textContent).toContain(section);
    }
    expect(frag.querySelectorAll(".stats-section.win-title.sm").length).toBeGreaterThanOrEqual(4);
    expect(frag.querySelector(".v.money")).not.toBeNull();
  });

  it("splits the milestones checklist into two kv columns with a gauge", () => {
    const frag = renderToFragment(statsTemplate(builtTower()));
    expect(frag.querySelectorAll(".col.ms.kv").length).toBe(2);
    expect(frag.querySelector(".evalbar")).not.toBeNull();
  });

  it("an empty tower still renders the grid; a Modern tower gains the Households section", () => {
    expect(renderToFragment(statsTemplate(new Simulation())).querySelector(".stats-grid")).not.toBeNull();
    expect(renderToFragment(statsTemplate(Simulation.newGame(3, "classic"))).textContent).not.toContain("Households");
    expect(renderToFragment(statsTemplate(Simulation.newGame(3, "modern"))).textContent).toContain("Households");
  });

  it("a sold Modern household renders the multi-size mix", () => {
    // Scope to the Size mix VALUE cell: the elevator and VIP rows also join
    // with the same separator, so a whole-dialog probe could pass vacuously.
    const frag = renderToFragment(statsTemplate(modernWithHousehold()));
    const key = [...frag.querySelectorAll("span.k")].find((el) => el.textContent === "Size mix")!;
    expect(key).toBeTruthy();
    expect(key.nextElementSibling!.textContent).toMatch(/×.+·.+×/); // two buckets joined
  });

  it("a multi-shaft tower renders EVERY shaft's utilization row; income history renders rows and Net", () => {
    const shafts = manyShafts();
    expect(shafts.elevatorStats().length).toBe(4);
    const frag = renderToFragment(statsTemplate(shafts));
    // All four shafts render a "% full" value cell (the two-column split holds
    // every row, none silently dropped).
    expect([...frag.querySelectorAll("span.v")].filter((v) => /% full$/.test(v.textContent ?? "")).length).toBe(4);
    const income = withIncome();
    expect(income.incomeBreakdown().hasData).toBe(true);
    expect(renderToFragment(statsTemplate(income)).textContent).toContain("Net");
  });

  it("a 4-star tower whose hotel guests diverge the rating count shows the row and explainer", () => {
    const sim = builtTower();
    const r = sim.tower.place("hotelSingle", 2, 22);
    expect(r.ok).toBe(true);
    const room = sim.tower.units.find((u) => u.id === r.unitId)!;
    room.state = "asleep"; // guest in residence tonight
    room.occupants = 1;
    sim.star = 4;
    // Guard the fixture: the divergence must be real or the row never renders.
    expect(sim.ratingPopulation()).toBeLessThan(sim.stats().population);
    const frag = renderToFragment(statsTemplate(sim));
    expect(frag.textContent).toContain("Counts toward stars");
    expect(frag.textContent).toContain("Hotel guests count toward your star rating");
  });

  it("an express shaft reads its Express label in the elevator list", () => {
    const sim = builtTower();
    // Tower-level placement: the star/money gates live in sim.buildTransport
    // and are not what this pins.
    expect(sim.tower.placeTransport("elevatorExpress", 16, 1, 2).ok).toBe(true);
    expect(renderToFragment(statsTemplate(sim)).textContent).toContain("Express");
  });
});

describe("incomeSection (income breakdown)", () => {
  it("Net sums only the shown rows, excluding hidden sub-dollar lines", () => {
    const sim = Simulation.newGame(91);
    // One clearly-shown line and two sub-$0.50/day lines that the row filter
    // hides (a realistic case: a small annual-ish charge amortized over 90 days).
    sim.recordMoney("offices", 1000);
    sim.recordMoney("food", 0.3); // rounds to $0, hidden row
    sim.recordMoney("retail", 0.3); // rounds to $0, hidden row

    const text = renderToFragment(incomeSection(sim) as Exclude<ReturnType<typeof incomeSection>, typeof nothing>).textContent!;

    // The big line shows; the sub-dollar lines are omitted from the list.
    expect(text).toContain("Offices");
    expect(text).not.toContain("Food");
    expect(text).not.toContain("Retail");

    // Net reflects only the shown rows ($1,000), not $1,000.6 rounded to
    // $1,001 (the old code summed every category, hidden lines included).
    //
    // money() formats via toLocaleString, whose thousands separator is
    // locale-dependent (comma, dot, or a nbsp / narrow-nbsp / thin space).
    // Collapse any separator sitting between two digits FIRST, so the
    // discriminating assertion below holds in EVERY locale; otherwise it
    // would only catch the regression under a comma locale.
    const norm = text.replace(/(\d)[,.\u00a0\u202f\u2009 ](\d)/g, "$1$2");
    expect(norm).toContain("Net");
    expect(norm).toContain("$1000/day"); // Offices row and Net both read $1,000
    expect(norm).not.toContain("$1001"); // the old, hidden-lines-included Net
  });

  it("renders nothing before any money has been recorded", () => {
    // `nothing` renders no nodes: the whole section is absent from the dialog,
    // and the section function itself returns the sentinel (not an empty shell).
    const sim = Simulation.newGame(92);
    expect(incomeSection(sim)).toBe(nothing);
    expect(renderToFragment(statsTemplate(sim)).textContent).not.toContain("Income (avg / day");
  });
});
