import { describe, it, expect } from "vitest";
import type { ImportReport } from "../../storage/tdtImport";
import type { ExportReport } from "../../storage/tdtExport";
import { exportConfirmTemplate, importReportTemplate, exportReportTemplate } from "./reports";
import { renderToFragment } from "../testing/litTestUtils";

/**
 * The TDT import/export report dialogs and the export-choice modal. Package: the
 * Modern-gated legacy button (disabled + title), the fact line (stars/TOWER,
 * negative funds, floor pluralization, basements suffix, rooms), the
 * brought-over/couldn't-bring (and export twin) lists as nested list items, and
 * the auto-escaped report strings and filename. The isModalOpen clobber guard,
 * the #a11y-live announcement, and the action wiring live in the controllers and
 * are pinned by the showImportReport / showExportReport / confirmExport
 * integration tests.
 */

const importReport = (over: Partial<ImportReport> = {}): ImportReport => ({
  towerName: "Old Tower",
  star: 3,
  money: 125000,
  day: 40,
  floors: 42,
  basements: 2,
  unitsImported: 310,
  broughtOver: ["Offices and their tenants", "Elevators"],
  couldNotBring: ["The cinema's booked film"],
  ...over,
});

const exportReport = (over: Partial<ExportReport> = {}): ExportReport => ({
  towerName: "New Tower",
  filename: "NEWTOWER.TDT",
  star: 6,
  money: 900000,
  floors: 80,
  basements: 3,
  roomsExported: 1200,
  comesAlong: ["The floor plan", "Rooms and their prices"],
  staysBehind: ["Modern households"],
  ...over,
});

describe("exportConfirmTemplate: the .TDT gate", () => {
  it("enables the legacy button with no title for a Classic tower", () => {
    const frag = renderToFragment(exportConfirmTemplate(false));
    const legacy = frag.querySelector<HTMLButtonElement>('[data-act="legacy"]')!;
    expect(legacy.disabled).toBe(false);
    expect(legacy.hasAttribute("title")).toBe(false);
    // The primary Export carries autofocus.
    expect(frag.querySelector('[data-act="export"]')!.hasAttribute("autofocus")).toBe(true);
  });

  it("disables the legacy button with an explaining title for a Modern tower", () => {
    const frag = renderToFragment(exportConfirmTemplate(true));
    const legacy = frag.querySelector<HTMLButtonElement>('[data-act="legacy"]')!;
    expect(legacy.disabled).toBe(true);
    expect(legacy.getAttribute("title")).toBe("Classic towers only");
  });

});

describe("importReportTemplate: the fact line and lists", () => {
  it("renders the fact line, the brought-over and couldn't-bring lists", () => {
    const frag = renderToFragment(importReportTemplate(importReport()));
    const facts = frag.querySelector(".import-facts")!.textContent!;
    expect(facts).toContain("Old Tower");
    expect(facts).toContain("3★");
    expect(facts).toContain("$125,000");
    expect(facts).toContain("42 floors");
    expect(facts).toContain("/ B2");
    expect(facts).toContain("310 rooms");
    const lists = frag.querySelectorAll("ul.import-list");
    expect(lists).toHaveLength(2);
    expect(lists[0].querySelectorAll("li")).toHaveLength(2);
    expect(lists[1].querySelectorAll("li")).toHaveLength(1);
  });

  it("reads a 6-star import as TOWER, and shows negative funds with a leading minus", () => {
    const frag = renderToFragment(importReportTemplate(importReport({ star: 6, money: -4200 })));
    const facts = frag.querySelector(".import-facts")!.textContent!;
    expect(facts).toContain("TOWER");
    expect(facts).toContain("-$4,200");
  });

  it("singularizes one floor and omits the basement suffix when there are none", () => {
    const frag = renderToFragment(importReportTemplate(importReport({ floors: 1, basements: 0 })));
    const facts = frag.querySelector(".import-facts")!.textContent!;
    expect(facts).toContain("1 floor");
    expect(facts).not.toContain("floors");
    expect(facts).not.toContain("/ B");
  });

  it("escapes a hostile tower name and hostile list rows as text", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const frag = renderToFragment(importReportTemplate(importReport({ towerName: hostile, broughtOver: [hostile] })));
    expect(frag.querySelector(".import-facts img")).toBeNull();
    expect(frag.querySelector("ul.import-list img")).toBeNull();
    expect(frag.querySelector(".import-facts")!.textContent).toContain(hostile);
  });

  it("rounds fractional funds to the nearest dollar (import money is display dollars)", () => {
    const frag = renderToFragment(importReportTemplate(importReport({ money: 100.6 })));
    expect(frag.querySelector(".import-facts")!.textContent).toContain("$101");
  });

});

describe("exportReportTemplate: the reverse fidelity report", () => {
  it("renders the fact line, the comes-along and stays-behind lists, and the filename", () => {
    const frag = renderToFragment(exportReportTemplate(exportReport()));
    const facts = frag.querySelector(".import-facts")!.textContent!;
    expect(facts).toContain("New Tower");
    expect(facts).toContain("TOWER");
    expect(facts).toContain("1,200 rooms");
    const lists = frag.querySelectorAll("ul.import-list");
    expect(lists).toHaveLength(2);
    expect(lists[0].querySelectorAll("li")).toHaveLength(2);
    expect(lists[1].querySelectorAll("li")).toHaveLength(1);
    expect(frag.textContent).toContain("NEWTOWER.TDT");
  });

  it("does NOT round funds (export money is already stored rounded to $100)", () => {
    // The reverse-fidelity report shows the value the 1994 file will hold as-is;
    // rounding it here would misreport it. This pins the deliberate asymmetry
    // with the import report, which rounds display dollars.
    const frag = renderToFragment(exportReportTemplate(exportReport({ money: 100.6 })));
    expect(frag.querySelector(".import-facts")!.textContent).toContain("$100.6");
  });

  it("singularizes one floor and omits the basement suffix when there are none", () => {
    const frag = renderToFragment(exportReportTemplate(exportReport({ floors: 1, basements: 0 })));
    const facts = frag.querySelector(".import-facts")!.textContent!;
    expect(facts).toContain("1 floor");
    expect(facts).not.toContain("floors");
    expect(facts).not.toContain("/ B");
  });

  it("escapes a hostile filename as text", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const frag = renderToFragment(exportReportTemplate(exportReport({ filename: hostile })));
    expect(frag.querySelectorAll("img")).toHaveLength(0);
    expect(frag.textContent).toContain(hostile);
  });

});
