import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, type TemplateResult } from "lit-html";
import type { SlotInfo } from "../storage/SaveGame";

const track = vi.hoisted(() => vi.fn());
vi.mock("../analytics", () => ({ trackAppAction: track }));

import { setSlotLabel, slotLabel } from "../storage/slotLabels";
import { RENAME_FAILED, renameSlot } from "./slotRename";
import { SAVES_DRAW } from "./savesDraw";
import { savesTemplate, slotName } from "./templates/saves";
import { renderToFragment } from "./testing/litTestUtils";
import type { UI } from "./UI";

let box: HTMLElement;
let ui: { openModalTemplate: ReturnType<typeof vi.fn>; sayVisibly: ReturnType<typeof vi.fn>; cb: { onShowSaves: ReturnType<typeof vi.fn> } };

beforeEach(() => {
  box = document.createElement("div");
  document.body.append(box);
  ui = {
    openModalTemplate: vi.fn((t: TemplateResult) => {
      render(t, box);
      return box;
    }),
    sayVisibly: vi.fn(),
    cb: { onShowSaves: vi.fn() },
  };
});
afterEach(() => {
  box.remove();
  localStorage.clear();
  track.mockReset();
});

const field = () => box.querySelector<HTMLInputElement>("input")!;
const submit = (name: string) => {
  field().value = name;
  box.querySelector<HTMLFormElement>("form")!.requestSubmit();
};

describe("naming a save slot", () => {
  it("a named slot shows its name in Saved Towers…, and the Auto-save keeps its own", () => {
    setSlotLabel(2, "Office run");
    expect(slotName({ slot: 2, exists: true, present: true })).toBe("Office run");
    expect(slotName({ slot: 1, exists: false, present: false })).toBe("Slot 1");
    expect(slotName({ slot: "auto", exists: true, present: true })).toBe("Auto-save");
    const slots: SlotInfo[] = [
      { slot: "auto", exists: true, present: true, towerName: "A" },
      { slot: 1, exists: false, present: false },
      { slot: 2, exists: true, present: true, towerName: "B" },
    ];
    const frag = renderToFragment(savesTemplate(slots));
    expect(frag.querySelector('[data-rename="auto"]')).toBeNull();
    expect(frag.querySelector('[data-rename="1"]')?.getAttribute("aria-label")).toBe("Rename Slot 1");
    expect(frag.querySelector('[data-rename="2"]')?.getAttribute("aria-label")).toBe("Rename Office run");
    expect([...frag.querySelectorAll(".slot-head b")].map((b) => b.textContent)).toEqual(["Auto-save", "Slot 1", "Office run"]);
  });

  it("Rename… starts from the slot's name, keeps the new one, reports it and goes back to the list", () => {
    setSlotLabel(1, "Old");
    renameSlot(ui as unknown as UI, 1);
    expect(box.querySelector("h2")?.textContent).toBe("Rename Slot 1");
    expect(field().value).toBe("Old");
    expect(document.activeElement).toBe(field());
    submit("  Hotel test ");
    expect(slotLabel(1)).toBe("Hotel test");
    expect(track).toHaveBeenCalledExactlyOnceWith("rename_slot", "named");
    expect(ui.cb.onShowSaves).toHaveBeenCalledWith(SAVES_DRAW.redraw);
  });

  it("an empty name gives the slot its number back, reported as cleared", () => {
    setSlotLabel(3, "Gone soon");
    renameSlot(ui as unknown as UI, 3);
    submit("   ");
    expect(slotLabel(3)).toBeUndefined();
    expect(track).toHaveBeenCalledExactlyOnceWith("rename_slot", "cleared");
  });

  it("Cancel keeps the name and goes back to the list without a report", () => {
    setSlotLabel(2, "Keep");
    renameSlot(ui as unknown as UI, 2);
    field().value = "Changed";
    box.querySelector<HTMLElement>('[data-act="cancel"]')!.click();
    expect(slotLabel(2)).toBe("Keep");
    expect(track).not.toHaveBeenCalled();
    expect(ui.cb.onShowSaves).toHaveBeenCalledWith(SAVES_DRAW.redraw);
  });

  it("a refused write is said in the dialog, which stays up", () => {
    renameSlot(ui as unknown as UI, 1);
    const refuse = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    submit("Nope");
    refuse.mockRestore();
    expect(ui.sayVisibly).toHaveBeenCalledWith(RENAME_FAILED);
    expect(ui.cb.onShowSaves).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });
});
