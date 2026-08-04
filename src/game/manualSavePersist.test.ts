import { describe, it, expect, vi, beforeEach } from "vitest";
import { Simulation } from "../engine/Simulation";
import type { SaveStoreErrorCode, SaveStorePort } from "../platform/saveStore";
import { isStorageWriteError } from "../storage/SaveGame";
import { ackedHash } from "../storage/saveStoreAcked";
import { toTowerFile } from "../storage/saveMigration";
import { LOCAL, TOWER, fakeStore, storeValue } from "./desktopSaveStore.fixture";

/**
 * The manual-save seam and the routed slot delete. `persistManualSave`'s
 * contract is three-valued by design: "stored" (the store committed),
 * "fallback" (browser-equivalent — the caller runs its SaveGame path), and a
 * THROW (the store failed, worded for the callers' existing toast/flush
 * contracts).
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
const { persistManualSave, deleteSlotFromStore, deleteSlotRouted, slotDeletePending, resetManualSaveForTests } =
  await import("./manualSavePersist");

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

describe("persistManualSave", () => {
  it("is a fallback on a browser-equivalent session", async () => {
    // No store resolved: the caller's SaveGame path is the correct behavior.
    await prepareSaveStore();
    expect(persistManualSave(Simulation.newGame(7), "auto")).toBe("fallback");
  });

  it("is a fallback when the shell predates writeSync", async () => {
    const store = fakeStore(SHARED);
    injectedStore = store.port;
    await prepareSaveStore();
    expect(persistManualSave(Simulation.newGame(7), 2)).toBe("fallback");
  });

  it("stores through writeSync, as .vctower text under the slot's id", async () => {
    const store = fakeStore(SHARED);
    const syncCalls = withWriteSync(store);
    injectedStore = store.port;
    await prepareSaveStore();

    expect(persistManualSave(Simulation.newGame(7), "auto")).toBe("stored");
    expect(persistManualSave(Simulation.newGame(7), 2)).toBe("stored");

    expect(syncCalls).toEqual([{ id: "auto" }, { id: "slot-2" }]);
    expect(store.held.get(`${LOCAL}|slot-2`)).toContain("VCTOWER1\n");
    // The write-through refreshed the cache, so the saves UI sees the slot.
    expect(localStorage.getItem("simtower-clone-slot-2")).not.toBeNull();
  });

  it("a 'full' failure throws the error isStorageWriteError recognizes", async () => {
    // That name is what routes the player to the storage-blame advice in
    // saveFailureMessage, rather than a raw code.
    const store = fakeStore(SHARED);
    withWriteSync(store, { ok: false, code: "full" });
    injectedStore = store.port;
    await prepareSaveStore();

    let thrown: unknown;
    try {
      persistManualSave(Simulation.newGame(7), "auto");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect(isStorageWriteError(thrown)).toBe(true);
  });

  it("any other failure code throws with the code in the message", async () => {
    const store = fakeStore(SHARED);
    withWriteSync(store, { ok: false, code: "io" });
    injectedStore = store.port;
    await prepareSaveStore();

    expect(() => persistManualSave(Simulation.newGame(7), "auto")).toThrowError(/\(io\)/);
  });

  it("origin-gone throws the export advice, never falls back", async () => {
    // The tower whose scope vanished is exactly the tower that must not land
    // in localStorage (it carries no scope there, and the migration would
    // sweep it into the shared namespace).
    const store = fakeStore(SHARED);
    withWriteSync(store);
    injectedStore = store.port;
    await prepareSaveStore();
    noteTowerOrigin({ id: "auto", scope: "account:gone" as never });

    expect(() => persistManualSave(Simulation.newGame(7), "auto")).toThrowError(/Export it to a file/);
    expect(localStorage.length).toBe(0);
  });

  it("'stale' from the port surfaces as stored (success-by-supersession)", async () => {
    const store = fakeStore(SHARED);
    withWriteSync(store, { ok: false, code: "stale" });
    injectedStore = store.port;
    await prepareSaveStore();

    expect(persistManualSave(Simulation.newGame(7), "auto")).toBe("stored");
  });
});

describe("deleteSlotFromStore", () => {
  /** Boot a session with slot-1 hydrated from the store. */
  async function hydratedWithSlot1() {
    const store = fakeStore(SHARED);
    const converted = toTowerFile(storeValue(TOWER));
    if (!converted.ok) throw new Error("fixture");
    store.held.set(`${LOCAL}|slot-1`, converted.text);
    injectedStore = store.port;
    await prepareSaveStore();
    return store;
  }

  it("resolves true without calling the store when the slot has no record", async () => {
    const store = await hydratedWithSlot1();
    const del = vi.fn(store.port.delete);
    store.port.delete = del;

    await expect(deleteSlotFromStore(2)).resolves.toBe(true);
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes the record at its hydrated origin and drops the coherence stamp", async () => {
    const store = await hydratedWithSlot1();
    expect(ackedHash("slot-1")).toBeDefined();

    await expect(deleteSlotFromStore(1)).resolves.toBe(true);

    expect(store.held.has(`${LOCAL}|slot-1`)).toBe(false);
    // A deleted slot's stamp must not outlive it: a later save to this slot
    // followed by a boot would otherwise read the fresh cache as "moved".
    expect(ackedHash("slot-1")).toBeUndefined();
  });

  it("resolves false when the store refuses, and reports pending while in flight", async () => {
    const store = await hydratedWithSlot1();
    let reject!: (err: Error) => void;
    store.port.delete = () =>
      new Promise<void>((_resolve, rej) => {
        reject = rej;
      });

    const outcome = deleteSlotFromStore(1);
    expect(slotDeletePending(1)).toBe(true);
    reject(new Error("io"));
    await expect(outcome).resolves.toBe(false);
    expect(slotDeletePending(1)).toBe(false);
  });
});

describe("deleteSlotRouted", () => {
  it("removes the cache row immediately and finishes quietly when the store agrees", async () => {
    const store = fakeStore(SHARED);
    const converted = toTowerFile(storeValue(TOWER));
    if (!converted.ok) throw new Error("fixture");
    store.held.set(`${LOCAL}|slot-1`, converted.text);
    injectedStore = store.port;
    await prepareSaveStore();
    expect(localStorage.getItem("simtower-clone-slot-1")).not.toBeNull();

    const toast = vi.fn();
    const rerender = vi.fn();
    deleteSlotRouted(1, { toast }, rerender);

    expect(localStorage.getItem("simtower-clone-slot-1")).toBeNull();
    await Promise.resolve(); // let the background delete settle
    await Promise.resolve();
    expect(toast).not.toHaveBeenCalled();
    expect(rerender).not.toHaveBeenCalled();
  });

  it("restores the cache, toasts, and re-renders when the store refuses", async () => {
    const store = fakeStore(SHARED);
    const converted = toTowerFile(storeValue(TOWER));
    if (!converted.ok) throw new Error("fixture");
    store.held.set(`${LOCAL}|slot-1`, converted.text);
    injectedStore = store.port;
    await prepareSaveStore();
    const cached = localStorage.getItem("simtower-clone-slot-1");
    expect(cached).not.toBeNull();
    store.port.delete = () => Promise.reject(new Error("io"));

    const toast = vi.fn();
    const rerender = vi.fn();
    deleteSlotRouted(1, { toast }, rerender);
    expect(localStorage.getItem("simtower-clone-slot-1")).toBeNull();

    await vi.waitFor(() => expect(rerender).toHaveBeenCalled());
    // The honest state is "not deleted": the row is back and the player knows.
    expect(localStorage.getItem("simtower-clone-slot-1")).toBe(cached);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("could not be deleted"), "bad");
  });
});
