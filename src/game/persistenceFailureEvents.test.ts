import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SaveGame } from "../storage/SaveGame";
import { SaveLoad, type SaveLoadDeps } from "./saveLoad";
import { trackAppAction, trackAppActionOnce, trackFileFailure } from "../analytics";
import { NEWER_SAVE_REFUSAL } from "./portLifecycle";

/**
 * The persistence failure signals of the 3.0 reliability gate (#1533): a save,
 * a load, an import or an export that fails reports its `app_action` code, and the
 * matching success reports nothing. The codes carry the fact only. The slot
 * and title-screen load paths are pinned in `appModals.test.ts`.
 */

vi.mock("../analytics", async (importActual) => {
  const actual = await importActual<typeof import("../analytics")>();
  return { ...actual, trackAppAction: vi.fn(), trackAppActionOnce: vi.fn(), trackFileFailure: vi.fn() };
});
vi.mock("./portLifecycle", async (importActual) => {
  const actual = await importActual<typeof import("./portLifecycle")>();
  return { ...actual, saveText: vi.fn(() => "SAVE TEXT") };
});

function makeLoad(port: Record<string, unknown> = {}, withNotice = true) {
  const ui = { toast: vi.fn(), sayVisibly: vi.fn(), showImportReport: vi.fn(), downloadFile: vi.fn(() => true) };
  const towerSwapped = vi.fn();
  const saveWarning = { show: vi.fn(), clear: vi.fn() };
  const deps = { ui, towerSwapped, enginePort: () => port, getView: () => null, saveWarning: withNotice ? saveWarning : undefined } as unknown as SaveLoadDeps;
  return { load: new SaveLoad(deps), ui, towerSwapped, saveWarning };
}

beforeEach(() => {
  vi.mocked(trackAppAction).mockClear();
  vi.mocked(trackAppActionOnce).mockClear();
  vi.mocked(trackFileFailure).mockClear();
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
    vi.spyOn(SaveGame, "save").mockReturnValue({ savedAt: 1, appVersion: "t" });
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

  it("tells the player once while autosave keeps failing, and again after it worked in between", async () => {
    const save = vi.spyOn(SaveGame, "saveAsync").mockRejectedValue(new DOMException("quota", "QuotaExceededError"));
    const { load, ui, saveWarning } = makeLoad();
    await load.autosave();
    await load.autosave();
    expect(saveWarning.show).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/private or incognito window/));
    expect(ui.toast).not.toHaveBeenCalled();

    save.mockResolvedValue(null);
    await load.autosave();
    expect(saveWarning.clear).toHaveBeenCalledTimes(1);
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith("Saving works again.", "good");
    save.mockRejectedValue(new DOMException("quota", "QuotaExceededError"));
    await load.autosave();
    expect(saveWarning.show).toHaveBeenCalledTimes(2);
  });

  it("falls back to one toast with the notice's headline when no notice surface is wired", async () => {
    vi.spyOn(SaveGame, "saveAsync").mockRejectedValue(new DOMException("quota", "QuotaExceededError"));
    const { load, ui } = makeLoad({}, false);
    await load.autosave();
    await load.autosave();
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^Your tower isn't being saved\. This browser won't let/), "bad");
  });

  it("keeps the failure notice for when the tab is visible again", async () => {
    vi.spyOn(SaveGame, "saveAsync").mockRejectedValue(new DOMException("quota", "QuotaExceededError"));
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const { load, saveWarning } = makeLoad();
    await load.autosave();
    expect(saveWarning.show).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    await load.autosave();
    expect(saveWarning.show).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it("toasts every failed Quick Save but raises the notice once, and a later good save takes it down", () => {
    const save = vi.spyOn(SaveGame, "save").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const { load, ui, saveWarning } = makeLoad();
    load.save();
    load.save();
    expect(ui.toast).toHaveBeenCalledTimes(2);
    expect(ui.toast).toHaveBeenNthCalledWith(2, expect.stringMatching(/^Save failed: storage is full or blocked/), "bad");
    expect(saveWarning.show).toHaveBeenCalledTimes(1);

    save.mockReturnValue({ savedAt: 1, appVersion: "t" });
    load.save();
    expect(saveWarning.clear).toHaveBeenCalledTimes(1);
    expect(ui.toast).toHaveBeenNthCalledWith(3, "Saving works again.", "good");
    expect(ui.toast).toHaveBeenLastCalledWith(expect.stringMatching(/^Saved ✓/), "good");
  });

  it("says nothing about saving working again to a player who was never told it failed", async () => {
    vi.spyOn(SaveGame, "saveAsync").mockResolvedValue(null);
    const { load, ui, saveWarning } = makeLoad();
    await load.autosave();
    expect(saveWarning.clear).not.toHaveBeenCalled();
    expect(ui.toast).not.toHaveBeenCalled();
  });

  it("words a failure that is not storage's own with its detail, still offering the export", async () => {
    vi.spyOn(SaveGame, "saveAsync").mockRejectedValue(new Error("deflate broke"));
    const { load, saveWarning } = makeLoad();
    await load.autosave();
    expect(saveWarning.show).toHaveBeenCalledExactlyOnceWith(
      "The game couldn't write its save (deflate broke). Export the tower to a file to keep it.",
    );
  });

  it("reports nothing when a periodic autosave works", async () => {
    vi.spyOn(SaveGame, "saveAsync").mockResolvedValue(null);
    const { load } = makeLoad();
    await load.autosave();
    expect(trackAppActionOnce).not.toHaveBeenCalled();
  });
});

describe("a refused import reports import_failed with its closed code (#2075)", () => {
  it("reports an unreadable .vctower as `save` with the engine's code, and a good one as nothing", async () => {
    const loadVctower = vi.fn(() => [0]);
    const bad = makeLoad({ loadVctower, lastReason: () => "not a tower", lastRefusalCode: () => "not_tower" });
    await bad.load.importGame("garbage");
    expect(loadVctower).toHaveBeenCalledExactlyOnceWith("garbage");
    expect(trackFileFailure).toHaveBeenCalledExactlyOnceWith("import_failed", "save", "not_tower");
    expect(bad.ui.sayVisibly).toHaveBeenCalledWith("Import failed: not a tower");

    vi.mocked(trackFileFailure).mockClear();
    const good = makeLoad({ loadVctower: () => [1] });
    await good.load.importGame("fine");
    expect(trackFileFailure).not.toHaveBeenCalled();
    expect(trackAppAction).not.toHaveBeenCalled();
    expect(good.towerSwapped).toHaveBeenCalledOnce();
  });

  it("reads a binary file's code too, sends a word this build does not know as `refused`, and a throw as `error`", async () => {
    const file = new Uint8Array([1]);
    const loadVctowerBytes = vi.fn(() => [0]);
    const bytes = makeLoad({ loadVctowerBytes, lastReason: () => "damaged", lastRefusalCode: vi.fn(() => "too_large") });
    await bytes.load.importGame(file);
    expect(loadVctowerBytes).toHaveBeenCalledExactlyOnceWith(file);
    expect(trackFileFailure).toHaveBeenLastCalledWith("import_failed", "save", "too_large");

    const loadVctower = vi.fn(() => [0]);
    const unknown = makeLoad({ loadVctower, lastReason: () => "no", lastRefusalCode: vi.fn(() => "some_new_word") });
    await unknown.load.importGame("text");
    expect(loadVctower).toHaveBeenCalledExactlyOnceWith("text");
    expect(trackFileFailure).toHaveBeenLastCalledWith("import_failed", "save", "refused");

    const lastRefusalCode = vi.fn(() => "damaged");
    const throwing = vi.fn(() => {
      throw new Error("memory access out of bounds");
    });
    const thrown = makeLoad({ loadVctower: throwing, lastRefusalCode });
    await thrown.load.importGame("x");
    expect(throwing).toHaveBeenCalledExactlyOnceWith("x");
    expect(lastRefusalCode).not.toHaveBeenCalled(); // a throw never reads a stale code
    expect(trackFileFailure).toHaveBeenLastCalledWith("import_failed", "save", "error");
    expect(trackFileFailure).toHaveBeenCalledTimes(3);
  });

  it("reports a refused .TDT as `tdt` with the engine's code", async () => {
    const loadTdt = vi.fn(() => [0]);
    const { load, ui } = makeLoad({ loadTdt, lastReason: () => "too small", lastRefusalCode: () => "unreadable" });
    await load.importLegacy(new ArrayBuffer(4), "tiny.TDT");
    expect(loadTdt).toHaveBeenCalledExactlyOnceWith(new Uint8Array(4), "tiny.TDT");
    expect(trackFileFailure).toHaveBeenCalledExactlyOnceWith("import_failed", "tdt", "unreadable");
    expect(ui.toast).toHaveBeenCalledWith("too small", "bad");
  });

  it("reports a .TDT reader that throws as `tdt` `error`, with the plain toast, never a stale reason or code", async () => {
    const loadTdt = vi.fn(() => {
      throw new Error("unreachable");
    });
    const lastReason = vi.fn(() => "a stale reason from an earlier file");
    const lastRefusalCode = vi.fn(() => "unreadable");
    const { load, ui } = makeLoad({ prepareTdt: vi.fn(() => Promise.resolve()), loadTdt, lastReason, lastRefusalCode });
    await load.importLegacy(new ArrayBuffer(4), "THROWS.TDT");
    expect(loadTdt).toHaveBeenCalledExactlyOnceWith(new Uint8Array(4), "THROWS.TDT");
    expect([lastReason.mock.calls.length, lastRefusalCode.mock.calls.length]).toEqual([0, 0]);
    expect(trackFileFailure).toHaveBeenCalledExactlyOnceWith("import_failed", "tdt", "error");
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith("This SimTower save couldn't be read.", "bad");
    expect(ui.showImportReport).not.toHaveBeenCalled();
  });

  it("reports a .TDT reader module that fails to load as `tdt` `error`, and never calls the reader", async () => {
    const prepareTdt = vi.fn(() => Promise.reject(new Error("chunk failed")));
    const loadTdt = vi.fn();
    const { load, ui } = makeLoad({ prepareTdt, loadTdt });
    await load.importLegacy(new ArrayBuffer(4), "OFFLINE.TDT");
    expect(prepareTdt).toHaveBeenCalledOnce();
    expect(loadTdt).not.toHaveBeenCalled();
    expect(trackFileFailure).toHaveBeenCalledExactlyOnceWith("import_failed", "tdt", "error");
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith("This SimTower save couldn't be read.", "bad");
  });
});

describe("an export that writes no file reports export_failed with its closed code (#1655, #2075)", () => {
  it("reports an engine that throws on a .vctower export as `save` `error`, a refusal with its code, and a good export as nothing", async () => {
    const bad = makeLoad({
      setCamera: () => {},
      exportVctowerBytes: () => {
        throw new Error("memory access out of bounds");
      },
      towerName: () => "Tower",
    });
    await bad.load.exportGame();
    expect(trackFileFailure).toHaveBeenCalledExactlyOnceWith("export_failed", "save", "error");
    expect(bad.ui.toast).toHaveBeenCalledWith("Export failed: memory access out of bounds", "bad");

    // The WASM binding can throw a bare string or null, not only an Error.
    for (const [thrown, line] of [
      ["trap", "Export failed: trap"],
      [null, "Export failed: null"],
    ] as const) {
      vi.mocked(trackFileFailure).mockClear();
      const odd = makeLoad({
        setCamera: () => {},
        exportVctowerBytes: () => {
          throw thrown;
        },
        towerName: () => "Tower",
      });
      await odd.load.exportGame();
      expect(trackFileFailure).toHaveBeenCalledExactlyOnceWith("export_failed", "save", "error");
      expect(odd.ui.toast).toHaveBeenCalledWith(line, "bad");
    }

    vi.mocked(trackFileFailure).mockClear();
    const exportVctowerBytes = vi.fn(() => undefined);
    const refused = makeLoad({
      setCamera: () => {},
      exportVctowerBytes,
      lastReason: () => "The build name reads as before 2.0.",
      lastRefusalCode: () => "refused",
      towerName: () => "Tower",
    });
    await refused.load.exportGame();
    expect(exportVctowerBytes).toHaveBeenCalledExactlyOnceWith(expect.any(String), expect.any(Number)); // the stamp's version and time
    expect(trackFileFailure).toHaveBeenCalledExactlyOnceWith("export_failed", "save", "refused");
    expect(refused.ui.toast).toHaveBeenCalledWith("Export failed: The build name reads as before 2.0.", "bad");

    vi.mocked(trackFileFailure).mockClear();
    const good = makeLoad({ setCamera: () => {}, exportVctowerBytes: () => new TextEncoder().encode("VCTOWER2\nabc"), towerName: () => "Tower" });
    await good.load.exportGame();
    expect(trackFileFailure).not.toHaveBeenCalled();
    expect(good.ui.downloadFile).toHaveBeenCalledOnce();
  });

  it("reports a refused .TDT export with its code, and a throwing or unloadable one as `error`", async () => {
    const tdtExport = vi.fn(() => [0]);
    const refused = makeLoad({ setCamera: () => {}, tdtExport, lastReason: () => "Modern towers cannot be exported.", lastRefusalCode: () => "modern" });
    await refused.load.exportLegacy();
    expect(tdtExport).toHaveBeenCalledExactlyOnceWith();
    expect(trackFileFailure).toHaveBeenCalledExactlyOnceWith("export_failed", "tdt", "modern");
    expect(refused.ui.sayVisibly).toHaveBeenCalledWith("Modern towers cannot be exported.");

    vi.mocked(trackFileFailure).mockClear();
    const thrown = makeLoad({
      setCamera: () => {},
      tdtExport: () => {
        throw new Error("out of memory");
      },
    });
    await thrown.load.exportLegacy();
    expect(trackFileFailure).toHaveBeenCalledExactlyOnceWith("export_failed", "tdt", "error");
    expect(thrown.ui.sayVisibly).toHaveBeenCalledWith("Export failed: out of memory");

    vi.mocked(trackFileFailure).mockClear();
    const unloaded = makeLoad({ prepareTdt: () => Promise.reject(new Error("Failed to fetch the codec")) });
    await unloaded.load.exportLegacy();
    expect(trackFileFailure).toHaveBeenCalledExactlyOnceWith("export_failed", "tdt", "error");
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
