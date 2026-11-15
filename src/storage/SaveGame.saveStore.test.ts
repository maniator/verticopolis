import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeIndexedDb } from "../tests/fakeIndexedDb";
import { SaveGame, UNREADABLE_KEY, openSaves } from "./SaveGame";
import { closeSaveStoreForTests, saveStore } from "./saveStore";
import { inflateCapped, STORE_MAGIC, toBase64 } from "./saveCompression";
import { resetSavePackerForTests } from "./savePacker";
import { stampText } from "./saveStamp";

/**
 * SaveGame through the save store, on a real tower: every read and write the
 * game makes lands in IndexedDB, comes back from it after a reload exactly as
 * it was written, and follows what an older build (localStorage alone) wrote
 * or deleted in between. The database is an in-memory fake
 * (`fakeIndexedDb.ts`); the store itself is `saveStore.test.ts`'s.
 */

const FIXTURE = resolve(__dirname, "../../conformance/fixtures/split-tower.vctower");
const AUTO_KEY = "verticopolis-save";
const SLOT_1 = "simtower-clone-slot-1";

let fake: FakeIndexedDb;
let tower: string;

/** A reload: the store closes, and the game opens it again at boot. */
async function reload(): Promise<boolean> {
  closeSaveStoreForTests();
  return openSaves(fake.asFactory());
}

/** The text the autosave read hands the engine, or null when nothing loads. */
function autosaveText(): string | null {
  let text: string | null = null;
  SaveGame.load((t) => ((text = t), true));
  return text;
}

/** The text a slot read hands the engine, or null. */
function slotText(n: number): string | null {
  let text: string | null = null;
  SaveGame.loadSlot(n, (t) => ((text = t), true));
  return text;
}

/** A packed value for `text` as a build writing at `ms` stores it. */
function packedAt(ms: number, text: string): string {
  const spy = vi.spyOn(Date, "now").mockReturnValue(ms);
  try {
    return SaveGame.packSync(text);
  } finally {
    spy.mockRestore();
  }
}

/** The same tower under another name, to tell two saves apart. */
const renamed = (name: string): string => JSON.stringify({ ...(JSON.parse(tower) as object), towerName: name });
const nameOf = (text: string | null): string | undefined => (text === null ? undefined : (JSON.parse(text) as { towerName: string }).towerName);

beforeEach(async () => {
  localStorage.clear();
  fake = new FakeIndexedDb();
  tower ??= await SaveGame.importText(readFileSync(FIXTURE, "utf8"));
});

afterEach(() => {
  closeSaveStoreForTests();
  vi.restoreAllMocks();
});

describe("SaveGame on the save store", () => {
  it("opens on IndexedDB at boot", async () => {
    expect(await openSaves(fake.asFactory())).toBe(true);
    expect(saveStore.backend()).toBe("indexedDB");
  });

  it("migrates the saves an older build left, and every read answers the same after the move", async () => {
    localStorage.setItem(AUTO_KEY, packedAt(1_000, renamed("Auto")));
    localStorage.setItem(SLOT_1, packedAt(2_000, renamed("Slot one")));
    const before = { auto: autosaveText(), slot: slotText(1), slots: SaveGame.listSlots() };
    await openSaves(fake.asFactory());
    expect({ auto: autosaveText(), slot: slotText(1), slots: SaveGame.listSlots() }).toEqual(before);
    expect(fake.row("verticopolis", "saves", AUTO_KEY)).toHaveProperty("packed");
    expect(fake.row("verticopolis", "saves", SLOT_1)).toHaveProperty("packed");
  });

  it("an autosave comes back from the database byte for byte after a reload, over a stale localStorage copy", async () => {
    await openSaves(fake.asFactory());
    SaveGame.save(renamed("Fresh"));
    const stored = saveStore.get(AUTO_KEY);
    const loaded = autosaveText();
    await saveStore.settled();
    localStorage.setItem(AUTO_KEY, packedAt(1, renamed("Stale")));
    await reload();
    expect(saveStore.get(AUTO_KEY)).toBe(stored);
    expect(autosaveText()).toBe(loaded);
    expect(nameOf(autosaveText())).toBe("Fresh");
  });

  it("an async autosave lands in the database too", async () => {
    await openSaves(fake.asFactory());
    await SaveGame.saveAsync(renamed("Async"));
    await saveStore.settled();
    localStorage.setItem(AUTO_KEY, packedAt(1, renamed("Stale")));
    await reload();
    expect(nameOf(autosaveText())).toBe("Async");
  });

  it("an autosave of the engine's stamped bytes stores their deflate as it is, and reloads as that save", async () => {
    await openSaves(fake.asFactory());
    const bytes = new TextEncoder().encode(stampText(renamed("Bytes")).json);
    await SaveGame.saveAsync(() => bytes.slice());
    await saveStore.settled();
    const row = fake.row("verticopolis", "saves", AUTO_KEY) as { packed: Uint8Array };
    expect(inflateCapped(row.packed)).toEqual(bytes);
    expect(saveStore.get(AUTO_KEY)).toBe(STORE_MAGIC + toBase64(row.packed));
    await reload();
    expect(nameOf(autosaveText())).toBe("Bytes");
  });

  it("a packer that dies with the bytes has the save made again and packed on the page", async () => {
    await openSaves(fake.asFactory());
    resetSavePackerForTests();
    vi.stubGlobal(
      "Worker",
      class {
        onerror: (() => void) | null = null;
        onmessage = null;
        onmessageerror = null;
        postMessage() {
          queueMicrotask(() => this.onerror?.());
        }
        terminate() {}
      },
    );
    let made = 0;
    try {
      await SaveGame.saveAsync(() => (made++, new TextEncoder().encode(stampText(renamed("Again")).json)));
    } finally {
      vi.unstubAllGlobals();
      resetSavePackerForTests();
    }
    expect(made).toBe(2);
    await saveStore.settled();
    await reload();
    expect(nameOf(autosaveText())).toBe("Again");
  });

  it("a slot saves, reloads and deletes through the store", async () => {
    await openSaves(fake.asFactory());
    SaveGame.saveSlot(1, renamed("Slot one"));
    expect(SaveGame.hasSlot(1)).toBe(true);
    const loaded = slotText(1);
    await saveStore.settled();
    await reload();
    expect(slotText(1)).toBe(loaded);
    SaveGame.deleteSlot(1);
    await saveStore.settled();
    expect(fake.row("verticopolis", "saves", SLOT_1)).toBeUndefined();
    await reload();
    expect(SaveGame.hasSlot(1)).toBe(false);
  });

  it("an Undo's restored slot value survives a reload byte for byte", async () => {
    await openSaves(fake.asFactory());
    SaveGame.saveSlot(1, renamed("Kept"));
    const raw = SaveGame.slotRaw(1)!;
    SaveGame.saveSlot(1, renamed("Overwritten"));
    SaveGame.restoreSlotRaw(1, raw);
    await saveStore.settled();
    await reload();
    expect(SaveGame.slotRaw(1)).toBe(raw);
  });

  it("takes a newer save an older build wrote to localStorage alone", async () => {
    await openSaves(fake.asFactory());
    SaveGame.saveSlot(1, renamed("Ours"));
    await saveStore.settled();
    closeSaveStoreForTests();
    localStorage.setItem(SLOT_1, packedAt(Date.now() + 60_000, renamed("Older build, later")));
    await openSaves(fake.asFactory());
    expect(nameOf(slotText(1))).toBe("Older build, later");
    await saveStore.settled();
    await reload();
    expect(nameOf(slotText(1))).toBe("Older build, later");
  });

  it("follows a slot an older build deleted, and the slot stays empty", async () => {
    await openSaves(fake.asFactory());
    SaveGame.saveSlot(1, renamed("Deleted elsewhere"));
    await saveStore.settled();
    closeSaveStoreForTests();
    localStorage.removeItem(SLOT_1);
    await openSaves(fake.asFactory());
    expect(SaveGame.hasSlot(1)).toBe(false);
    await saveStore.settled();
    expect(fake.row("verticopolis", "saves", SLOT_1)).toBeUndefined();
  });

  it("keeps an unreadable autosave aside in the database, and its copy comes back after a reload", async () => {
    await openSaves(fake.asFactory());
    saveStore.set(AUTO_KEY, "VCZ1:not a tower");
    expect(SaveGame.loadResult(() => true)).toMatchObject({ loaded: false, corrupt: true });
    expect(SaveGame.preserveUnreadable()).toBe(true);
    const backup = SaveGame.unreadableBackup();
    expect(backup).not.toBeNull();
    await saveStore.settled();
    expect(fake.row("verticopolis", "saves", UNREADABLE_KEY)).toBeDefined();
    await reload();
    expect(SaveGame.unreadableBackup()).toBe(backup);
  });

  it("a write localStorage refuses throws, and the save before it stays in both places", async () => {
    await openSaves(fake.asFactory());
    SaveGame.saveSlot(1, renamed("Before"));
    await saveStore.settled();
    const before = SaveGame.slotRaw(1);
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => SaveGame.saveSlot(1, renamed("Refused"))).toThrow();
    expect(SaveGame.slotRaw(1)).toBe(before);
    await saveStore.settled();
    await reload();
    expect(nameOf(slotText(1))).toBe("Before");
  });

  it("clear empties the autosave in the database as well", async () => {
    await openSaves(fake.asFactory());
    SaveGame.save(renamed("Gone"));
    SaveGame.clear();
    await saveStore.settled();
    expect(fake.row("verticopolis", "saves", AUTO_KEY)).toBeUndefined();
    await reload();
    expect(SaveGame.hasSave()).toBe(false);
  });

  it("plays on localStorage, with every read the same, when the database will not open", async () => {
    fake.failOpen = true;
    expect(await openSaves(fake.asFactory())).toBe(false);
    SaveGame.saveSlot(1, renamed("Local"));
    expect(nameOf(slotText(1))).toBe("Local");
    expect(localStorage.getItem(SLOT_1)).toBe(SaveGame.slotRaw(1));
  });
});
