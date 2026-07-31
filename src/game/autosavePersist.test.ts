import { describe, it, expect, vi, beforeEach } from "vitest";
import { Simulation } from "../engine/Simulation";
import type { SaveScopeToken, SaveStorePort, SaveStoreSnapshot } from "../platform/saveStore";
import { asScopeToken } from "../platform/saveStore";

/**
 * Where a periodic autosave lands on a wrapped build.
 *
 * The branch is `IS_WRAPPED_BUILD && saveStoreSession()`, and that constant is
 * false under vitest by construction, so without mocking `../platform` this
 * module's desktop half never runs in any test. The build guard cannot cover it
 * either: it greps the emitted bundle for literals, so it can prove the store
 * SHIPPED and not that autosave actually routes to it.
 *
 * The property under test is the one that would otherwise be discovered by a
 * player: on desktop the tower goes to the file store and localStorage is not
 * written at all.
 */

const LOCAL: SaveScopeToken = asScopeToken("local");

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

const { persistAutosave } = await import("./autosavePersist");
const { prepareSaveStore, resetSaveStoreForTests, noteTowerOrigin, setStoreAuthoritativeForTests, storeIsAuthoritative } =
  await import("./desktopSaveStore");

function fakeStore(shared = true) {
  const written: { id: string; scope: SaveScopeToken; contents: string }[] = [];
  const port: SaveStorePort = {
    list: (): Promise<SaveStoreSnapshot> =>
      Promise.resolve({ scopes: [{ token: LOCAL, label: "This computer", shared }], records: [] }),
    read: () => Promise.resolve(null),
    write: (id, contents, scope) => {
      written.push({ id, scope, contents });
      return Promise.resolve();
    },
    delete: () => Promise.resolve(),
  };
  return { port, written };
}

beforeEach(() => {
  resetSaveStoreForTests();
  injectedStore = undefined;
  localStorage.clear();
  // The store-routing tests below arm the tripwire explicitly. It is OFF in
  // production until the read path lands, and the last test in this file pins
  // that default, so the routing stays covered without pretending it is live.
  setStoreAuthoritativeForTests(true);
});

describe("persistAutosave on a wrapped build", () => {
  it("writes the tower to the store as .vctower text, and NOT to localStorage", async () => {
    const { port, written } = fakeStore();
    injectedStore = port;
    await prepareSaveStore();

    const setItem = vi.spyOn(Storage.prototype, "setItem");
    try {
      await persistAutosave(Simulation.newGame(7));
      expect(setItem).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }

    expect(written.length).toBe(1);
    expect(written[0]!.id).toBe("auto");
    expect(written[0]!.scope).toBe(LOCAL);
    // The same container the migration writes and SaveGame.import reads, so one
    // format crosses the bridge rather than two.
    expect(written[0]!.contents.startsWith("VCTOWER1\n")).toBe(true);
    expect(localStorage.length).toBe(0);
  });

  it("TRIPWIRE: does not route to the store until the read path lands", async () => {
    // The production default, asserted so this cannot be flipped by accident and
    // so the reason is discoverable from a failing test rather than a comment.
    // SaveGame answers load, hasSave, listSlots and hasSlot from localStorage
    // across twenty call sites. Writing autosaves to the store while reads come
    // from localStorage would send a player's progress somewhere nothing
    // reads: the next launch would load the pre-migration copy and the session
    // would silently vanish. The two halves ship together.
    // Read the module's INITIAL value, not one the test seam just wrote.
    // Asserting after `resetSaveStoreForTests()` was a tautology: that helper
    // sets the flag false, so flipping the production default to true left the
    // test green and the guard inert.
    vi.resetModules();
    const fresh = await import("./desktopSaveStore");
    expect(fresh.storeIsAuthoritative()).toBe(false);
    // Then put the LIVE module (the one `persistAutosave` closed over) back to
    // that default, since `beforeEach` arms it for the routing tests.
    resetSaveStoreForTests();
    expect(storeIsAuthoritative()).toBe(false);

    const { port, written } = fakeStore();
    injectedStore = port;
    await prepareSaveStore();
    await persistAutosave(Simulation.newGame(7));

    expect(written).toEqual([]);
    expect(localStorage.getItem("verticopolis-save")).not.toBeNull();
  });

  it("falls back to localStorage when the shell offers no store", async () => {
    // A wrapped build whose shell has no store, or whose list() failed, still
    // has to save somewhere. That somewhere is localStorage, exactly as on web.
    await prepareSaveStore();

    await persistAutosave(Simulation.newGame(7));

    expect(localStorage.getItem("verticopolis-save")).not.toBeNull();
  });

  it("REGRESSION: does not fall back to localStorage when the store REFUSES", async () => {
    // The refusal that can fire is `origin-gone`: the tower's own scope
    // disappeared mid-session. The entire point of refusing is to avoid writing
    // it somewhere every account on the machine can read, so a localStorage
    // fallback here would do the thing the refusal exists to prevent. A
    // periodic autosave is best effort; the next tick tries again.
    const { port, written } = fakeStore();
    injectedStore = port;
    await prepareSaveStore();
    noteTowerOrigin({ id: "auto", scope: asScopeToken("account:gone") });

    await persistAutosave(Simulation.newGame(7));

    expect(written).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it("does not throw when the store write rejects", async () => {
    // The autosave drain treats persistence as best effort and has no UI
    // surface; a throw here would escape into the interval callback.
    const { port } = fakeStore();
    port.write = () => Promise.reject(new Error("io"));
    injectedStore = port;
    await prepareSaveStore();

    await expect(persistAutosave(Simulation.newGame(7))).resolves.toBeUndefined();
  });
});

describe("the localStorage fallback cannot leak an account's tower", () => {
  it("REGRESSION: a failed write on an ACCOUNT-scoped tower writes nowhere", async () => {
    // The leak a confirming pass found in an earlier fix. Keying the fallback on
    // the refusal NAME, and falling back for everything except `origin-gone`,
    // meant one disk-full tick wrote an account's tower into localStorage.
    // localStorage carries no scope, so the next boot's migration correctly
    // read it as ownerless and moved it into the SHARED namespace, where every
    // account on the machine can read it. That reaches in two steps the
    // destination `origin-gone` refuses to reach in one.
    //
    // This test fails if the check goes back to `result.refusal === "origin-gone"`.
    const ACCOUNT = asScopeToken("account:test-scope");
    const port: SaveStorePort = {
      list: (): Promise<SaveStoreSnapshot> =>
        Promise.resolve({
          scopes: [
            { token: LOCAL, label: "This computer", shared: true },
            { token: ACCOUNT, label: "Your towers" },
          ],
          records: [],
        }),
      read: () => Promise.resolve(null),
      write: () => Promise.reject(Object.assign(new Error("no space"), { code: "full" })),
      delete: () => Promise.resolve(),
    };
    injectedStore = port;
    await prepareSaveStore();
    noteTowerOrigin({ id: "auto", scope: ACCOUNT });

    await persistAutosave(Simulation.newGame(7));

    expect(localStorage.length).toBe(0);
  });

  it("but a SHARED-scoped tower may fall back, since that adds no exposure", async () => {
    // The other half, and why this is not just "never fall back": a tower headed
    // for the shared scope is already readable by every account on the machine,
    // so localStorage costs it nothing and losing the save costs the player.
    const { port } = fakeStore();
    port.write = () => Promise.reject(Object.assign(new Error("no space"), { code: "full" }));
    injectedStore = port;
    await prepareSaveStore();

    await persistAutosave(Simulation.newGame(7));

    expect(localStorage.getItem("verticopolis-save")).not.toBeNull();
  });
});
