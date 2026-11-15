import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deflateSync } from "fflate";
import { FakeIndexedDb } from "../tests/fakeIndexedDb";
import { closeFileSpaceForTests, fileSpace } from "./fileSpace";
import { copySlotsOnce, slotFiles, SLOTS_COPIED } from "./fileSpaceMigrate";
import { STORE_MAGIC, toBase64, TOWER_FILE_MAGIC } from "./saveCompression";
import type { SlotInfo } from "./SaveGame";

/** A slot value as `SaveGame.saveTo` writes it. */
const storeValue = (obj: unknown): string =>
  STORE_MAGIC + toBase64(deflateSync(new TextEncoder().encode(JSON.stringify(obj)), { level: 1 }));
const TOWER = { minutes: 60, units: [], towerName: "Spire" };
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const row = (slot: number, info: Partial<SlotInfo> = {}): SlotInfo => ({ slot, exists: true, present: true, ...info });

describe("slotFiles", () => {
  it("turns each filled slot into its .vctower text with the payload untouched", () => {
    const raw = storeValue(TOWER);
    const values: Record<number, string> = { 1: raw, 3: storeValue({ ...TOWER, towerName: "Mall" }) };
    const files = slotFiles((n) => values[n] ?? null, [row(1, { towerName: "Spire", savedAt: 50 }), row(3, { towerName: "Mall" })], () => undefined);
    expect(files.map((f) => f.name)).toEqual(["Spire", "Mall"]);
    expect(text(files[0]!.bytes)).toBe(`${TOWER_FILE_MAGIC}\n${raw.slice(STORE_MAGIC.length)}\n`);
    expect(files[0]).toMatchObject({ kind: "tower", modified: 50 });
  });

  it("names a file by the slot's own name first, then its tower, then its number", () => {
    const raw = storeValue(TOWER);
    const files = slotFiles(() => raw, [row(1, { towerName: "Spire" }), row(2, { towerName: "" })], (n) => (n === 1 ? "My best" : undefined));
    expect(files.map((f) => f.name)).toEqual(["My best", "Slot 2", "Slot 3"]);
  });

  it("keeps the bytes of a slot this build can't read, and leaves out one that is no save", () => {
    const unreadable = STORE_MAGIC + "not-base64!";
    const values: Record<number, string> = { 1: unreadable, 2: "   " };
    const files = slotFiles((n) => values[n] ?? null, [], () => undefined);
    expect(files).toHaveLength(1);
    expect(text(files[0]!.bytes)).toBe(`${TOWER_FILE_MAGIC}\nnot-base64!\n`);
  });
});

describe("copySlotsOnce", () => {
  let fake: FakeIndexedDb;
  beforeEach(() => {
    fake = new FakeIndexedDb();
  });
  afterEach(() => closeFileSpaceForTests());

  it("does nothing while the folder is closed", async () => {
    expect(await copySlotsOnce()).toBe(0);
  });

  it("copies once and remembers it", async () => {
    await fileSpace.open(fake.asFactory());
    await copySlotsOnce();
    expect(await fileSpace.flag(SLOTS_COPIED)).toBe(true);
    expect(await copySlotsOnce()).toBe(0);
  });

  it("tries again next time when the device is full", async () => {
    await fileSpace.open(fake.asFactory());
    fake.failWrites = true;
    expect(await copySlotsOnce()).toBe(0);
    fake.failWrites = false;
    expect(await fileSpace.flag(SLOTS_COPIED)).toBe(false);
  });
});
