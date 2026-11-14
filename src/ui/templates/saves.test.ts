import { describe, it, expect, vi } from "vitest";
import type { SlotInfo } from "../../storage/SaveGame";
import { replaceSlotTemplate, savesTemplate, type SavesGuard } from "./saves";
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
  it("offers the kept unreadable autosave as a download only when one is kept", () => {
    const slots: SlotInfo[] = [{ slot: "auto", exists: false, present: true }];
    expect(renderToFragment(savesTemplate(slots)).querySelector('[data-act="unreadable"]')).toBeNull();
    const kept = renderToFragment(savesTemplate(slots, true)).querySelector('[data-act="unreadable"]');
    expect(kept?.textContent).toContain("Download unreadable save");
  });

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

describe("savesTemplate list name", () => {
  it("names the list and carries no caption or description", () => {
    const slots: SlotInfo[] = [
      { slot: "auto", exists: true, present: true, towerName: "A", star: 1, population: 1, funds: 1, savedAt: AT },
      { slot: 1, exists: false, present: false },
    ];
    const frag = renderToFragment(savesTemplate(slots));
    const list = frag.querySelector(".slots")!;
    expect(list.getAttribute("aria-label")).toBe("Saved towers");
    expect(list.hasAttribute("aria-describedby")).toBe(false);
    expect(list.previousElementSibling!.tagName).toBe("H2");
  });
});

describe("savesTemplate population", () => {
  it("leaves the population out while no census has run, rather than reading 'pop 0'", () => {
    const slots: SlotInfo[] = [{ slot: 1, exists: true, present: true, towerName: "One", star: 2, funds: 5000, savedAt: AT }];
    const row = renderToFragment(savesTemplate(slots)).querySelector(".slot")!;
    expect(row.textContent).not.toContain("pop");
    expect(row.textContent).toContain("$5,000");
  });
});

describe("savesTemplate overwrite guard", () => {
  const filled = (slot: number, towerName: string): SlotInfo => ({ slot, exists: true, present: true, towerName, star: 2, funds: 1000, savedAt: AT });
  const guard = (over: Partial<SavesGuard> = {}): SavesGuard => ({ home: null, liveName: "Live", undo: null, ...over });

  it("tags the live tower's own slot and keeps its Save one click", () => {
    const frag = renderToFragment(savesTemplate([filled(1, "Mine"), filled(2, "Other")], false, guard({ home: 1 })));
    const [mine, other] = [...frag.querySelectorAll(".slot")];
    expect(mine.querySelector(".slot-tag")?.textContent).toBe("This tower");
    const save = mine.querySelector('[data-save="1"]')!;
    expect(save.textContent).toBe("Save");
    expect(save.classList.contains("primary")).toBe(true);
    expect(other.querySelector(".slot-tag")).toBeNull();
  });

  it("says Replace… on every other occupied slot, and plain Save on an empty one", () => {
    const frag = renderToFragment(savesTemplate([filled(1, "Mine"), filled(2, "Other"), { slot: 3, exists: false, present: false }], false, guard({ home: 1 })));
    const replace = frag.querySelector('[data-save="2"]')!;
    expect(replace.textContent).toBe("Replace…");
    expect(replace.getAttribute("aria-label")).toBe("Replace the tower in Slot 2");
    expect(frag.querySelector('[data-save="3"]')!.textContent).toBe("Save");
  });

  it("with no home slot known, every occupied slot says Replace… and none is tagged", () => {
    const frag = renderToFragment(savesTemplate([filled(1, "A"), filled(2, "B")]));
    expect([...frag.querySelectorAll("[data-save]")].map((b) => b.textContent)).toEqual(["Replace…", "Replace…"]);
    expect(frag.querySelector(".slot-tag")).toBeNull();
  });

  it("shows the Undo line naming the tower and the slot, only when there is one", () => {
    expect(renderToFragment(savesTemplate([filled(1, "A")], false, guard())).querySelector('[data-act="undo"]')).toBeNull();
    const replaced = renderToFragment(
      savesTemplate([filled(1, "A")], false, guard({ undo: { slot: 1, towerName: "Old <b>One</b>", action: "replaced", run: vi.fn() } })),
    );
    expect(replaced.querySelector(".slot-undo")?.textContent).toContain("Replaced Old <b>One</b> in Slot 1.");
    expect(replaced.querySelector(".slot-undo b")?.children).toHaveLength(0); // the name is text, not markup
    const deleted = renderToFragment(savesTemplate([filled(1, "A")], false, guard({ undo: { slot: 2, towerName: "Gone", action: "deleted", run: vi.fn() } })));
    expect(deleted.querySelector(".slot-undo")?.textContent).toContain("Deleted Gone from Slot 2.");
    expect(deleted.querySelector('[data-act="undo"]')?.getAttribute("aria-label")).toBe("Undo: put Gone back in Slot 2");
  });
});

describe("replaceSlotTemplate", () => {
  const target: SlotInfo = { slot: 2, exists: true, present: true, towerName: "Saved Tower", star: 3, population: 1200, funds: 5000, savedAt: AT, day: 40 };

  it("names both towers: the saved one with its summary, the live one by name", () => {
    const frag = renderToFragment(replaceSlotTemplate(target, "Live Tower", { onCancel: vi.fn(), onReplace: vi.fn() }));
    expect(frag.querySelector("h2")?.textContent).toBe("Replace Slot 2?");
    expect(frag.querySelector(".slot-detail")?.textContent).toContain("Saved Tower");
    expect(frag.querySelector(".slot-detail")?.textContent).toContain("Day 40");
    expect(frag.textContent).toContain("replaces it with Live Tower, the tower you're playing now");
    expect(frag.textContent).not.toContain("same name");
  });

  it("puts Cancel first as the default button and Replace second as the dangerous one", () => {
    const onCancel = vi.fn();
    const onReplace = vi.fn();
    const frag = renderToFragment(replaceSlotTemplate(target, "Live Tower", { onCancel, onReplace }));
    const buttons = [...frag.querySelectorAll(".modal-actions .btn")] as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent)).toEqual(["Cancel", "Replace"]);
    expect(buttons[0].classList.contains("primary")).toBe(true);
    expect(buttons[1].classList.contains("danger")).toBe(true);
    buttons[0].click();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onReplace).not.toHaveBeenCalled();
    buttons[1].click();
    expect(onReplace).toHaveBeenCalledOnce();
  });

  it("warns when the two towers share a name", () => {
    const frag = renderToFragment(replaceSlotTemplate(target, "Saved Tower", { onCancel: vi.fn(), onReplace: vi.fn() }));
    expect(frag.textContent).toContain("They have the same name, so check the date and population.");
  });
});
