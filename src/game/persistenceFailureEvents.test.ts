import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SaveGame } from "../storage/SaveGame";
import { SaveLoad, type SaveLoadDeps } from "./saveLoad";
import { trackAppAction, trackAppActionOnce } from "../analytics";
import { NEWER_SAVE_REFUSAL } from "./portLifecycle";

/**
 * The persistence failure signals of the 3.0 reliability gate (#1533): a save,
 * a load, an import or an export that fails reports its `app_action` code, and the
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
  const ui = { toast: vi.fn(), sayVisibly: vi.fn(), showImportReport: vi.fn(), downloadFile: vi.fn(() => true) };
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

  it("leaves a silent save's throw to its caller and reports it as `timer` (pre-update, context-loss and TDT flushes)", () => {
    vi.spyOn(SaveGame, "save").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const { load } = makeLoad();
    expect(() => load.save(true)).toThrow();
    expect(trackAppActionOnce).toHaveBeenCalledExactlyOnceWith("autosave_failed", "timer");
  });

  it("rethrows the save's own error when reporting it throws", () => {
    const quota = new DOMException("quota", "QuotaExceededError");
    vi.spyOn(SaveGame, "save").mockImplementation(() => {
      throw quota;
    });
    vi.mocked(trackAppActionOnce).mockImplementationOnce(() => {
      throw new TypeError("telemetry broke");
    });
    const { load } = makeLoad();
    expect(() => load.save(true)).toThrow(quota);
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

describe("an export that writes no file reports export_failed (#1655)", () => {
  it("reports an engine that throws on a .vctower export as `save`, and a good export as nothing", async () => {
    const bad = makeLoad({
      setCamera: () => {},
      exportVctower: () => {
        throw new Error("memory access out of bounds");
      },
      towerName: () => "Tower",
    });
    await bad.load.exportGame();
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("export_failed", "save");
    expect(bad.ui.toast).toHaveBeenCalledWith("Export failed: memory access out of bounds", "bad");

    // The WASM binding can throw a bare string or null, not only an Error.
    for (const [thrown, line] of [
      ["trap", "Export failed: trap"],
      [null, "Export failed: null"],
    ] as const) {
      vi.mocked(trackAppAction).mockClear();
      const odd = makeLoad({
        setCamera: () => {},
        exportVctower: () => {
          throw thrown;
        },
        towerName: () => "Tower",
      });
      await odd.load.exportGame();
      expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("export_failed", "save");
      expect(odd.ui.toast).toHaveBeenCalledWith(line, "bad");
    }

    vi.mocked(trackAppAction).mockClear();
    const good = makeLoad({ setCamera: () => {}, exportVctower: () => "VCTOWER1\nabc", towerName: () => "Tower" });
    await good.load.exportGame();
    expect(trackAppAction).not.toHaveBeenCalled();
    expect(good.ui.downloadFile).toHaveBeenCalledOnce();
  });

  it("reports a refused, throwing or unloadable .TDT export as `tdt`", async () => {
    const refused = makeLoad({ setCamera: () => {}, tdtExport: () => [0], lastReason: () => "Modern towers cannot be exported." });
    await refused.load.exportLegacy();
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("export_failed", "tdt");
    expect(refused.ui.sayVisibly).toHaveBeenCalledWith("Modern towers cannot be exported.");

    vi.mocked(trackAppAction).mockClear();
    const thrown = makeLoad({
      setCamera: () => {},
      tdtExport: () => {
        throw new Error("out of memory");
      },
    });
    await thrown.load.exportLegacy();
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("export_failed", "tdt");
    expect(thrown.ui.sayVisibly).toHaveBeenCalledWith("Export failed: out of memory");

    vi.mocked(trackAppAction).mockClear();
    const unloaded = makeLoad({ prepareTdt: () => Promise.reject(new Error("Failed to fetch the codec")) });
    await unloaded.load.exportLegacy();
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("export_failed", "tdt");
    expect(unloaded.ui.sayVisibly).toHaveBeenCalledWith("Export failed: Failed to fetch the codec");
  });
});

describe("Quick Load of a save a newer build wrote", () => {
  it("says to update the game, and keeps the plain message for no save at all", () => {
    localStorage.clear();
    const { load, ui } = makeLoad({ loadSave: () => [0], lastReason: () => NEWER_SAVE_REFUSAL });
    load.load();
    expect(ui.toast).toHaveBeenLastCalledWith("No saved tower found.", "bad");
    localStorage.setItem("verticopolis-save", SaveGame.packSync("{}"));
    load.load();
    expect(ui.toast).toHaveBeenLastCalledWith(NEWER_SAVE_REFUSAL, "bad");
  });
});
