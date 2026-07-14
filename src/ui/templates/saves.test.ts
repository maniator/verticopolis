import { describe, it, expect } from "vitest";
import type { SlotInfo } from "../../storage/SaveGame";
import { savesHtml } from "../uiTemplates";
import { savesTemplate } from "./saves";
import { renderToFragment, assertDomEquivalent } from "../testing/litTestUtils";

/**
 * The Saved Towers slot manager. Package: the per-row action gating (auto has no
 * Save/Delete, an empty slot shows Save only, a filled numbered slot shows all
 * three), the rule-set chip, the TOWER/star + pop/funds detail line, the Delete
 * button's per-row aria-label, the auto-escaped tower name, and the transitional
 * `assertDomEquivalent` guard against `savesHtml`. The Save/Load/Delete dispatch
 * and export/import/close wiring live in the controller and are pinned by the
 * showSaves integration tests.
 */

const AT = 1_700_000_000_000;

describe("savesTemplate row gating and actions", () => {
  it("gives the auto-save row Load only (no Save, no Delete)", () => {
    const slots: SlotInfo[] = [{ slot: "auto", exists: true, towerName: "Auto Twr", star: 2, population: 300, funds: 50000, savedAt: AT }];
    const row = renderToFragment(savesTemplate(slots)).querySelector(".slot")!;
    expect(row.querySelector("[data-save]")).toBeNull();
    expect(row.querySelector('[data-load="auto"]')).not.toBeNull();
    expect(row.querySelector("[data-del]")).toBeNull();
  });

  it("gives a filled numbered slot Save + Load + Delete, and reads a 6-star as TOWER", () => {
    const slots: SlotInfo[] = [{ slot: 1, exists: true, towerName: "One", star: 6, population: 15000, funds: 1_000_000, savedAt: AT }];
    const row = renderToFragment(savesTemplate(slots)).querySelector(".slot")!;
    expect(row.querySelector('[data-save="1"]')).not.toBeNull();
    expect(row.querySelector('[data-load="1"]')).not.toBeNull();
    expect(row.querySelector('[data-del="1"]')).not.toBeNull();
    expect(row.textContent).toContain("TOWER");
  });

  it("gives an empty slot Save only and reads 'empty'", () => {
    const slots: SlotInfo[] = [{ slot: 2, exists: false }];
    const row = renderToFragment(savesTemplate(slots)).querySelector(".slot")!;
    expect(row.querySelector('[data-save="2"]')).not.toBeNull();
    expect(row.querySelector("[data-load]")).toBeNull();
    expect(row.querySelector("[data-del]")).toBeNull();
    expect(row.textContent).toContain("empty");
  });

  it("labels the Delete button per slot for screen readers", () => {
    const slots: SlotInfo[] = [{ slot: 3, exists: true, towerName: "Three", star: 3, population: 1200, funds: 9000, savedAt: AT }];
    const del = renderToFragment(savesTemplate(slots)).querySelector('[data-del="3"]')!;
    expect(del.getAttribute("aria-label")).toBe("Delete save slot 3");
  });
});

describe("savesTemplate rule-set chip and star badge", () => {
  it("tags a Modern tower with the alt badge, a Classic tower with the plain badge", () => {
    const modern = renderToFragment(savesTemplate([{ slot: 1, exists: true, towerName: "M", star: 2, population: 300, funds: 1, savedAt: AT, mode: "modern" }]));
    const mChip = modern.querySelector(".nt-badge")!;
    expect(mChip.classList.contains("alt")).toBe(true);
    expect(mChip.textContent).toBe("Modern");

    const classic = renderToFragment(savesTemplate([{ slot: 1, exists: true, towerName: "C", star: 2, population: 300, funds: 1, savedAt: AT, mode: "classic" }]));
    const cChip = classic.querySelector(".nt-badge")!;
    expect(cChip.classList.contains("alt")).toBe(false);
    expect(cChip.textContent).toBe("Classic");
  });

  it("reads a missing star as 1-star", () => {
    const frag = renderToFragment(savesTemplate([{ slot: 1, exists: true, towerName: "S", population: 5, funds: 5, savedAt: AT }]));
    expect(frag.querySelector(".slot-detail")!.textContent).toContain("1★");
  });

  it("reads a defined non-tower star with the star glyph (not TOWER)", () => {
    const frag = renderToFragment(savesTemplate([{ slot: 1, exists: true, towerName: "S", star: 3, population: 5, funds: 5, savedAt: AT }]));
    const detail = frag.querySelector(".slot-detail")!.textContent!;
    expect(detail).toContain("3★");
    expect(detail).not.toContain("TOWER");
  });
});

describe("savesTemplate defaults on absent optional fields", () => {
  it("falls back to 'Tower' when the slot has no name, and reads a missing mode as Classic", () => {
    const frag = renderToFragment(savesTemplate([{ slot: 1, exists: true, star: 2, population: 1, funds: 1, savedAt: AT }]));
    const detail = frag.querySelector(".slot-detail")!;
    expect(detail.textContent).toContain("Tower");
    const chip = detail.querySelector(".nt-badge")!;
    expect(chip.textContent).toBe("Classic");
    expect(chip.classList.contains("alt")).toBe(false);
  });
});

describe("savesTemplate escapes the tower name as text", () => {
  it("renders a hostile tower name as literal text, injecting no element", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const frag = renderToFragment(savesTemplate([{ slot: 1, exists: true, towerName: hostile, star: 2, population: 1, funds: 1, savedAt: AT }]));
    expect(frag.querySelector(".slot-detail img")).toBeNull();
    expect(frag.querySelector(".slot-detail")!.textContent).toContain(hostile);
  });
});

describe("savesTemplate matches the legacy savesHtml structure", () => {
  const mixed: SlotInfo[] = [
    { slot: "auto", exists: true, towerName: "Auto Twr", star: 2, population: 300, funds: 50000, savedAt: AT, mode: "classic", day: 12 },
    { slot: 1, exists: true, towerName: "One & Only", star: 6, population: 15000, funds: 1_000_000, savedAt: AT, mode: "modern", day: 400 },
    { slot: 2, exists: false },
  ];

  it("holds across auto, filled (both modes), and empty rows", () => {
    expect(() => assertDomEquivalent(savesHtml(mixed), savesTemplate(mixed))).not.toThrow();
  });

  it("holds for an empty slot list", () => {
    expect(() => assertDomEquivalent(savesHtml([]), savesTemplate([]))).not.toThrow();
  });
});
