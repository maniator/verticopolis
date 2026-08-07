import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Simulation } from "../engine/Simulation";
import type { SaveStorePort } from "../platform/saveStore";
import { LOCAL, fakeStore } from "./desktopSaveStore.fixture";

/**
 * The export flow's single-flight latch and its watchdog (GH #760). The
 * desktop contract makes the shell's save dialog window-modal, but a macOS
 * app menu (or a nonconforming shell) can fire Export mid-dialog, and a hung
 * `exportRecord` bridge must not hold the latch forever. The `vi.mock`
 * preamble is repeated here because vi.mock is file-scoped and hoisted; the
 * fixture module carries everything shareable.
 */

let injectedStore: SaveStorePort | undefined;

vi.mock("../platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform")>()),
  IS_WRAPPED_BUILD: true,
  getPlatform: () => ({
    isNativeWrapper: true,
    saveFile: () => Promise.resolve(),
    openExternal: () => {},
    get saveStore() {
      return injectedStore;
    },
  }),
}));

const { prepareSaveStore, resetSaveStoreForTests } = await import("./desktopSaveStore");
const { resetManualSaveForTests } = await import("./manualSavePersist");
const { runExportFlow, resetExportFlowForTests, EXPORT_WATCHDOG_MS } = await import("./exportFlow");

const SHARED = [{ token: LOCAL, label: "This computer", shared: true }];

/** A store whose flush succeeds and whose exportRecord the test controls. */
function storeWithExport(exportRecord: SaveStorePort["exportRecord"]) {
  const store = fakeStore(SHARED);
  store.port.writeSync = (id, contents, scope) => {
    store.held.set(`${scope}|${id}`, contents);
    return { ok: true };
  };
  store.port.exportRecord = exportRecord;
  return store;
}

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
  const downloads: string[] = [];
  return {
    toasts,
    downloads,
    ui: {
      toast: (text: string, kind?: string) => {
        toasts.push({ text, kind: kind ?? "info" });
      },
      downloadFile: (filename: string) => {
        downloads.push(filename);
      },
    },
  };
}

function flowDeps(ui: ReturnType<typeof fakeUi>["ui"], sim = Simulation.newGame(7)) {
  return { getSim: () => sim, ui };
}

const HUNG_TOAST = { text: "The export is not responding. You can try exporting again.", kind: "bad" };
const STORED_TOAST = { text: "Tower exported. Check where you saved it.", kind: "good" };

beforeEach(() => {
  resetSaveStoreForTests();
  resetManualSaveForTests();
  resetExportFlowForTests();
  injectedStore = undefined;
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("export single-flight latch (GH #760)", () => {
  it("REGRESSION: a second export while the dialog is open is a quiet no-op", async () => {
    const gate = deferred<boolean>();
    let dialogs = 0;
    const store = storeWithExport(() => {
      dialogs++;
      return gate.promise;
    });
    injectedStore = store.port;
    await prepareSaveStore();
    const { ui, toasts } = fakeUi();
    const deps = flowDeps(ui);

    const first = runExportFlow(deps, () => {});
    // The macOS-menu path: Export fires again while the dialog sits open. No
    // second flush-plus-dialog, and no toast competing with the open dialog.
    await runExportFlow(deps, () => {});
    expect(dialogs).toBe(1);
    expect(toasts).toEqual([]);

    gate.resolve(true);
    await first;
    expect(dialogs).toBe(1);
    expect(toasts).toEqual([STORED_TOAST]);
  });

  it("the latch releases on success, cancel, and failure, so the next export runs", async () => {
    const outcomes = [Promise.resolve(true), Promise.resolve(false)];
    let dialogs = 0;
    const store = storeWithExport(() => {
      dialogs++;
      return outcomes.shift() ?? Promise.resolve(true);
    });
    injectedStore = store.port;
    await prepareSaveStore();
    const { ui, toasts } = fakeUi();
    const deps = flowDeps(ui);

    await runExportFlow(deps, () => {}); // success
    await runExportFlow(deps, () => {}); // canceled: says nothing, opens nothing else
    await runExportFlow(deps, () => {}); // and the latch freed again
    expect(dialogs).toBe(3);
    expect(toasts).toEqual([STORED_TOAST, STORED_TOAST]);
  });

  it("the latch releases when the flow itself throws (the failure toast path)", async () => {
    // No store this session, so the live-serialize path runs; its throw must
    // free the latch the same as a settle.
    const { SaveGame } = await import("../storage/SaveGame");
    const spy = vi.spyOn(SaveGame, "export").mockRejectedValueOnce(new Error("no compressor"));
    const { ui, toasts, downloads } = fakeUi();
    const deps = flowDeps(ui);

    await runExportFlow(deps, () => {});
    expect(toasts).toEqual([{ text: "Export failed: no compressor", kind: "bad" }]);

    await runExportFlow(deps, () => {});
    expect(downloads).toHaveLength(1);
    spy.mockRestore();
  });

  it("REGRESSION: the watchdog frees a latch held by a hung bridge and says so", async () => {
    let dialogs = 0;
    const store = storeWithExport(() => {
      dialogs++;
      return new Promise<boolean>(() => {}); // the bridge never answers
    });
    injectedStore = store.port;
    await prepareSaveStore();
    vi.useFakeTimers();
    const { ui, toasts } = fakeUi();
    const deps = flowDeps(ui);

    void runExportFlow(deps, () => {});
    await vi.advanceTimersByTimeAsync(EXPORT_WATCHDOG_MS - 1);
    expect(toasts).toEqual([]); // a long dialog session is not a hang
    await vi.advanceTimersByTimeAsync(1);
    expect(toasts).toEqual([HUNG_TOAST]);

    // The whole point of the watchdog: Export is not bricked for the session.
    void runExportFlow(deps, () => {});
    expect(dialogs).toBe(2);
  });

  it("a dialog that settles late, after the watchdog, still completes exactly once", async () => {
    const gate = deferred<boolean>();
    const store = storeWithExport(() => gate.promise);
    injectedStore = store.port;
    await prepareSaveStore();
    vi.useFakeTimers();
    const { ui, toasts } = fakeUi();
    const deps = flowDeps(ui);

    const first = runExportFlow(deps, () => {});
    await vi.advanceTimersByTimeAsync(EXPORT_WATCHDOG_MS);
    expect(toasts).toEqual([HUNG_TOAST]);

    // The bridge finally answers: the file WAS written, so the success toast
    // is honest, and it lands once (the watchdog never fires again).
    gate.resolve(true);
    await first;
    await vi.advanceTimersByTimeAsync(EXPORT_WATCHDOG_MS * 2);
    expect(toasts).toEqual([HUNG_TOAST, STORED_TOAST]);
  });

  it("REGRESSION: a late fallback never runs the live path, only an owned one does", async () => {
    // The hung bridge finally REJECTS after the watchdog freed the latch.
    // exportStoredTower maps the rejection to "fallback", and pre-fix the
    // flow then ran the live path: a download (or on a wrapped shell a
    // second saveFile dialog) landing minutes late, possibly on top of a
    // retry's open dialog. The run no longer owns the latch, so it stops.
    const gate = deferred<boolean>();
    const store = storeWithExport(() => gate.promise);
    injectedStore = store.port;
    await prepareSaveStore();
    vi.useFakeTimers();
    const { ui, toasts, downloads } = fakeUi();
    const deps = flowDeps(ui);

    const first = runExportFlow(deps, () => {});
    await vi.advanceTimersByTimeAsync(EXPORT_WATCHDOG_MS);
    expect(toasts).toEqual([HUNG_TOAST]);

    gate.reject(new Error("bridge died"));
    await first;
    expect(downloads).toEqual([]);
    expect(toasts).toEqual([HUNG_TOAST]);
  });

  it("REGRESSION: a late fallback stays suppressed while a retry holds the latch", async () => {
    // The worst case the bail exists for, and the one that separates the
    // correct `latchOwner !== run` from a lazy `latchOwner === 0` (which
    // survived every other test here): run1's bridge rejects AFTER run2 took
    // the latch, so the latch is nonzero but not run1's. The live path must
    // still not run, or its dialog lands on top of run2's open one.
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const gates = [first, second];
    let dialogs = 0;
    const store = storeWithExport(() => {
      dialogs++;
      return gates.shift()!.promise;
    });
    injectedStore = store.port;
    await prepareSaveStore();
    vi.useFakeTimers();
    const { ui, toasts, downloads } = fakeUi();
    const deps = flowDeps(ui);

    const run1 = runExportFlow(deps, () => {});
    await vi.advanceTimersByTimeAsync(EXPORT_WATCHDOG_MS);
    const run2 = runExportFlow(deps, () => {});
    expect(dialogs).toBe(2);

    first.reject(new Error("bridge died"));
    await run1;
    expect(downloads).toEqual([]);
    expect(dialogs).toBe(2);

    second.resolve(true);
    await run2;
    expect(toasts).toEqual([HUNG_TOAST, STORED_TOAST]);
  });

  it("an immediate fallback still owns the latch and hands the player a live file", async () => {
    // The bail above must not overreach: a malformed exportRecord answer
    // resolves NOW, the run still owns the latch, and the party's rule
    // (fall back to live, never refuse the export) holds unchanged.
    const store = storeWithExport(() => Promise.resolve(undefined as unknown as boolean));
    injectedStore = store.port;
    await prepareSaveStore();
    const { ui, downloads } = fakeUi();
    const deps = flowDeps(ui);

    await runExportFlow(deps, () => {});
    expect(downloads).toHaveLength(1);
  });

  it("REGRESSION: the stored-byte flush carries the camera stamped at export time", async () => {
    // The stamp-before-flush order lives only in this flow (a party catch:
    // dropping it exports towers at a stale view), and a reorder mutation
    // survived the whole suite before this test. Decode the bytes the flush
    // committed and require the camera the stamp wrote at export time.
    const { SaveGame } = await import("../storage/SaveGame");
    const store = storeWithExport(() => Promise.resolve(true));
    injectedStore = store.port;
    await prepareSaveStore();
    const { ui } = fakeUi();
    const sim = Simulation.newGame(7);

    await runExportFlow(flowDeps(ui, sim), (s) => {
      s.view = { tile: 123, floor: 45, zoom: 2 };
    });
    const flushed = [...store.held.entries()].find(([key]) => key.endsWith("|auto"))?.[1];
    expect(flushed).toBeDefined();
    const decoded = await SaveGame.import(flushed!);
    expect(decoded.view).toEqual({ tile: 123, floor: 45, zoom: 2 });
  });

  it("REGRESSION: a late settle never unlocks the export that took over the latch", async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const gates = [first, second];
    let dialogs = 0;
    const store = storeWithExport(() => {
      dialogs++;
      return gates.shift()!.promise;
    });
    injectedStore = store.port;
    await prepareSaveStore();
    vi.useFakeTimers();
    const { ui, toasts } = fakeUi();
    const deps = flowDeps(ui);

    const run1 = runExportFlow(deps, () => {});
    await vi.advanceTimersByTimeAsync(EXPORT_WATCHDOG_MS);
    const run2 = runExportFlow(deps, () => {});
    expect(dialogs).toBe(2);

    // The hung dialog settles as a cancel while the retry's dialog is open:
    // it must say nothing AND must not free the retry's latch.
    first.resolve(false);
    await run1;
    void runExportFlow(deps, () => {});
    expect(dialogs).toBe(2);

    second.resolve(true);
    await run2;
    expect(toasts).toEqual([HUNG_TOAST, STORED_TOAST]);
  });
});
