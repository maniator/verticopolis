import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Simulation } from "../engine/Simulation";
import type { SaveStorePort } from "../platform/saveStore";
import {
  HUNG_TOAST,
  LATE_STORED_TOAST,
  LIVE_TOAST,
  STORED_TOAST,
  deferred,
  fakeUi,
  flowDeps,
  storeWithExport,
} from "./exportFlow.fixture";

/**
 * The export flow's single-flight latch and its watchdog (GH #760). The
 * desktop contract makes the shell's save dialog window-modal, but a macOS
 * app menu (or a nonconforming shell) can fire Export mid-dialog, and a hung
 * `exportRecord` bridge must not hold the latch forever. The `vi.mock`
 * preamble is repeated here because vi.mock is file-scoped and hoisted;
 * `exportFlow.fixture` carries everything shareable. The late-success wording
 * these tests drive past lives in `exportLateToast.test.ts` (GH #774).
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
    // is honest, and it lands once (the watchdog never fires again). Its
    // wording is the late one (GH #774), which the suite below covers; what
    // this test still owns is the exactly-once part.
    gate.resolve(true);
    await first;
    await vi.advanceTimersByTimeAsync(EXPORT_WATCHDOG_MS * 2);
    expect(toasts).toEqual([HUNG_TOAST, LATE_STORED_TOAST]);
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

describe("wrapped fallback dialog (GH #773)", () => {
  // No store in these tests, so the flow falls back to the live path, which on
  // a wrapped session routes downloadFile to the shell's saveFile dialog.

  it("REGRESSION: the latch spans the shell's saveFile dialog on the live fallback", async () => {
    const { SaveGame } = await import("../storage/SaveGame");
    const spy = vi.spyOn(SaveGame, "export").mockResolvedValue("VCTOWER1\nfake");
    const gate = deferred<void>();
    const { ui, toasts, downloads } = fakeUi([gate.promise]);
    const deps = flowDeps(ui);

    const first = runExportFlow(deps, () => {});
    await vi.waitFor(() => expect(downloads).toHaveLength(1));

    // Reentry while the dialog sits open: pre-fix, downloadFile was
    // fire-and-forget, so the latch had already released and this stacked a
    // second flush plus a second dialog (the #760 collision, back again).
    await runExportFlow(deps, () => {});
    expect(downloads).toHaveLength(1);

    // The size toast keeps its pre-settle timing: the port contract resolves
    // saveFile identically for a written file and a canceled dialog
    // (types.ts, cancel is not an error), so a post-settle toast could not be
    // more honest about cancel, only later. The residual is that a cancel
    // still gets this toast; pinned so a port contract change that CAN
    // distinguish revisits it deliberately.
    expect(toasts).toEqual([LIVE_TOAST]);

    gate.resolve();
    await first;
    expect(toasts).toEqual([LIVE_TOAST]); // the settle adds nothing

    // The settle released the latch, so the next export runs.
    await runExportFlow(deps, () => {});
    expect(downloads).toHaveLength(2);
    spy.mockRestore();
  });

  it("REGRESSION: the watchdog frees a hung saveFile dialog, and a late settle never unlocks the retry", async () => {
    const { SaveGame } = await import("../storage/SaveGame");
    const spy = vi.spyOn(SaveGame, "export").mockResolvedValue("VCTOWER1\nfake");
    vi.useFakeTimers();
    const first = deferred<void>();
    const second = deferred<void>();
    const { ui, toasts, downloads } = fakeUi([first.promise, second.promise]);
    const deps = flowDeps(ui);

    const run1 = runExportFlow(deps, () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(downloads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(EXPORT_WATCHDOG_MS - 1);
    expect(toasts).toEqual([LIVE_TOAST]); // a long dialog session is not a hang
    await vi.advanceTimersByTimeAsync(1);
    expect(toasts).toEqual([LIVE_TOAST, HUNG_TOAST]);

    // The whole point of the watchdog: Export is not bricked for the session.
    const run2 = runExportFlow(deps, () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(downloads).toHaveLength(2);

    // Run 1's dialog settles late while run 2's is open: run 2 keeps the
    // latch, so a third attempt is still a quiet no-op.
    first.resolve();
    await run1;
    void runExportFlow(deps, () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(downloads).toHaveLength(2);

    second.resolve();
    await run2;
    expect(toasts).toEqual([LIVE_TOAST, HUNG_TOAST, LIVE_TOAST]);
    spy.mockRestore();
  });
});
