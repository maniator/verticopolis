import { describe, it, expect, vi, beforeEach } from "vitest";
import { Simulation } from "../engine/Simulation";
import type { SaveScopeToken, SaveStorePort, SaveStoreSnapshot } from "../platform/saveStore";
import { asScopeToken } from "../platform/saveStore";
import { TOWER, storeValue } from "./desktopSaveStore.fixture";

/**
 * Where a periodic autosave lands on a wrapped build.
 *
 * The branch is `IS_WRAPPED_BUILD && storeIsAuthoritative()`, and that constant
 * is false under vitest by construction, so without mocking `../platform` this
 * module's desktop half never runs in any test. The build guard cannot cover it
 * either: it greps the emitted bundle for literals, so it can prove the store
 * SHIPPED and not that autosave actually routes to it.
 *
 * The property under test is the one that would otherwise be discovered by a
 * player: on desktop the tower goes to the file store, and localStorage is only
 * ever a cache DERIVED from what the store committed, never a save target.
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
const { prepareSaveStore, resetSaveStoreForTests, noteTowerOrigin } = await import("./desktopSaveStore");

function fakeStore(shared = true) {
  const written: { id: string; scope: SaveScopeToken; contents: string }[] = [];
  const port: SaveStorePort = {
    list: (): Promise<SaveStoreSnapshot> =>
      Promise.resolve({ scopes: [{ token: LOCAL, label: "This computer", shared }], records: [] }),
    // Serves the last write back, because the store's first routed write per
    // session is READ BACK and compared; a read that ignored writes would flag
    // every fake store as a lying shell.
    read: (id, scope) => {
      const hit = [...written].reverse().find((w) => w.id === id && w.scope === scope);
      return Promise.resolve(hit?.contents ?? null);
    },
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
});

describe("persistAutosave on a wrapped build", () => {
  it("writes the tower to the store as .vctower text, and localStorage only as the derived cache", async () => {
    const { port, written } = fakeStore();
    injectedStore = port;
    await prepareSaveStore();

    await persistAutosave(Simulation.newGame(7));

    expect(written.length).toBe(1);
    expect(written[0]!.id).toBe("auto");
    expect(written[0]!.scope).toBe(LOCAL);
    // The same container the migration writes and SaveGame.import reads, so one
    // format crosses the bridge rather than two.
    expect(written[0]!.contents.startsWith("VCTOWER1\n")).toBe(true);
    // localStorage is not the save TARGET, but the boot-hydrated CACHE is
    // refreshed from the value the store just committed, so a mid-session
    // "Load auto" serves this tower rather than the boot copy. The cache entry
    // is derived from the store's accepted contents, never written on its own,
    // and the coherence stamp is updated in the same motion.
    const cached = localStorage.getItem("verticopolis-save");
    expect(cached).not.toBeNull();
    expect(cached).toBe("VCZ1:" + written[0]!.contents.trim().slice("VCTOWER1\n".length).replace(/\s+/g, ""));
    expect(localStorage.getItem("vc-store-acked")).not.toBeNull();
    expect(localStorage.length).toBe(2);
  });

  it("a session whose hydration DISAGREED stays browser-equivalent", async () => {
    // The tripwire's replacement, from the other side. `storeIsAuthoritative()`
    // is now the FACT that hydration materialized the store into the readers;
    // when it did not (here: a readable localStorage tower the store knows
    // nothing about), routing writes to the store would put progress where no
    // reader looks. The session saves to localStorage exactly as on the web,
    // and the same comparison reruns next boot.
    const { port, written } = fakeStore();
    // The migration's write fails, so the readable localStorage tower stays a
    // STRAY the store has no record of, which is the shape hydration reads as
    // disagreement (recurring, self-healing when the migration succeeds) and
    // never as degraded (which would pause saving).
    port.write = () => Promise.reject(Object.assign(new Error("no space"), { code: "full" }));
    injectedStore = port;
    const stray = storeValue(TOWER);
    localStorage.setItem("verticopolis-save", stray);
    await prepareSaveStore();

    await persistAutosave(Simulation.newGame(7));

    expect(written).toEqual([]);
    const after = localStorage.getItem("verticopolis-save");
    expect(after).not.toBeNull();
    // And it genuinely SAVED there, rather than skipping: the new game's tower
    // replaced the stray.
    expect(after).not.toBe(stray);
  });

  it("falls back to localStorage when the shell offers no store", async () => {
    // A wrapped build whose shell has no store, or whose list() failed, still
    // has to save somewhere. That somewhere is localStorage, exactly as on web.
    await prepareSaveStore();

    await persistAutosave(Simulation.newGame(7));

    expect(localStorage.getItem("verticopolis-save")).not.toBeNull();
  });

  it("REGRESSION: does not fall back to localStorage when the store REFUSES", async () => {
    // `origin-gone`: the tower's own scope disappeared mid-session. The entire
    // point of refusing is to avoid writing it somewhere every account on the
    // machine can read, so a localStorage fallback here would do the thing the
    // refusal exists to prevent. A periodic autosave is best effort; the next
    // tick tries again.
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

  it("a DEGRADED session saves nowhere, and says so once per tower", async () => {
    // The shell listed towers hydration could not read. A store write would
    // land where no reader looks; a localStorage write would be overwritten by
    // the next boot's successful hydration (#736 F1). Manual saves refuse with
    // modal wording, but the periodic autosave has no surface, so it logs one
    // bulletin per sim rather than staying silent all session.
    injectedStore = {
      list: (): Promise<SaveStoreSnapshot> =>
        Promise.resolve({
          scopes: [{ token: LOCAL, label: "This computer", shared: true }],
          records: [{ id: "auto", scope: LOCAL, bytes: 5 }],
        }),
      read: () => Promise.reject(new Error("io")),
      write: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    await prepareSaveStore();

    const sim = Simulation.newGame(7);
    const emit = vi.spyOn(sim, "emit");
    await persistAutosave(sim);
    await persistAutosave(sim);

    expect(localStorage.length).toBe(0);
    const pauses = emit.mock.calls.filter(([text]) => text.includes("Autosave is paused"));
    expect(pauses.length).toBe(1);
    expect(pauses[0]![1]).toBe("bad");
  });
});

describe("a hydrated session never writes localStorage as a save target", () => {
  it("REGRESSION: a failed write on an ACCOUNT-scoped tower writes nowhere", async () => {
    // The leak a confirming pass found in an earlier fix. Keying the fallback on
    // the refusal NAME, and falling back for everything except `origin-gone`,
    // meant one disk-full tick wrote an account's tower into localStorage.
    // localStorage carries no scope, so the next boot's migration correctly
    // read it as ownerless and moved it into the SHARED namespace, where every
    // account on the machine can read it. That reaches in two steps the
    // destination `origin-gone` refuses to reach in one.
    const ACCOUNT = asScopeToken("account:test-scope");
    const port: SaveStorePort = {
      list: (): Promise<SaveStoreSnapshot> =>
        Promise.resolve({
          scopes: [
            { token: LOCAL, label: "This computer", shared: true },
            { token: ACCOUNT, label: "Your towers", shared: false },
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

  it("and neither does a SHARED-scoped tower: a failed tick retries, it does not fork", async () => {
    // This used to fall back, on the reasoning that a shared-headed tower had
    // no exposure to lose. D4 removed the fallback entirely for hydrated
    // sessions: a localStorage copy written past the store makes the cache
    // disagree with the stamp, and while the next boot's reconcile-forward
    // would heal it, healing a fork every failed tick is strictly worse than
    // retrying the write next tick with nothing forked.
    const { port } = fakeStore();
    port.write = () => Promise.reject(Object.assign(new Error("no space"), { code: "full" }));
    injectedStore = port;
    await prepareSaveStore();

    await persistAutosave(Simulation.newGame(7));

    expect(localStorage.length).toBe(0);
  });
});
