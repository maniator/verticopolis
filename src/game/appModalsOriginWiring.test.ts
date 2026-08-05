import { describe, it, expect, vi, beforeEach } from "vitest";
import { Simulation } from "../engine/Simulation";
import { SaveGame } from "../storage/SaveGame";
import type { GameApp } from "../main";
import { loadFromSlot, loadFromSplash, saveToSlot, showSaves, showTowerPicker } from "./appModals";
import { adoptConfirmedLegacyImport } from "./legacyImportAdopt";

/**
 * The appModals and legacyImportAdopt halves of the origin and degraded
 * wiring. `towerOriginWiring.test.ts` covers the `SaveLoad` sites and states
 * why this shape exists; a previous review round found that HALF the call
 * sites had no such coverage, so deleting `loadFromSplash`'s origin note (for
 * one) left the whole suite green. These close that.
 */

vi.mock("../platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform")>()),
  IS_WRAPPED_BUILD: true,
}));

const noteTowerOriginForSlot = vi.fn();
const storeReadDegraded = vi.fn(() => false);
const slotDeletePendingMock = vi.fn((_slot: number) => false);

vi.mock("./manualSavePersist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./manualSavePersist")>()),
  slotDeletePending: (slot: number) => slotDeletePendingMock(slot),
}));

const saveScopeCaptionMock = vi.fn<() => { text: string; listLabel: string } | undefined>(() => undefined);
vi.mock("./desktopScopeCaption", () => ({
  saveScopeCaption: () => saveScopeCaptionMock(),
}));

vi.mock("./desktopSaveStore", () => ({
  noteTowerOriginForSlot: (slot: unknown) => noteTowerOriginForSlot(slot),
  storeReadDegraded: () => storeReadDegraded(),
  saveStoreSession: () => null,
  storeIsAuthoritative: () => false,
  writeTowerToStore: vi.fn(),
  prepareSaveStore: vi.fn(),
  saveMigrationReport: () => null,
  resetSaveStoreForTests: vi.fn(),
  noteTowerOrigin: vi.fn(),
  towerOrigin: () => undefined,
}));

/** The minimal GameApp surface these functions touch. */
function fakeApp() {
  const adopted: Simulation[] = [];
  const toasts: string[] = [];
  const app = {
    sim: Simulation.newGame(1),
    engine: { viewState: () => null },
    adoptSim: (sim: Simulation) => adopted.push(sim),
    ui: { toast: (text: string) => toasts.push(text) },
  } as unknown as GameApp;
  return { app, adopted, toasts };
}

beforeEach(() => {
  localStorage.clear();
  noteTowerOriginForSlot.mockClear();
  storeReadDegraded.mockReturnValue(false);
  slotDeletePendingMock.mockImplementation(() => false);
});

describe("appModals load paths report the origin, AFTER adoption", () => {
  it("loadFromSlot notes the slot it loaded", () => {
    SaveGame.saveSlot(2, Simulation.newGame(7));
    const { app, adopted } = fakeApp();

    loadFromSlot(app, 2);

    expect(adopted.length).toBe(1);
    expect(noteTowerOriginForSlot).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("loadFromSlot notes nothing for an empty slot", () => {
    const { app, adopted } = fakeApp();
    loadFromSlot(app, 3);
    expect(adopted.length).toBe(0);
    expect(noteTowerOriginForSlot).not.toHaveBeenCalled();
  });

  it("loadFromSplash notes the slot it loaded", () => {
    SaveGame.save(Simulation.newGame(9));
    const { app, adopted } = fakeApp();

    expect(loadFromSplash(app, "auto")).toBe(true);

    expect(adopted.length).toBe(1);
    expect(noteTowerOriginForSlot).toHaveBeenCalledExactlyOnceWith("auto");
  });

  it("loadFromSplash notes nothing on a failed load", () => {
    const { app } = fakeApp();
    expect(loadFromSplash(app, 1)).toBe(false);
    expect(noteTowerOriginForSlot).not.toHaveBeenCalled();
  });
});

describe("appModals slot save refuses in a degraded session", () => {
  it("saveToSlot toasts the pause message and writes nothing", () => {
    storeReadDegraded.mockReturnValue(true);
    const { app, toasts } = fakeApp();

    saveToSlot(app, 1);

    expect(localStorage.getItem("simtower-clone-slot-1")).toBeNull();
    expect(toasts.length).toBe(1);
    expect(toasts[0]).toContain("saving is paused");
  });

  it("saveToSlot saves normally in a healthy session", () => {
    const { app, toasts } = fakeApp();
    saveToSlot(app, 1);
    expect(localStorage.getItem("simtower-clone-slot-1")).not.toBeNull();
    expect(toasts[0]).toContain("Saved to slot 1");
  });

  it("saveToSlot refuses while the slot's store delete is in flight", () => {
    // A save landing between the delete's dispatch and its answer would be
    // unlinked by the pending delete right after "Saved to slot N" toasted.
    slotDeletePendingMock.mockImplementation((slot) => slot === 2);
    const { app, toasts } = fakeApp();

    saveToSlot(app, 2);

    expect(localStorage.getItem("simtower-clone-slot-2")).toBeNull();
    expect(toasts.length).toBe(1);
    expect(toasts[0]).toContain("still being deleted");
  });
});

describe("the confirmed legacy import in a degraded session", () => {
  function makeDeps() {
    const toasts: string[] = [];
    const adopted: Simulation[] = [];
    const sim = Simulation.newGame(3);
    return {
      toasts,
      adopted,
      sim,
      deps: {
        adoptSim: (s: Simulation) => adopted.push(s),
        getSim: () => sim,
        ui: { toast: (text: string) => toasts.push(text) } as never,
      },
    };
  }

  it("says saving is paused ONCE, advises an export, and skips the flush", () => {
    // The previous behavior misdiagnosed a degraded session twice over:
    // "storage is full or blocked" from the slot copy AND from the flush,
    // when storage was fine and saving was deliberately paused.
    storeReadDegraded.mockReturnValue(true);
    const { deps, sim, toasts, adopted } = makeDeps();
    const flush = vi.fn(() => {
      throw new Error("saving is paused");
    });

    adoptConfirmedLegacyImport(deps as never, sim, flush);

    expect(adopted.length).toBe(1);
    expect(flush).not.toHaveBeenCalled();
    expect(toasts.length).toBe(1);
    expect(toasts[0]).toContain("Saving is paused");
    expect(toasts[0]).toContain("export");
    expect(toasts.some((t) => t.includes("full or blocked"))).toBe(false);
    // The import itself still cleared the origin.
    expect(noteTowerOriginForSlot).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it("keeps the ordinary two-outcome wording in a healthy session", () => {
    const { deps, sim, toasts } = makeDeps();
    adoptConfirmedLegacyImport(deps as never, sim, vi.fn());
    expect(toasts.some((t) => t.includes("saved to slot 1"))).toBe(true);
  });

  it("the scope caption reaches BOTH saves surfaces from the shell's data", () => {
    // The D2 labelling ruling's last mile: the ratified copy travels from the
    // shell's scope label through list() to the templates. An audit found the
    // templates shipped with caption parameters no caller constructed, so the
    // copy reached no screen; this pins both call sites.
    const caption = { text: "Towers here. Everyone opens them.", listLabel: "Towers here" };
    saveScopeCaptionMock.mockReturnValue(caption);
    const seen: unknown[] = [];
    const app = {
      sim: Simulation.newGame(1),
      ui: {
        toast: () => {},
        showSaves: (_slots: unknown, scope: unknown) => seen.push(scope),
        showTowerPicker: (ctx: { scope?: unknown }) => seen.push(ctx.scope),
      },
    } as unknown as GameApp;

    showSaves(app);
    showTowerPicker(app);

    expect(seen).toEqual([caption, caption]);
  });

  it("the fresh-slot pick SKIPS a slot whose store delete is in flight", () => {
    // The slot LOOKS free (its cache row is already gone), but a failed
    // delete restores it, and the copy written meanwhile would be unlinked.
    slotDeletePendingMock.mockImplementation((slot) => slot === 1);
    const { deps, sim, toasts } = makeDeps();

    adoptConfirmedLegacyImport(deps as never, sim, vi.fn());

    expect(localStorage.getItem("simtower-clone-slot-1")).toBeNull();
    expect(localStorage.getItem("simtower-clone-slot-2")).not.toBeNull();
    expect(toasts.some((t) => t.includes("saved to slot 2"))).toBe(true);
  });
});
