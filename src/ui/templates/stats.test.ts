import { describe, it, expect } from "vitest";
import { nothing } from "lit-html";
import { gateLabel, incomeSection, milestonesSection, nextStarSection, statsModalTemplate, statsTemplate, STAR_GATE_LABELS } from "./stats";
import { catalogFor } from "../../tests/catalogFixture";
import { renderToFragment } from "../testing/litTestUtils";
import type { StarGateId } from "../../simport/panels";
import { LAYOUT } from "../../tests/portKit/mockPort";
import { ledger, milestoneList, statsScreenFor, type ScreenParts } from "../../tests/fixtures/statsScreens";

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
 * suite). The screens are hand-built (`statsScreens.ts`): each test states
 * the report fields its branch reads. What the engine reports (the VIP
 * review, the parking gate, the 4-star rating count, the ledger, the
 * vacancies, the star gates) is the Rust engine's, in its panel tests
 * (`engine-rs/src/panels/tests*.rs`) and `wasm_port_reports_tests.rs`.
 */

const body = (parts: ScreenParts = {}) => renderToFragment(statsTemplate(statsScreenFor(parts)));

/** The value cell after the key `key`. */
const cellAfter = (frag: DocumentFragment, key: string): HTMLElement | null =>
  ([...frag.querySelectorAll("span.k")].find((k) => k.textContent === key)?.nextElementSibling as HTMLElement) ?? null;

/** The VIP row's value cell, so tests can assert the verdict COLOR directly. */
const vipCell = (parts: ScreenParts) => cellAfter(body(parts), "VIP visits");

describe("statsTemplate structure", () => {
  it("renders the stats grid with the Overview section", () => {
    const frag = body();
    expect(frag.querySelector(".stats-grid")).not.toBeNull();
    expect(frag.textContent).toContain("Overview");
    expect(frag.textContent).toContain("Tower name");
  });

  it("shows the VIP visits row from 3★ and reflects the earned review", () => {
    expect(body().textContent).not.toContain("VIP visits");
    let frag = body({ stats: { star: 3 } });
    expect(frag.textContent).toContain("VIP visits");
    expect(frag.textContent).toContain("None yet");
    frag = body({ stats: { star: 3 }, report: { vipVisits: 3, vipFavorable: true } });
    expect(frag.textContent).toContain("3 · review earned");
    // The verdict trusts the flag alone: favorable with no recorded visits
    // (fixtures, tampered saves) still reads earned, never a muted "None yet".
    frag = body({ stats: { star: 3 }, report: { vipVisits: 0, vipFavorable: true } });
    expect(frag.textContent).toContain("Review earned");
    expect(frag.textContent).not.toContain("None yet");
  });

  it("colors the VIP verdict by the earned flag alone: good when earned, muted otherwise", () => {
    // No visits, no review: muted "None yet".
    expect(vipCell({ stats: { star: 3 } })!.getAttribute("style")).toContain("var(--muted)");
    // Visits without the review: still muted, with the not-yet wording.
    const struggling = vipCell({ stats: { star: 3 }, report: { vipVisits: 2 } })!;
    expect(struggling.textContent).toContain("2 · review not yet earned");
    expect(struggling.getAttribute("style")).toContain("var(--muted)");
    // The review alone flips the color, even with zero visits, and the flag
    // alone keeps the row visible below 3★.
    const earned = vipCell({ stats: { star: 1 }, report: { vipVisits: 0, vipFavorable: true } })!;
    expect(earned.textContent).toContain("Review earned");
    expect(earned.getAttribute("style")).toContain("var(--good)");
  });

  it("hides the parking demand row until the engine reports a demand or a space", () => {
    // Below 3★ the engine reports no demand (parking is not buildable yet).
    expect(body().textContent).not.toContain("Parking demand");
    const demand = { officePop: 6, offices: 1, suites: 0, homes: 0, total: 1, coverage: null };
    expect(body({ stats: { star: 3 }, report: { parkingDemand: demand } }).textContent).toContain("Parking demand");
    expect(cellAfter(body({ stats: { parkingSpaces: 2 } }), "Parking spaces")!.textContent).toBe("0 / 2 working");
  });

  it("names the homes in the parking demand only when Modern homes need spaces (#1973)", () => {
    const offices = { officePop: 6, offices: 1, suites: 2, homes: 0, total: 3, coverage: null as number | null };
    const cell = (demand: typeof offices) =>
      cellAfter(body({ stats: { star: 3 }, report: { parkingDemand: demand } }), "Parking demand")!.textContent;
    expect(cell(offices)).toBe("3 needed (1 offices + 2 suites)");
    expect(cell({ ...offices, homes: 4, total: 7 })).toBe("7 needed (1 offices + 2 suites + 4 homes)");
  });

  it("shows how much of the parking need is covered only while it falls short (#1973)", () => {
    const demand = { officePop: 6, offices: 1, suites: 2, homes: 4, total: 7, coverage: null as number | null };
    const cell = (d: typeof demand) =>
      cellAfter(body({ stats: { star: 3 }, report: { parkingDemand: d } }), "Parking demand")!.textContent;
    expect(cell(demand)).toBe("7 needed (1 offices + 2 suites + 4 homes)");
    expect(cell({ ...demand, coverage: 0.6449 })).toBe("7 needed (1 offices + 2 suites + 4 homes) · 64% covered");
  });

  it("escapes a hostile tower name as text, injecting no element", () => {
    const frag = body({ towerName: `<img src=x onerror="alert(1)">` });
    expect(frag.querySelector("img")).toBeNull();
    expect(frag.textContent).toContain(`<img src=x onerror="alert(1)">`);
  });
});

describe("statsTemplate sections", () => {
  it("renders every section as a mini title bar with the solvency-styled Funds cell", () => {
    // The window grammar the design system reads: section strips use the
    // documented .win-title.sm variant and Funds carries the money class.
    const frag = body();
    for (const section of ["Overview", "Tenancy", "Transport & access", "Milestones"]) {
      expect(frag.textContent).toContain(section);
    }
    expect(frag.querySelectorAll(".stats-section.win-title.sm").length).toBeGreaterThanOrEqual(4);
    expect(frag.querySelector(".v.money")).not.toBeNull();
    expect(body({ stats: { money: -5 } }).querySelector(".v.loss"), "debt reads as a loss").not.toBeNull();
  });

  it("splits the milestones checklist into two kv columns; the achieved goal reads done with a filled gauge", () => {
    const frag = body({ report: { milestones: milestoneList(["pop-500"]) } });
    expect(frag.querySelectorAll(".col.ms.kv").length).toBe(2);
    expect(frag.querySelector(".ms-done")).not.toBeNull();
    expect(frag.textContent).toContain("✓");
    const gauge = frag.querySelector<HTMLElement>(".evalbar > span")!;
    expect(gauge.getAttribute("style")).toMatch(/width:\s*[1-9]/); // non-zero progress
  });

  it("an empty tower still renders the grid; a Modern tower gains the Households section", () => {
    const empty = { population: 0, offices: 0, occupiedOffices: 0, floors: 0, elevators: 0, transports: 0 };
    expect(body({ stats: empty, report: { elevators: [] } }).querySelector(".stats-grid")).not.toBeNull();
    expect(body({ mode: "classic" }).textContent).not.toContain("Households");
    expect(body({ mode: "modern" }).textContent).toContain("Households");
  });

  it("the catalog's variantHouseholds rule decides the Households section, whatever the mode's name", () => {
    // Each mode with the rule on and off, so neither mode's name can stand in.
    for (const mode of ["classic", "modern"] as const) {
      const screen = statsScreenFor({ mode });
      for (const variantHouseholds of [true, false]) {
        const catalog = { ...screen.catalog, rules: { ...screen.catalog.rules, variantHouseholds } };
        const text = renderToFragment(statsTemplate({ ...screen, catalog })).textContent;
        if (variantHouseholds) expect(text, `${mode}, variantHouseholds on`).toContain("Households");
        else expect(text, `${mode}, variantHouseholds off`).not.toContain("Households");
      }
    }
  });

  it("a sold Modern household renders the multi-size mix", () => {
    // Scope to the Size mix VALUE cell: the elevator and VIP rows also join
    // with the same separator, so a whole-dialog probe could pass vacuously.
    const households = { households: 2, residents: 6, mix: [[2, 1], [4, 1]] as const };
    const cell = cellAfter(body({ mode: "modern", report: { households } }), "Size mix")!;
    expect(cell).toBeTruthy();
    expect(cell.textContent).toMatch(/×.+·.+×/); // two buckets joined
  });

  it("a multi-shaft tower renders EVERY shaft's utilization row; income history renders rows and Net", () => {
    const shaft = (id: number, bottom: number, top: number) => ({ id, kind: "elevatorStandard" as const, bottom, top, cars: 1, capacity: 21, utilization: 0.1 * id });
    const elevators = [shaft(4, 1, 5), shaft(3, 2, 5), shaft(2, 1, 4), shaft(1, 1, 3)];
    const frag = body({ stats: { elevators: 4, transports: 4 }, report: { elevators } });
    // All four shafts render a "% full" value cell (the two-column split holds
    // every row, none silently dropped).
    expect([...frag.querySelectorAll("span.v")].filter((v) => /% full$/.test(v.textContent ?? "")).length).toBe(4);
    const income = { averages: ledger({ offices: 2_500, upkeep: -400 }), hasData: true };
    expect(body({ report: { income } }).textContent).toContain("Net");
  });

  it("a 4-star tower whose hotel guests diverge the rating count shows the row and explainer", () => {
    const frag = body({ stats: { star: 4, population: 7 }, report: { ratingPopulation: 6 } });
    expect(frag.textContent).toContain("Counts toward stars");
    expect(frag.textContent).toContain("Hotel guests count toward your star rating");
    // At 3★, or with no divergence, the row stays out.
    expect(body({ stats: { star: 3, population: 7 }, report: { ratingPopulation: 6 } }).textContent).not.toContain("Counts toward stars");
    expect(body({ stats: { star: 4, population: 7 }, report: { ratingPopulation: 7 } }).textContent).not.toContain("Counts toward stars");
  });

  it("an express shaft reads its Express label in the elevator list", () => {
    const elevators = [{ id: 2, kind: "elevatorExpress" as const, bottom: 1, top: 2, cars: 1, capacity: 42, utilization: 0 }];
    expect(body({ report: { elevators } }).textContent).toContain("Express");
  });
});

describe("incomeSection (income breakdown)", () => {
  it("Net sums only the shown rows, excluding hidden sub-dollar lines", () => {
    // One clearly-shown line and two sub-$0.50/day lines that the row filter
    // hides (a realistic case: a small annual-ish charge amortized over 90 days).
    const income = { averages: ledger({ offices: 1000, food: 0.3, retail: 0.3 }), hasData: true };
    const text = renderToFragment(incomeSection(income) as Exclude<ReturnType<typeof incomeSection>, typeof nothing>).textContent!;

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
    expect(incomeSection({ averages: ledger({}), hasData: false })).toBe(nothing);
    expect(body().textContent).not.toContain("Income (avg / day");
  });
});

describe("Tenancy vacancies split off-market (No Rate) counts out", () => {
  it("plain vacancies read the bare number; off-market vacancies add the parenthetical", () => {
    const vacancies = (vacant: number, vacantNoRate: number) => cellAfter(body({ stats: { vacant, vacantNoRate } }), "Vacancies")!.textContent;
    expect(vacancies(2, 0)).toBe("2"); // two vacant, none off-market: unchanged
    expect(vacancies(2, 1)).toBe("2 (1 off-market)"); // the honest split
  });
});

describe("the exterminator row is never a dialog footer", () => {
  it("renders nested, so the sticky-footer rule cannot reach it", () => {
    // `.modal-box > .modal-actions:last-child` pins the DIALOG FOOTER. Tower
    // Statistics also renders a `.modal-actions` mid-body for the exterminator,
    // and pinning that would park a button on an opaque band over the sections
    // the player is scrolling through. The CSS guard
    // (src/tests/stickyDialogActions.guard.test.ts) proves the selector keeps
    // its child combinator; this proves the other half, that the exterminator
    // row really is nested. `openModalTemplate` makes the modal template's
    // TOP-LEVEL nodes the children of `.modal-box`, so "not a top-level node"
    // is exactly "not reachable by that selector".
    const housekeeping = { rooms: 1, crews: 0, maids: 0, dailyCapacity: 0, outOfReach: 0, dirty: 0, infested: 1 };
    const screen = statsScreenFor({ mode: "modern", stats: { hotelRooms: 1 }, report: { housekeeping } });
    const frag = renderToFragment(statsModalTemplate(statsTemplate(screen)));
    const footers = [...frag.children].filter((el) => el.classList.contains("modal-actions"));
    expect(footers).toHaveLength(1);
    expect(footers[0].querySelector('[data-act="close"]')).not.toBeNull();
    const exterm = frag.querySelector('[data-act="exterminate"]');
    // Fixture premise: without an offerable extermination there is no row,
    // and this test would pass by rendering nothing.
    expect(exterm).not.toBeNull();
    expect(footers[0].contains(exterm)).toBe(false);
  });
});

describe("star gate copy", () => {
  it("labels every star gate the engine reports, and no other", () => {
    // The engine answers gates by id from its published table; the screen
    // words each one.
    const published = (LAYOUT as unknown as { starGates: string[] }).starGates;
    expect(Object.keys(STAR_GATE_LABELS).sort()).toEqual([...published].sort());
    for (const id of published) expect(gateLabel(id, 100), id).toMatch(/\S/);
  });

  it("names the wedding hall's floor from the tower's top floor (#1987)", () => {
    const req = { star: 6, isTower: false, popHave: 1, popNeed: 2, popMet: false, gates: [{ id: "weddingHall" as StarGateId, met: false }], allMet: false };
    const text = (topFloor: number) => renderToFragment(nextStarSection(req, topFloor) as Exclude<ReturnType<typeof nextStarSection>, typeof nothing>).textContent ?? "";
    const top = catalogFor("modern").world.maxFloor;
    expect(text(top), "the catalog's top floor").toContain(`Wedding Hall (floor ${top})`);
    expect(text(120), "a taller tower's top floor").toContain("Wedding Hall (floor 120)");
  });

  it("shows the hall's floor from the catalog on the stats screen", () => {
    const catalog = catalogFor("modern");
    const taller = { ...catalog, world: { ...catalog.world, maxFloor: catalog.world.maxFloor + 20 } };
    const hallGate = { star: 6, isTower: false, popHave: 1, popNeed: 2, popMet: false, gates: [{ id: "weddingHall" as StarGateId, met: false }], allMet: false };
    const screen = { ...statsScreenFor({ mode: "modern", report: { nextStar: hallGate } }), catalog: taller };
    expect(renderToFragment(statsTemplate(screen)).textContent ?? "").toContain(`Wedding Hall (floor ${catalog.world.maxFloor + 20})`);
  });

  it("shows a gate id the table does not know as the id itself", () => {
    const req = { star: 4, isTower: false, popHave: 1, popNeed: 2, popMet: false, gates: [{ id: "observatory" as StarGateId, met: false }], allMet: false };
    const section = nextStarSection(req, 100);
    expect(section).not.toBe(nothing);
    expect(renderToFragment(section as Exclude<typeof section, typeof nothing>).textContent).toContain("observatory");
  });

  it("shows an id that names an Object prototype member as the id itself", () => {
    const req = { star: 4, isTower: false, popHave: 1, popNeed: 2, popMet: false, gates: [{ id: "constructor" as StarGateId, met: false }], allMet: false };
    const section = nextStarSection(req, 100) as Exclude<ReturnType<typeof nextStarSection>, typeof nothing>;
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
