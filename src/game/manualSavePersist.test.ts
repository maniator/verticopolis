import { describe, it, expect, vi, beforeEach } from "vitest";
import { Simulation } from "../engine/Simulation";
import type { SaveStoreErrorCode, SaveStorePort } from "../platform/saveStore";
import { isStorageWriteError } from "../storage/SaveGame";
import { ackedHash } from "../storage/saveStoreAcked";
import { toTowerFile } from "../storage/saveMigration";
import { ACCOUNT, LOCAL, TOWER, fakeStore, storeValue } from "./desktopSaveStore.fixture";

/**
 * The manual-save seam and the routed slot delete. `persistManualSave`'s
 * contract is three-valued by design: "stored" (the store committed),
 * "fallback" (browser-equivalent, so the caller runs its SaveGame path), and
 * a THROW (the store failed, worded for the callers' existing toast/flush
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

  it("an out-of-range slot number falls back rather than minting a store id", async () => {
    // Unreachable from the saves dialog (a closed 1..SLOT_COUNT list), but a
    // future caller must not be able to write `slot-7` into the store and
    // poison the origin bookkeeping. SaveGame accepts any slot number, so the
    // fallback keeps browser equivalence.
    const store = fakeStore(SHARED);
    const syncCalls = withWriteSync(store);
    injectedStore = store.port;
    await prepareSaveStore();

    expect(persistManualSave(Simulation.newGame(7), 7)).toBe("fallback");
    expect(syncCalls).toEqual([]);
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

  it("REGRESSION: 'denied' reads as storage-blame too, per the spec's wording rule", async () => {
    // Both `full` and `denied` route to the "free up space or allow site
    // storage" advice; an earlier revision gave `denied` the neutral wording,
    // which sent the player chasing a code bug for a permissions problem.
    const store = fakeStore(SHARED);
    withWriteSync(store, { ok: false, code: "denied" });
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

  it("the circuit breaker's 'stalled' code throws the not-responding wording", async () => {
    const store = fakeStore(SHARED);
    withWriteSync(store, { ok: false, code: "stale" }); // present, never reached
    injectedStore = store.port;
    await prepareSaveStore();
    store.port.write = () => new Promise<void>(() => {}); // hangs forever
    vi.useFakeTimers();
    try {
      const { writeTowerToStore } = await import("./desktopSaveStore");
      void writeTowerToStore("auto", "hung");
      await vi.advanceTimersByTimeAsync(6000);
      expect(() => persistManualSave(Simulation.newGame(7), "auto")).toThrowError(/not responding/);
    } finally {
      vi.useRealTimers();
    }
  });
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

  it("REGRESSION: a second delete for the same slot observes the first, never races it", async () => {
    // With a bare pending set, the first delete's cleanup cleared the flag
    // while the second was still in flight, so slotDeletePending read false
    // and a save could land inside the remaining window.
    const store = await hydratedWithSlot1();
    let release!: () => void;
    store.port.delete = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });

    const first = deleteSlotFromStore(1);
    const second = deleteSlotFromStore(1);
    expect(second).toBe(first);
    expect(slotDeletePending(1)).toBe(true);
    release();
    await expect(first).resolves.toBe(true);
    expect(slotDeletePending(1)).toBe(false);
  });

  it("REGRESSION: a hung delete times out as a failure instead of wedging the slot forever", async () => {
    // Unbounded, a delete that never settled kept the slot pending for the
    // whole session: saveToSlot refused it forever, and the restore path
    // never fired.
    vi.useFakeTimers();
    try {
      const store = await hydratedWithSlot1();
      store.port.delete = () => new Promise<void>(() => {}); // never settles

      const outcome = deleteSlotFromStore(1);
      expect(slotDeletePending(1)).toBe(true);
      await vi.advanceTimersByTimeAsync(4000);
      await expect(outcome).resolves.toBe(false);
      expect(slotDeletePending(1)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("REGRESSION: a slot CREATED this session is deletable, and a re-save follows the origin rule", async () => {
    // The boot snapshot said slot-2 had no record. An earlier revision never
    // updated it, so deleting a slot saved this session reported success
    // without calling the store, and the record resurrected every boot (and
    // kept syncing through Steam Cloud).
    const store = fakeStore(SHARED);
    store.port.writeSync = (id, contents, scope) => {
      store.held.set(`${scope}|${id}`, contents);
      return { ok: true };
    };
    injectedStore = store.port;
    await prepareSaveStore();

    expect(persistManualSave(Simulation.newGame(7), 2)).toBe("stored");
    expect(store.held.has(`${LOCAL}|slot-2`)).toBe(true);

    await expect(deleteSlotFromStore(2)).resolves.toBe(true);
    // The record is genuinely gone from the store, not just from the cache.
    expect(store.held.has(`${LOCAL}|slot-2`)).toBe(false);
    expect(ackedHash("slot-2")).toBeUndefined();

    // And a save AFTER the delete is a new record again (the dead record's
    // address was forgotten), not a write into a stale snapshot entry.
    expect(persistManualSave(Simulation.newGame(9), 2)).toBe("stored");
    expect(store.held.has(`${LOCAL}|slot-2`)).toBe(true);
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
