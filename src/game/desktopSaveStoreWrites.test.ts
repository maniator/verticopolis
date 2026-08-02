import { describe, it, expect, vi, beforeEach } from "vitest";
import { asScopeToken, type SaveScopeToken, type SaveStorePort } from "../platform/saveStore";
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
  resetSaveStoreForTests,
  setStoreAuthoritativeForTests,
  writeTowerToStore,
  noteTowerOrigin,
  towerOrigin,
} = await import("./desktopSaveStore");

beforeEach(() => {
  resetSaveStoreForTests();
  injectedStore = undefined;
  localStorage.clear();
  setStoreAuthoritativeForTests(true);
});

describe("writeTowerToStore honors the tower's origin", () => {
  const SCOPES = [
    { token: LOCAL, label: "This computer", shared: true },
    { token: ACCOUNT, label: "Your towers", shared: false },
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

describe("Copilot review findings", () => {
  const SHARED = [{ token: LOCAL, label: "This computer", shared: true }];

  it("survives a rejection whose code getter throws, from the WRITE path", async () => {
    // `saveStoreErrorCode` guarded this and `writeTowerToStore` duplicated the
    // unguarded read. Running inside a catch, a throwing getter would throw a
    // second time and turn a handled store failure into an unhandled rejection.
    const { port } = fakeStore(SHARED);
    port.write = () =>
      Promise.reject(
        Object.defineProperty({}, "code", {
          get() {
            throw new Error("hostile");
          },
        }),
      );
    injectedStore = port;
    await prepareSaveStore();

    const result = await writeTowerToStore("auto", "x");
    expect(result).toEqual({ ok: false, refusal: "failed", localFallbackSafe: true });
  });

  it("bounds the MIGRATION, not just list(), so a shell that hangs mid-write cannot block boot", async () => {
    // The timeout covered `list()` only. The migration then awaits a write and
    // a read-back per slot, so a shell that answers list() promptly and hangs on
    // the first write left boot pending forever on a blank page.
    vi.useFakeTimers();
    try {
      const { port } = fakeStore(SHARED);
      port.write = () => new Promise<void>(() => {}); // never settles
      injectedStore = port;
      localStorage.setItem("verticopolis-save", storeValue(TOWER));

      const booted = prepareSaveStore();
      await vi.advanceTimersByTimeAsync(5000);
      await expect(booted).resolves.toBeUndefined();
      // The session still resolved, so reads are ready; only the move was
      // abandoned, and it is safe to abandon because localStorage is untouched.
      expect(saveStoreSession()?.defaultScope).toBe(LOCAL);
      expect(localStorage.getItem("verticopolis-save")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps per-address counters separate when a scope token contains the separator", async () => {
    // The composite key `${scope}|${id}` was safe only because slot ids are a
    // closed list with no `|`. Scope tokens are opaque and shell-controlled.
    const weird = asScopeToken("a|b");
    const { port } = fakeStore([
      { token: weird, label: "Odd", shared: true },
      { token: LOCAL, label: "This computer", shared: false },
    ]);
    const seqs: { scope: SaveScopeToken; seq: number }[] = [];
    port.write = (_id, _c, scope, seq) => {
      seqs.push({ scope, seq });
      return Promise.resolve();
    };
    injectedStore = port;
    await prepareSaveStore();

    await writeTowerToStore("auto", "one");
    noteTowerOrigin({ id: "auto", scope: LOCAL });
    await writeTowerToStore("auto", "two");

    // Two different addresses, so each starts its own counter at 1.
    expect(seqs).toEqual([
      { scope: weird, seq: 1 },
      { scope: LOCAL, seq: 1 },
    ]);
  });
});
