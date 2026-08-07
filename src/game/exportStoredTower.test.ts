import { describe, it, expect, vi, beforeEach } from "vitest";
import { Simulation } from "../engine/Simulation";
import type { SaveStoreErrorCode, SaveStorePort } from "../platform/saveStore";
import { ACCOUNT, LOCAL, fakeStore } from "./desktopSaveStore.fixture";

/**
 * The stored-byte export flow (story D7, closing D2's AC22), split from
 * manualSavePersist.test.ts at the 500-line guard. The `vi.mock` preamble is
 * repeated here because vi.mock is file-scoped and hoisted; the fixture module
 * carries everything shareable.
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

const { prepareSaveStore, resetSaveStoreForTests, noteTowerOrigin } = await import("./desktopSaveStore");
const { persistManualSave, resetManualSaveForTests } = await import("./manualSavePersist");

const SHARED = [{ token: LOCAL, label: "This computer", shared: true }];

function withWriteSync(
  store: ReturnType<typeof fakeStore>,
  result: { ok: true } | { ok: false; code?: SaveStoreErrorCode } = { ok: true },
) {
  const syncCalls: { id: string }[] = [];
  store.port.writeSync = (id, contents, scope) => {
    syncCalls.push({ id });
    if (result.ok) store.held.set(`${scope}|${id}`, contents);
    return result;
  };
  return syncCalls;
}

beforeEach(() => {
  resetSaveStoreForTests();
  resetManualSaveForTests();
  injectedStore = undefined;
  localStorage.clear();
});
describe("exportStoredTower (story D7, D2's AC22)", () => {
  it("flushes to AUTO first, then exports the auto record, in that order", async () => {
    const store = fakeStore(SHARED);
    const order: string[] = [];
    store.port.writeSync = (id, contents, scope) => {
      order.push(`flush:${id}`);
      store.held.set(`${scope}|${id}`, contents);
      return { ok: true };
    };
    store.port.exportRecord = (id: string, scope: string, name: string) => {
      order.push(`export:${id}:${scope}:${name}`);
      return Promise.resolve(true);
    };
    injectedStore = store.port;
    await prepareSaveStore();

    const { exportStoredTower } = await import("./manualSavePersist");
    expect(await exportStoredTower(Simulation.newGame(7), "my-tower.vctower")).toBe("exported");
    expect(order).toEqual(["flush:auto", `export:auto:${LOCAL}:my-tower.vctower`]);
  });

  it("REGRESSION: exports the LAST-COMMITTED scope, not the highest cross-scope seq", async () => {
    // A review caught the seq comparison: seq is minted per (id, scope), so
    // after a shared tower ran auto's counter up and an account tower's scope
    // started fresh at 1, "highest seq" pointed at the OLD tower's record.
    // Recency across scopes is renderer commit order, nothing else.
    const store = fakeStore([
      { token: LOCAL, label: "This computer", shared: true },
      { token: ACCOUNT, label: "This account", shared: false },
    ]);
    withWriteSync(store);
    const exportedScopes: string[] = [];
    store.port.exportRecord = (_id: string, scope: string) => {
      exportedScopes.push(scope);
      return Promise.resolve(true);
    };
    injectedStore = store.port;
    await prepareSaveStore();

    // The shared tower's session: auto's LOCAL counter climbs past 1.
    expect(persistManualSave(Simulation.newGame(7), "auto")).toBe("stored");
    expect(persistManualSave(Simulation.newGame(7), "auto")).toBe("stored");
    expect(persistManualSave(Simulation.newGame(7), "auto")).toBe("stored");

    // The player loads an account tower; its scope's counter starts at 1.
    noteTowerOrigin({ id: "auto", scope: ACCOUNT });

    const { exportStoredTower } = await import("./manualSavePersist");
    expect(await exportStoredTower(Simulation.newGame(9), "t.vctower")).toBe("exported");
    expect(exportedScopes).toEqual([ACCOUNT]);
  });

  it("falls back to live when the member is absent, without flushing", async () => {
    const store = fakeStore(SHARED);
    const syncCalls = withWriteSync(store);
    injectedStore = store.port;
    await prepareSaveStore();

    const { exportStoredTower } = await import("./manualSavePersist");
    expect(await exportStoredTower(Simulation.newGame(7), "t.vctower")).toBe("fallback");
    // No flush either: the point of the flush is the copy that will not happen.
    expect(syncCalls).toEqual([]);
  });

  it("NEVER copies stale bytes: a failed flush falls back without exporting", async () => {
    // The party's rule. A flush that fails leaves the auto record older than
    // the live tower, and copying it would hand the player a backup missing
    // their session.
    const store = fakeStore(SHARED);
    withWriteSync(store, { ok: false, code: "full" });
    const exported: string[] = [];
    store.port.exportRecord = (id: string) => {
      exported.push(id);
      return Promise.resolve(true);
    };
    injectedStore = store.port;
    await prepareSaveStore();

    const { exportStoredTower } = await import("./manualSavePersist");
    expect(await exportStoredTower(Simulation.newGame(7), "t.vctower")).toBe("fallback");
    expect(exported).toEqual([]);
  });

  it("a flush that answers fallback (writeSync-less shell) falls back too", async () => {
    const store = fakeStore(SHARED); // no writeSync member
    const exported: string[] = [];
    store.port.exportRecord = (id: string) => {
      exported.push(id);
      return Promise.resolve(true);
    };
    injectedStore = store.port;
    await prepareSaveStore();

    const { exportStoredTower } = await import("./manualSavePersist");
    expect(await exportStoredTower(Simulation.newGame(7), "t.vctower")).toBe("fallback");
    expect(exported).toEqual([]);
  });

  it("a CANCELED dialog is a choice: no success claim and no second dialog", async () => {
    // Copilot's catch on the public flow: exportRecord resolving on cancel
    // let the success toast fire on a canceled dialog. The contract now
    // resolves false on cancel, and the caller says nothing and opens
    // nothing else (a fallback here would greet the cancel with a second
    // dialog).
    const store = fakeStore(SHARED);
    withWriteSync(store);
    store.port.exportRecord = () => Promise.resolve(false);
    injectedStore = store.port;
    await prepareSaveStore();

    const { exportStoredTower } = await import("./manualSavePersist");
    expect(await exportStoredTower(Simulation.newGame(7), "t.vctower")).toBe("canceled");
  });

  it("a MALFORMED resolution falls back, never reads as a silent cancel", async () => {
    // Both review hunters converged here: a non-boolean resolution mapped to
    // "canceled" picks the one branch with zero feedback, so on a broken
    // shell Export would silently do nothing forever. Strict true and strict
    // false are the only choices; everything else is the fallback.
    const store = fakeStore(SHARED);
    withWriteSync(store);
    store.port.exportRecord = () => Promise.resolve(undefined as never);
    injectedStore = store.port;
    await prepareSaveStore();

    const { exportStoredTower } = await import("./manualSavePersist");
    expect(await exportStoredTower(Simulation.newGame(7), "t.vctower")).toBe("fallback");
  });

  it("a rejecting exportRecord falls back to the live path", async () => {
    const store = fakeStore(SHARED);
    withWriteSync(store);
    store.port.exportRecord = () => Promise.reject(new Error("io"));
    injectedStore = store.port;
    await prepareSaveStore();

    const { exportStoredTower } = await import("./manualSavePersist");
    expect(await exportStoredTower(Simulation.newGame(7), "t.vctower")).toBe("fallback");
  });

  it("no authoritative store means the live path, member or not", async () => {
    const { exportStoredTower } = await import("./manualSavePersist");
    expect(await exportStoredTower(Simulation.newGame(7), "t.vctower")).toBe("fallback");
  });

  it("PIN (GH #774): shell conformance is not observable from this suite", () => {
    // Every test in this file runs against a FAKE port, so all any of them can
    // show is that the renderer asks correctly and reads the answer
    // correctly. The half that decides whether the exported bytes match the
    // filename is the shell's: it must capture the record's bytes at call
    // time, before the dialog opens, and hold that capture in memory rather
    // than staging a copy on disk (see the exportRecord doc in
    // src/platform/saveStore.ts). A fake port cannot fail that, so passing
    // here is not evidence a real shell conforms.
    //
    // The enforcing test lives in the private shell repo, at
    // desktop/shell/test/storeIpc.test.ts, named "export: bytes are read
    // BEFORE the dialog opens". Anyone reasoning about GH #774 from this
    // repo alone will conclude the timing is untested; it is tested, over
    // there. What this repo can hold is the contract prose, pinned by
    // src/tests/saveStoreExportContract.test.ts.
    expect(true).toBe(true);
  });
});
