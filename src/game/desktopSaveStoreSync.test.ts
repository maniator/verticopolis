import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SaveScopeToken, SaveStoreErrorCode, SaveStorePort } from "../platform/saveStore";
import { ackedHash } from "../storage/saveStoreAcked";
import { toTowerFile } from "../storage/saveMigration";
import { ACCOUNT, LOCAL, TOWER, fakeStore, storeValue } from "./desktopSaveStore.fixture";

/**
 * The SYNCHRONOUS write path (`writeTowerToStoreSync`), the first-write
 * read-back that replaced the tripwire, `stale` as success-by-supersession,
 * and the slot-target rule. These are the parts D4 added to the write paths;
 * the origin rule itself is pinned in `desktopSaveStoreWrites.test.ts`.
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

const {
  prepareSaveStore,
  resetSaveStoreForTests,
  storeReadDegraded,
  noteTowerOrigin,
  writeTowerToStore,
  writeTowerToStoreSync,
} = await import("./desktopSaveStore");

const SHARED = [{ token: LOCAL, label: "This computer", shared: true }];

/** A valid `.vctower` payload, so the write-through cache path exercises. */
function towerText(name: string): string {
  const converted = toTowerFile(storeValue({ ...TOWER, towerName: name }));
  if (!converted.ok) throw new Error("fixture is not convertible");
  return converted.text;
}

/** Attach a recording writeSync member to a fixture store. */
function withWriteSync(
  store: ReturnType<typeof fakeStore>,
  result: { ok: true } | { ok: false; code?: SaveStoreErrorCode } = { ok: true },
) {
  const syncCalls: { id: string; scope: SaveScopeToken; seq: number }[] = [];
  store.port.writeSync = (id, contents, scope, seq) => {
    syncCalls.push({ id, scope, seq });
    if (result.ok) store.held.set(`${scope}|${id}`, contents);
    return result;
  };
  return syncCalls;
}

beforeEach(() => {
  resetSaveStoreForTests();
  injectedStore = undefined;
  localStorage.clear();
});

describe("writeTowerToStoreSync", () => {
  it("refuses with no-store when there is no hydrated session", async () => {
    expect(writeTowerToStoreSync("auto", "x")).toEqual({
      ok: false,
      refusal: "no-store",
      localFallbackSafe: true,
    });
  });

  it("reports 'unsupported' when the shell predates the writeSync member", async () => {
    const store = fakeStore(SHARED);
    injectedStore = store.port;
    await prepareSaveStore();

    expect(writeTowerToStoreSync("auto", "x")).toBe("unsupported");
  });

  it("writes through the port, refreshes the cache, and stamps the ack", async () => {
    const store = fakeStore(SHARED);
    const syncCalls = withWriteSync(store);
    injectedStore = store.port;
    await prepareSaveStore();

    const text = towerText("Synced");
    expect(writeTowerToStoreSync("auto", text)).toEqual({ ok: true });

    expect(syncCalls).toEqual([{ id: "auto", scope: LOCAL, seq: 1 }]);
    const cached = localStorage.getItem("verticopolis-save");
    expect(cached).toBe("VCZ1:" + text.trim().slice("VCTOWER1\n".length).replace(/\s+/g, ""));
    expect(ackedHash("auto")).toBeDefined();
  });

  it("shares the per-address seq counter with the async path", async () => {
    // One counter per (id, scope) across BOTH paths, or the shell's high-water
    // mark would silently drop whichever path wrote second.
    const store = fakeStore(SHARED);
    const syncCalls = withWriteSync(store);
    injectedStore = store.port;
    await prepareSaveStore();

    await writeTowerToStore("auto", towerText("First"));
    writeTowerToStoreSync("auto", towerText("Second"));

    expect(syncCalls).toEqual([{ id: "auto", scope: LOCAL, seq: 2 }]);
  });

  it("'stale' is success-by-supersession: ok, and the cache is NOT regressed", async () => {
    // The store already committed newer content for this address (a concurrent
    // async write landed first), so the tower is safe and this older payload
    // must not overwrite the cache.
    const store = fakeStore(SHARED);
    withWriteSync(store, { ok: false, code: "stale" });
    injectedStore = store.port;
    await prepareSaveStore();
    localStorage.setItem("verticopolis-save", "newer-cache-value");

    expect(writeTowerToStoreSync("auto", towerText("Older"))).toEqual({ ok: true });
    expect(localStorage.getItem("verticopolis-save")).toBe("newer-cache-value");
  });

  it("a failure code comes back as a failed result, never fallback-safe", async () => {
    const store = fakeStore(SHARED);
    withWriteSync(store, { ok: false, code: "full" });
    injectedStore = store.port;
    await prepareSaveStore();

    expect(writeTowerToStoreSync("auto", "x")).toEqual({
      ok: false,
      refusal: "failed",
      code: "full",
      localFallbackSafe: false,
    });
  });

  it("a writeSync that THROWS is a failed result, not an escaped throw", async () => {
    const store = fakeStore(SHARED);
    store.port.writeSync = () => {
      throw Object.assign(new Error("io"), { code: "io" });
    };
    injectedStore = store.port;
    await prepareSaveStore();

    expect(writeTowerToStoreSync("auto", "x")).toEqual({
      ok: false,
      refusal: "failed",
      code: "io",
      localFallbackSafe: false,
    });
  });

  it("honors the origin rule exactly like the async path", async () => {
    const store = fakeStore(SHARED);
    withWriteSync(store);
    injectedStore = store.port;
    await prepareSaveStore();
    noteTowerOrigin({ id: "slot-1", scope: ACCOUNT }); // scope not offered

    expect(writeTowerToStoreSync("slot-1", "x")).toEqual({
      ok: false,
      refusal: "origin-gone",
      localFallbackSafe: false,
    });
  });
});

describe("the async path maps 'stale' the same way", () => {
  it("a rejection carrying code 'stale' resolves ok without touching the cache", async () => {
    const store = fakeStore(SHARED);
    store.port.write = () => Promise.reject(Object.assign(new Error("superseded"), { code: "stale" }));
    injectedStore = store.port;
    await prepareSaveStore();
    localStorage.setItem("verticopolis-save", "newer-cache-value");

    expect(await writeTowerToStore("auto", towerText("Older"))).toEqual({ ok: true });
    expect(localStorage.getItem("verticopolis-save")).toBe("newer-cache-value");
  });
});

describe("the first routed write per session is READ BACK", () => {
  it("a lying shell (write resolves, nothing persisted) flips the session to degraded", async () => {
    // The tripwire's replacement. Unchecked, such a shell looks perfect all
    // session while every boot's hydration rolls the player back to whatever
    // it actually kept.
    const store = fakeStore(SHARED);
    store.port.write = () => Promise.resolve(); // accepts, persists nothing
    injectedStore = store.port;
    await prepareSaveStore();

    expect(await writeTowerToStore("auto", towerText("Lost"))).toEqual({
      ok: false,
      refusal: "failed",
      localFallbackSafe: false,
    });
    expect(storeReadDegraded()).toBe(true);
    // And the cache was NOT refreshed with a value the store never kept.
    expect(localStorage.getItem("verticopolis-save")).toBeNull();
  });

  it("a read-back that REJECTS reads as the same bridge failure", async () => {
    const store = fakeStore(SHARED);
    injectedStore = store.port;
    await prepareSaveStore();
    store.port.read = () => Promise.reject(new Error("io"));

    const result = await writeTowerToStore("auto", towerText("Lost"));
    expect(result.ok).toBe(false);
    expect(storeReadDegraded()).toBe(true);
  });

  it("verifies ONCE per session, not per write", async () => {
    const store = fakeStore(SHARED);
    injectedStore = store.port;
    await prepareSaveStore();
    let reads = 0;
    const realRead = store.port.read.bind(store.port);
    store.port.read = (id, scope) => {
      reads++;
      return realRead(id, scope);
    };

    await writeTowerToStore("auto", towerText("One"));
    await writeTowerToStore("auto", towerText("Two"));
    await writeTowerToStore("slot-1", towerText("Three"));

    expect(reads).toBe(1);
  });
});

describe("the slot-target rule", () => {
  it("overwrites an EXISTING slot record where it lives, not at the live tower's origin", async () => {
    // A tower opened from the account scope, saved to a slot that already
    // exists in the shared one: without this rule the write would create a
    // second slot-2 in the account namespace while the player's existing
    // slot-2 sat untouched — two towers under one label.
    const SCOPES = [
      { token: LOCAL, label: "This computer", shared: true },
      { token: ACCOUNT, label: "Your towers", shared: false },
    ];
    const store = fakeStore(SCOPES);
    const existing = toTowerFile(storeValue({ ...TOWER, towerName: "Existing slot" }));
    if (!existing.ok) throw new Error("fixture");
    store.held.set(`${LOCAL}|slot-2`, existing.text);
    injectedStore = store.port;
    await prepareSaveStore();
    noteTowerOrigin({ id: "auto", scope: ACCOUNT }); // the live tower is account-scoped

    expect(await writeTowerToStore("slot-2", towerText("Overwrite"))).toEqual({ ok: true });
    expect(store.calls.writes).toEqual([{ id: "slot-2", scope: LOCAL }]);
  });

  it("a FRESH slot still follows the live tower's origin", async () => {
    const SCOPES = [
      { token: LOCAL, label: "This computer", shared: true },
      { token: ACCOUNT, label: "Your towers", shared: false },
    ];
    const store = fakeStore(SCOPES);
    injectedStore = store.port;
    await prepareSaveStore();
    noteTowerOrigin({ id: "auto", scope: ACCOUNT });

    expect(await writeTowerToStore("slot-2", towerText("Fresh"))).toEqual({ ok: true });
    expect(store.calls.writes).toEqual([{ id: "slot-2", scope: ACCOUNT }]);
  });

  it("the AUTOSAVE id is exempt: auto always follows the live tower's origin", async () => {
    // Writing an account tower's progress over a shared `auto` record is the
    // cross-account leak the origin rule exists to prevent, so an existing
    // shared auto record must NOT capture an account tower's autosaves.
    const SCOPES = [
      { token: LOCAL, label: "This computer", shared: true },
      { token: ACCOUNT, label: "Your towers", shared: false },
    ];
    const store = fakeStore(SCOPES);
    const existing = toTowerFile(storeValue(TOWER));
    if (!existing.ok) throw new Error("fixture");
    store.held.set(`${LOCAL}|auto`, existing.text);
    injectedStore = store.port;
    await prepareSaveStore();
    noteTowerOrigin({ id: "slot-1", scope: ACCOUNT });

    expect(await writeTowerToStore("auto", towerText("Account progress"))).toEqual({ ok: true });
    expect(store.calls.writes).toEqual([{ id: "auto", scope: ACCOUNT }]);
  });
});
