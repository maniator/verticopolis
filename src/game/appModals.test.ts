import { describe, it, expect, vi, beforeEach } from "vitest";
import { showSaves, saveToSlot, loadFromSlot, deleteSlot, showTowerPicker, loadFromSplash, undoSlot } from "./appModals";
import { __resetSlotGuardForTest, forgetLiveTower, homeSlot, pendingUndo, rememberHome } from "../storage/slotGuard";
import type { SavesGuard } from "../ui/templates/saves";
import { SaveGame } from "../storage/SaveGame";
import { makeApp, makeSim } from "./appModals.fixture";
import { trackAppAction, trackAppActionOnce } from "../analytics";
import { NEWER_SAVE_REFUSAL } from "./portLifecycle";

/**
 * These pin the save-slot commands against the hand-built fake `GameApp`
 * (`appModals.fixture.ts`). `SaveGame` is fully mocked (no localStorage, no
 * compression). The stats screen and the exterminator are in
 * `appModalsStats.test.ts`.
 */

vi.mock("../analytics", async (importActual) => {
  const actual = await importActual<typeof import("../analytics")>();
  return { ...actual, trackAppAction: vi.fn(), trackAppActionOnce: vi.fn() };
});

vi.mock("../storage/SaveGame", async (importActual) => {
  // Spread the real module so isStorageWriteError/saveFailureMessage stay
  // REAL: the quota tests below exercise the actual failure classification
  // and copy, not stubs of them. Only the SaveGame writer object is mocked.
  const actual = await importActual<typeof import("../storage/SaveGame")>();
  return {
    ...actual,
    SaveGame: {
      listSlots: vi.fn(() => [{ slot: "auto", exists: false }]),
      unreadableBackup: vi.fn(() => "VCTOWER1\nkept"),
      saveSlot: vi.fn(),
      load: vi.fn(),
      loadSlot: vi.fn(),
      deleteSlot: vi.fn(),
      slotRaw: vi.fn(),
      restoreSlotRaw: vi.fn(),
    },
  };
});

/** The manual slots' stored values, behind the mocked SaveGame's raw reads,
 *  writes and deletes, so the real overwrite guard (`storage/slotGuard`) sees
 *  what each command left. A slot save stores its text with a `packed:` mark. */
const stored = new Map<number, string>();
/** The tower name each stored slot lists under. */
const names = new Map<number, string>();
const store = (slot: number, raw: string, name: string): void => {
  stored.set(slot, raw);
  names.set(slot, name);
};

beforeEach(() => {
  __resetSlotGuardForTest();
  stored.clear();
  names.clear();
  vi.mocked(SaveGame.slotRaw).mockReset().mockImplementation((n) => stored.get(n) ?? null);
  vi.mocked(SaveGame.restoreSlotRaw).mockReset().mockImplementation((n, raw) => void stored.set(n, raw));
  vi.mocked(SaveGame.saveSlot).mockReset().mockImplementation((n, text) => store(n, `packed:${text}`, "Fake"));
  vi.mocked(SaveGame.deleteSlot).mockImplementation((n) => void stored.delete(n));
  vi.mocked(SaveGame.listSlots).mockImplementation(() => [
    { slot: "auto", exists: false, present: false },
    ...[...stored.keys()].map((slot) => ({ slot, exists: true, present: true, towerName: names.get(slot) })),
  ]);
  vi.mocked(SaveGame.listSlots).mockClear();
  vi.mocked(SaveGame.saveSlot).mockClear();
  vi.mocked(SaveGame.load).mockClear();
  vi.mocked(SaveGame.loadSlot).mockClear();
  vi.mocked(SaveGame.deleteSlot).mockClear();
  vi.mocked(trackAppAction).mockClear();
  vi.mocked(trackAppActionOnce).mockClear();
});

describe("showSaves", () => {
  it("passes the SaveGame slot listing and the kept unreadable autosave to the UI", () => {
    const sim = makeSim();
    const { app, ui } = makeApp(sim);
    vi.mocked(SaveGame.listSlots).mockReturnValueOnce([{ slot: "auto", exists: false, present: false }]);
    showSaves(app);
    expect(SaveGame.listSlots).toHaveBeenCalledTimes(1);
    expect(ui.showSaves).toHaveBeenCalledExactlyOnceWith([{ slot: "auto", exists: false, present: false }], "VCTOWER1\nkept", {
      home: null,
      liveName: "Fake",
      undo: null,
      replaceTarget: expect.any(Function),
    });
  });

  it("passes the live tower's home slot while that slot still holds what it saved", () => {
    const { app, ui } = makeApp(makeSim());
    saveToSlot(app, 2);
    showSaves(app);
    expect(ui.showSaves.mock.calls[0][2]).toMatchObject({ home: 2 });
    store(2, "written by another tab", "Other");
    showSaves(app);
    expect(ui.showSaves.mock.calls[1][2]).toMatchObject({ home: null });
  });

  it("does not call a slot home when its tower has another name than the live one", () => {
    // A reload boots the autosave, which another tab may have filled with a
    // different tower; the remembered slot still holds this tab's old one.
    store(1, "VCZ1:tower x", "Tower X");
    rememberHome(1, "VCZ1:tower x");
    const { app, ui } = makeApp(makeSim()); // the live tower is "Fake"
    showSaves(app);
    expect(ui.showSaves.mock.calls[0][2]).toMatchObject({ home: null });
    saveToSlot(app, 1); // so a save there is a replace, with an Undo
    expect(pendingUndo(SaveGame.slotRaw)).toMatchObject({ slot: 1, towerName: "Tower X", action: "replaced" });
  });
});

describe("the overwrite guard's Undo", () => {
  const guardShown = (ui: ReturnType<typeof makeApp>["ui"]): SavesGuard => ui.showSaves.mock.lastCall![2] as SavesGuard;

  it("keeps the tower a save replaced, and Undo puts it back byte for byte", () => {
    store(1, "VCZ1:old tower", "Old Tower");
    const { app, ui } = makeApp(makeSim());
    saveToSlot(app, 1);
    expect(stored.get(1)).toBe("packed:SAVE TEXT");
    showSaves(app);
    const undo = guardShown(ui).undo!;
    expect(undo).toMatchObject({ slot: 1, towerName: "Old Tower", action: "replaced" });
    expect(undo.run()).toBe("back");
    expect(SaveGame.restoreSlotRaw).toHaveBeenCalledExactlyOnceWith(1, "VCZ1:old tower");
    expect(stored.get(1)).toBe("VCZ1:old tower");
    expect(ui.toast).toHaveBeenLastCalledWith("Old Tower is back in slot 1.", "good");
    // Used up, and the slot is no longer the live tower's.
    expect(pendingUndo(SaveGame.slotRaw)).toBeNull();
    expect(homeSlot(SaveGame.slotRaw)).toBeNull();
  });

  it("keeps nothing when the save goes into the live tower's own slot", () => {
    store(1, "VCZ1:this tower earlier", "Fake");
    rememberHome(1, "VCZ1:this tower earlier");
    const { app } = makeApp(makeSim());
    saveToSlot(app, 1);
    expect(pendingUndo(SaveGame.slotRaw)).toBeNull();
    expect(homeSlot(SaveGame.slotRaw)).toBe(1);
  });

  it("keeps nothing when the slot was empty, and the slot becomes home", () => {
    const { app } = makeApp(makeSim());
    saveToSlot(app, 3);
    expect(pendingUndo(SaveGame.slotRaw)).toBeNull();
    expect(homeSlot(SaveGame.slotRaw)).toBe(3);
  });

  it("keeps nothing and claims no home when the save fails", () => {
    store(1, "VCZ1:old tower", "Old Tower");
    vi.mocked(SaveGame.saveSlot).mockImplementationOnce(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const { app } = makeApp(makeSim());
    saveToSlot(app, 1);
    expect(pendingUndo(SaveGame.slotRaw)).toBeNull();
    expect(homeSlot(SaveGame.slotRaw)).toBeNull();
  });

  it("keeps a deleted tower, and Undo puts it back", () => {
    store(2, "VCZ1:deleted tower", "Gone Tower");
    const { app, ui } = makeApp(makeSim());
    deleteSlot(app, 2);
    expect(stored.has(2)).toBe(false);
    showSaves(app);
    expect(guardShown(ui).undo).toMatchObject({ slot: 2, towerName: "Gone Tower", action: "deleted" });
    expect(undoSlot(app)).toBe("back");
    expect(stored.get(2)).toBe("VCZ1:deleted tower");
  });

  it("says so inside the open dialog when storage refuses the Undo, and keeps the step", () => {
    store(2, "VCZ1:deleted tower", "Gone Tower");
    const { app, ui } = makeApp(makeSim());
    deleteSlot(app, 2);
    vi.mocked(SaveGame.restoreSlotRaw).mockImplementationOnce(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    vi.mocked(trackAppActionOnce).mockClear();
    expect(undoSlot(app)).toBe("failed");
    expect(ui.sayVisibly).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("Save failed"));
    expect(trackAppActionOnce).not.toHaveBeenCalled(); // an Undo is not an autosave failure
    expect(pendingUndo(SaveGame.slotRaw)).not.toBeNull();
  });

  it("does nothing once the slot holds something else", () => {
    store(2, "VCZ1:deleted tower", "Gone Tower");
    const { app } = makeApp(makeSim());
    deleteSlot(app, 2);
    saveToSlot(app, 2); // the empty slot takes the live tower
    expect(undoSlot(app)).toBe("gone");
    expect(SaveGame.restoreSlotRaw).not.toHaveBeenCalled();
    expect(stored.get(2)).toBe("packed:SAVE TEXT");
  });
});

const guardShownOf = (ui: ReturnType<typeof makeApp>["ui"]): SavesGuard => ui.showSaves.mock.lastCall![2] as SavesGuard;

describe("the guard's click-time answer", () => {
  it("asks for a slot holding another tower, read from storage now, not from the drawn list", () => {
    const { app, ui } = makeApp(makeSim());
    showSaves(app); // drawn with every slot empty
    store(3, "VCZ1:written by another tab", "Other");
    expect(guardShownOf(ui).replaceTarget!(3)).toMatchObject({ slot: 3, towerName: "Other" });
  });

  it("answers with an unreadable row for a slot this version can't read, so the dialog never saves over it at once", () => {
    const { app, ui } = makeApp(makeSim());
    showSaves(app);
    stored.set(3, "VCZ9:from a newer build"); // written since, and listed as not existing
    vi.mocked(SaveGame.listSlots).mockReturnValueOnce([{ slot: 3, exists: false, present: true }]);
    expect(guardShownOf(ui).replaceTarget!(3)).toEqual({ slot: 3, exists: false, present: true });
  });

  it("saves at once into an empty slot or the live tower's own", () => {
    const { app, ui } = makeApp(makeSim());
    saveToSlot(app, 1);
    showSaves(app);
    expect(guardShownOf(ui).replaceTarget!(1)).toBeNull();
    expect(guardShownOf(ui).replaceTarget!(2)).toBeNull();
  });
});

describe("the live tower's home slot follows loads", () => {
  it("a manual slot load makes that slot home", () => {
    store(2, "VCZ1:tower two", "Two");
    vi.mocked(SaveGame.loadSlot).mockImplementationOnce((_slot, load) => load("TOWER"));
    const { app } = makeApp(makeSim());
    loadFromSlot(app, 2);
    expect(homeSlot(SaveGame.slotRaw)).toBe(2);
  });

  it("an autosave load names no home: the shared autosave may hold another tower than the slot", () => {
    // Load slot 2 (tower Y), then the Auto-save row, which still holds tower X.
    store(2, "VCZ1:tower y", "Fake");
    vi.mocked(SaveGame.loadSlot).mockImplementationOnce((_slot, load) => load("Y"));
    vi.mocked(SaveGame.load).mockImplementationOnce((load) => load("X"));
    const { app, ui, followSwap } = makeApp(makeSim());
    followSwap.mockImplementation(() => forgetLiveTower()); // as followEngineTower does
    loadFromSlot(app, 2);
    expect(homeSlot(SaveGame.slotRaw)).toBe(2);
    loadFromSlot(app, "auto");
    expect(homeSlot(SaveGame.slotRaw)).toBeNull();
    showSaves(app);
    expect(guardShownOf(ui).replaceTarget!(2)).toMatchObject({ slot: 2 }); // so saving over Y asks
  });

  it("a failed load leaves the home alone", () => {
    store(1, "VCZ1:this tower", "Fake");
    rememberHome(1, "VCZ1:this tower");
    store(2, "VCZ1:tower two", "Two");
    vi.mocked(SaveGame.loadSlot).mockImplementationOnce((_slot, load) => load("BAD"));
    const { app } = makeApp(makeSim());
    loadFromSlot(app, 2);
    expect(homeSlot(SaveGame.slotRaw)).toBe(1);
  });

  it("a title-screen slot load makes that slot home too", () => {
    store(3, "VCZ1:tower three", "Three");
    vi.mocked(SaveGame.loadSlot).mockImplementationOnce((_slot, load) => load("TOWER"));
    const { app } = makeApp(makeSim());
    expect(loadFromSplash(app, 3)).toBe(true);
    expect(homeSlot(SaveGame.slotRaw)).toBe(3);
  });
});

describe("saveToSlot", () => {
  it("stamps the live camera view, writes the slot, and toasts success", () => {
    const sim = makeSim();
    const { app, ui, engine } = makeApp(sim);
    saveToSlot(app, 2);
    expect(engine.viewState).toHaveBeenCalledTimes(1);
    expect(sim.view).toEqual({ tile: 40, floor: 3, zoom: 2 });
    expect(SaveGame.saveSlot).toHaveBeenCalledExactlyOnceWith(2, "SAVE TEXT");
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith("Saved to slot 2.", "good");
  });

  it("surfaces a storage failure honestly inside the open dialog: no success toast, no escaped throw (AUD-010)", () => {
    vi.mocked(SaveGame.saveSlot).mockImplementationOnce(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const sim = makeSim();
    const { app, ui, saveWarning } = makeApp(sim);
    expect(saveToSlot(app, 2)).toBe(false); // so the dialog keeps the line on screen
    // Said inside the Saved Towers dialog the save came from: its top layer
    // would hide a toast.
    expect(ui.sayVisibly).toHaveBeenCalledExactlyOnceWith(
      "Save failed: storage is full or blocked. Free up space or allow site storage, or export the tower to a file.",
    );
    expect(ui.toast).not.toHaveBeenCalled();
    expect(trackAppActionOnce).toHaveBeenCalledExactlyOnceWith("autosave_failed", "manual");
    // A slot is a separate copy: a full store can refuse it while the
    // autosave still fits, so a slot failure never claims the tower is unsaved.
    expect(saveWarning.show).not.toHaveBeenCalled();
  });

  it("says every failed slot save, never raising the save-failure notice", () => {
    const quota = (): never => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    vi.mocked(SaveGame.saveSlot).mockImplementationOnce(quota).mockImplementationOnce(quota);
    const { app, ui, saveWarning } = makeApp(makeSim());
    saveToSlot(app, 1);
    saveToSlot(app, 2);
    expect(ui.sayVisibly).toHaveBeenCalledTimes(2);
    expect(saveWarning.show).not.toHaveBeenCalled();
  });

  it("keeps the raw detail (no storage blame) when a non-storage bug throws instead", () => {
    vi.mocked(SaveGame.saveSlot).mockImplementationOnce(() => {
      throw new Error("serialize exploded");
    });
    const sim = makeSim();
    const { app, ui } = makeApp(sim);
    expect(() => saveToSlot(app, 4)).not.toThrow();
    expect(ui.sayVisibly).toHaveBeenCalledExactlyOnceWith("Save failed: serialize exploded");
  });
});

describe("loadFromSlot", () => {
  it("adopts and toasts on a truthy manual-slot load", () => {
    const loaded = "TOWER";
    vi.mocked(SaveGame.loadSlot).mockImplementationOnce((_slot, load) => load(loaded));
    const sim = makeSim();
    const { app, ui, enginePort, followSwap } = makeApp(sim);
    loadFromSlot(app, 1);
    expect(SaveGame.loadSlot).toHaveBeenCalledExactlyOnceWith(1, expect.any(Function));
    expect(enginePort.loadSave).toHaveBeenCalledExactlyOnceWith(loaded);
    expect(followSwap).toHaveBeenCalledTimes(1);
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith("Tower loaded.", "good");
  });

  it("reads the autosave via load() when the slot is 'auto'", () => {
    const loaded = "AUTO";
    vi.mocked(SaveGame.load).mockImplementationOnce((load) => load(loaded));
    const sim = makeSim();
    const { app, enginePort, followSwap } = makeApp(sim);
    loadFromSlot(app, "auto");
    expect(SaveGame.load).toHaveBeenCalledTimes(1);
    expect(SaveGame.loadSlot).not.toHaveBeenCalled();
    expect(enginePort.loadSave).toHaveBeenCalledExactlyOnceWith(loaded);
    expect(followSwap).toHaveBeenCalledTimes(1);
  });

  it("toasts failure and does not adopt on a null (empty/corrupt) load", () => {
    vi.mocked(SaveGame.loadSlot).mockImplementationOnce((_slot, load) => load("BAD"));
    const sim = makeSim();
    const { app, ui, followSwap } = makeApp(sim);
    loadFromSlot(app, 3);
    expect(followSwap).not.toHaveBeenCalled();
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith("That slot is empty or corrupt.", "bad");
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("load_failed");
  });
});

describe("loadFromSlot with a save from a newer version", () => {
  it("says to update the game, and does not adopt the tower", () => {
    vi.mocked(SaveGame.loadSlot).mockImplementationOnce((_slot, load) => load("BAD"));
    const { app, ui, enginePort, followSwap } = makeApp(makeSim());
    (enginePort as { lastReason: () => string | undefined }).lastReason = () => NEWER_SAVE_REFUSAL;
    loadFromSlot(app, 1);
    expect(followSwap).not.toHaveBeenCalled();
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith(NEWER_SAVE_REFUSAL, "bad");
  });

  it("keeps the empty-or-corrupt copy when the slot held nothing to try, whatever the engine last refused", () => {
    vi.mocked(SaveGame.loadSlot).mockReturnValueOnce(false);
    const { app, ui, enginePort } = makeApp(makeSim());
    (enginePort as { lastReason: () => string | undefined }).lastReason = () => NEWER_SAVE_REFUSAL;
    loadFromSlot(app, 2);
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith("That slot is empty or corrupt.", "bad");
  });
});

describe("deleteSlot", () => {
  it("deletes the slot and toasts", () => {
    const sim = makeSim();
    const { app, ui } = makeApp(sim);
    deleteSlot(app, 3);
    expect(SaveGame.deleteSlot).toHaveBeenCalledExactlyOnceWith(3);
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith("Deleted slot 3.", "info");
  });
});

/**
 * The title-screen load commands (SPEC-splash-load-tower). They are separate
 * from {@link loadFromSlot} because the splash changes two contracts: failures
 * must not toast (the title screen paints over the toast rail), and the
 * teardown plus re-pause belong to the app's `followSwap`, not here.
 */
describe("loadFromSplash", () => {
  it("adopts the tower and reports success, without toasting or re-pausing", () => {
    const loaded = "TOWER";
    vi.mocked(SaveGame.loadSlot).mockImplementationOnce((_slot, load) => load(loaded));
    const { app, ui, enginePort, followSwap } = makeApp(makeSim());
    expect(loadFromSplash(app, 2)).toBe(true);
    expect(enginePort.loadSave).toHaveBeenCalledExactlyOnceWith(loaded);
    expect(followSwap).toHaveBeenCalledTimes(1);
    // followSwap owns the "Welcome back" toast and the speed-0 re-pause, so that
    // every arrival route (slot, .vctower, .TDT) behaves identically.
    expect(ui.toast).not.toHaveBeenCalled();
  });

  it("reads the autosave via load() for the 'auto' slot", () => {
    const loaded = "AUTO";
    vi.mocked(SaveGame.load).mockImplementationOnce((load) => load(loaded));
    const { app, enginePort, followSwap } = makeApp(makeSim());
    expect(loadFromSplash(app, "auto")).toBe(true);
    expect(enginePort.loadSave).toHaveBeenCalledExactlyOnceWith(loaded);
    expect(followSwap).toHaveBeenCalledTimes(1);
  });

  it("reports failure rather than throwing when storage is blocked outright", () => {
    // The slot list is built from parsed metadata, but the load re-reads
    // localStorage, which throws when storage is blocked. An escaping throw
    // would leave the picker looking frozen with no error shown.
    vi.mocked(SaveGame.loadSlot).mockImplementationOnce(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const { app, ui, followSwap } = makeApp(makeSim());
    expect(loadFromSplash(app, 1)).toBe(false);
    expect(followSwap).not.toHaveBeenCalled();
    expect(ui.toast).not.toHaveBeenCalled();
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("load_failed");
  });

  it("reports failure WITHOUT adopting or toasting, so the title screen survives", () => {
    // The picker renders the reason inline instead. Adopting nothing is what
    // keeps the splash up: followSwap is the only thing that takes it down.
    vi.mocked(SaveGame.loadSlot).mockImplementationOnce((_slot, load) => load("BAD"));
    const { app, ui, followSwap } = makeApp(makeSim());
    expect(loadFromSplash(app, 1)).toBe(false);
    expect(followSwap).not.toHaveBeenCalled();
    expect(ui.toast).not.toHaveBeenCalled();
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("load_failed");
  });
});

describe("showTowerPicker", () => {
  it("passes a thunk that re-reads storage per call, not a captured snapshot", () => {
    const { app, ui } = makeApp(makeSim());
    showTowerPicker(app);
    const { getSlots } = ui.showTowerPicker.mock.calls[0][0] as { getSlots: () => { slots: unknown[]; storageBlocked: boolean } };
    expect(SaveGame.listSlots).not.toHaveBeenCalled(); // nothing read until rendered
    getSlots();
    getSlots();
    expect(SaveGame.listSlots).toHaveBeenCalledTimes(2);
  });

  it("reports blocked storage as its own state, not as an empty list", () => {
    // listSlots reads localStorage, which THROWS a SecurityError rather than
    // returning null when storage is blocked. The title screen must not die on
    // that, and it must not tell the player nothing is saved either: they may
    // have four towers on this device that the browser will not hand over.
    vi.mocked(SaveGame.listSlots).mockImplementationOnce(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const { app, ui } = makeApp(makeSim());
    showTowerPicker(app);
    const { getSlots } = ui.showTowerPicker.mock.calls[0][0] as {
      getSlots: () => { slots: unknown[]; storageBlocked: boolean };
    };
    expect(getSlots()).toEqual({ slots: [], storageBlocked: true });
  });

  it("routes a picked slot through loadFromSplash", () => {
    const loaded = "TOWER";
    vi.mocked(SaveGame.loadSlot).mockImplementationOnce((_slot, load) => load(loaded));
    const { app, ui, enginePort, followSwap } = makeApp(makeSim());
    showTowerPicker(app);
    const cb = ui.showTowerPicker.mock.calls[0][0] as { onLoad: (s: number | "auto") => boolean };
    expect(cb.onLoad(3)).toBe(true);
    expect(enginePort.loadSave).toHaveBeenCalledExactlyOnceWith(loaded);
    expect(followSwap).toHaveBeenCalledTimes(1);
  });
});
