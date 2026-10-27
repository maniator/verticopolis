import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { cumulativeStarGates, nextStarRequirements } from "../../engine/sim/star";
import { nothing } from "lit-html";
import { incomeSection, milestonesSection, nextStarSection, statsModalTemplate, canCallExterminator, STAR_GATE_LABELS } from "./stats";
import { statsBodyOf, statsScreenOf } from "./stats.fixture";
import { renderToFragment } from "../testing/litTestUtils";
import type { StarGateId } from "../../simport/panels";

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
async function vipCell(sim: Simulation): Promise<HTMLElement | null> {
  const frag = renderToFragment(await statsBodyOf(sim));
  const key = [...frag.querySelectorAll("span.k")].find((k) => k.textContent === "VIP visits");
  return (key?.nextElementSibling as HTMLElement) ?? null;
}

describe("statsTemplate structure", () => {
  it("renders the stats grid with the Overview section", async () => {
    const frag = renderToFragment(await statsBodyOf(builtTower()));
    expect(frag.querySelector(".stats-grid")).not.toBeNull();
    expect(frag.textContent).toContain("Overview");
    expect(frag.textContent).toContain("Tower name");
  });

  it("shows the VIP visits row from 3★ and reflects the earned review", async () => {
    const sim = builtTower();
    expect(renderToFragment(await statsBodyOf(sim)).textContent).not.toContain("VIP visits");
    sim.star = 3;
    let frag = renderToFragment(await statsBodyOf(sim));
    expect(frag.textContent).toContain("VIP visits");
    expect(frag.textContent).toContain("None yet");
    sim.vipVisits = 3;
    sim.vipFavorable = true;
    frag = renderToFragment(await statsBodyOf(sim));
    expect(frag.textContent).toContain("3 · review earned");
    // The verdict trusts the flag alone: favorable with no recorded visits
    // (fixtures, tampered saves) still reads earned, never a muted "None yet".
    sim.vipVisits = 0;
    frag = renderToFragment(await statsBodyOf(sim));
    expect(frag.textContent).toContain("Review earned");
    expect(frag.textContent).not.toContain("None yet");
  });

  it("colors the VIP verdict by the earned flag alone: good when earned, muted otherwise", async () => {
    const sim = builtTower();
    sim.star = 3;
    // No visits, no review: muted "None yet".
    expect((await vipCell(sim))!.getAttribute("style")).toContain("var(--muted)");
    // Visits without the review: still muted, with the not-yet wording.
    sim.vipVisits = 2;
    const struggling = (await vipCell(sim))!;
    expect(struggling.textContent).toContain("2 · review not yet earned");
    expect(struggling.getAttribute("style")).toContain("var(--muted)");
    // The review alone flips the color, even with zero visits, and the flag
    // alone keeps the row visible below 3★.
    sim.vipFavorable = true;
    sim.vipVisits = 0;
    sim.star = 1;
    const earned = (await vipCell(sim))!;
    expect(earned.textContent).toContain("Review earned");
    expect(earned.getAttribute("style")).toContain("var(--good)");
  });

  it("hides the parking demand row until parking unlocks at 3★", async () => {
    const sim = builtTower(); // occupied office at 1★, no parking buildable yet
    expect(renderToFragment(await statsBodyOf(sim)).textContent).not.toContain("Parking demand");
    sim.star = 3;
    expect(renderToFragment(await statsBodyOf(sim)).textContent).toContain("Parking demand");
  });

  it("escapes a hostile tower name as text, injecting no element", async () => {
    const sim = builtTower();
    sim.tower.towerName = `<img src=x onerror="alert(1)">`;
    const frag = renderToFragment(await statsBodyOf(sim));
    expect(frag.querySelector("img")).toBeNull();
    expect(frag.textContent).toContain(`<img src=x onerror="alert(1)">`);
  });
});

describe("statsTemplate sections across fixture towers", () => {
  it("renders every section as a mini title bar with the solvency-styled Funds cell", async () => {
    // The window grammar the design system reads: section strips use the
    // documented .win-title.sm variant and Funds carries the money class.
    const frag = renderToFragment(await statsBodyOf(builtTower()));
    for (const section of ["Overview", "Tenancy", "Transport & access", "Milestones"]) {
      expect(frag.textContent).toContain(section);
    }
    expect(frag.querySelectorAll(".stats-section.win-title.sm").length).toBeGreaterThanOrEqual(4);
    expect(frag.querySelector(".v.money")).not.toBeNull();
  });

  it("splits the milestones checklist into two kv columns; the achieved goal reads done with a filled gauge", async () => {
    // builtTower forces one achieved milestone, so the done marker and a
    // non-zero gauge width must render (the ms-done markup the retired
    // equivalence guard used to verify).
    const frag = renderToFragment(await statsBodyOf(builtTower()));
    expect(frag.querySelectorAll(".col.ms.kv").length).toBe(2);
    expect(frag.querySelector(".ms-done")).not.toBeNull();
    expect(frag.textContent).toContain("\u2713");
    const gauge = frag.querySelector<HTMLElement>(".evalbar > span")!;
    expect(gauge.getAttribute("style")).toMatch(/width:\s*[1-9]/); // non-zero progress
  });

  it("an empty tower still renders the grid; a Modern tower gains the Households section", async () => {
    expect(renderToFragment(await statsBodyOf(new Simulation())).querySelector(".stats-grid")).not.toBeNull();
    expect(renderToFragment(await statsBodyOf(Simulation.newGame(3, "classic"))).textContent).not.toContain("Households");
    expect(renderToFragment(await statsBodyOf(Simulation.newGame(3, "modern"))).textContent).toContain("Households");
  });

  it("a sold Modern household renders the multi-size mix", async () => {
    // Scope to the Size mix VALUE cell: the elevator and VIP rows also join
    // with the same separator, so a whole-dialog probe could pass vacuously.
    const frag = renderToFragment(await statsBodyOf(modernWithHousehold()));
    const key = [...frag.querySelectorAll("span.k")].find((el) => el.textContent === "Size mix")!;
    expect(key).toBeTruthy();
    expect(key.nextElementSibling!.textContent).toMatch(/×.+·.+×/); // two buckets joined
  });

  it("a multi-shaft tower renders EVERY shaft's utilization row; income history renders rows and Net", async () => {
    const shafts = manyShafts();
    expect(shafts.elevatorStats().length).toBe(4);
    const frag = renderToFragment(await statsBodyOf(shafts));
    // All four shafts render a "% full" value cell (the two-column split holds
    // every row, none silently dropped).
    expect([...frag.querySelectorAll("span.v")].filter((v) => /% full$/.test(v.textContent ?? "")).length).toBe(4);
    const income = withIncome();
    expect(income.incomeBreakdown().hasData).toBe(true);
    expect(renderToFragment(await statsBodyOf(income)).textContent).toContain("Net");
  });

  it("a 4-star tower whose hotel guests diverge the rating count shows the row and explainer", async () => {
    const sim = builtTower();
    const r = sim.tower.place("hotelSingle", 2, 22);
    expect(r.ok).toBe(true);
    const room = sim.tower.units.find((u) => u.id === r.unitId)!;
    room.state = "asleep"; // guest in residence tonight
    room.occupants = 1;
    sim.star = 4;
    // Guard the fixture: the divergence must be real or the row never renders.
    expect(sim.ratingPopulation()).toBeLessThan(sim.stats().population);
    const frag = renderToFragment(await statsBodyOf(sim));
    expect(frag.textContent).toContain("Counts toward stars");
    expect(frag.textContent).toContain("Hotel guests count toward your star rating");
  });

  it("an express shaft reads its Express label in the elevator list", async () => {
    const sim = builtTower();
    // Tower-level placement: the star/money gates live in sim.buildTransport
    // and are not what this pins.
    expect(sim.tower.placeTransport("elevatorExpress", 16, 1, 2).ok).toBe(true);
    expect(renderToFragment(await statsBodyOf(sim)).textContent).toContain("Express");
  });
});

describe("incomeSection (income breakdown)", () => {
  it("Net sums only the shown rows, excluding hidden sub-dollar lines", async () => {
    const sim = Simulation.newGame(91);
    // One clearly-shown line and two sub-$0.50/day lines that the row filter
    // hides (a realistic case: a small annual-ish charge amortized over 90 days).
    sim.recordMoney("offices", 1000);
    sim.recordMoney("food", 0.3); // rounds to $0, hidden row
    sim.recordMoney("retail", 0.3); // rounds to $0, hidden row

    const text = renderToFragment(incomeSection((await statsScreenOf(sim)).report.income) as Exclude<ReturnType<typeof incomeSection>, typeof nothing>).textContent!;

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

  it("renders nothing before any money has been recorded", async () => {
    // `nothing` renders no nodes: the whole section is absent from the dialog,
    // and the section function itself returns the sentinel (not an empty shell).
    const sim = Simulation.newGame(92);
    expect(incomeSection((await statsScreenOf(sim)).report.income)).toBe(nothing);
    expect(renderToFragment(await statsBodyOf(sim)).textContent).not.toContain("Income (avg / day");
  });
});

describe("Tenancy vacancies split off-market (No Rate) counts out", () => {
  it("plain vacancies read the bare number; off-market vacancies add the parenthetical", async () => {
    const sim = builtTower();
    // Widen the strip first so both extra offices place cleanly, then add
    // them: one plain-vacant, one vacant AND off-market. Every placement is
    // asserted successful, so a fixture-width change fails loudly here
    // instead of silently testing a different tower.
    for (let x = 30; x < 45; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let x = 30; x < 45; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
    const a = sim.tower.place("office", 2, 12 + 9);
    expect(a.ok).toBe(true);
    const c = sim.tower.place("office", 2, 30);
    expect(c.ok).toBe(true);
    const vacantRow = async () => {
      const frag = renderToFragment(await statsBodyOf(sim));
      const key = [...frag.querySelectorAll("span.k")].find((k) => k.textContent === "Vacancies");
      return (key?.nextElementSibling as HTMLElement).textContent;
    };
    expect(await vacantRow()).toBe("2"); // two vacant, none off-market: unchanged
    sim.tower.units.find((u) => u.id === c.unitId)!.noRate = true;
    expect(await vacantRow()).toBe("2 (1 off-market)"); // the honest split
  });
});

describe("the exterminator row is never a dialog footer", () => {
  it("renders nested, so the sticky-footer rule cannot reach it", async () => {
    // `.modal-box > .modal-actions:last-child` pins the DIALOG FOOTER. Tower
    // Statistics also renders a `.modal-actions` mid-body for the exterminator,
    // and pinning that would park a button on an opaque band over the sections
    // the player is scrolling through. The CSS guard
    // (src/tests/stickyDialogActions.guard.test.ts) proves the selector keeps
    // its child combinator; this proves the other half, that the exterminator
    // row really is nested. `openModalTemplate` makes the modal template's
    // TOP-LEVEL nodes the children of `.modal-box`, so "not a top-level node"
    // is exactly "not reachable by that selector".
    const sim = Simulation.newGame(3, "modern");
    for (let x = 0; x < GRID.width; x++) sim.tower.place("lobby", 1, x);
    for (let x = 0; x < GRID.width; x++) sim.tower.place("floor", 2, x);
    const r = sim.tower.place("hotelSingle", 2, Math.floor(GRID.width / 2));
    expect(r.ok).toBe(true);
    sim.tower.units.find((u) => u.id === r.unitId)!.state = "infested";
    // Fixture premise: without an offerable extermination there is no row to
    // place, and this test would pass by rendering nothing.
    const screen = await statsScreenOf(sim);
    expect(canCallExterminator(screen.report, screen.catalog)).toBe(true);

    const frag = renderToFragment(statsModalTemplate(await statsBodyOf(sim)));
    const footers = [...frag.children].filter((el) => el.classList.contains("modal-actions"));
    expect(footers).toHaveLength(1);
    expect(footers[0].querySelector('[data-act="close"]')).not.toBeNull();
    const exterm = frag.querySelector('[data-act="exterminate"]');
    expect(exterm).not.toBeNull();
    expect(footers[0].contains(exterm)).toBe(false);
  });
});

describe("star gate copy", () => {
  it("labels each star gate as the engine's own table does", () => {
    // The engine answers gates by id; the screen's copy must stay the label
    // the TypeScript engine attaches, gate for gate, on every rung.
    const sim = Simulation.newGame(3, "modern");
    const gates = [...cumulativeStarGates(sim, 5)];
    sim.star = 5;
    gates.push(...nextStarRequirements(sim)!.gates);
    expect(new Set(gates.map((g) => g.id))).toEqual(new Set(Object.keys(STAR_GATE_LABELS)));
    for (const g of gates) expect(STAR_GATE_LABELS[g.id], g.id).toBe(g.label);
  });

  it("shows a gate id the table does not know as the id itself", () => {
    const req = { star: 4, isTower: false, popHave: 1, popNeed: 2, popMet: false, gates: [{ id: "observatory" as StarGateId, met: false }], allMet: false };
    const section = nextStarSection(req);
    expect(section).not.toBe(nothing);
    expect(renderToFragment(section as Exclude<typeof section, typeof nothing>).textContent).toContain("observatory");
  });

  it("shows an id that names an Object prototype member as the id itself", () => {
    const req = { star: 4, isTower: false, popHave: 1, popNeed: 2, popMet: false, gates: [{ id: "constructor" as StarGateId, met: false }], allMet: false };
    const section = nextStarSection(req) as Exclude<ReturnType<typeof nextStarSection>, typeof nothing>;
    const text = renderToFragment(section).textContent ?? "";
    expect([text.includes("constructor"), text.includes("function")]).toEqual([true, false]);
  });
});

describe("milestone copy", () => {
  it("shows a milestone id the table does not know as the id itself, with no description", () => {
    const fragment = renderToFragment(milestonesSection({ achieved: 1, total: 1, list: [{ id: "moonBase", done: true }] }));
    const [label, desc] = [...fragment.querySelectorAll(".ms .k, .ms .v")].map((el) => el.textContent ?? "");
    expect([label.includes("moonBase"), desc]).toEqual([true, ""]);
  });
});
