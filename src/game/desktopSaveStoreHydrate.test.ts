import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SaveScopeToken, SaveStorePort } from "../platform/saveStore";
import { SaveGame } from "../storage/SaveGame";
import { toTowerFile } from "../storage/saveMigration";
import { ACCOUNT, LOCAL, TOWER, fakeStore, storeValue } from "./desktopSaveStore.fixture";

/**
 * Hydration: materializing the store's records into localStorage once, before
 * `SaveGame` is first touched.
 *
 * The property under test is the one that decides whether a player keeps their
 * tower. A missing key reads as ABSENT, `hasSave()` goes false, the splash
 * offers New Tower rather than Continue, and the first autosave commits over a
 * real save. So a partial hydration must never happen: it is all of it or none
 * of it.
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
  storeIsAuthoritative,
  storeReadDegraded,
  noteTowerOriginForSlot,
  towerOrigin,
} = await import("./desktopSaveStore");

const SHARED = [{ token: LOCAL, label: "This computer", shared: true }];

/** Seed a store with a tower already in `.vctower` form under `id`. */
function seed(store: ReturnType<typeof fakeStore>, id: string, tower: unknown, scope: SaveScopeToken = LOCAL): void {
  const converted = toTowerFile(storeValue(tower));
  if (!converted.ok) throw new Error("fixture is not convertible");
  store.held.set(`${scope}|${id}`, converted.text);
}

beforeEach(() => {
  resetSaveStoreForTests();
  injectedStore = undefined;
  localStorage.clear();
});

describe("hydration materializes the store into localStorage", () => {
  it("makes a store-only tower loadable through the ordinary synchronous readers", async () => {
    // The whole point: localStorage starts EMPTY, the tower exists only in the
    // store, and `SaveGame` still answers without being made async.
    const store = fakeStore(SHARED);
    seed(store, "auto", TOWER);
    injectedStore = store.port;

    await prepareSaveStore();

    expect(SaveGame.hasSave()).toBe(true);
    expect(SaveGame.load()?.tower.towerName).toBe(TOWER.towerName);
    expect(storeIsAuthoritative()).toBe(true);
  });

  it("maps each store id back to the localStorage key that slot lives under", async () => {
    const store = fakeStore(SHARED);
    seed(store, "auto", TOWER);
    seed(store, "slot-2", { ...TOWER, towerName: "Second" });
    injectedStore = store.port;

    await prepareSaveStore();

    expect(localStorage.getItem("verticopolis-save")).not.toBeNull();
    expect(localStorage.getItem("simtower-clone-slot-2")).not.toBeNull();
    expect(SaveGame.hasSlot(2)).toBe(true);
    expect(SaveGame.loadSlot(2)?.tower.towerName).toBe("Second");
  });

  it("keeps Founder status across hydration", async () => {
    // `TOWER` carries no appVersion, which is what earns the badge, and the
    // reverse conversion must not have introduced one.
    const store = fakeStore(SHARED);
    seed(store, "auto", TOWER);
    injectedStore = store.port;

    await prepareSaveStore();

    expect(SaveGame.load()?.founder).toBe(true);
  });
});

describe("hydration is all or nothing", () => {
  it("REGRESSION: a failed read hydrates NOTHING, rather than leaving a slot looking empty", async () => {
    // The tower-deleting bug. With a partial hydration, `slot-1` would read as
    // absent, the free-slot picker would offer it, and a real manual save would
    // be overwritten. Refusing the whole hydration keeps localStorage as it
    // stands and the store simply is not used this session.
    const store = fakeStore(SHARED);
    seed(store, "auto", TOWER);
    seed(store, "slot-1", { ...TOWER, towerName: "Manual" });
    const realRead = store.port.read.bind(store.port);
    store.port.read = (id, scope) => (id === "slot-1" ? Promise.reject(new Error("io")) : realRead(id, scope));
    injectedStore = store.port;

    await prepareSaveStore();

    expect(localStorage.getItem("verticopolis-save")).toBeNull();
    expect(localStorage.getItem("simtower-clone-slot-1")).toBeNull();
    expect(storeIsAuthoritative()).toBe(false);
  });

  it("treats a null read as ambiguous rather than as absence", async () => {
    // Null means absent OR timed out, and neither is safe to render as "no
    // tower here".
    const store = fakeStore(SHARED);
    seed(store, "auto", TOWER);
    store.port.read = () => Promise.resolve(null);
    injectedStore = store.port;

    await prepareSaveStore();

    expect(storeIsAuthoritative()).toBe(false);
    expect(SaveGame.hasSave()).toBe(false);
  });

  it("refuses when a localStorage tower is not in the store, since the two disagree", async () => {
    // Reachable today: the migration skips entirely when no scope is marked
    // shared. Routing writes then would send the tower somewhere the readers
    // cannot see.
    const store = fakeStore([{ token: ACCOUNT, label: "Your towers", shared: false }]);
    injectedStore = store.port;
    localStorage.setItem("verticopolis-save", storeValue(TOWER));

    await prepareSaveStore();

    expect(storeIsAuthoritative()).toBe(false);
    // And the tower is untouched, so a later boot can still move it.
    expect(SaveGame.hasSave()).toBe(true);
  });

  it("an EMPTY store beside empty localStorage is consistent, not a failure", async () => {
    // A fresh desktop install. Nothing to hydrate is not the same as hydration
    // failing, and treating it as failure would leave the store unusable
    // forever on exactly the machines that have nothing to migrate.
    const store = fakeStore(SHARED);
    injectedStore = store.port;

    await prepareSaveStore();

    expect(storeIsAuthoritative()).toBe(true);
    expect(SaveGame.hasSave()).toBe(false);
  });
});

describe("a record this build cannot read stays visible", () => {
  it("hydrates a too-new container as present-but-unreadable, never as absent", async () => {
    // `VCTOWER2` from a future build. Dropping it would let the splash offer
    // New Tower and the first autosave commit over it. Written verbatim, it is
    // present to `getItem`, fails to parse in `readSlot`, and the saves UI
    // already has wording for that state.
    const store = fakeStore(SHARED);
    store.held.set(`${LOCAL}|slot-1`, "VCTOWER2\nAAAABBBB\n");
    injectedStore = store.port;

    await prepareSaveStore();

    expect(storeIsAuthoritative()).toBe(true);
    // PRESENT, so nothing offers the slot for overwrite.
    expect(SaveGame.hasSlot(1)).toBe(true);
    // But not loadable, so it renders with the existing unreadable wording.
    expect(SaveGame.loadSlot(1)).toBeNull();
    const info = SaveGame.listSlots().find((s) => s.slot === 1)!;
    expect(info.present).toBe(true);
    expect(info.exists).toBe(false);
  });

  it("keeps the bytes, so a later build can still recover the tower", async () => {
    const store = fakeStore(SHARED);
    store.held.set(`${LOCAL}|slot-1`, "VCTOWER2\nPAYLOAD\n");
    injectedStore = store.port;

    await prepareSaveStore();

    expect(localStorage.getItem("simtower-clone-slot-1")).toContain("PAYLOAD");
  });
});

describe("a degraded session is distinguished from no store at all", () => {
  it("reports degraded only when hydration RAN and failed", async () => {
    // Three boots that all end with hydrated === false, and only one of them
    // is degraded. Conflating them would either pause saving in a plain
    // browser-equivalent session or let a degraded one write.
    const store = fakeStore(SHARED);
    seed(store, "auto", TOWER);
    store.port.read = () => Promise.reject(new Error("io"));
    injectedStore = store.port;
    await prepareSaveStore();
    expect(storeReadDegraded()).toBe(true);

    resetSaveStoreForTests();
    injectedStore = undefined; // no store at all
    await prepareSaveStore();
    expect(storeReadDegraded()).toBe(false);

    resetSaveStoreForTests();
    // A healthy store: hydration runs and succeeds, so nothing is degraded.
    const idle = fakeStore(SHARED);
    seed(idle, "auto", TOWER);
    injectedStore = idle.port;
    await prepareSaveStore();
    expect(storeReadDegraded()).toBe(false);
  });

  it("REGRESSION (#736 F1): a degraded session autosaves NOWHERE", async () => {
    // A localStorage write here would be overwritten by the next boot's
    // successful hydration, which materializes the store over these very keys.
    // The degraded session's progress would be resurrected-over by an older
    // copy, so the honest answer is to write nothing and say saving is paused.
    const store = fakeStore(SHARED);
    seed(store, "auto", TOWER);
    store.port.read = () => Promise.reject(new Error("io"));
    injectedStore = store.port;
    await prepareSaveStore();

    const { persistAutosave } = await import("./autosavePersist");
    const { Simulation } = await import("../engine/Simulation");
    await persistAutosave(Simulation.newGame(5));

    expect(localStorage.length).toBe(0);
    expect(store.calls.writes).toEqual([]);
  });
});

describe("hydration records each slot's origin", () => {
  it("captures the scope a hydrated tower came from, for the origin rule", async () => {
    const store = fakeStore(SHARED);
    seed(store, "slot-2", TOWER);
    injectedStore = store.port;
    await prepareSaveStore();

    noteTowerOriginForSlot(2);
    expect(towerOrigin()).toEqual({ id: "slot-2", scope: LOCAL });
  });

  it("clears the origin for a slot that has no hydrated record", async () => {
    const store = fakeStore(SHARED);
    seed(store, "slot-2", TOWER);
    injectedStore = store.port;
    await prepareSaveStore();

    noteTowerOriginForSlot(2);
    noteTowerOriginForSlot(1); // never hydrated
    expect(towerOrigin()).toBeUndefined();
  });

  it("records no origins when hydration failed, so autosave cannot target an unseen scope", async () => {
    const store = fakeStore(SHARED);
    seed(store, "auto", TOWER);
    store.port.read = () => Promise.reject(new Error("io"));
    injectedStore = store.port;
    await prepareSaveStore();

    noteTowerOriginForSlot("auto");
    expect(towerOrigin()).toBeUndefined();
  });
});

describe("PR review P1: a migrated boot whose snapshot re-read fails is DEGRADED", () => {
  it("pauses saves rather than letting localStorage race the just-migrated store copy", async () => {
    // Codex's find. The migration copied towers into the store, then the
    // re-read failed and the boot returned neither hydrated nor degraded.
    // Saves then fell back to localStorage, putting NEWER progress beside the
    // OLDER store copy, and the next boot's hydration overwrote the newer
    // with the older: #736 F1's resurrection, made reachable by this branch.
    // The re-read failing is a bridge failure, so degraded is also the honest
    // description.
    const store = fakeStore(SHARED);
    localStorage.setItem("verticopolis-save", storeValue(TOWER));
    let lists = 0;
    const realList = store.port.list.bind(store.port);
    store.port.list = () => (++lists === 1 ? realList() : Promise.reject(new Error("io")));
    injectedStore = store.port;

    await prepareSaveStore();

    // The migration ran and moved the tower.
    expect(store.calls.writes.map((w) => w.id)).toEqual(["auto"]);
    // And the session is degraded: not silently browser-equivalent.
    expect(storeReadDegraded()).toBe(true);
    expect(storeIsAuthoritative()).toBe(false);

    const { persistAutosave } = await import("./autosavePersist");
    const { Simulation } = await import("../engine/Simulation");
    const before = localStorage.getItem("verticopolis-save");
    await persistAutosave(Simulation.newGame(5));
    expect(localStorage.getItem("verticopolis-save")).toBe(before);
  });
});
