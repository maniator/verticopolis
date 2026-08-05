import { describe, it, expect, vi, beforeEach } from "vitest";
import { Simulation } from "../engine/Simulation";
import { SaveLoad, type SaveLoadDeps } from "./saveLoad";

/**
 * The origin WIRING: that every tower adoption path tells the desktop store
 * where the live tower came from, and that the two clearing paths actually
 * clear.
 *
 * Same shape as `hostCommandsWiring.test.ts`, and for the same reason: every
 * call site is written `if (IS_WRAPPED_BUILD) ...`, and that constant is false
 * under vitest, so in every other test these lines do not run. All of them
 * could be deleted with the whole suite green. The origin rule's own tests
 * cannot catch that either, because they drive `noteTowerOrigin` directly.
 *
 * `./desktopSaveStore` is mocked: what is under test is that the CALL happens
 * with the right argument at the right moment, not what the store does with it,
 * which has its own suites.
 */

vi.mock("../platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform")>()),
  IS_WRAPPED_BUILD: true,
}));

const noteTowerOriginForSlot = vi.fn();
const storeReadDegraded = vi.fn(() => false);

vi.mock("./desktopSaveStore", () => ({
  noteTowerOriginForSlot: (slot: unknown) => noteTowerOriginForSlot(slot),
  storeReadDegraded: () => storeReadDegraded(),
  // The members other imports in the module graph reach for.
  saveStoreSession: () => null,
  storeIsAuthoritative: () => false,
  writeTowerToStore: vi.fn(),
  prepareSaveStore: vi.fn(),
  saveMigrationReport: () => null,
  resetSaveStoreForTests: vi.fn(),
  noteTowerOrigin: vi.fn(),
  towerOrigin: () => undefined,
}));

function makeSaveLoad(overrides: Partial<SaveLoadDeps> = {}): { sl: SaveLoad; adopted: Simulation[] } {
  const adopted: Simulation[] = [];
  const sl = new SaveLoad({
    getSim: () => Simulation.newGame(1),
    getView: () => null,
    adoptSim: (sim) => adopted.push(sim),
    ui: {
      toast: vi.fn(),
      sayVisibly: vi.fn(),
      downloadFile: vi.fn(),
      showImportReport: vi.fn(),
      showExportReport: vi.fn(),
    },
    showCrashScreen: vi.fn(),
    attemptGraphicsRecovery: vi.fn(),
    armOnboarding: vi.fn(),
    ...overrides,
  });
  return { sl, adopted };
}

beforeEach(() => {
  localStorage.clear();
  noteTowerOriginForSlot.mockClear();
  storeReadDegraded.mockReturnValue(false);
});

describe("every adoption path reports the tower's origin", () => {
  it("newGame CLEARS the origin, before the new sim is adopted", () => {
    // The account-leak case (#736 F5): without this, a new tower inherits the
    // previous tower's scope and autosaves into a namespace it never came from.
    const { sl, adopted } = makeSaveLoad();
    const order: string[] = [];
    noteTowerOriginForSlot.mockImplementation((slot) => order.push(`origin:${String(slot)}`));

    sl.newGame();

    expect(noteTowerOriginForSlot).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(adopted.length).toBe(1);
    expect(order).toEqual(["origin:undefined"]);
  });

  it("load() reports the autosave slot", async () => {
    // Seed a loadable autosave the real SaveGame can read.
    const { SaveGame } = await import("../storage/SaveGame");
    SaveGame.save(Simulation.newGame(7));

    const { sl, adopted } = makeSaveLoad();
    sl.load();

    expect(noteTowerOriginForSlot).toHaveBeenCalledExactlyOnceWith("auto");
    expect(adopted.length).toBe(1);
  });

  it("load() reports nothing when there was no tower to adopt", () => {
    const { sl, adopted } = makeSaveLoad();
    sl.load();
    expect(noteTowerOriginForSlot).not.toHaveBeenCalled();
    expect(adopted.length).toBe(0);
  });

  it("importGame clears the origin, and only AFTER the import succeeded", async () => {
    const { SaveGame } = await import("../storage/SaveGame");
    const text = await SaveGame.export(Simulation.newGame(3));

    const { sl, adopted } = makeSaveLoad();
    await sl.importGame(text);
    expect(noteTowerOriginForSlot).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(adopted.length).toBe(1);

    // A FAILED import must leave the live tower's origin untouched.
    noteTowerOriginForSlot.mockClear();
    await sl.importGame("not a tower file");
    expect(noteTowerOriginForSlot).not.toHaveBeenCalled();
  });
});

describe("a degraded session refuses the writes it cannot keep", () => {
  it("Quick Save toasts the refusal instead of writing", () => {
    storeReadDegraded.mockReturnValue(true);
    const toast = vi.fn();
    const { sl } = makeSaveLoad({
      ui: {
        toast,
        sayVisibly: vi.fn(),
        downloadFile: vi.fn(),
        showImportReport: vi.fn(),
        showExportReport: vi.fn(),
      },
    });

    sl.save();

    expect(localStorage.getItem("verticopolis-save")).toBeNull();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(String(toast.mock.calls[0]![0])).toContain("saving is paused");
  });

  it("the silent path THROWS, so saveBeforeUpdate's caller does not reload", () => {
    // The one contract that must not soften: a caller that reloads on a
    // successful-looking flush loses the tower, which is the thing
    // saveBeforeUpdate exists to prevent.
    storeReadDegraded.mockReturnValue(true);
    const { sl } = makeSaveLoad();
    expect(() => sl.save(true)).toThrow(/saving is paused/);
    expect(localStorage.getItem("verticopolis-save")).toBeNull();
  });

  it("a healthy session saves exactly as before", () => {
    const { sl } = makeSaveLoad();
    sl.save(true);
    expect(localStorage.getItem("verticopolis-save")).not.toBeNull();
  });
});
