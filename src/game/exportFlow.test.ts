import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SaveGame } from "../storage/SaveGame";
import { runExportFlow } from "./exportFlow";
import { ExportRefused } from "./portLifecycle";
import { trackFileExported, trackFileFailure } from "../analytics";

vi.mock("../analytics", async (importActual) => ({
  ...(await importActual<typeof import("../analytics")>()),
  trackFileExported: vi.fn(),
  trackFileFailure: vi.fn(),
}));

/**
 * The .vctower export flow: the engine's file under the tower's name, the size
 * line, and the analytics for a download that started or an export that
 * failed. The flow is synchronous (#1655), so each run finishes before the next.
 */

/** `downloadStarts` is what each download reports, in call order (default:
 *  every download starts). A `false` stands in for `UI.downloadFile` having
 *  already toasted its own failure. */
function fakeUi(downloadStarts: boolean[] = [], onDownload: () => void = () => {}) {
  const toasts: { text: string; kind: string }[] = [];
  const downloads: { filename: string; contents: string | Uint8Array }[] = [];
  return {
    toasts,
    downloads,
    ui: {
      toast: (text: string, kind?: string) => {
        toasts.push({ text, kind: kind ?? "info" });
      },
      downloadFile: (filename: string, contents: string | Uint8Array): boolean => {
        downloads.push({ filename, contents });
        onDownload();
        return downloadStarts.shift() ?? true;
      },
    },
  };
}

const HEADER = { mode: "modern", star: 2, population: 90 };

function flowDeps(ui: ReturnType<typeof fakeUi>["ui"]) {
  return { ui, reader: () => ({ header: HEADER as never }) };
}

const FAKE_FILE = "VCTOWER1\nfake";

/** The flow's save callback: the engine's `.vctower` file and the tower's
 *  name. Whether the engine's file reads back as the same tower is checked on
 *  the Rust engine in `src/tests/integration/saveRepair.integration.test.ts`. */
function saved(file: string | Uint8Array = FAKE_FILE, towerName = "Tower Seven") {
  return () => ({ file, towerName });
}

// The size line for the 13-byte file these tests save
// ("VCTOWER1\nfake" rounds to 0.0 KB).
const LIVE_TOAST = { text: "Tower exported (0.0 KB). Check your downloads.", kind: "good" };

beforeEach(() => {
  vi.mocked(trackFileExported).mockClear();
  vi.mocked(trackFileFailure).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe(".vctower export flow", () => {
  it("hands the player the engine's file under the tower's name, and says how big it is", () => {
    const { ui, toasts, downloads } = fakeUi();
    const file = "VCTOWER1\n" + "x".repeat(2048 - 9);
    runExportFlow(flowDeps(ui), saved(file, "Skyline One"));
    expect(downloads).toEqual([{ filename: SaveGame.exportFilename("Skyline One"), contents: file }]);
    expect(toasts).toEqual([{ text: "Tower exported (2.0 KB). Check your downloads.", kind: "good" }]);
  });

  it("sizes a binary file by its bytes", () => {
    const { ui, toasts, downloads } = fakeUi();
    const file = new Uint8Array(3072);
    runExportFlow(flowDeps(ui), saved(file));
    expect(downloads[0]!.contents).toBe(file);
    expect(toasts).toEqual([{ text: "Tower exported (3.0 KB). Check your downloads.", kind: "good" }]);
  });

  it("reports a .vctower export once the download starts, and not for one that failed", () => {
    const { ui } = fakeUi([false, true]);
    runExportFlow(flowDeps(ui), saved());
    expect(trackFileExported).not.toHaveBeenCalled();
    runExportFlow(flowDeps(ui), saved());
    expect(trackFileExported).toHaveBeenCalledExactlyOnceWith("vctower", expect.any(Function));
    expect(vi.mocked(trackFileExported).mock.calls[0][1]()).toEqual(HEADER);
  });

  it("reports the header the file was written from, even when the tower moves on during the download", () => {
    let header = HEADER;
    const { ui } = fakeUi([true], () => {
      header = { ...HEADER, population: 9999 };
    });
    runExportFlow({ ui, reader: () => ({ header: header as never }) }, saved());
    expect(vi.mocked(trackFileExported).mock.calls[0][1]()).toEqual(HEADER);
  });

  it("REGRESSION (GH #997): a download that failed gets no success toast, and the next export still runs", () => {
    const { ui, toasts, downloads } = fakeUi([false]);
    runExportFlow(flowDeps(ui), saved());
    expect(downloads).toHaveLength(1);
    // UI.downloadFile already toasted the failure; the flow adds nothing.
    expect(toasts).toEqual([]);
    runExportFlow(flowDeps(ui), saved());
    expect(downloads).toHaveLength(2);
    expect(toasts).toEqual([LIVE_TOAST]);
  });

  it("says an engine refusal and reports its closed code (#2075)", () => {
    const { ui, toasts, downloads } = fakeUi();
    runExportFlow(flowDeps(ui), () => {
      throw new ExportRefused("The tower is too large to export.", "too_large");
    });
    expect(downloads).toEqual([]);
    expect(toasts).toEqual([{ text: "Export failed: The tower is too large to export.", kind: "bad" }]);
    expect(trackFileFailure).toHaveBeenCalledExactlyOnceWith("export_failed", "save", "too_large");
    expect(trackFileExported).not.toHaveBeenCalled();
  });

  it("says a throw while stamping the view, reports it as an error, and the next export runs", () => {
    const { ui, toasts } = fakeUi();
    runExportFlow(flowDeps(ui), () => {
      throw new Error("context lost");
    });
    expect(toasts).toEqual([{ text: "Export failed: context lost", kind: "bad" }]);
    expect(trackFileFailure).toHaveBeenCalledExactlyOnceWith("export_failed", "save", "error");
    runExportFlow(flowDeps(ui), saved());
    expect(toasts[toasts.length - 1]).toEqual(LIVE_TOAST);
  });
});
