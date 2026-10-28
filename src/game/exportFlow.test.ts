import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Simulation } from "../engine/Simulation";
import { SaveGame } from "../storage/SaveGame";
import { runExportFlow, runLegacyDownload, resetExportFlowForTests, EXPORT_WATCHDOG_MS } from "./exportFlow";

/**
 * The export flow's single-flight latch and its watchdog (GH #760). A second
 * export fired while the first is still compressing must not stack a second
 * download, and a stuck export must not hold the latch forever.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** `downloadStarts` is what each download reports, in call order (default:
 *  every download starts). A `false` stands in for `UI.downloadFile` having
 *  already toasted its own failure. */
function fakeUi(downloadStarts: boolean[] = []) {
  const toasts: { text: string; kind: string }[] = [];
  // What reached the player through sayVisibly (which falls back to a toast in the real UI).
  const said: { text: string; kind: string }[] = [];
  const downloads: { filename: string; contents: string | Uint8Array }[] = [];
  return {
    toasts,
    said,
    downloads,
    ui: {
      sayVisibly: (text: string, kind?: string) => {
        said.push({ text, kind: kind ?? "bad" });
      },
      toast: (text: string, kind?: string) => {
        toasts.push({ text, kind: kind ?? "info" });
      },
      downloadFile: (filename: string, contents: string | Uint8Array): boolean => {
        downloads.push({ filename, contents });
        return downloadStarts.shift() ?? true;
      },
    },
  };
}

function flowDeps(ui: ReturnType<typeof fakeUi>["ui"], sim = Simulation.newGame(7)) {
  return { getSim: () => sim, ui };
}

/** The flow's save callback: the engine port's save of `sim` and its name. */
function saved(sim = Simulation.newGame(7)) {
  return () => ({ text: JSON.stringify(sim.serialize()), towerName: sim.tower.towerName });
}

const HUNG_TOAST = { text: "The export is not responding. You can try exporting again.", kind: "bad" };
// The size line for the 13-byte payload these tests mock into SaveGame.export
// ("VCTOWER1\nfake" rounds to 0.0 KB).
const LIVE_TOAST = { text: "Tower exported (0.0 KB). Check your downloads.", kind: "good" };
const LATE_TOAST = { text: "The earlier export finished after all (0.0 KB). Check your downloads.", kind: "good" };

beforeEach(() => {
  resetExportFlowForTests();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("export single-flight latch (GH #760)", () => {
  it("hands the player a real .vctower download and says how big it is", async () => {
    const { ui, toasts, downloads } = fakeUi();
    const sim = Simulation.newGame(7);
    await runExportFlow(flowDeps(ui, sim), saved(sim));
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.filename).toBe(SaveGame.exportFilename(sim.tower.towerName));
    const text = downloads[0]!.contents as string;
    expect(typeof text).toBe("string");
    // The file reads back as the same tower.
    const back = await SaveGame.import(text);
    expect(back.tower.towerName).toBe(sim.tower.towerName);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.kind).toBe("good");
    expect(toasts[0]!.text).toMatch(/^Tower exported \(\d+\.\d KB\)\. Check your downloads\.$/);
  });

  it("REGRESSION (GH #997): a download that failed gets no success toast, and the latch frees", async () => {
    vi.spyOn(SaveGame, "export").mockResolvedValue("VCTOWER1\nfake");
    const { ui, toasts, downloads } = fakeUi([false]);
    await runExportFlow(flowDeps(ui), saved());
    expect(downloads).toHaveLength(1);
    // UI.downloadFile already toasted the failure; the flow adds nothing.
    expect(toasts).toEqual([]);
    // The next export runs and succeeds normally.
    await runExportFlow(flowDeps(ui), saved());
    expect(downloads).toHaveLength(2);
    expect(toasts).toEqual([LIVE_TOAST]);
  });

  it("REGRESSION: a second export while the first is compressing is a quiet no-op", async () => {
    const gate = deferred<string>();
    const spy = vi.spyOn(SaveGame, "export").mockReturnValue(gate.promise);
    const { ui, toasts, downloads } = fakeUi();
    const first = runExportFlow(flowDeps(ui), saved());
    await runExportFlow(flowDeps(ui), saved());
    expect(spy).toHaveBeenCalledTimes(1);
    gate.resolve("VCTOWER1\nfake");
    await first;
    expect(downloads).toHaveLength(1);
    expect(toasts).toEqual([LIVE_TOAST]);
  });

  it("the latch releases on success and on failure, so the next export runs", async () => {
    const spy = vi.spyOn(SaveGame, "export").mockRejectedValueOnce(new Error("boom"));
    const { ui, toasts, downloads } = fakeUi();
    await runExportFlow(flowDeps(ui), saved());
    expect(toasts).toEqual([{ text: "Export failed: boom", kind: "bad" }]);
    spy.mockResolvedValue("VCTOWER1\nfake");
    await runExportFlow(flowDeps(ui), saved());
    await runExportFlow(flowDeps(ui), saved());
    expect(downloads).toHaveLength(2);
  });

  it("the latch releases when stamping the view throws, and the failure is said", async () => {
    const { ui, toasts } = fakeUi();
    await runExportFlow(flowDeps(ui), () => {
      throw new Error("context lost");
    });
    expect(toasts).toEqual([{ text: "Export failed: context lost", kind: "bad" }]);
    vi.spyOn(SaveGame, "export").mockResolvedValue("VCTOWER1\nfake");
    await runExportFlow(flowDeps(ui), saved());
    expect(toasts[toasts.length - 1]).toEqual(LIVE_TOAST);
  });

  it("stamps the camera before it serializes", async () => {
    const order: string[] = [];
    vi.spyOn(SaveGame, "export").mockImplementation(() => {
      order.push("export");
      return Promise.resolve("VCTOWER1\nfake");
    });
    const { ui } = fakeUi();
    await runExportFlow(flowDeps(ui), () => {
      order.push("stamp");
      return saved()();
    });
    expect(order).toEqual(["stamp", "export"]);
  });

  it("REGRESSION: the watchdog frees a latch held by a stuck export and says so", async () => {
    vi.useFakeTimers();
    vi.spyOn(SaveGame, "export").mockReturnValueOnce(new Promise<string>(() => {}));
    const { ui, toasts } = fakeUi();
    void runExportFlow(flowDeps(ui), saved());
    await vi.advanceTimersByTimeAsync(EXPORT_WATCHDOG_MS - 1);
    expect(toasts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(toasts).toEqual([HUNG_TOAST]);
  });

  it("REGRESSION: a late settle never unlocks the export that took over the latch", async () => {
    vi.useFakeTimers();
    const slow = deferred<string>();
    const retry = deferred<string>();
    vi.spyOn(SaveGame, "export").mockReturnValueOnce(slow.promise).mockReturnValueOnce(retry.promise);
    const { ui, toasts, downloads } = fakeUi();
    const first = runExportFlow(flowDeps(ui), saved());
    await vi.advanceTimersByTimeAsync(EXPORT_WATCHDOG_MS);
    const second = runExportFlow(flowDeps(ui), saved());
    // The first export lands late: its download still arrives, but the
    // retry still holds the latch, so a third attempt stays a no-op.
    slow.resolve("VCTOWER1\nfake");
    await first;
    await runExportFlow(flowDeps(ui), saved());
    expect(downloads).toHaveLength(1);
    retry.resolve("VCTOWER1\nfake");
    await second;
    expect(downloads).toHaveLength(2);
    expect(toasts).toEqual([HUNG_TOAST, LATE_TOAST, LIVE_TOAST]);
  });

  it("REGRESSION (GH #997): an export that settles after the watchdog says it finished after all", async () => {
    vi.useFakeTimers();
    const slow = deferred<string>();
    vi.spyOn(SaveGame, "export").mockReturnValueOnce(slow.promise);
    const { ui, toasts, downloads } = fakeUi();
    const run = runExportFlow(flowDeps(ui), saved());
    await vi.advanceTimersByTimeAsync(EXPORT_WATCHDOG_MS);
    slow.resolve("VCTOWER1\nfake");
    await run;
    expect(downloads).toHaveLength(1);
    expect(toasts).toEqual([HUNG_TOAST, LATE_TOAST]);
  });

  it("a late settle whose download fails ends on the failure alone, with no success line", async () => {
    vi.useFakeTimers();
    const slow = deferred<string>();
    vi.spyOn(SaveGame, "export").mockReturnValueOnce(slow.promise);
    const { ui, toasts, downloads } = fakeUi([false]);
    const run = runExportFlow(flowDeps(ui), saved());
    await vi.advanceTimersByTimeAsync(EXPORT_WATCHDOG_MS);
    slow.resolve("VCTOWER1\nfake");
    await run;
    expect(downloads).toHaveLength(1);
    // The fake stands in for UI.downloadFile, which has already toasted its failure.
    expect(toasts).toEqual([HUNG_TOAST]);
  });
});

describe("legacy (.TDT) download shares the export latch (GH #760 follow-on)", () => {
  it("REGRESSION: a second legacy download while the first is open runs nothing, and the latch frees on settle", async () => {
    const { ui, toasts, said } = fakeUi();
    const gate = deferred<void>();
    let downloads = 0;
    const dl = () => {
      downloads++;
      return gate.promise;
    };
    const first = runLegacyDownload(ui, dl);
    // A second legacy export fired while the first is still settling: no second
    // download, and no message, since the player's own download is the one running.
    expect(await runLegacyDownload(ui, dl)).toBe(false);
    expect(downloads).toBe(1);
    expect(said).toEqual([]);
    expect(toasts).toEqual([]);
    gate.resolve();
    expect(await first).toBe(true);
    // Latch freed on settle: the next legacy download runs.
    await runLegacyDownload(ui, () => {
      downloads++;
      return Promise.resolve();
    });
    expect(downloads).toBe(2);
  });

  it("REGRESSION (GH #1012): a .TDT download clicked while a .vctower export runs says why nothing happened", async () => {
    const slow = deferred<string>();
    vi.spyOn(SaveGame, "export").mockReturnValueOnce(slow.promise);
    const { ui, toasts, said, downloads } = fakeUi();
    const vctower = runExportFlow(flowDeps(ui), saved());
    let legacy = 0;
    const ran = await runLegacyDownload(ui, () => {
      legacy++;
    });
    expect(ran).toBe(false);
    expect(legacy).toBe(0);
    // Through sayVisibly: closing the report dialog can reopen a queued one over a plain toast.
    expect(said).toEqual([{ text: "Another export is still running. Try again when it finishes.", kind: "info" }]);
    // The .vctower export that held the latch still finishes and announces itself.
    slow.resolve("VCTOWER1\nfake");
    await vctower;
    expect(downloads).toHaveLength(1);
    expect(toasts).toEqual([LIVE_TOAST]);
  });

  it("a legacy download and a .vctower export are mutually exclusive on the shared latch", async () => {
    const { ui, downloads, said } = fakeUi();
    const gate = deferred<void>();
    let legacy = 0;
    const held = runLegacyDownload(ui, () => {
      legacy++;
      return gate.promise;
    });
    // A .vctower export fired while the legacy download holds the latch bails
    // before it serializes or opens anything.
    await runExportFlow(flowDeps(ui), saved());
    expect(legacy).toBe(1);
    expect(downloads).toEqual([]);
    // ...and quietly: the #1012 message is only for a .TDT click.
    expect(said).toEqual([]);
    gate.resolve();
    await held;
  });

  it("the watchdog frees a latch held by a hung legacy download and says so", async () => {
    vi.useFakeTimers();
    const { ui, toasts } = fakeUi();
    void runLegacyDownload(ui, () => new Promise<void>(() => {})); // never settles
    await vi.advanceTimersByTimeAsync(EXPORT_WATCHDOG_MS + 1);
    expect(toasts).toEqual([{ text: "The export is not responding. You can try exporting again.", kind: "bad" }]);
    // The freed latch lets a fresh legacy download run.
    let ran = false;
    await runLegacyDownload(ui, () => {
      ran = true;
      return Promise.resolve();
    });
    expect(ran).toBe(true);
  });
});
