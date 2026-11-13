import { describe, it, expect, vi, beforeEach } from "vitest";
import { showSaves, saveToSlot, loadFromSlot, deleteSlot, showTowerPicker, loadFromSplash } from "./appModals";
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
    },
  };
});

beforeEach(() => {
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
    showSaves(app);
    expect(SaveGame.listSlots).toHaveBeenCalledTimes(1);
    expect(ui.showSaves).toHaveBeenCalledExactlyOnceWith([{ slot: "auto", exists: false }], "VCTOWER1\nkept");
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

  it("surfaces a storage failure honestly: failure toast, no success toast, no escaped throw (AUD-010)", () => {
    vi.mocked(SaveGame.saveSlot).mockImplementationOnce(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const sim = makeSim();
    const { app, ui, saveWarning } = makeApp(sim);
    expect(() => saveToSlot(app, 2)).not.toThrow();
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith(
      "Save failed: storage is full or blocked. Free up space or allow site storage, or export the tower to a file.",
      "bad",
    );
    expect(trackAppActionOnce).toHaveBeenCalledExactlyOnceWith("autosave_failed", "manual");
    // A slot is a separate copy: a full store can refuse it while the
    // autosave still fits, so a slot failure never claims the tower is unsaved.
    expect(saveWarning.show).not.toHaveBeenCalled();
  });

  it("toasts every failed slot save, never raising the save-failure notice", () => {
    const quota = (): never => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    vi.mocked(SaveGame.saveSlot).mockImplementationOnce(quota).mockImplementationOnce(quota);
    const { app, ui, saveWarning } = makeApp(makeSim());
    saveToSlot(app, 1);
    saveToSlot(app, 2);
    expect(ui.toast).toHaveBeenCalledTimes(2);
    expect(saveWarning.show).not.toHaveBeenCalled();
  });

  it("keeps the raw detail (no storage blame) when a non-storage bug throws instead", () => {
    vi.mocked(SaveGame.saveSlot).mockImplementationOnce(() => {
      throw new Error("serialize exploded");
    });
    const sim = makeSim();
    const { app, ui } = makeApp(sim);
    expect(() => saveToSlot(app, 4)).not.toThrow();
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith("Save failed: serialize exploded", "bad");
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
