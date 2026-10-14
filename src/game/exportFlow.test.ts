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

function fakeUi() {
  const toasts: { text: string; kind: string }[] = [];
  const downloads: { filename: string; contents: string | Uint8Array }[] = [];
  return {
    toasts,
    downloads,
    ui: {
      toast: (text: string, kind?: string) => {
        toasts.push({ text, kind: kind ?? "info" });
      },
      downloadFile: (filename: string, contents: string | Uint8Array): void => {
        downloads.push({ filename, contents });
      },
    },
  };
}

function flowDeps(ui: ReturnType<typeof fakeUi>["ui"], sim = Simulation.newGame(7)) {
  return { getSim: () => sim, ui };
}

const HUNG_TOAST = { text: "The export is not responding. You can try exporting again.", kind: "bad" };
// The size line for the 13-byte payload these tests mock into SaveGame.export
// ("VCTOWER1\nfake" rounds to 0.0 KB).
const LIVE_TOAST = { text: "Tower exported (0.0 KB). Check your downloads.", kind: "good" };

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
    await runExportFlow(flowDeps(ui, sim), () => {});
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.filename).toBe(SaveGame.exportFilename(sim));
    const text = downloads[0]!.contents as string;
    expect(typeof text).toBe("string");
    // The file reads back as the same tower.
    const back = await SaveGame.import(text);
    expect(back.tower.towerName).toBe(sim.tower.towerName);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.kind).toBe("good");
    expect(toasts[0]!.text).toMatch(/^Tower exported \(\d+\.\d KB\)\. Check your downloads\.$/);
  });

  it("REGRESSION: a second export while the first is compressing is a quiet no-op", async () => {
    const gate = deferred<string>();
    const spy = vi.spyOn(SaveGame, "export").mockReturnValue(gate.promise);
    const { ui, toasts, downloads } = fakeUi();
    const first = runExportFlow(flowDeps(ui), () => {});
    await runExportFlow(flowDeps(ui), () => {});
    expect(spy).toHaveBeenCalledTimes(1);
    gate.resolve("VCTOWER1\nfake");
    await first;
    expect(downloads).toHaveLength(1);
    expect(toasts).toEqual([LIVE_TOAST]);
  });

  it("the latch releases on success and on failure, so the next export runs", async () => {
    const spy = vi.spyOn(SaveGame, "export").mockRejectedValueOnce(new Error("boom"));
    const { ui, toasts, downloads } = fakeUi();
    await runExportFlow(flowDeps(ui), () => {});
    expect(toasts).toEqual([{ text: "Export failed: boom", kind: "bad" }]);
    spy.mockResolvedValue("VCTOWER1\nfake");
    await runExportFlow(flowDeps(ui), () => {});
    await runExportFlow(flowDeps(ui), () => {});
    expect(downloads).toHaveLength(2);
  });

  it("the latch releases when stamping the view throws, and the failure is said", async () => {
    const { ui, toasts } = fakeUi();
    await runExportFlow(flowDeps(ui), () => {
      throw new Error("context lost");
    });
    expect(toasts).toEqual([{ text: "Export failed: context lost", kind: "bad" }]);
    vi.spyOn(SaveGame, "export").mockResolvedValue("VCTOWER1\nfake");
    await runExportFlow(flowDeps(ui), () => {});
    expect(toasts[toasts.length - 1]).toEqual(LIVE_TOAST);
  });

  it("stamps the camera before it serializes", async () => {
    const order: string[] = [];
    vi.spyOn(SaveGame, "export").mockImplementation(() => {
      order.push("export");
      return Promise.resolve("VCTOWER1\nfake");
    });
    const { ui } = fakeUi();
    await runExportFlow(flowDeps(ui), () => order.push("stamp"));
    expect(order).toEqual(["stamp", "export"]);
  });

  it("REGRESSION: the watchdog frees a latch held by a stuck export and says so", async () => {
    vi.useFakeTimers();
    vi.spyOn(SaveGame, "export").mockReturnValueOnce(new Promise<string>(() => {}));
    const { ui, toasts } = fakeUi();
    void runExportFlow(flowDeps(ui), () => {});
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
    const first = runExportFlow(flowDeps(ui), () => {});
    await vi.advanceTimersByTimeAsync(EXPORT_WATCHDOG_MS);
    const second = runExportFlow(flowDeps(ui), () => {});
    // The first export lands late: its download still arrives, but the
    // retry still holds the latch, so a third attempt stays a no-op.
    slow.resolve("VCTOWER1\nfake");
    await first;
    await runExportFlow(flowDeps(ui), () => {});
    expect(downloads).toHaveLength(1);
    retry.resolve("VCTOWER1\nfake");
    await second;
    expect(downloads).toHaveLength(2);
    expect(toasts).toEqual([HUNG_TOAST, LIVE_TOAST, LIVE_TOAST]);
  });
});

describe("legacy (.TDT) download shares the export latch (GH #760 follow-on)", () => {
  it("REGRESSION: a second legacy download while the first is open is a quiet no-op, and the latch frees on settle", async () => {
    const { ui } = fakeUi();
    const gate = deferred<void>();
    let downloads = 0;
    const dl = () => {
      downloads++;
      return gate.promise;
    };
    const first = runLegacyDownload(ui, dl);
    // A second legacy export fired while the first is still settling: no second download.
    await runLegacyDownload(ui, dl);
    expect(downloads).toBe(1);
    gate.resolve();
    await first;
    // Latch freed on settle: the next legacy download runs.
    await runLegacyDownload(ui, () => {
      downloads++;
      return Promise.resolve();
    });
    expect(downloads).toBe(2);
  });

  it("a legacy download and a .vctower export are mutually exclusive on the shared latch", async () => {
    const { ui, downloads } = fakeUi();
    const gate = deferred<void>();
    let legacy = 0;
    const held = runLegacyDownload(ui, () => {
      legacy++;
      return gate.promise;
    });
    // A .vctower export fired while the legacy download holds the latch bails
    // before it serializes or opens anything.
    await runExportFlow(flowDeps(ui), () => {});
    expect(legacy).toBe(1);
    expect(downloads).toEqual([]);
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

describe("runExportFlow with an engine host that settles", () => {
  afterEach(() => {
    resetExportFlowForTests();
  });

  it("settles first, then exports the tower the app holds after the wait", async () => {
    const { setStepGate } = await import("../wasmhost/stepGate");
    const { ui, downloads } = fakeUi();
    const first = Simulation.newGame(7);
    const second = Simulation.newGame(8);
    second.tower.towerName = "Adopted During The Wait";
    let held = first;
    const settled: Simulation[] = [];
    // The first tower's settle adopts the second, as a load during the wait would.
    setStepGate(first, { canStep: () => true, flush: () => {}, settle: async () => { settled.push(first); held = second; } });
    setStepGate(second, { canStep: () => true, flush: () => {}, settle: async () => { settled.push(second); } });
    const stamped: Simulation[] = [];
    await runExportFlow({ getSim: () => held, ui }, (sim) => stamped.push(sim));
    expect(settled).toEqual([first, second]);
    expect(stamped).toEqual([second]);
    expect(downloads).toHaveLength(1);
    expect(downloads[0].filename).toMatch(/adopted-during-the-wait/);
    setStepGate(first, null);
    setStepGate(second, null);
  });
});
