import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SaveStorePort } from "../platform/saveStore";
import { ACCOUNT, LOCAL, TOWER, fakeStore, storeValue } from "./desktopSaveStore.fixture";

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
  saveStoreSession,
  saveMigrationReport,
  resetSaveStoreForTests,
} = await import("./desktopSaveStore");

beforeEach(() => {
  resetSaveStoreForTests();
  injectedStore = undefined;
  localStorage.clear();
});

describe("prepareSaveStore", () => {
  it("does nothing when the shell offers no store", async () => {
    await prepareSaveStore();
    expect(saveStoreSession()).toBeNull();
    expect(saveMigrationReport()).toBeNull();
  });

  it("resolves a session and migrates localStorage into the shared scope", async () => {
    const { port, held, calls } = fakeStore([{ token: LOCAL, label: "This computer", shared: true }]);
    injectedStore = port;
    localStorage.setItem("verticopolis-save", storeValue(TOWER));

    await prepareSaveStore();

    expect(saveStoreSession()?.defaultScope).toBe(LOCAL);
    expect(saveMigrationReport()?.outcomes.get("auto")).toBe("migrated");
    expect(calls.writes).toEqual([{ id: "auto", scope: LOCAL }]);
    expect(held.get(`${LOCAL}|auto`)).toContain("VCTOWER1");
  });

  it("REGRESSION (#730): refuses to migrate when no scope is marked shared", async () => {
    // The account-attribution hazard. Once a default scope means "the account
    // logged in right now", migrating into it would sweep the PREVIOUS account's
    // leftover localStorage towers into this player's Steam Cloud. A tower found
    // in localStorage has no knowable owner, so with no shell-marked shared
    // scope the only safe answer is to write nothing at all.
    const { port, calls } = fakeStore([{ token: ACCOUNT, label: "Your towers", shared: false }]);
    injectedStore = port;
    localStorage.setItem("verticopolis-save", storeValue(TOWER));

    await prepareSaveStore();

    // The session still resolves: reading is fine, only writing is refused.
    expect(saveStoreSession()?.defaultScope).toBe(ACCOUNT);
    expect(saveMigrationReport()).toBeNull();
    expect(calls.writes).toEqual([]);
    // And the towers are untouched, so a later boot with a marked scope moves them.
    expect(localStorage.getItem("verticopolis-save")).not.toBeNull();
  });

  it("REGRESSION (#730): migrates to the SHARED scope even when another is default", async () => {
    // Order must not decide where towers land, and "default" must never stand in
    // for "shared".
    const { port, calls } = fakeStore([
      { token: ACCOUNT, label: "Your towers", shared: false },
      { token: LOCAL, label: "This computer", shared: true },
    ]);
    injectedStore = port;
    localStorage.setItem("verticopolis-save", storeValue(TOWER));

    await prepareSaveStore();

    expect(saveStoreSession()?.defaultScope).toBe(ACCOUNT);
    expect(calls.writes).toEqual([{ id: "auto", scope: LOCAL }]);
  });

  it("re-reads the snapshot after a migration that moved something", async () => {
    // Otherwise everything it just moved is invisible for the rest of the
    // session, while the NEXT boot reports it already present and the player
    // sees an empty saves list in between.
    const { port, calls } = fakeStore([{ token: LOCAL, label: "L", shared: true }]);
    injectedStore = port;
    localStorage.setItem("verticopolis-save", storeValue(TOWER));

    await prepareSaveStore();

    expect(calls.list).toBe(2);
    expect(saveStoreSession()?.records.map((r) => r.id)).toEqual(["auto"]);
  });

  it("does not re-read when the migration moved nothing", async () => {
    // The common case on every boot after the first. A second list() there is a
    // round trip across a process boundary for a snapshot that cannot have
    // changed.
    const { port, calls } = fakeStore([{ token: LOCAL, label: "L", shared: true }]);
    injectedStore = port;

    await prepareSaveStore();

    expect(calls.list).toBe(1);
    expect(saveMigrationReport()?.migratedAny).toBe(false);
  });

  it("never rejects, whatever the shell does", async () => {
    // Awaited during boot, before first paint. A shell that throws has to
    // degrade to "no durable store this session", not take the splash down.
    for (const hostile of [
      { list: () => Promise.reject(new Error("io")) },
      {
        list: () => {
          throw new Error("synchronous throw");
        },
      },
      { list: () => Promise.resolve(null) },
      { list: () => Promise.resolve({ scopes: [], records: [] }) },
    ]) {
      resetSaveStoreForTests();
      injectedStore = {
        read: () => Promise.resolve(null),
        write: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        ...hostile,
      } as unknown as SaveStorePort;
      await expect(prepareSaveStore()).resolves.toBeUndefined();
      expect(saveStoreSession()).toBeNull();
    }
  });

  it("survives a store whose write rejects, leaving localStorage intact", async () => {
    const { port } = fakeStore([{ token: LOCAL, label: "L", shared: true }]);
    port.write = () => Promise.reject(Object.assign(new Error("full"), { code: "full" }));
    injectedStore = port;
    const raw = storeValue(TOWER);
    localStorage.setItem("verticopolis-save", raw);

    await expect(prepareSaveStore()).resolves.toBeUndefined();

    expect(saveMigrationReport()?.outcomes.get("auto")).toBe("write-failed");
    expect(saveMigrationReport()?.failures).toEqual([{ id: "auto", code: "full" }]);
    expect(localStorage.getItem("verticopolis-save")).toBe(raw);
  });

  it("runs once per page load, so a second call is a no-op", async () => {
    const { port, calls } = fakeStore([{ token: LOCAL, label: "L", shared: true }]);
    injectedStore = port;

    await prepareSaveStore();
    await prepareSaveStore();
    await prepareSaveStore();

    expect(calls.list).toBe(1);
  });

  it("REGRESSION (AC5): never writes a SAVE key it did not hydrate", async () => {
    // The desktop build's standing rule, post-hydration form. The migration
    // itself never writes localStorage; hydration MAY write save keys, but only
    // to materialize store records, and here both records round-trip to exactly
    // what localStorage already holds, so the only write left is the coherence
    // stamp (`vc-store-acked`, its own meta key). Asserted with a spy rather
    // than by inspection, so a NEW write anywhere under prepareSaveStore fails
    // here rather than on a player's machine.
    const { port } = fakeStore([{ token: LOCAL, label: "L", shared: true }]);
    injectedStore = port;
    localStorage.setItem("verticopolis-save", storeValue(TOWER));
    localStorage.setItem("simtower-clone-slot-1", storeValue(TOWER));

    // INSTANCE spies: happy-dom's localStorage does not dispatch through
    // Storage.prototype, so prototype spies intercept nothing and this whole
    // test would pass vacuously.
    const setItem = vi.spyOn(localStorage, "setItem");
    const removeItem = vi.spyOn(localStorage, "removeItem");
    const clear = vi.spyOn(localStorage, "clear");
    try {
      await prepareSaveStore();
      // The coherence stamp for the two hydrated records is the ONLY write,
      // and asserting it happened proves the spy genuinely intercepts.
      expect(setItem).toHaveBeenCalled();
      expect(setItem.mock.calls.filter(([key]) => key !== "vc-store-acked")).toEqual([]);
      expect(removeItem).not.toHaveBeenCalled();
      expect(clear).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
      removeItem.mockRestore();
      clear.mockRestore();
    }
    // Both towers moved, so the read path genuinely ran rather than the spy
    // passing because nothing happened at all.
    expect(saveMigrationReport()?.outcomes.get("auto")).toBe("migrated");
    expect(saveMigrationReport()?.outcomes.get("slot-1")).toBe("migrated");
  });
});
