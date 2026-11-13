import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveGame } from "../storage/SaveGame";
import { PortCodes } from "../simport/portCodes";
import { mockPort } from "../tests/portKit/mockPort";
import { isCrashed, isEngineStopped, isSplashUp } from "./interactionState";
import { adoptConfirmedLegacyImport } from "./legacyImportAdopt";
import { trackFileExported, trackFileImported, trackTdtImportRead } from "../analytics";
import { importFacts } from "../simport/tdtRecords";
import {
  RESUME_AFTER_RECOVERY_KEY,
  SaveLoad,
  type SaveLoadDeps,
} from "./saveLoad";

vi.mock("../analytics", async (importActual) => ({
  ...(await importActual<typeof import("../analytics")>()),
  trackAppAction: vi.fn(),
  trackAppActionOnce: vi.fn(),
  trackFileImported: vi.fn(),
  trackFileExported: vi.fn(),
  trackTdtImportRead: vi.fn(),
}));
vi.mock("./interactionState", () => ({
  isSplashUp: vi.fn(() => false),
  isEngineStopped: vi.fn(() => false),
  isCrashed: vi.fn(() => false),
}));
vi.mock("../ui/Onboarding", () => ({ shouldArm: vi.fn(() => true) }));
vi.mock("./legacyImportAdopt", () => ({ adoptConfirmedLegacyImport: vi.fn() }));
vi.mock("./exportFlow", async (importActual) => ({
  ...(await importActual<typeof import("./exportFlow")>()),
  runLegacyDownload: vi.fn(
    (_ui: unknown, download: () => void) => (download(), Promise.resolve()),
  ),
}));
vi.mock("../simport/tdtRecords", () => ({
  exportFacts: vi.fn(() => ({})),
  importFacts: vi.fn(() => ({})),
}));
vi.mock("../storage/tdtExportReport", () => ({
  exportReport: vi.fn(() => ({ filename: "TOWER.TDT" })),
}));
vi.mock("../storage/tdtImportReport", () => ({
  importReport: vi.fn(() => ({ towerName: "Old Tower" })),
}));

/**
 * The save shell's new-tower, pre-update and context-loss flows, and the
 * legacy file confirmations, over a mock port: the port calls each makes and
 * what it shows. The failure signals are `persistenceFailureEvents.test.ts`'s;
 * a real tower's save, load and founding are the integration suites' and the
 * engine's.
 */

const GENERATION = 5;
const HEADER = { mode: "classic", star: 3, population: 420 };

function setup(
  answers: Parameters<typeof mockPort>[0] = {},
  rooms: unknown[] = [],
) {
  const port = mockPort({
    serialize: () => "SAVE",
    generation: () => GENERATION,
    logLine: () => Float64Array.of(1, 0),
    lastReason: () => undefined,
    foundTower: () => Float64Array.of(1, 0),
    ...answers,
  });
  const codes = new PortCodes(port);
  const deps = {
    enginePort: () => port,
    portCodes: () => codes,
    reader: () => ({ rooms: rooms as never, structure: [] as never, header: HEADER as never }),
    towerSwapped: vi.fn(),
    getView: () => null,
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
  } satisfies SaveLoadDeps;
  return { port, codes, deps, saves: new SaveLoad(deps) };
}

type CrashInfo = Parameters<SaveLoadDeps["showCrashScreen"]>[0];

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(SaveGame, "save").mockImplementation(() => {});
  vi.spyOn(SaveGame, "hasSave").mockReturnValue(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(isSplashUp).mockReturnValue(false);
  vi.mocked(isEngineStopped).mockReturnValue(false);
  vi.mocked(isCrashed).mockReturnValue(false);
});

describe("SaveLoad.newGame", () => {
  it("founds the tower by mode and calendar code, follows it, cues the first lobby and arms onboarding for a first-timer", () => {
    const { saves, port, codes, deps } = setup();
    saves.newGame("modern", "realWorld", true);
    expect(port.foundTower).toHaveBeenCalledExactlyOnceWith(
      expect.any(Number),
      codes.code("modes", "modern"),
      codes.code("calendars", "realWorld"),
      true,
    );
    expect(deps.towerSwapped).toHaveBeenCalledOnce();
    expect(deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      "New tower founded. Lay a lobby on the ground line to open it.",
      "good",
    );
    expect(deps.armOnboarding).toHaveBeenCalledOnce();
  });

  it("a founded tower with rooms says good luck, and a returning player is not onboarded", () => {
    vi.mocked(SaveGame.hasSave).mockReturnValue(true);
    const { saves, deps } = setup({}, [{}]);
    saves.newGame();
    expect(deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      "New tower founded. Good luck!",
      "good",
    );
    expect(deps.armOnboarding).not.toHaveBeenCalled();
  });

  it("a refused founding throws the engine's reason and follows nothing", () => {
    const { saves, deps } = setup({
      foundTower: () => Float64Array.of(0, 0),
      lastReason: () => "No.",
    });
    expect(() => saves.newGame()).toThrow("No.");
    expect(deps.towerSwapped).not.toHaveBeenCalled();
  });
});

describe("SaveLoad.saveBeforeUpdate", () => {
  it("flushes the tower, except behind the splash", () => {
    const { saves, port } = setup();
    saves.saveBeforeUpdate();
    expect(SaveGame.save).toHaveBeenCalledExactlyOnceWith("SAVE");
    expect(port.serialize).toHaveBeenCalledOnce();
    vi.mocked(isSplashUp).mockReturnValue(true);
    saves.saveBeforeUpdate();
    expect(SaveGame.save).toHaveBeenCalledOnce();
  });
});

describe("SaveLoad.recoverFromContextLoss", () => {
  it("a first loss with a clean flush recovers in place and logs the trace in the same tower", () => {
    const { saves, port, codes, deps } = setup();
    saves.recoverFromContextLoss();
    expect(SaveGame.save).toHaveBeenCalledOnce();
    expect(deps.showCrashScreen).not.toHaveBeenCalled();
    expect(deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      "The device reset the game's graphics. Recovering...",
      "info",
    );
    const done = deps.attemptGraphicsRecovery.mock.calls[0][0] as (
      ok: boolean,
    ) => void;
    done(true);
    expect(port.logLine).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("Your tower was saved first."),
      codes.code("logKinds", "info"),
    );
    expect(deps.ui.toast).toHaveBeenLastCalledWith(
      "Graphics recovered. Your tower was saved.",
      "good",
    );
  });

  it("a recovery after a tower swap claims no save; one under a crash screen stays quiet", () => {
    let generation = GENERATION;
    const { saves, port, deps } = setup({ generation: () => generation });
    saves.recoverFromContextLoss();
    const done = deps.attemptGraphicsRecovery.mock.calls[0][0] as (
      ok: boolean,
    ) => void;
    generation += 1;
    done(true);
    expect(port.logLine).not.toHaveBeenCalled();
    expect(deps.ui.toast).toHaveBeenLastCalledWith(
      "Graphics recovered.",
      "good",
    );
    vi.mocked(isCrashed).mockReturnValue(true);
    done(true);
    expect(deps.ui.toast).toHaveBeenCalledTimes(2);
  });

  it("a failed recovery shows the crash screen, whose reload stamps the resume flag", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    try {
      const { saves, deps } = setup();
      saves.recoverFromContextLoss();
      (deps.attemptGraphicsRecovery.mock.calls[0][0] as (ok: boolean) => void)(
        false,
      );
      const info = deps.showCrashScreen.mock.calls[0][0] as CrashInfo;
      expect(info.crash).toMatchObject({
        kind: "webgl-context-lost",
        repeat: false,
        saveFlushed: true,
        recoveryFailed: true,
      });
      info.onReload();
      expect(sessionStorage.getItem(RESUME_AFTER_RECOVERY_KEY)).not.toBeNull();
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a second loss within 90 seconds is a repeat and goes straight to the crash screen", () => {
    const { saves, deps } = setup();
    saves.recoverFromContextLoss();
    saves.recoverFromContextLoss();
    expect(deps.attemptGraphicsRecovery).toHaveBeenCalledOnce();
    expect(
      (deps.showCrashScreen.mock.calls[0][0] as CrashInfo).crash.repeat,
    ).toBe(true);
  });

  it("a failed flush shows the screen with the storage blame and whether a prior save exists", () => {
    vi.mocked(SaveGame.save).mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    vi.mocked(SaveGame.hasSave).mockReturnValue(true);
    const { saves, deps } = setup();
    saves.recoverFromContextLoss();
    expect((deps.showCrashScreen.mock.calls[0][0] as CrashInfo).save).toEqual({
      flushed: false,
      behindSplash: false,
      storageBlame: true,
      hadPriorSave: true,
    });
  });

  it("behind the splash nothing is flushed and the screen says so; a stopped engine does nothing", () => {
    vi.mocked(isSplashUp).mockReturnValue(true);
    const { saves, deps } = setup();
    saves.recoverFromContextLoss();
    expect(SaveGame.save).not.toHaveBeenCalled();
    expect(
      (deps.showCrashScreen.mock.calls[0][0] as CrashInfo).crash.behindSplash,
    ).toBe(true);
    vi.mocked(isEngineStopped).mockReturnValue(true);
    const stopped = setup();
    stopped.saves.recoverFromContextLoss();
    expect(stopped.deps.showCrashScreen).not.toHaveBeenCalled();
  });
});

describe("SaveLoad legacy files", () => {
  it("the export report's download writes the engine's .TDT bytes", async () => {
    const bytes = Uint8Array.of(1, 2, 3);
    const { saves, deps } = setup({
      prepareTdt: () => Promise.resolve(),
      tdtExport: () => Float64Array.of(1, 0),
      tdtFile: () => bytes,
      towerName: () => "Spire",
    });
    await saves.exportLegacy();
    const [, cb] = deps.ui.showExportReport.mock.calls[0] as unknown as [
      unknown,
      { onDownload(): void },
    ];
    vi.mocked(deps.ui.downloadFile).mockReturnValueOnce(false);
    cb.onDownload();
    expect(trackFileExported, "a download the page could not start is not an export").not.toHaveBeenCalled();
    vi.mocked(deps.ui.downloadFile).mockReturnValueOnce(true);
    cb.onDownload();
    expect(deps.ui.downloadFile).toHaveBeenLastCalledWith("TOWER.TDT", bytes);
    expect(trackFileExported).toHaveBeenCalledExactlyOnceWith("tdt", expect.any(Function));
    expect(vi.mocked(trackFileExported).mock.calls[0][1]()).toBe(HEADER);
  });

  it("the import report's Open tower adopts through the confirmed flow, which re-stages the same file", async () => {
    const { saves, port, deps } = setup({
      prepareTdt: () => Promise.resolve(),
      loadTdt: () => Float64Array.of(1, 0),
    });
    const buffer = Uint8Array.of(9, 9).buffer;
    await saves.importLegacy(buffer, "OLD.TDT");
    expect(trackTdtImportRead, "the read is reported with the report's facts").toHaveBeenCalledExactlyOnceWith(
      vi.mocked(importFacts).mock.results[0].value,
    );
    const [, cb] = deps.ui.showImportReport.mock.calls[0] as unknown as [
      unknown,
      { onOpen(): void },
    ];
    cb.onOpen();
    const [, name, flush, restage] = vi.mocked(adoptConfirmedLegacyImport).mock
      .calls[0];
    expect(name).toBe("Old Tower");
    flush();
    expect(
      SaveGame.save,
      "the flush is the pre-update save",
    ).toHaveBeenCalledExactlyOnceWith("SAVE");
    restage();
    expect(port.loadTdt).toHaveBeenCalledTimes(2);
    expect(port.loadTdt).toHaveBeenLastCalledWith(
      new Uint8Array(buffer),
      "OLD.TDT",
    );
  });
});

describe("SaveLoad .vctower import", () => {
  it("reports the arrived tower once it is open, and nothing for a refused file", async () => {
    let answer = Float64Array.of(1, 0);
    const { saves, deps } = setup({ loadVctower: () => answer });
    await saves.importGame("VCTOWER1");
    expect(deps.towerSwapped).toHaveBeenCalledOnce();
    expect(trackFileImported).toHaveBeenCalledExactlyOnceWith("vctower", expect.any(Function));
    expect(vi.mocked(trackFileImported).mock.calls[0][1]()).toBe(HEADER);

    answer = Float64Array.of(0, 0);
    await saves.importGame("not a tower");
    expect(trackFileImported).toHaveBeenCalledOnce();
  });
});
