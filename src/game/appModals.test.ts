import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GameApp } from "../main";
import type { Simulation } from "../engine/Simulation";
import { showStats, showSaves, saveToSlot, loadFromSlot, deleteSlot, showTowerPicker, loadFromSplash } from "./appModals";
import { SaveGame } from "../storage/SaveGame";

/**
 * These pin the stats/exterminator/save-slot commands against a hand-built fake
 * `GameApp`. `SaveGame` is fully mocked (no localStorage, no compression);
 * `statsTemplate` is stubbed to a token so the fake sim only needs the handful
 * of fields the commands themselves read, while `canCallExterminator` stays the
 * REAL predicate so the handler gate is exercised against actual sim state.
 */

vi.mock("../storage/SaveGame", async (importActual) => {
  // Spread the real module so isStorageWriteError/saveFailureMessage stay
  // REAL: the quota tests below exercise the actual failure classification
  // and copy, not stubs of them. Only the SaveGame writer object is mocked.
  const actual = await importActual<typeof import("../storage/SaveGame")>();
  return {
    ...actual,
    SaveGame: {
      listSlots: vi.fn(() => [{ slot: "auto", exists: false }]),
      saveSlot: vi.fn(),
      load: vi.fn(),
      loadSlot: vi.fn(),
      deleteSlot: vi.fn(),
    },
  };
});

vi.mock("../ui/templates/stats", async (importActual) => {
  const actual = await importActual<typeof import("../ui/templates/stats")>();
  return { ...actual, statsTemplate: vi.fn(() => "STATS_BODY") };
});

interface Refusal {
  ok: false;
  reason?: "funds" | "pending" | "none" | string;
  cost?: number;
}

interface SimShape {
  view: unknown;
  exterminationDueDay: number | undefined;
  rules: { infestationRecovery: ReturnType<typeof vi.fn> };
  housekeepingCoverage: ReturnType<typeof vi.fn>;
  callExterminator: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
}

/** A sim where the exterminator is offerable: Modern recovery exists, rooms are
 *  infested, and none is en route. Callers dial the pieces they need. */
function makeSim(over: Partial<SimShape> = {}): SimShape {
  return {
    view: null,
    exterminationDueDay: undefined,
    rules: { infestationRecovery: vi.fn(() => ({ calloutFee: 100, perRoomFee: 50 })) },
    housekeepingCoverage: vi.fn(() => ({ infested: 2 })),
    callExterminator: vi.fn(() => ({ ok: true })),
    emit: vi.fn(),
    ...over,
  };
}

function makeApp(sim: SimShape) {
  const ui = {
    showStats: vi.fn(),
    confirmModal: vi.fn(),
    showSaves: vi.fn(),
    showTowerPicker: vi.fn(),
    toast: vi.fn(),
  };
  const engine = { viewState: vi.fn(() => ({ camera: "VIEW" })) };
  const app = {
    sim,
    ui,
    engine,
    adoptSim: vi.fn(),
  };
  return { app: app as unknown as GameApp, ui, engine, adoptSim: app.adoptSim };
}

beforeEach(() => {
  vi.mocked(SaveGame.listSlots).mockClear();
  vi.mocked(SaveGame.saveSlot).mockClear();
  vi.mocked(SaveGame.load).mockClear();
  vi.mocked(SaveGame.loadSlot).mockClear();
  vi.mocked(SaveGame.deleteSlot).mockClear();
});

describe("showStats", () => {
  it("wires an exterminate handler when the action is offerable", () => {
    const sim = makeSim(); // recovery, 2 infested, none en route → offerable
    const { app, ui } = makeApp(sim);
    showStats(app);
    expect(ui.showStats).toHaveBeenCalledTimes(1);
    const handlers = ui.showStats.mock.calls[0][1] as Record<string, () => void>;
    expect(typeof handlers.exterminate).toBe("function");
  });

  it("wires NO handlers when the action is not offerable", () => {
    // No recovery rule (Classic-style): canCallExterminator is false.
    const sim = makeSim({ rules: { infestationRecovery: vi.fn(() => null) } });
    const { app, ui } = makeApp(sim);
    showStats(app);
    const handlers = ui.showStats.mock.calls[0][1] as Record<string, () => void>;
    expect(handlers).toEqual({});
  });

  it("also declines when a dispatch is already en route", () => {
    const sim = makeSim({ exterminationDueDay: 5 });
    const { app, ui } = makeApp(sim);
    showStats(app);
    expect(ui.showStats.mock.calls[0][1]).toEqual({});
  });

  it("also declines when nothing is infested", () => {
    const sim = makeSim({ housekeepingCoverage: vi.fn(() => ({ infested: 0 })) });
    const { app, ui } = makeApp(sim);
    showStats(app);
    expect(ui.showStats.mock.calls[0][1]).toEqual({});
  });
});

/** Fire the exterminate handler that showStats wired, returning the confirmModal
 *  spy so a test can drive its confirm callback. */
function fireExterminate(app: GameApp, ui: ReturnType<typeof makeApp>["ui"]) {
  showStats(app);
  const handlers = ui.showStats.mock.calls[0][1] as Record<string, () => void>;
  handlers.exterminate();
}

describe("confirmExterminate refusals surfaced by the confirm callback", () => {
  const cases: Array<{ reason: string; cost?: number; message: string }> = [
    { reason: "funds", cost: 500, message: "Not enough funds to book the exterminator ($500)." },
    { reason: "pending", message: "An exterminator is already on the way." },
    { reason: "none", message: "No infested rooms left to treat." },
    { reason: "whatever", message: "The exterminator is unavailable." },
  ];

  for (const { reason, cost, message } of cases) {
    it(`emits "${message}" for reason "${reason}"`, () => {
      const res: Refusal = { ok: false, reason, ...(cost !== undefined ? { cost } : {}) };
      const sim = makeSim({ callExterminator: vi.fn(() => res) });
      const { app, ui } = makeApp(sim);
      fireExterminate(app, ui);
      expect(ui.confirmModal).toHaveBeenCalledTimes(1);
      const onConfirm = ui.confirmModal.mock.calls[0][2] as () => void;
      onConfirm();
      expect(sim.callExterminator).toHaveBeenCalledTimes(1);
      expect(sim.emit).toHaveBeenCalledExactlyOnceWith(message, "bad");
    });
  }

  it("funds refusal falls back to the computed cost when the result omits one", () => {
    // recovery 100 + 50/room * 2 infested = 200.
    const sim = makeSim({ callExterminator: vi.fn(() => ({ ok: false, reason: "funds" })) });
    const { app, ui } = makeApp(sim);
    fireExterminate(app, ui);
    (ui.confirmModal.mock.calls[0][2] as () => void)();
    expect(sim.emit).toHaveBeenCalledExactlyOnceWith("Not enough funds to book the exterminator ($200).", "bad");
  });

  it("emits nothing extra and reopens stats on a successful dispatch", () => {
    const sim = makeSim({ callExterminator: vi.fn(() => ({ ok: true })) });
    const { app, ui } = makeApp(sim);
    fireExterminate(app, ui);
    (ui.confirmModal.mock.calls[0][2] as () => void)();
    expect(sim.emit).not.toHaveBeenCalled();
    // showStats runs again after the confirm (initial open + reopen).
    expect(ui.showStats).toHaveBeenCalledTimes(2);
  });

  it("bails with a reason before confirming when the tower cleared between render and click", () => {
    // Rooms cleared after the modal rendered: infested is now 0, so the handler
    // says why instead of opening a confirm dialog.
    const sim = makeSim();
    const { app, ui } = makeApp(sim);
    showStats(app);
    const handlers = ui.showStats.mock.calls[0][1] as Record<string, () => void>;
    sim.housekeepingCoverage.mockReturnValue({ infested: 0 });
    handlers.exterminate();
    expect(ui.confirmModal).not.toHaveBeenCalled();
    expect(sim.emit).toHaveBeenCalledExactlyOnceWith("No infested rooms left to treat.", "bad");
  });

  it("reports the exterminator unavailable when the recovery rule vanished", () => {
    const sim = makeSim();
    const { app, ui } = makeApp(sim);
    showStats(app);
    const handlers = ui.showStats.mock.calls[0][1] as Record<string, () => void>;
    sim.rules.infestationRecovery.mockReturnValue(null);
    handlers.exterminate();
    expect(ui.confirmModal).not.toHaveBeenCalled();
    expect(sim.emit).toHaveBeenCalledExactlyOnceWith("The exterminator is unavailable.", "bad");
  });
});

describe("showSaves", () => {
  it("passes the SaveGame slot listing to the UI", () => {
    const sim = makeSim();
    const { app, ui } = makeApp(sim);
    showSaves(app);
    expect(SaveGame.listSlots).toHaveBeenCalledTimes(1);
    // The second argument is the scope caption, absent outside a wrapped
    // build (IS_WRAPPED_BUILD is false under vitest); the wrapped-side wiring
    // is pinned in appModalsOriginWiring.test.ts.
    expect(ui.showSaves).toHaveBeenCalledExactlyOnceWith([{ slot: "auto", exists: false }], undefined);
  });
});

describe("saveToSlot", () => {
  it("stamps the live camera view, writes the slot, and toasts success", () => {
    const sim = makeSim();
    const { app, ui, engine } = makeApp(sim);
    saveToSlot(app, 2);
    expect(engine.viewState).toHaveBeenCalledTimes(1);
    expect(sim.view).toEqual({ camera: "VIEW" });
    expect(SaveGame.saveSlot).toHaveBeenCalledExactlyOnceWith(2, sim);
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith("Saved to slot 2.", "good");
  });

  it("surfaces a storage failure honestly: failure toast, no success toast, no escaped throw (AUD-010)", () => {
    vi.mocked(SaveGame.saveSlot).mockImplementationOnce(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const sim = makeSim();
    const { app, ui } = makeApp(sim);
    expect(() => saveToSlot(app, 2)).not.toThrow();
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith(
      "Save failed: storage is full or blocked. Free up space or allow site storage, then try again.",
      "bad",
    );
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
    const loaded = { tag: "TOWER" } as unknown as Simulation;
    vi.mocked(SaveGame.loadSlot).mockReturnValueOnce(loaded);
    const sim = makeSim();
    const { app, ui, adoptSim } = makeApp(sim);
    loadFromSlot(app, 1);
    expect(SaveGame.loadSlot).toHaveBeenCalledExactlyOnceWith(1);
    expect(adoptSim).toHaveBeenCalledExactlyOnceWith(loaded);
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith("Tower loaded.", "good");
  });

  it("reads the autosave via load() when the slot is 'auto'", () => {
    const loaded = { tag: "AUTO" } as unknown as Simulation;
    vi.mocked(SaveGame.load).mockReturnValueOnce(loaded);
    const sim = makeSim();
    const { app, adoptSim } = makeApp(sim);
    loadFromSlot(app, "auto");
    expect(SaveGame.load).toHaveBeenCalledTimes(1);
    expect(SaveGame.loadSlot).not.toHaveBeenCalled();
    expect(adoptSim).toHaveBeenCalledExactlyOnceWith(loaded);
  });

  it("toasts failure and does not adopt on a null (empty/corrupt) load", () => {
    vi.mocked(SaveGame.loadSlot).mockReturnValueOnce(null);
    const sim = makeSim();
    const { app, ui, adoptSim } = makeApp(sim);
    loadFromSlot(app, 3);
    expect(adoptSim).not.toHaveBeenCalled();
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
 * teardown plus re-pause belong to `adoptSim`, not here.
 */
describe("loadFromSplash", () => {
  it("adopts the tower and reports success, without toasting or re-pausing", () => {
    const loaded = { tag: "TOWER" } as unknown as Simulation;
    vi.mocked(SaveGame.loadSlot).mockReturnValueOnce(loaded);
    const { app, ui, adoptSim } = makeApp(makeSim());
    expect(loadFromSplash(app, 2)).toBe(true);
    expect(adoptSim).toHaveBeenCalledExactlyOnceWith(loaded);
    // adoptSim owns the "Welcome back" toast and the speed-0 re-pause, so that
    // every arrival route (slot, .vctower, .TDT) behaves identically.
    expect(ui.toast).not.toHaveBeenCalled();
  });

  it("reads the autosave via load() for the 'auto' slot", () => {
    const loaded = { tag: "AUTO" } as unknown as Simulation;
    vi.mocked(SaveGame.load).mockReturnValueOnce(loaded);
    const { app, adoptSim } = makeApp(makeSim());
    expect(loadFromSplash(app, "auto")).toBe(true);
    expect(adoptSim).toHaveBeenCalledExactlyOnceWith(loaded);
  });

  it("reports failure rather than throwing when storage is blocked outright", () => {
    // The slot list is built from parsed metadata, but the load re-reads
    // localStorage, which throws when storage is blocked. An escaping throw
    // would leave the picker looking frozen with no error shown.
    vi.mocked(SaveGame.loadSlot).mockImplementationOnce(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const { app, ui, adoptSim } = makeApp(makeSim());
    expect(loadFromSplash(app, 1)).toBe(false);
    expect(adoptSim).not.toHaveBeenCalled();
    expect(ui.toast).not.toHaveBeenCalled();
  });

  it("reports failure WITHOUT adopting or toasting, so the title screen survives", () => {
    // The picker renders the reason inline instead. Adopting nothing is what
    // keeps the splash up: adoptSim is the only thing that takes it down.
    vi.mocked(SaveGame.loadSlot).mockReturnValueOnce(null);
    const { app, ui, adoptSim } = makeApp(makeSim());
    expect(loadFromSplash(app, 1)).toBe(false);
    expect(adoptSim).not.toHaveBeenCalled();
    expect(ui.toast).not.toHaveBeenCalled();
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
    const loaded = { tag: "TOWER" } as unknown as Simulation;
    vi.mocked(SaveGame.loadSlot).mockReturnValueOnce(loaded);
    const { app, ui, adoptSim } = makeApp(makeSim());
    showTowerPicker(app);
    const cb = ui.showTowerPicker.mock.calls[0][0] as { onLoad: (s: number | "auto") => boolean };
    expect(cb.onLoad(3)).toBe(true);
    expect(adoptSim).toHaveBeenCalledExactlyOnceWith(loaded);
  });
});
