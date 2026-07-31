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
const ACCOUNT: SaveScopeToken = asScopeToken("account:test-scope");

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
  setStoreAuthoritativeForTests,
  writeTowerToStore,
  noteTowerOrigin,
  towerOrigin,
} = await import("./desktopSaveStore");

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
  // The migration and the write path are BOTH gated on the tripwire, so these
  // tests arm it. One test below deliberately does not, and pins that a
  // non-authoritative store migrates nothing: gating only the write path left
  // boot 1 copying towers into a store that boot 2 then froze forever.
  setStoreAuthoritativeForTests(true);
});

describe("the tripwire gates the MIGRATION, not just the write path", () => {
  it("migrates nothing while the store is not authoritative", async () => {
    // The defect this pins. Migrating while autosaves still go to localStorage
    // copies the towers at boot 1, and boot 2 finds the destinations occupied
    // and skips (correctly, per the derived done-marker), so the store is
    // frozen at boot 1. The day the readers are routed, the player loads a
    // tower missing every session since.
    resetSaveStoreForTests();
    const { port, calls } = fakeStore([{ token: LOCAL, label: "This computer", shared: true }]);
    injectedStore = port;
    localStorage.setItem("verticopolis-save", storeValue(TOWER));

    await prepareSaveStore();

    // The session still resolves, so reads are ready the moment the gate flips.
    expect(saveStoreSession()?.defaultScope).toBe(LOCAL);
    expect(saveMigrationReport()).toBeNull();
    expect(calls.writes).toEqual([]);
    expect(localStorage.getItem("verticopolis-save")).not.toBeNull();
  });
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

describe("writeTowerToStore honors the tower's origin", () => {
  const SCOPES = [
    { token: LOCAL, label: "This computer", shared: true },
    { token: ACCOUNT, label: "Your towers" },
  ];

  it("sends a tower with no origin to the default scope", async () => {
    const { port, calls } = fakeStore(SCOPES);
    injectedStore = port;
    await prepareSaveStore();

    expect(await writeTowerToStore("auto", "VCTOWER1\nAAA\n")).toEqual({ ok: true });
    expect(calls.writes).toEqual([{ id: "auto", scope: LOCAL }]);
  });

  it("writes a tower back to the scope it was opened from", async () => {
    const { port, calls } = fakeStore(SCOPES);
    injectedStore = port;
    await prepareSaveStore();
    noteTowerOrigin({ id: "slot-1", scope: ACCOUNT });

    expect(await writeTowerToStore("slot-1", "VCTOWER1\nAAA\n")).toEqual({ ok: true });
    // NOT the default scope, which is what an origin-blind write would pick.
    expect(calls.writes).toEqual([{ id: "slot-1", scope: ACCOUNT }]);
  });

  it("REGRESSION: refuses rather than falling back when the origin scope is gone", async () => {
    // The account-isolation rule. Writing this tower into the shared scope
    // because its account directory went away mid-session would put it where
    // every account on the machine can read it. Losing an autosave tick is
    // recoverable; that is not.
    const { port, calls } = fakeStore([{ token: LOCAL, label: "This computer", shared: true }]);
    injectedStore = port;
    await prepareSaveStore();
    noteTowerOrigin({ id: "slot-1", scope: ACCOUNT });

    expect(await writeTowerToStore("slot-1", "VCTOWER1\nAAA\n")).toEqual({
      ok: false,
      refusal: "origin-gone",
      // Never safe to write to localStorage instead: this is precisely the
      // tower whose scope vanished, and localStorage carries no scope, so the
      // next boot's migration would read it as ownerless and move it into the
      // SHARED namespace.
      localFallbackSafe: false,
    });
    expect(calls.writes).toEqual([]);
  });

  it("adopts the scope it landed in, so later autosaves do not re-decide", async () => {
    // Without this, a shell that changed its default scope mid-session would
    // scatter one tower's autosaves across two namespaces.
    const { port, calls } = fakeStore(SCOPES);
    injectedStore = port;
    await prepareSaveStore();

    await writeTowerToStore("auto", "one");
    expect(towerOrigin()).toEqual({ id: "auto", scope: LOCAL });
    await writeTowerToStore("auto", "two");
    expect(calls.writes).toEqual([
      { id: "auto", scope: LOCAL },
      { id: "auto", scope: LOCAL },
    ]);
  });

  it("increments seq per id, and never persists it", async () => {
    // The port contract: the shell's high-water mark is session-scoped, because
    // a persisted mark would drop every write of the next session once the
    // game's counter started over.
    const { port } = fakeStore(SCOPES);
    const seqs: number[] = [];
    port.write = (_id, _c, _s, seq) => {
      seqs.push(seq);
      return Promise.resolve();
    };
    injectedStore = port;
    await prepareSaveStore();

    await writeTowerToStore("auto", "a");
    await writeTowerToStore("auto", "b");
    await writeTowerToStore("slot-1", "c");
    expect(seqs).toEqual([1, 2, 1]);

    resetSaveStoreForTests();
    injectedStore = port;
    await prepareSaveStore();
    await writeTowerToStore("auto", "d");
    expect(seqs[3]).toBe(1);
  });

  it("reports a store failure with its code rather than throwing", async () => {
    const { port } = fakeStore(SCOPES);
    port.write = () => Promise.reject(Object.assign(new Error("full"), { code: "full" }));
    injectedStore = port;
    await prepareSaveStore();

    // Headed for LOCAL, the shared scope, so localStorage adds no exposure the
    // tower did not already have and the caller may fall back.
    expect(await writeTowerToStore("auto", "x")).toEqual({
      ok: false,
      refusal: "failed",
      code: "full",
      localFallbackSafe: true,
    });
  });

  it("refuses when there is no store at all", async () => {
    await prepareSaveStore();
    // No store means no account context at all, so localStorage cannot leak
    // between accounts and is simply the only place a tower can go.
    expect(await writeTowerToStore("auto", "x")).toEqual({
      ok: false,
      refusal: "no-store",
      localFallbackSafe: true,
    });
  });

  it("REGRESSION: a failed write on an ACCOUNT-scoped tower is not fallback-safe", async () => {
    // The leak the confirming pass found in the previous fix. Falling back on
    // any refusal except `origin-gone` meant one disk-full tick wrote an
    // account's tower to localStorage, where it carries no scope; the next
    // boot's migration then correctly read it as ownerless and moved it into
    // the SHARED namespace, reachable by every account on the machine. Two
    // steps to the destination `origin-gone` refuses in one.
    const { port } = fakeStore(SCOPES);
    port.write = () => Promise.reject(Object.assign(new Error("full"), { code: "full" }));
    injectedStore = port;
    await prepareSaveStore();
    noteTowerOrigin({ id: "slot-1", scope: ACCOUNT });

    expect(await writeTowerToStore("slot-1", "x")).toEqual({
      ok: false,
      refusal: "failed",
      code: "full",
      localFallbackSafe: false,
    });
  });

  it("does not overwrite the live tower's origin id on a successful write", async () => {
    // `loadedFrom = resolved.target` was unconditional, so a tower opened from
    // slot-2 reported its origin as `auto` after one autosave tick.
    const { port } = fakeStore(SCOPES);
    injectedStore = port;
    await prepareSaveStore();
    noteTowerOrigin({ id: "slot-2", scope: LOCAL });

    await writeTowerToStore("auto", "x");

    expect(towerOrigin()).toEqual({ id: "slot-2", scope: LOCAL });
  });

  it("REGRESSION (AC5): writing a tower never touches localStorage", async () => {
    const { port } = fakeStore(SCOPES);
    injectedStore = port;
    await prepareSaveStore();

    const setItem = vi.spyOn(Storage.prototype, "setItem");
    try {
      expect(await writeTowerToStore("auto", "VCTOWER1\nAAA\n")).toEqual({ ok: true });
      expect(setItem).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });
});
