import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SaveGame } from "../storage/SaveGame";
import { SaveLoad, type SaveLoadDeps } from "./saveLoad";
import { trackAppAction, trackAppActionOnce } from "../analytics";

/**
 * The persistence failure signals of the 3.0 reliability gate (#1533): a save,
 * a load or an import that fails reports its `app_action` code, and the
 * matching success reports nothing. The codes carry the fact only. The slot
 * and title-screen load paths are pinned in `appModals.test.ts`.
 */

vi.mock("../analytics", async (importActual) => {
  const actual = await importActual<typeof import("../analytics")>();
  return { ...actual, trackAppAction: vi.fn(), trackAppActionOnce: vi.fn() };
});
vi.mock("./portLifecycle", async (importActual) => {
  const actual = await importActual<typeof import("./portLifecycle")>();
  return { ...actual, saveText: vi.fn(() => "SAVE TEXT") };
});

function makeLoad(port: Record<string, unknown> = {}) {
  const ui = { toast: vi.fn(), sayVisibly: vi.fn(), showImportReport: vi.fn() };
  const towerSwapped = vi.fn();
  const deps = { ui, towerSwapped, enginePort: () => port, getView: () => null } as unknown as SaveLoadDeps;
  return { load: new SaveLoad(deps), ui, towerSwapped };
}

beforeEach(() => {
  vi.mocked(trackAppAction).mockClear();
  vi.mocked(trackAppActionOnce).mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("a failed save reports autosave_failed", () => {
  it("reports a Quick Save that throws as `manual`, still toasting the player", () => {
    vi.spyOn(SaveGame, "save").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const { load, ui } = makeLoad();
    expect(() => load.save()).not.toThrow();
    expect(ui.toast).toHaveBeenCalledWith(expect.stringMatching(/^Save failed/), "bad");
    expect(trackAppActionOnce).toHaveBeenCalledExactlyOnceWith("autosave_failed", "manual");
  });

  it("leaves a silent save's throw to its caller and reports nothing", () => {
    vi.spyOn(SaveGame, "save").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const { load } = makeLoad();
    expect(() => load.save(true)).toThrow();
    expect(trackAppActionOnce).not.toHaveBeenCalled();
  });

  it("reports nothing when the save works", () => {
    vi.spyOn(SaveGame, "save").mockImplementation(() => {});
    const { load } = makeLoad();
    load.save();
    expect(trackAppActionOnce).not.toHaveBeenCalled();
  });

  it("reports a periodic autosave that fails as `timer`", async () => {
    vi.spyOn(SaveGame, "saveAsync").mockRejectedValue(new DOMException("quota", "QuotaExceededError"));
    const { load } = makeLoad();
    await load.autosave();
    expect(trackAppActionOnce).toHaveBeenCalledExactlyOnceWith("autosave_failed", "timer");
  });

  it("reports nothing when a periodic autosave works", async () => {
    vi.spyOn(SaveGame, "saveAsync").mockResolvedValue(undefined);
    const { load } = makeLoad();
    await load.autosave();
    expect(trackAppActionOnce).not.toHaveBeenCalled();
  });
});

describe("a refused import reports import_failed", () => {
  it("reports an unreadable .vctower as `save`, and a good one as nothing", async () => {
    const bad = makeLoad({ loadVctower: () => [0], lastReason: () => "not a tower" });
    await bad.load.importGame("garbage");
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("import_failed", "save");
    expect(bad.ui.sayVisibly).toHaveBeenCalledWith("Import failed: not a tower");

    vi.mocked(trackAppAction).mockClear();
    const good = makeLoad({ loadVctower: () => [1] });
    await good.load.importGame("fine");
    expect(trackAppAction).not.toHaveBeenCalled();
    expect(good.towerSwapped).toHaveBeenCalledOnce();
  });

  it("reports a refused .TDT as `tdt`", async () => {
    const { load, ui } = makeLoad({ loadTdt: () => [0], lastReason: () => "too small" });
    await load.importLegacy(new ArrayBuffer(4), "tiny.TDT");
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("import_failed", "tdt");
    expect(ui.toast).toHaveBeenCalledWith("too small", "bad");
  });
});
