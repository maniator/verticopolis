import { describe, it, expect } from "vitest";
import type { SlotInfo } from "../../storage/SaveGame";
import { savesTemplate, type SaveScopeCaption } from "./saves";
import { renderToFragment } from "../testing/litTestUtils";

/**
 * The Saved Towers slot manager. Package: the per-row action gating (auto has no
 * Save/Delete, an empty slot shows Save only, a filled numbered slot shows all
 * three), the rule-set chip, the TOWER/star + pop/funds detail line, the Delete
 * button's per-row aria-label, and the auto-escaped tower name. The
 * Save/Load/Delete dispatch and export/import/close wiring live in the controller
 * and are pinned by the showSaves integration tests.
 */

const AT = 1_700_000_000_000;

describe("savesTemplate row gating and actions", () => {
  it("gives the auto-save row Load only (no Save, no Delete)", () => {
    const slots: SlotInfo[] = [{ slot: "auto", exists: true, present: true, towerName: "Auto Twr", star: 2, population: 300, funds: 50000, savedAt: AT }];
    const row = renderToFragment(savesTemplate(slots)).querySelector(".slot")!;
    expect(row.querySelector("[data-save]")).toBeNull();
    expect(row.querySelector('[data-load="auto"]')).not.toBeNull();
    expect(row.querySelector("[data-del]")).toBeNull();
  });

  it("gives a filled numbered slot Save + Load + Delete, and reads a 6-star as TOWER", () => {
    const slots: SlotInfo[] = [{ slot: 1, exists: true, present: true, towerName: "One", star: 6, population: 15000, funds: 1_000_000, savedAt: AT }];
    const row = renderToFragment(savesTemplate(slots)).querySelector(".slot")!;
    expect(row.querySelector('[data-save="1"]')).not.toBeNull();
    expect(row.querySelector('[data-load="1"]')).not.toBeNull();
    expect(row.querySelector('[data-del="1"]')).not.toBeNull();
    expect(row.textContent).toContain("TOWER");
  });

  it("gives an empty slot Save only and reads 'empty'", () => {
    const slots: SlotInfo[] = [{ slot: 2, exists: false, present: false }];
    const row = renderToFragment(savesTemplate(slots)).querySelector(".slot")!;
    expect(row.querySelector('[data-save="2"]')).not.toBeNull();
    expect(row.querySelector("[data-load]")).toBeNull();
    expect(row.querySelector("[data-del]")).toBeNull();
    expect(row.textContent).toContain("empty");
  });

  it("labels the Delete button per slot for screen readers", () => {
    const slots: SlotInfo[] = [{ slot: 3, exists: true, present: true, towerName: "Three", star: 3, population: 1200, funds: 9000, savedAt: AT }];
    const del = renderToFragment(savesTemplate(slots)).querySelector('[data-del="3"]')!;
    expect(del.getAttribute("aria-label")).toBe("Delete save slot 3");
  });
});

describe("savesTemplate rule-set chip and star badge", () => {
  it("tags a Modern tower with the alt badge, a Classic tower with the plain badge", () => {
    const modern = renderToFragment(savesTemplate([{ slot: 1, exists: true, present: true, towerName: "M", star: 2, population: 300, funds: 1, savedAt: AT, mode: "modern" }]));
    const mChip = modern.querySelector(".nt-badge")!;
    expect(mChip.classList.contains("alt")).toBe(true);
    expect(mChip.textContent).toBe("Modern");

    const classic = renderToFragment(savesTemplate([{ slot: 1, exists: true, present: true, towerName: "C", star: 2, population: 300, funds: 1, savedAt: AT, mode: "classic" }]));
    const cChip = classic.querySelector(".nt-badge")!;
    expect(cChip.classList.contains("alt")).toBe(false);
    expect(cChip.textContent).toBe("Classic");
  });

  it("reads a missing star as 1-star", () => {
    const frag = renderToFragment(savesTemplate([{ slot: 1, exists: true, present: true, towerName: "S", population: 5, funds: 5, savedAt: AT }]));
    expect(frag.querySelector(".slot-detail")!.textContent).toContain("1★");
  });

  it("reads a defined non-tower star with the star glyph (not TOWER)", () => {
    const frag = renderToFragment(savesTemplate([{ slot: 1, exists: true, present: true, towerName: "S", star: 3, population: 5, funds: 5, savedAt: AT }]));
    const detail = frag.querySelector(".slot-detail")!.textContent!;
    expect(detail).toContain("3★");
    expect(detail).not.toContain("TOWER");
  });
});

describe("savesTemplate defaults on absent optional fields", () => {
  it("falls back to 'Tower' when the slot has no name, and reads a missing mode as Classic", () => {
    const frag = renderToFragment(savesTemplate([{ slot: 1, exists: true, present: true, star: 2, population: 1, funds: 1, savedAt: AT }]));
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
    const frag = renderToFragment(savesTemplate([{ slot: 1, exists: true, present: true, towerName: hostile, star: 2, population: 1, funds: 1, savedAt: AT }]));
    expect(frag.querySelector(".slot-detail img")).toBeNull();
    expect(frag.querySelector(".slot-detail")!.textContent).toContain(hostile);
  });
});

describe("savesTemplate protects a present-but-unreadable slot", () => {
  it("labels it, drops Save, and keeps Delete", () => {
    // Not "empty": overwriting would destroy bytes a later build may still
    // recover, which is what preserveUnreadable exists to prevent for the
    // autosave. Delete stays, because clearing a slot you have been TOLD is
    // unreadable is a deliberate choice rather than a silent loss.
    const slots: SlotInfo[] = [{ slot: 1, exists: false, present: true }];
    const row = renderToFragment(savesTemplate(slots)).querySelector(".slot")!;
    expect(row.textContent).toContain("Couldn't be read by this version.");
    expect(row.querySelector(".slot-empty")).toBeNull();
    expect(row.querySelector("[data-save]")).toBeNull();
    expect(row.querySelector("[data-load]")).toBeNull();
    expect(row.querySelector("[data-del]")).not.toBeNull();
  });

  it("still offers Save on a genuinely absent slot", () => {
    const slots: SlotInfo[] = [{ slot: 2, exists: false, present: false }];
    const row = renderToFragment(savesTemplate(slots)).querySelector(".slot")!;
    expect(row.querySelector(".slot-empty")).not.toBeNull();
    expect(row.querySelector("[data-save]")).not.toBeNull();
    expect(row.querySelector("[data-del]")).toBeNull();
  });
});

describe("savesTemplate scope caption (injected, never detected)", () => {
  const SLOTS: SlotInfo[] = [
    { slot: "auto", exists: true, present: true, towerName: "A", star: 1, population: 1, funds: 1, savedAt: AT },
    { slot: 1, exists: false, present: false },
  ];
  // Typed, so renaming a field on the interface fails this file rather than
  // leaving a fixture that silently no longer matches the contract.
  const SCOPE: SaveScopeCaption = {
    text: "Towers on this computer. Anyone who plays here can open them.",
    listLabel: "Towers on this computer",
  };

  it("renders nothing extra when no scope is passed, so web and mobile are unchanged", () => {
    const frag = renderToFragment(savesTemplate(SLOTS));
    expect(frag.querySelector(".slots-scope")).toBeNull();
    // The list still has a name, just not a scope-specific one.
    expect(frag.querySelector(".slots")!.getAttribute("aria-label")).toBe("Saved towers");
  });

  it("renders the caption BEFORE the list, so it is read as context and not as a footnote", () => {
    const frag = renderToFragment(savesTemplate(SLOTS, SCOPE));
    const caption = frag.querySelector(".slots-scope")!;
    expect(caption.textContent).toBe(SCOPE.text);
    // Document order is the whole accessibility claim here: a caption after the
    // rows is one a screen reader reaches only after every tower.
    const list = frag.querySelector(".slots")!;
    expect(caption.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And it sits under the heading rather than above it.
    const h2 = frag.querySelector("h2")!;
    expect(h2.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names the list with the scope label", () => {
    const frag = renderToFragment(savesTemplate(SLOTS, SCOPE));
    expect(frag.querySelector(".slots")!.getAttribute("aria-label")).toBe(SCOPE.listLabel);
  });

  it("carries valid list semantics: role=list with listitem children", () => {
    // A role="list" whose children are not listitems is invalid ARIA, and the
    // failure mode is silent: the semantics are dropped, taking the label and
    // the announced item count with them. So both halves are asserted together.
    const frag = renderToFragment(savesTemplate(SLOTS, SCOPE));
    const list = frag.querySelector(".slots")!;
    expect(list.getAttribute("role")).toBe("list");
    const rows = [...frag.querySelectorAll(".slot")];
    expect(rows.length).toBe(SLOTS.length);
    expect(rows.every((r) => r.getAttribute("role") === "listitem")).toBe(true);
  });

  it("puts no scope marker on a row, and none on the Delete button's name", () => {
    // The caption is a property of the LIST. Repeating it per row would be N
    // identical chips, and adding it to a destructive control's accessible name
    // would bury the one word that matters there.
    const filled: SlotInfo[] = [
      { slot: 1, exists: true, present: true, towerName: "T", star: 1, population: 1, funds: 1, savedAt: AT },
    ];
    const frag = renderToFragment(savesTemplate(filled, SCOPE));
    expect(frag.querySelector(".slot")!.textContent).not.toContain("computer");
    expect(frag.querySelector("[data-del]")!.getAttribute("aria-label")).toBe("Delete save slot 1");
  });
});

describe("savesTemplate scope caption: shell-supplied strings are not trusted to be sane", () => {
  const SLOTS: SlotInfo[] = [{ slot: 1, exists: false, present: false }];

  it("links the caption to the list, so a jump to the list still reaches it", () => {
    // Document order serves a sequential reader. The normal way to reach a list
    // of saves is to jump to it by role, and a jump lands past anything that
    // merely precedes it, so the association is what makes the caption
    // reachable both ways.
    const frag = renderToFragment(savesTemplate(SLOTS, { text: "Where they live.", listLabel: "Here" }));
    const list = frag.querySelector(".slots")!;
    const captionId = list.getAttribute("aria-describedby");
    expect(captionId).toBeTruthy();
    expect(frag.querySelector(`#${captionId}`)!.textContent).toBe("Where they live.");
  });

  it("adds no dangling aria-describedby when there is no caption", () => {
    // Pointing at an id that does not exist is worse than pointing at nothing.
    const list = renderToFragment(savesTemplate(SLOTS)).querySelector(".slots")!;
    expect(list.getAttribute("aria-describedby")).toBeFalsy();
  });

  it("falls back to the generic list name when the shell sends an empty label", () => {
    // `??` would let "" through and leave the list with no accessible name at
    // all, which is worse than the generic one it replaced.
    for (const listLabel of ["", "   "]) {
      const frag = renderToFragment(savesTemplate(SLOTS, { text: "t", listLabel }));
      expect(frag.querySelector(".slots")!.getAttribute("aria-label")).toBe("Saved towers");
    }
  });

  it("renders no caption element when the shell sends empty text", () => {
    // An empty paragraph would still take its margin and would describe the
    // list as "".
    for (const text of ["", "   \n "]) {
      const frag = renderToFragment(savesTemplate(SLOTS, { text, listLabel: "Here" }));
      expect(frag.querySelector(".slots-scope")).toBeNull();
      expect(frag.querySelector(".slots")!.getAttribute("aria-describedby")).toBeFalsy();
      // The label it DID supply is still honored.
      expect(frag.querySelector(".slots")!.getAttribute("aria-label")).toBe("Here");
    }
  });
});
