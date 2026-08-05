import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SaveScopeToken, SaveStorePort } from "../platform/saveStore";
import { ackedHash, coherenceHash, noteAcked } from "../storage/saveStoreAcked";
import { toTowerFile } from "../storage/saveMigration";
import { conflictBulletinText } from "./desktopSaveHydrate";
import { LOCAL, TOWER, fakeStore, storeValue } from "./desktopSaveStore.fixture";

/**
 * Hydration's THREE-WAY, decided by the coherence stamp: which side moved
 * since the store last acknowledged a value. This replaces the party-rejected
 * "store wins, no comparison" (#736 F1), whose two tower-loss constructions
 * (a browser-equivalent session's progress bulldozed when a stray heals, and
 * Steam Cloud replacing store files under a newer cache) both came from
 * overwriting without knowing which side moved.
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

const { prepareSaveStore, resetSaveStoreForTests, storeIsAuthoritative, hydrationConflictIds } =
  await import("./desktopSaveStore");

const SHARED = [{ token: LOCAL, label: "This computer", shared: true }];
const V1 = storeValue(TOWER);
const V2 = storeValue({ ...TOWER, towerName: "Newer" });

/** Seed the store with `value` (a VCZ1 store value) under `id`. */
function seed(store: ReturnType<typeof fakeStore>, id: string, value: string, scope: SaveScopeToken = LOCAL): void {
  const converted = toTowerFile(value);
  if (!converted.ok) throw new Error("fixture is not convertible");
  store.held.set(`${scope}|${id}`, converted.text);
}

beforeEach(() => {
  resetSaveStoreForTests();
  injectedStore = undefined;
  localStorage.clear();
});

describe("the coherence three-way at hydration", () => {
  it("store == cache: coherent, and the stamp is refreshed", async () => {
    const store = fakeStore(SHARED);
    seed(store, "auto", V1);
    localStorage.setItem("verticopolis-save", V1);
    injectedStore = store.port;

    await prepareSaveStore();

    expect(storeIsAuthoritative()).toBe(true);
    expect(localStorage.getItem("verticopolis-save")).toBe(V1);
    expect(ackedHash("auto")).toBe(coherenceHash(V1));
    expect(store.calls.writes).toEqual([]);
    expect(hydrationConflictIds()).toEqual([]);
  });

  it("the STORE moved (cache == acked): store wins, legitimately", async () => {
    // Steam Cloud brought another machine's progress, which syncs before
    // launch by design. The cache is exactly what the store last acknowledged,
    // so overwriting it loses nothing.
    const store = fakeStore(SHARED);
    seed(store, "auto", V2);
    localStorage.setItem("verticopolis-save", V1);
    noteAcked("auto", V1);
    injectedStore = store.port;

    await prepareSaveStore();

    expect(storeIsAuthoritative()).toBe(true);
    expect(localStorage.getItem("verticopolis-save")).toBe(V2);
    expect(ackedHash("auto")).toBe(coherenceHash(V2));
    // No stash: nothing was lost, so nothing to recover.
    expect(localStorage.getItem("vc-conflict-auto")).toBeNull();
    expect(hydrationConflictIds()).toEqual([]);
    expect(store.calls.writes).toEqual([]);
  });

  it("REGRESSION (#736 F1): the CACHE moved (store == acked): reconciled FORWARD, never bulldozed", async () => {
    // The party-blocking construction: a browser-equivalent session saved real
    // progress to localStorage (say, an old shell without writeSync), and the
    // pre-stamp rule would have overwritten it with the older store copy at
    // the next boot. The stamp proves the store did NOT move, so the cache is
    // strictly newer and is pushed INTO the store instead.
    const store = fakeStore(SHARED);
    seed(store, "auto", V1);
    localStorage.setItem("verticopolis-save", V2);
    noteAcked("auto", V1);
    injectedStore = store.port;

    await prepareSaveStore();

    expect(storeIsAuthoritative()).toBe(true);
    // The newer local tower SURVIVES...
    expect(localStorage.getItem("verticopolis-save")).toBe(V2);
    // ...and the store was brought up to it, with a real seq.
    expect(store.calls.writes).toEqual([{ id: "auto", scope: LOCAL }]);
    const forward = toTowerFile(V2);
    if (!forward.ok) throw new Error("fixture is not convertible");
    expect(store.held.get(`${LOCAL}|auto`)).toBe(forward.text);
    expect(ackedHash("auto")).toBe(coherenceHash(V2));
    expect(hydrationConflictIds()).toEqual([]);
  });

  it("a FAILED reconcile-forward keeps the newer cache and retries next boot", async () => {
    const store = fakeStore(SHARED);
    seed(store, "auto", V1);
    localStorage.setItem("verticopolis-save", V2);
    noteAcked("auto", V1);
    store.port.write = () => Promise.reject(new Error("io"));
    injectedStore = store.port;

    await prepareSaveStore();

    // Hydration still SUCCEEDS: the failure cost is a retry, never the session.
    expect(storeIsAuthoritative()).toBe(true);
    expect(localStorage.getItem("verticopolis-save")).toBe(V2);
    // The stamp still says V1 was the last acknowledged value, so the next
    // boot re-runs the same reconcile rather than reading V2 as a conflict.
    expect(ackedHash("auto")).toBe(coherenceHash(V1));
  });

  it("BOTH moved: the local copy is stashed, the store wins, and the caller is told", async () => {
    const store = fakeStore(SHARED);
    const V3 = storeValue({ ...TOWER, towerName: "Store side" });
    seed(store, "auto", V3);
    localStorage.setItem("verticopolis-save", V2);
    noteAcked("auto", V1); // matches NEITHER side
    injectedStore = store.port;

    await prepareSaveStore();

    expect(storeIsAuthoritative()).toBe(true);
    expect(localStorage.getItem("verticopolis-save")).toBe(V3);
    // The losing copy is evidence for recovery, not silently gone.
    expect(localStorage.getItem("vc-conflict-auto")).toBe(V2);
    expect(hydrationConflictIds()).toEqual(["auto"]);
    expect(ackedHash("auto")).toBe(coherenceHash(V3));
  });

  it("NOTHING ever acked reads conservatively, as a conflict", async () => {
    // A legacy machine's first boot with divergent copies has no stamp to
    // consult. Guessing either way risks a tower; stashing risks nothing.
    const store = fakeStore(SHARED);
    seed(store, "auto", V1);
    localStorage.setItem("verticopolis-save", V2);
    injectedStore = store.port;

    await prepareSaveStore();

    expect(storeIsAuthoritative()).toBe(true);
    expect(localStorage.getItem("verticopolis-save")).toBe(V1);
    expect(localStorage.getItem("vc-conflict-auto")).toBe(V2);
    expect(hydrationConflictIds()).toEqual(["auto"]);
  });

  it("REGRESSION: a legacy raw-JSON cache beside its own migrated form is NOT a conflict", async () => {
    // A pre-compression save's first desktop boot: the migration deflates the
    // raw JSON into the store in the same boot hydration runs. No stamp
    // exists yet and the strings differ, so an earlier revision stashed the
    // cache and warned about a sync divergence on a machine that has never
    // synced anything. Same bytes, two representations: coherent.
    const raw = JSON.stringify({ ...TOWER });
    const store = fakeStore(SHARED);
    seed(store, "auto", storeValue(TOWER)); // what migrating `raw` produces
    localStorage.setItem("verticopolis-save", raw);
    injectedStore = store.port;

    await prepareSaveStore();

    expect(storeIsAuthoritative()).toBe(true);
    // The readers keep serving exactly what they already had.
    expect(localStorage.getItem("verticopolis-save")).toBe(raw);
    expect(localStorage.getItem("vc-conflict-auto")).toBeNull();
    expect(hydrationConflictIds()).toEqual([]);
    expect(ackedHash("auto")).toBe(coherenceHash(raw));
  });

  it("REGRESSION: a TIMED-OUT reconcile-forward write leaves NO stamp", async () => {
    // withTimeout RESOLVES null on a hang rather than rejecting. Stamping a
    // write the shell may have dropped would make the next boot read the
    // cache as store-acknowledged and let the older store copy win silently,
    // the one branch of the three-way with no stash.
    vi.useFakeTimers();
    try {
      const store = fakeStore(SHARED);
      seed(store, "auto", V1);
      localStorage.setItem("verticopolis-save", V2);
      noteAcked("auto", V1); // the cache moved: reconcile-forward
      store.port.write = () => new Promise<void>(() => {}); // hangs
      injectedStore = store.port;

      const booted = prepareSaveStore();
      await vi.advanceTimersByTimeAsync(8000);
      await booted;

      expect(storeIsAuthoritative()).toBe(true);
      expect(localStorage.getItem("verticopolis-save")).toBe(V2);
      // Still V1: the next boot re-runs the same reconcile instead of
      // misreading V2 as what the store acknowledged.
      expect(ackedHash("auto")).toBe(coherenceHash(V1));
      // And the evidence of a hung write reaches the circuit breaker, so the
      // session's first sendSync cannot freeze the renderer on a main
      // process that was already hanging writes at boot.
      const { writeTowerToStoreSync } = await import("./desktopSaveStore");
      store.port.writeSync = () => ({ ok: true });
      expect(writeTowerToStoreSync("auto", "x")).toEqual({
        ok: false,
        refusal: "failed",
        code: "stalled",
        localFallbackSafe: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a quota failure mid-write rolls back the conflict STASH too, not just the slot keys", async () => {
    // The stash is part of the same transaction: written before a later
    // setItem hits quota, it would otherwise survive the rollback as debris
    // that makes the next boot's quota failure strictly likelier.
    const store = fakeStore(SHARED);
    const V3 = storeValue({ ...TOWER, towerName: "Store A" });
    const V4 = storeValue({ ...TOWER, towerName: "Store B" });
    seed(store, "auto", V3);
    seed(store, "slot-1", V4);
    localStorage.setItem("verticopolis-save", V1); // conflicts with V3, no stamp
    localStorage.setItem("simtower-clone-slot-1", V2); // conflicts with V4, no stamp
    injectedStore = store.port;

    // Let the FIRST conflict's stash and value land, then hit quota ONCE (the
    // second conflict's stash). The rollback's own restores go through, which
    // is the realistic shape: the failing write was the biggest one. The spy
    // targets the INSTANCE: happy-dom's localStorage does not dispatch
    // through Storage.prototype, so a prototype spy intercepts nothing.
    let writes = 0;
    const realSetItem = localStorage.setItem.bind(localStorage);
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      writes += 1;
      if (writes === 3) throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
      realSetItem(key, value);
    });
    try {
      await prepareSaveStore();
    } finally {
      setItem.mockRestore();
    }

    // The interception genuinely fired (guards against a vacuous pass).
    expect(writes).toBeGreaterThanOrEqual(3);
    // The whole hydration failed as a disagreement, and localStorage is
    // EXACTLY as it stood: values restored, no stash debris for either slot.
    expect(storeIsAuthoritative()).toBe(false);
    expect(localStorage.getItem("verticopolis-save")).toBe(V1);
    expect(localStorage.getItem("simtower-clone-slot-1")).toBe(V2);
    expect(localStorage.getItem("vc-conflict-auto")).toBeNull();
    expect(localStorage.getItem("vc-conflict-slot-1")).toBeNull();
  });

  it("the unreadable stash CONVERGES: the boot after a reconcile writes nothing", async () => {
    // The preserve round trip is representation-shifting for a raw-bytes
    // stash (it deflates on the way in), so without the equivalence check the
    // reconcile fired again on every boot forever, churning a durable write
    // plus a cloud sync per launch.
    const store = fakeStore(SHARED);
    const stored = toTowerFile("stash-bytes", true);
    if (!stored.ok) throw new Error("fixture");
    store.held.set(`${LOCAL}|unreadable`, stored.text);
    localStorage.setItem("simtower-clone-unreadable", "stash-bytes");
    injectedStore = store.port;

    await prepareSaveStore();

    expect(storeIsAuthoritative()).toBe(true);
    expect(store.calls.writes).toEqual([]);
    expect(localStorage.getItem("simtower-clone-unreadable")).toBe("stash-bytes");
  });

  it("the unreadable stash reconciles the OTHER way: localStorage wins", async () => {
    // The stash is preserved bytes, and a fresh local stash is by definition
    // the copy worth keeping; the store's older one was already superseded on
    // this machine.
    const store = fakeStore(SHARED);
    // Preserve mode: the store-side stash round-trips verbatim.
    const stored = toTowerFile("old-stash-bytes", true);
    if (!stored.ok) throw new Error("fixture");
    store.held.set(`${LOCAL}|unreadable`, stored.text);
    localStorage.setItem("simtower-clone-unreadable", "new-stash-bytes");
    injectedStore = store.port;

    await prepareSaveStore();

    expect(storeIsAuthoritative()).toBe(true);
    expect(localStorage.getItem("simtower-clone-unreadable")).toBe("new-stash-bytes");
    expect(store.calls.writes).toEqual([{ id: "unreadable", scope: LOCAL }]);
    const forwarded = toTowerFile("new-stash-bytes", true);
    expect(forwarded.ok && store.held.get(`${LOCAL}|unreadable`) === forwarded.text).toBe(true);
  });
});

describe("conflictBulletinText", () => {
  it("names the autosave and slots the way the saves UI does", () => {
    expect(conflictBulletinText("auto")).toContain("your autosave");
    expect(conflictBulletinText("auto-legacy")).toContain("your autosave");
    expect(conflictBulletinText("slot-2")).toContain("save slot 2");
    // The promise the wording makes must stay true: the stash exists.
    expect(conflictBulletinText("slot-2")).toContain("set aside");
  });
});
