import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeIndexedDb } from "../tests/fakeIndexedDb";
import { closeSaveStoreForTests, openSaveStore, saveStore, type SaveStoreKeys } from "./saveStore";
import { STORE_MAGIC, toBase64 } from "./saveCompression";

const AUTO = "auto";
const SLOT = "slot-1";
const STASH = "stash";
const KEYS: SaveStoreKeys = { managed: [AUTO, SLOT, STASH], mirrored: [AUTO] };

/** The write time a test value carries: `t<ms>:` in front, or none. */
const savedAt = (value: string): number | undefined => {
  const m = /^t(\d+):/.exec(value);
  return m ? Number(m[1]) : undefined;
};

let fake: FakeIndexedDb;
const open = () => openSaveStore(KEYS, { factory: fake.asFactory(), savedAt });
const reopen = async () => {
  closeSaveStoreForTests();
  return open();
};

beforeEach(() => {
  localStorage.clear();
  fake = new FakeIndexedDb();
});

afterEach(() => {
  closeSaveStoreForTests();
  vi.restoreAllMocks();
});

describe("saveStore before it opens", () => {
  it("is localStorage", () => {
    saveStore.set(SLOT, "t1:slot");
    expect(localStorage.getItem(SLOT)).toBe("t1:slot");
    expect(saveStore.get(SLOT)).toBe("t1:slot");
    saveStore.remove(SLOT);
    expect(localStorage.getItem(SLOT)).toBeNull();
    expect(saveStore.backend()).toBe("localStorage");
  });

  it("stays on localStorage when the database will not open", async () => {
    fake.failOpen = true;
    expect(await open()).toBe(false);
    expect(saveStore.backend()).toBe("localStorage");
  });

  it("stays on localStorage when the database does not answer in time, and lets a late answer go", async () => {
    fake.openDelayMs = 40;
    expect(await openSaveStore(KEYS, { factory: fake.asFactory(), savedAt, timeoutMs: 5 })).toBe(false);
    expect(saveStore.backend()).toBe("localStorage");
    await vi.waitFor(() => expect(fake.lastDb?.closed).toBe(true));
    expect(saveStore.backend()).toBe("localStorage");
  });

  it("stays on localStorage, with nothing marked copied, when the copy does not read back", async () => {
    localStorage.setItem(SLOT, "t1:slot");
    fake.dropWrites = true;
    expect(await open()).toBe(false);
    expect(saveStore.backend()).toBe("localStorage");
    expect(fake.row("verticopolis", "meta", "migrated-from-localStorage")).toBeUndefined();
    expect(saveStore.get(SLOT)).toBe("t1:slot");
  });
});

describe("the first open", () => {
  it("copies every localStorage save in, marks the copy done and leaves the originals", async () => {
    const packed = new Uint8Array([1, 2, 3, 250]);
    localStorage.setItem(AUTO, "t5:auto");
    localStorage.setItem(SLOT, STORE_MAGIC + toBase64(packed));
    localStorage.setItem(STASH, "unreadable bytes");
    expect(await open()).toBe(true);
    expect(saveStore.backend()).toBe("indexedDB");
    expect(fake.row("verticopolis", "saves", AUTO)).toEqual({ text: "t5:auto" });
    expect(fake.row("verticopolis", "saves", SLOT)).toEqual({ packed });
    expect(fake.row("verticopolis", "saves", STASH)).toEqual({ text: "unreadable bytes" });
    expect(fake.row("verticopolis", "meta", "migrated-from-localStorage")).toBe(true);
    expect(saveStore.get(SLOT)).toBe(STORE_MAGIC + toBase64(packed));
    expect(localStorage.getItem(SLOT)).toBe(STORE_MAGIC + toBase64(packed));
  });

  it("copies nothing again once the copy is marked done", async () => {
    localStorage.setItem(SLOT, "t1:old");
    await open();
    localStorage.setItem(SLOT, "t9:written by an older build");
    await reopen();
    expect(saveStore.get(SLOT)).toBe("t1:old");
  });
});

describe("the autosave's two copies", () => {
  beforeEach(() => {
    fake.seed("verticopolis", "meta", "migrated-from-localStorage", true);
  });

  it("takes localStorage's when it is newer, and writes it back to the database", async () => {
    fake.seed("verticopolis", "saves", AUTO, { text: "t5:db" });
    localStorage.setItem(AUTO, "t6:local");
    await open();
    expect(saveStore.get(AUTO)).toBe("t6:local");
    expect(fake.row("verticopolis", "saves", AUTO)).toEqual({ text: "t6:local" });
  });

  it("takes localStorage's when the database has none", async () => {
    localStorage.setItem(AUTO, "no time");
    await open();
    expect(saveStore.get(AUTO)).toBe("no time");
  });

  it("keeps the database's when it is newer, on a tie, or when a time cannot be read", async () => {
    for (const [db, local] of [
      ["t7:db", "t6:local"],
      ["t6:db", "t6:local"],
      ["t6:db", "no time"],
    ]) {
      fake.seed("verticopolis", "saves", AUTO, { text: db });
      localStorage.setItem(AUTO, local);
      await reopen();
      expect(saveStore.get(AUTO), `${db} against ${local}`).toBe(db);
    }
  });

  it("deletes the database copy of a key localStorage no longer holds", async () => {
    fake.seed("verticopolis", "saves", AUTO, { text: "t5:deleted by an older build" });
    await open();
    expect(saveStore.get(AUTO)).toBeNull();
    expect(fake.row("verticopolis", "saves", AUTO)).toBeUndefined();
  });

  it("keeps the database copy when localStorage cannot be read", async () => {
    fake.seed("verticopolis", "saves", AUTO, { text: "t5:db" });
    vi.spyOn(localStorage, "getItem").mockImplementationOnce(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    await open();
    expect(saveStore.get(AUTO)).toBe("t5:db");
    expect(fake.row("verticopolis", "saves", AUTO)).toEqual({ text: "t5:db" });
  });

  it("takes localStorage's over a database copy whose time cannot be read", async () => {
    fake.seed("verticopolis", "saves", AUTO, { text: "no time" });
    localStorage.setItem(AUTO, "t1:local");
    await open();
    expect(saveStore.get(AUTO)).toBe("t1:local");
  });
});

describe("writes once open", () => {
  beforeEach(async () => {
    await open();
  });

  it("put a slot in the database alone, and the autosave in both", async () => {
    saveStore.set(SLOT, "t2:slot");
    saveStore.set(AUTO, "t2:auto");
    expect(saveStore.get(SLOT)).toBe("t2:slot");
    expect(localStorage.getItem(SLOT)).toBeNull();
    expect(localStorage.getItem(AUTO)).toBe("t2:auto");
    await saveStore.settled();
    expect(fake.row("verticopolis", "saves", SLOT)).toEqual({ text: "t2:slot" });
    expect(fake.row("verticopolis", "saves", AUTO)).toEqual({ text: "t2:auto" });
  });

  it("keep a writer's deflate bytes as they are, with the text in memory and in the mirror", async () => {
    const packed = new Uint8Array([9, 8, 7]);
    // The bytes are the writer's word for the text's payload: the store
    // keeps them without decoding the text to check, so a mismatch shows here.
    const value = STORE_MAGIC + toBase64(new Uint8Array([1, 2, 3]));
    saveStore.set(AUTO, value, packed);
    expect(saveStore.get(AUTO)).toBe(value);
    expect(localStorage.getItem(AUTO)).toBe(value);
    await saveStore.settled();
    expect(fake.row("verticopolis", "saves", AUTO)).toEqual({ packed });
  });

  it("land in the order they were made", async () => {
    saveStore.set(SLOT, "t1:first");
    saveStore.set(SLOT, "t2:second");
    saveStore.remove(SLOT);
    saveStore.set(SLOT, "t3:third");
    await saveStore.settled();
    expect(fake.row("verticopolis", "saves", SLOT)).toEqual({ text: "t3:third" });
  });

  it("remove a slot from the database and the old localStorage copy", async () => {
    localStorage.setItem(SLOT, "t1:copy an older build reads");
    saveStore.set(SLOT, "t2:slot");
    await saveStore.settled();
    saveStore.remove(SLOT);
    expect(saveStore.get(SLOT)).toBeNull();
    expect(localStorage.getItem(SLOT)).toBeNull();
    await saveStore.settled();
    expect(fake.row("verticopolis", "saves", SLOT)).toBeUndefined();
  });

  it("read back after a reload", async () => {
    saveStore.set(SLOT, "t4:slot");
    await saveStore.settled();
    await reopen();
    expect(saveStore.get(SLOT)).toBe("t4:slot");
  });

  it("throw and change nothing when localStorage refuses the autosave", () => {
    saveStore.set(AUTO, "t1:auto");
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const commits = fake.commits;
    expect(() => saveStore.set(AUTO, "t2:auto")).toThrow("full");
    expect(saveStore.get(AUTO)).toBe("t1:auto");
    expect(fake.commits).toBe(commits);
  });

  it("leave other keys to localStorage", () => {
    saveStore.set("vc-prefs", "x");
    expect(localStorage.getItem("vc-prefs")).toBe("x");
    expect(saveStore.get("vc-prefs")).toBe("x");
  });
});

describe("a database write that fails", () => {
  beforeEach(async () => {
    await open();
  });

  it("is reported for a slot, and by settled once", async () => {
    const heard = vi.fn();
    saveStore.onFailure(heard);
    fake.failWrites = true;
    saveStore.set(SLOT, "t1:slot");
    await expect(saveStore.settled()).rejects.toMatchObject({ name: "QuotaExceededError" });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard.mock.calls[0][1]).toBe(SLOT);
    await expect(saveStore.settled()).resolves.toBeUndefined();
  });

  it("is not reported for the autosave, whose localStorage copy is whole, or for a delete", async () => {
    const heard = vi.fn();
    saveStore.onFailure(heard);
    fake.failWrites = true;
    saveStore.set(AUTO, "t1:auto");
    saveStore.remove(SLOT);
    await expect(saveStore.settled()).rejects.toBeDefined();
    expect(heard).not.toHaveBeenCalled();
    expect(localStorage.getItem(AUTO)).toBe("t1:auto");
  });

  it("does not stop the writes after it", async () => {
    fake.failWrites = true;
    saveStore.set(SLOT, "t1:lost");
    await saveStore.settled().catch(() => undefined);
    fake.failWrites = false;
    saveStore.set(SLOT, "t2:kept");
    await saveStore.settled();
    expect(fake.row("verticopolis", "saves", SLOT)).toEqual({ text: "t2:kept" });
  });

  it("stops being heard once unsubscribed", async () => {
    const heard = vi.fn();
    saveStore.onFailure(heard)();
    fake.failWrites = true;
    saveStore.set(SLOT, "t1:slot");
    await saveStore.settled().catch(() => undefined);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe("another tab", () => {
  it("that writes localStorage alone reaches this tab's memory for a mirrored key", async () => {
    await open();
    const tell = (key: string, newValue: string | null) => window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea: localStorage }));
    tell(AUTO, "t8:an older build's tab");
    expect(saveStore.get(AUTO)).toBe("t8:an older build's tab");
    tell(SLOT, "t9:not mirrored here");
    expect(saveStore.get(SLOT)).toBeNull();
    tell(AUTO, null);
    expect(saveStore.get(AUTO)).toBeNull();
  });

  it("that upgrades the database makes this one close and go back to localStorage", async () => {
    await open();
    localStorage.setItem(AUTO, "t3:auto");
    fake.lastDb!.onversionchange!();
    expect(fake.lastDb!.closed).toBe(true);
    expect(saveStore.backend()).toBe("localStorage");
    expect(saveStore.get(AUTO)).toBe("t3:auto");
  });

  it("updates this tab's memory when it writes or deletes a save", async () => {
    await open();
    const other = new BroadcastChannel("verticopolis-saves");
    const heard = new Promise<void>((resolve) => {
      const probe = new BroadcastChannel("verticopolis-saves");
      let n = 0;
      probe.onmessage = () => {
        if (++n === 3) {
          probe.close();
          resolve();
        }
      };
    });
    other.postMessage({ key: SLOT, value: "t9:from the other tab" });
    other.postMessage({ key: "not a save", value: "ignored" });
    other.postMessage({ key: STASH, value: null });
    await heard;
    await new Promise((r) => setTimeout(r, 0));
    other.close();
    expect(saveStore.get(SLOT)).toBe("t9:from the other tab");
    expect(saveStore.get(STASH)).toBeNull();
    expect(saveStore.get("not a save")).toBeNull();
  });
});

describe("regressions", () => {
  it("a second open answers true and opens nothing more", async () => {
    expect(await open()).toBe(true);
    const db = fake.lastDb;
    expect(await open()).toBe(true);
    expect(fake.lastDb).toBe(db);
  });

  it("keeps a large compressed save byte for byte as its raw bytes", async () => {
    const bytes = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 7919) % 256);
    const value = STORE_MAGIC + toBase64(bytes);
    await open();
    saveStore.set(SLOT, value);
    await saveStore.settled();
    const row = fake.row("verticopolis", "saves", SLOT) as { packed: Uint8Array };
    expect(row.packed.length).toBe(bytes.length);
    await reopen();
    expect(saveStore.get(SLOT)).toBe(value);
  });

  it("keeps a damaged compressed value as its text, so it reads back byte for byte", async () => {
    await open();
    for (const value of [STORE_MAGIC + "not base64!", STORE_MAGIC + "abc", STORE_MAGIC + "QQ==\n"]) {
      saveStore.set(SLOT, value);
      await saveStore.settled();
      expect(fake.row("verticopolis", "saves", SLOT)).toEqual({ text: value });
      await reopen();
      expect(saveStore.get(SLOT)).toBe(value);
    }
  });

  it("keeps a save that is not compressed as its text", async () => {
    await open();
    saveStore.set(SLOT, '{"version":7}');
    await saveStore.settled();
    expect(fake.row("verticopolis", "saves", SLOT)).toEqual({ text: '{"version":7}' });
  });

  it("ignores a database row it did not write, and the localStorage copy stands", async () => {
    fake.seed("verticopolis", "meta", "migrated-from-localStorage", true);
    fake.seed("verticopolis", "saves", AUTO, { something: "else" });
    fake.seed("verticopolis", "saves", STASH, 42);
    localStorage.setItem(AUTO, "t1:local");
    await open();
    expect(saveStore.get(AUTO)).toBe("t1:local");
    expect(saveStore.get(STASH)).toBeNull();
  });

  it("writes made before the store opens go to localStorage and are copied in at the first open", async () => {
    saveStore.set(SLOT, "t1:before");
    saveStore.set(AUTO, "t1:auto before");
    await open();
    expect(saveStore.get(SLOT)).toBe("t1:before");
    expect(fake.row("verticopolis", "saves", AUTO)).toEqual({ text: "t1:auto before" });
  });

  it("a copy that fails to land leaves the copy unmarked, so the next boot copies again", async () => {
    localStorage.setItem(SLOT, "t1:slot");
    fake.failWrites = true;
    expect(await open()).toBe(false);
    expect(fake.row("verticopolis", "meta", "migrated-from-localStorage")).toBeUndefined();
    fake.failWrites = false;
    expect(await open()).toBe(true);
    expect(saveStore.get(SLOT)).toBe("t1:slot");
  });

  it("a key that is not mirrored keeps its database copy when localStorage has none", async () => {
    fake.seed("verticopolis", "meta", "migrated-from-localStorage", true);
    fake.seed("verticopolis", "saves", SLOT, { text: "t1:slot" });
    await open();
    expect(saveStore.get(SLOT)).toBe("t1:slot");
  });

  it("writes nothing at boot when the two copies agree", async () => {
    fake.seed("verticopolis", "meta", "migrated-from-localStorage", true);
    fake.seed("verticopolis", "saves", AUTO, { text: "t5:same" });
    localStorage.setItem(AUTO, "t5:same");
    const commits = fake.commits;
    await open();
    expect(fake.commits).toBe(commits);
  });

  it("after an upgrade closed it, a write goes to localStorage alone", async () => {
    await open();
    fake.lastDb!.onversionchange!();
    const commits = fake.commits;
    saveStore.set(AUTO, "t9:after");
    await saveStore.settled();
    expect(localStorage.getItem(AUTO)).toBe("t9:after");
    expect(fake.commits).toBe(commits);
  });

  it("another tab clearing localStorage drops every mirrored save from memory", async () => {
    localStorage.setItem(AUTO, "t1:auto");
    await open();
    window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
    expect(saveStore.get(AUTO)).toBeNull();
  });

  it("a storage event from another storage area changes nothing", async () => {
    localStorage.setItem(AUTO, "t1:auto");
    await open();
    window.dispatchEvent(new StorageEvent("storage", { key: AUTO, newValue: "t2:session", storageArea: sessionStorage }));
    expect(saveStore.get(AUTO)).toBe("t1:auto");
  });

  it("a cross-tab message without a string key or value changes nothing", async () => {
    localStorage.setItem(SLOT, "t1:slot");
    await open();
    const other = new BroadcastChannel("verticopolis-saves");
    const probe = new BroadcastChannel("verticopolis-saves");
    const heard = new Promise<void>((resolve) => {
      let n = 0;
      probe.onmessage = () => {
        if (++n === 2) resolve();
      };
    });
    other.postMessage({ key: 5, value: "x" });
    other.postMessage({ key: SLOT, value: 7 });
    await heard;
    await new Promise((r) => setTimeout(r, 0));
    other.close();
    probe.close();
    expect(saveStore.get(SLOT)).toBe("t1:slot");
  });

  it("a timed-out open leaves every later write in localStorage alone", async () => {
    fake.openDelayMs = 40;
    expect(await openSaveStore(KEYS, { factory: fake.asFactory(), savedAt, timeoutMs: 5 })).toBe(false);
    await vi.waitFor(() => expect(fake.lastDb?.closed).toBe(true));
    const commits = fake.commits;
    saveStore.set(SLOT, "t2:later");
    await saveStore.settled();
    expect(localStorage.getItem(SLOT)).toBe("t2:later");
    expect(saveStore.backend()).toBe("localStorage");
    expect(fake.commits).toBe(commits);
    expect(fake.row("verticopolis", "saves", SLOT)).toBeUndefined();
  });
});
