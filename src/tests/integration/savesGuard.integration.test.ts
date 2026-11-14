// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountAppDom, makeUI } from "../uiFixture";
import type { SlotInfo } from "../../storage/SaveGame";
import type { SavesGuard, UndoResult } from "../../ui/templates/saves";

/**
 * The Saved Towers overwrite guard in the real dialog: a save over another
 * tower asks first with Cancel as the default, the live tower's own slot and
 * an empty slot save at once, and the Undo line runs its step and redraws.
 * The app side (which slot is home, what Undo puts back) is pinned in
 * `game/appModals.test.ts`.
 */

const AT = 1_700_000_000_000;
const slots: SlotInfo[] = [
  { slot: "auto", exists: true, present: true, towerName: "Live", star: 2, funds: 100, savedAt: AT },
  { slot: 1, exists: true, present: true, towerName: "Live", star: 2, funds: 100, savedAt: AT },
  { slot: 2, exists: true, present: true, towerName: "Other Tower", star: 4, funds: 900, savedAt: AT, day: 12 },
  { slot: 3, exists: false, present: false },
];
const guard = (over: Partial<SavesGuard> = {}): SavesGuard => ({ home: 1, liveName: "Live", undo: null, ...over });

const dialog = (): HTMLDialogElement => document.getElementById("modal") as HTMLDialogElement;
const press = (sel: string): void => {
  const el = dialog().querySelector<HTMLElement>(sel);
  expect(el, `expected a "${sel}" element in the open dialog`).not.toBeNull();
  el!.click();
};

beforeEach(() => {
  mountAppDom();
});

describe("Saved Towers overwrite guard", () => {
  it("saves into the live tower's own slot at once", () => {
    const { ui, cb } = makeUI();
    ui.showSaves(slots, null, guard());
    press('[data-save="1"]');
    expect(cb.onSaveSlot).toHaveBeenCalledExactlyOnceWith(1);
    expect(cb.onShowSaves).toHaveBeenCalledOnce();
  });

  it("saves into an empty slot at once", () => {
    const { ui, cb } = makeUI();
    ui.showSaves(slots, null, guard());
    press('[data-save="3"]');
    expect(cb.onSaveSlot).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("asks before saving over another tower, naming both, with Cancel focused", () => {
    const { ui, cb } = makeUI();
    ui.showSaves(slots, null, guard());
    press('[data-save="2"]');
    expect(cb.onSaveSlot).not.toHaveBeenCalled();
    expect(dialog().querySelector("h2")?.textContent).toContain("Replace Slot 2?");
    expect(dialog().textContent).toContain("Other Tower");
    expect(dialog().textContent).toContain("replaces it with Live, the tower you're playing now");
    expect(document.activeElement).toBe(dialog().querySelector('[data-act="no"]'));
  });

  it("Cancel goes back to the list as drawn and writes nothing", () => {
    const { ui, cb } = makeUI();
    ui.showSaves(slots, null, guard());
    press('[data-save="2"]');
    press('[data-act="no"]');
    expect(cb.onSaveSlot).not.toHaveBeenCalled();
    expect(cb.onShowSaves).not.toHaveBeenCalled(); // nothing changed, so no re-read
    expect(dialog().querySelector("h2")?.textContent).toContain("Saved Towers");
    expect(dialog().querySelector('[data-save="2"]')?.textContent).toBe("Replace…");
  });

  it("Esc closes the question and writes nothing", () => {
    const { ui, cb } = makeUI();
    ui.showSaves(slots, null, guard());
    press('[data-save="2"]');
    dialog().dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(dialog().open).toBe(false);
    expect(cb.onSaveSlot).not.toHaveBeenCalled();
  });

  it("Replace saves over the slot and redraws the list", () => {
    const { ui, cb } = makeUI();
    ui.showSaves(slots, null, guard());
    press('[data-save="2"]');
    press('[data-act="yes"]');
    expect(cb.onSaveSlot).toHaveBeenCalledExactlyOnceWith(2);
    expect(cb.onShowSaves).toHaveBeenCalledOnce();
  });

  it("a failed save leaves the dialog as it is, so the failure said inside it stays on screen", () => {
    const { ui, cb } = makeUI({ onSaveSlot: vi.fn(() => false) });
    ui.showSaves(slots, null, guard());
    press('[data-save="2"]');
    press('[data-act="yes"]');
    expect(cb.onSaveSlot).toHaveBeenCalledExactlyOnceWith(2);
    expect(cb.onShowSaves).not.toHaveBeenCalled();
    expect(dialog().open).toBe(true);
  });

  it("the question gives way to a report that arrives while it is up, since closing it loses nothing", () => {
    const { ui } = makeUI();
    ui.showSaves(slots, null, guard());
    press('[data-save="2"]');
    const report = { towerName: "GRAND", star: 3, money: 1, day: 3, floors: 5, basements: 1, unitsImported: 9, broughtOver: [], couldNotBring: [] };
    ui.showImportReport(report, { onOpen: vi.fn() });
    expect(dialog().textContent).toContain("Open tower"); // it opened now, nothing left waiting to be dropped
    expect(dialog().textContent).not.toContain("Replace Slot 2?");
  });

  it("asks for every occupied slot when no home slot is known (the default)", () => {
    const { ui, cb } = makeUI();
    ui.showSaves(slots);
    press('[data-save="1"]');
    expect(cb.onSaveSlot).not.toHaveBeenCalled();
    expect(dialog().querySelector("h2")?.textContent).toContain("Replace Slot 1?");
    expect(dialog().textContent).toContain("Live"); // the saved tower is still named
  });

  it("Undo runs its step and redraws the list", () => {
    const { ui, cb } = makeUI();
    const run = vi.fn((): UndoResult => "back");
    ui.showSaves(slots, null, guard({ undo: { slot: 2, towerName: "Old", action: "replaced", run } }));
    press('[data-act="undo"]');
    expect(run).toHaveBeenCalledOnce();
    expect(cb.onShowSaves).toHaveBeenCalledOnce();
  });

  it("a failed Undo leaves the dialog up, so the failure said inside it stays on screen", () => {
    const { ui, cb } = makeUI();
    ui.showSaves(slots, null, guard({ undo: { slot: 2, towerName: "Old", action: "replaced", run: (): UndoResult => "failed" } }));
    press('[data-act="undo"]');
    expect(cb.onShowSaves).not.toHaveBeenCalled();
    expect(dialog().open).toBe(true);
  });

  it("an Undo whose slot changed since redraws, so the stale line goes away", () => {
    const { ui, cb } = makeUI();
    ui.showSaves(slots, null, guard({ undo: { slot: 2, towerName: "Old", action: "replaced", run: (): UndoResult => "gone" } }));
    press('[data-act="undo"]');
    expect(cb.onShowSaves).toHaveBeenCalledOnce();
  });

  it("refuses a save over a slot written since with a save this version can't read", () => {
    const { ui, cb } = makeUI();
    const replaceTarget = vi.fn((): SlotInfo => ({ slot: 3, exists: false, present: true }));
    ui.showSaves(slots, null, guard({ replaceTarget }));
    press('[data-save="3"]'); // drawn empty
    expect(cb.onSaveSlot).not.toHaveBeenCalled();
    expect(cb.onShowSaves).toHaveBeenCalledOnce();
    expect(dialog().textContent).toContain("Slot 3 holds a save this version can't read");
  });

  it("checks again at Replace, refusing a slot that turned unreadable while the question was up", () => {
    const { ui, cb } = makeUI();
    const readable: SlotInfo = slots[2];
    const replaceTarget = vi.fn((): SlotInfo => readable);
    ui.showSaves(slots, null, guard({ replaceTarget }));
    press('[data-save="2"]');
    replaceTarget.mockReturnValue({ slot: 2, exists: false, present: true }); // another tab wrote it meanwhile
    press('[data-act="yes"]');
    expect(cb.onSaveSlot).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("Slot 2 holds a save this version can't read");
  });

  it("asks from the guard's click-time answer when it has one, whatever the list showed", () => {
    const { ui, cb } = makeUI();
    const fresh: SlotInfo = { slot: 3, exists: true, present: true, towerName: "Written Since", star: 1, funds: 0, savedAt: AT };
    const replaceTarget = vi.fn((slot: number) => (slot === 3 ? fresh : null));
    ui.showSaves(slots, null, guard({ replaceTarget }));
    press('[data-save="3"]'); // drawn empty
    expect(replaceTarget).toHaveBeenCalledExactlyOnceWith(3);
    expect(cb.onSaveSlot).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain("Written Since");
  });
});
