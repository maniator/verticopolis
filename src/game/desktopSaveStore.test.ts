import { describe, it, expect, vi, beforeEach } from "vitest";
import { asScopeToken, type SaveScopeToken, type SaveStorePort, type SaveStoreSnapshot } from "../platform/saveStore";
import { deflateSync } from "fflate";
import { STORE_MAGIC, toBase64 } from "../storage/saveCompression";

/**
 * The wrapped-only orchestration: resolve the shell's store once, migrate
 * localStorage into it, and answer synchronously afterwards.
 *
 * `../platform` is mocked because `getPlatform()` is the module's only way to
 * reach a store, and the real resolver returns the browser port under vitest.
 * The storage modules underneath are NOT mocked: what is being tested is the
 * orchestration ON TOP of them, and mocking them would leave the ordering
 * (migrate, then re-read) asserted against fakes rather than against the real
 * migration's behavior.
 */

const LOCAL: SaveScopeToken = asScopeToken("local");
const ACCOUNT: SaveScopeToken = asScopeToken("account:76561198027391269");

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

const { prepareSaveStore, saveStoreSession, saveMigrationReport, resetSaveStoreForTests } = await import(
  "./desktopSaveStore"
);

const TOWER = { minutes: 4321, units: [{ t: "office" }], towerName: "Old Guard", money: 500 };

function storeValue(obj: unknown): string {
  return STORE_MAGIC + toBase64(deflateSync(new TextEncoder().encode(JSON.stringify(obj)), { level: 1 }));
}

/** A store whose scopes are configurable, so the shared-scope gating is testable. */
function fakeStore(scopes: { token: SaveScopeToken; label: string; shared?: boolean }[]) {
  const held = new Map<string, string>();
  const calls = { list: 0, writes: [] as { id: string; scope: SaveScopeToken }[] };
  const port: SaveStorePort = {
    list(): Promise<SaveStoreSnapshot> {
      calls.list++;
      return Promise.resolve({
        scopes,
        records: [...held.keys()].map((k) => {
          const [scope, id] = k.split("|");
          return { id: id!, scope: scope as SaveScopeToken, bytes: held.get(k)!.length };
        }),
      });
    },
    read: (id, scope) => Promise.resolve(held.get(`${scope}|${id}`) ?? null),
    write: (id, contents, scope) => {
      calls.writes.push({ id, scope });
      held.set(`${scope}|${id}`, contents);
      return Promise.resolve();
    },
    delete: (id, scope) => {
      held.delete(`${scope}|${id}`);
      return Promise.resolve();
    },
  };
  return { port, held, calls };
}

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
    const { port, calls } = fakeStore([{ token: ACCOUNT, label: "Your towers" }]);
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
      { token: ACCOUNT, label: "Your towers" },
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

  it("REGRESSION (AC5): never writes localStorage", async () => {
    // The desktop build's standing rule. localStorage stays READABLE, because
    // the migration has to read it, and is never written. Asserted with a spy
    // rather than by inspection, so a NEW write anywhere under prepareSaveStore
    // fails here rather than on a player's machine.
    const { port } = fakeStore([{ token: LOCAL, label: "L", shared: true }]);
    injectedStore = port;
    localStorage.setItem("verticopolis-save", storeValue(TOWER));
    localStorage.setItem("simtower-clone-slot-1", storeValue(TOWER));

    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const clear = vi.spyOn(Storage.prototype, "clear");
    try {
      await prepareSaveStore();
      expect(setItem).not.toHaveBeenCalled();
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
