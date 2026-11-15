import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeIndexedDb } from "../tests/fakeIndexedDb";
import {
  cleanFileName,
  closeFileSpaceForTests,
  copyName,
  freeName,
  FILE_NAME_MAX,
  FileNameTakenError,
  FileSpaceFullError,
  fileSpace,
  type TowerFileEntry,
} from "./fileSpace";

const DB = "verticopolis-files";
const bytes = (...values: number[]) => new Uint8Array(values);

let fake: FakeIndexedDb;
const open = () => fileSpace.open(fake.asFactory());
const reopen = async () => {
  closeFileSpaceForTests();
  return open();
};

beforeEach(() => {
  fake = new FakeIndexedDb();
});

afterEach(() => {
  closeFileSpaceForTests();
});

describe("cleanFileName", () => {
  it("drops the characters a disk refuses, folds spaces and caps the length", () => {
    expect(cleanFileName('  My: "Tower"\t/ one?  ')).toBe("My Tower one");
    expect(cleanFileName("a\u0000b\u007fc")).toBe("abc");
    expect(cleanFileName("x".repeat(FILE_NAME_MAX + 9))).toHaveLength(FILE_NAME_MAX);
    expect(cleanFileName(' <>|*" ')).toBe("");
  });
});

describe("copyName", () => {
  const entry = (name: string): TowerFileEntry => ({ id: name, name, kind: "tower", size: 1, modified: 1 });

  it("counts up past the copies that already exist, in any case", () => {
    expect(copyName("Spire", [entry("Spire")])).toBe("Copy of Spire");
    expect(copyName("Spire", [entry("Spire"), entry("copy of spire")])).toBe("Copy (2) of Spire");
    expect(copyName("Spire", [entry("Copy of Spire"), entry("Copy (2) of Spire")])).toBe("Copy (3) of Spire");
  });

  it("keeps a copy of a long name within the cap", () => {
    expect(copyName("y".repeat(FILE_NAME_MAX), []).length).toBeLessThanOrEqual(FILE_NAME_MAX);
  });
});

describe("fileSpace", () => {
  it("stays closed and empty when the database will not open", async () => {
    fake.failOpen = true;
    expect(await open()).toBe(false);
    expect(fileSpace.isOpen()).toBe(false);
    expect(fileSpace.list()).toEqual([]);
    expect(() => fileSpace.save("a", "tower", bytes(1))).toThrow("isn't open");
  });

  it("keeps a saved file's bytes exactly and lists it after a reload", async () => {
    await open();
    const saved = await fileSpace.save("  Spire  ", "tower", bytes(1, 2, 3), 1000);
    expect(saved).toMatchObject({ name: "Spire", kind: "tower", size: 3, modified: 1000 });
    await reopen();
    expect(fileSpace.list()).toEqual([saved]);
    expect(await fileSpace.read(saved.id)).toEqual(bytes(1, 2, 3));
    expect(fake.row(DB, "bodies", saved.id)).toEqual(bytes(1, 2, 3));
  });

  it("lists newest first and adds up the folder's usage", async () => {
    await open();
    await fileSpace.save("Old", "tower", bytes(1, 2), 10);
    await fileSpace.save("New", "tdt", bytes(1, 2, 3), 20);
    expect(fileSpace.list().map((e) => e.name)).toEqual(["New", "Old"]);
    expect(fileSpace.usage()).toEqual({ count: 2, bytes: 5 });
  });

  it("replaces a file saved under the same name in another case, keeping its id", async () => {
    await open();
    const first = await fileSpace.save("Spire", "tower", bytes(1), 10);
    const second = await fileSpace.save("SPIRE", "tower", bytes(9, 9), 20);
    expect(second.id).toBe(first.id);
    expect(fileSpace.list()).toEqual([second]);
    expect(fileSpace.find("spire")).toEqual(second);
    expect(await fileSpace.read(first.id)).toEqual(bytes(9, 9));
  });

  it("refuses to replace when asked to keep what is there, and changes nothing", async () => {
    await open();
    const first = await fileSpace.save("Spire", "tower", bytes(1), 10);
    await expect(fileSpace.save("spire", "tower", bytes(9, 9), 20, false)).rejects.toThrow(`A tower named "Spire" already exists.`);
    expect(fileSpace.list()).toEqual([first]);
    expect(await fileSpace.read(first.id)).toEqual(bytes(1));
  });

  it("refuses an empty name", async () => {
    await open();
    await expect(fileSpace.save(" ?? ", "tower", bytes(1))).rejects.toThrow("Type a name");
    expect(fileSpace.list()).toEqual([]);
  });

  it("reports a full device and changes nothing", async () => {
    await open();
    const kept = await fileSpace.save("Kept", "tower", bytes(1), 10);
    fake.failWrites = true;
    await expect(fileSpace.save("Big", "tower", bytes(2))).rejects.toBeInstanceOf(FileSpaceFullError);
    fake.failWrites = false;
    expect(fileSpace.list()).toEqual([kept]);
    await reopen();
    expect(fileSpace.list()).toEqual([kept]);
  });

  it("keeps working after a failed write", async () => {
    await open();
    fake.failWrites = true;
    await expect(fileSpace.save("A", "tower", bytes(1))).rejects.toBeInstanceOf(FileSpaceFullError);
    fake.failWrites = false;
    await fileSpace.save("B", "tower", bytes(2));
    expect(fileSpace.list().map((e) => e.name)).toEqual(["B"]);
  });

  it("renames a file, and refuses a name another file has", async () => {
    await open();
    const a = await fileSpace.save("A", "tower", bytes(1), 10);
    await fileSpace.save("B", "tower", bytes(2), 20);
    await expect(fileSpace.rename(a.id, "b")).rejects.toBeInstanceOf(FileNameTakenError);
    const renamed = await fileSpace.rename(a.id, "a: renamed");
    expect(renamed).toEqual({ ...a, name: "a renamed" });
    await fileSpace.rename(a.id, "A RENAMED");
    await reopen();
    expect(fileSpace.get(a.id)?.name).toBe("A RENAMED");
    await expect(fileSpace.rename("missing", "x")).rejects.toThrow("gone");
  });

  it("duplicates a file under a free copy name with the same bytes", async () => {
    await open();
    const a = await fileSpace.save("Spire", "tdt", bytes(4, 5), 10);
    const copy = await fileSpace.duplicate(a.id);
    const again = await fileSpace.duplicate(a.id);
    expect(copy).toMatchObject({ name: "Copy of Spire", kind: "tdt", size: 2 });
    expect(again.name).toBe("Copy (2) of Spire");
    expect(copy.id).not.toBe(a.id);
    expect(await fileSpace.read(copy.id)).toEqual(bytes(4, 5));
    await expect(fileSpace.duplicate("missing")).rejects.toThrow("gone");
  });

  it("removes a file and its bytes", async () => {
    await open();
    const a = await fileSpace.save("A", "tower", bytes(1));
    await fileSpace.remove(a.id);
    expect(fileSpace.list()).toEqual([]);
    expect(await fileSpace.read(a.id)).toBeNull();
    expect(fake.row(DB, "bodies", a.id)).toBeUndefined();
  });

  it("runs writes in the order they were asked for", async () => {
    await open();
    const first = fileSpace.save("A", "tower", bytes(1), 10);
    const second = fileSpace.save("a", "tower", bytes(2, 2), 20);
    const [x, y] = await Promise.all([first, second]);
    expect(y.id).toBe(x.id);
    expect(fileSpace.list()).toEqual([y]);
  });

  it("tells listeners about each change until they unsubscribe", async () => {
    await open();
    let heard = 0;
    const off = fileSpace.onChange(() => heard++);
    const a = await fileSpace.save("A", "tower", bytes(1));
    await fileSpace.rename(a.id, "B");
    off();
    await fileSpace.remove(a.id);
    expect(heard).toBe(2);
  });

  it("keeps flags with the folder", async () => {
    await open();
    expect(await fileSpace.flag("slotsCopied")).toBe(false);
    await fileSpace.setFlag("slotsCopied");
    await reopen();
    expect(await fileSpace.flag("slotsCopied")).toBe(true);
  });

  it("drops index rows that are not files", async () => {
    await open();
    const good = await fileSpace.save("Good", "tower", bytes(1), 5);
    fake.seed(DB, "meta", "index", [good, { id: 3 }, null, { ...good, id: "x", kind: "zip" }]);
    await reopen();
    expect(fileSpace.list()).toEqual([good]);
  });

  it("closes when a later build upgrades the database", async () => {
    await open();
    let heard = 0;
    fileSpace.onChange(() => heard++);
    fake.lastDb?.onversionchange?.();
    expect(fileSpace.isOpen()).toBe(false);
    expect(heard).toBe(1);
  });
});

describe("fileSpace.addOnce", () => {
  const file = (name: string, ...values: number[]) => ({ name, kind: "tower" as const, bytes: bytes(...values), modified: 7 });

  it("adds the files under free names and sets the flag, once", async () => {
    await open();
    await fileSpace.save("Spire", "tower", bytes(0), 1);
    expect(await fileSpace.addOnce("copied", [file("Spire", 1), file("spire", 2), file("Mall", 3)])).toBe(3);
    expect(await fileSpace.addOnce("copied", [file("Again", 4)])).toBe(0);
    await reopen();
    const names = fileSpace.list().map((e) => e.name).sort();
    expect(names).toEqual(["Mall", "Spire", "Spire (2)", "spire (3)"]);
    expect(await fileSpace.flag("copied")).toBe(true);
    expect(await fileSpace.read(fileSpace.find("Mall")!.id)).toEqual(bytes(3));
  });

  it("adds nothing when another tab set the flag first", async () => {
    await open();
    fake.seed(DB, "meta", "copied", true);
    expect(await fileSpace.addOnce("copied", [file("A", 1)])).toBe(0);
    expect(fileSpace.list()).toEqual([]);
  });

  it("reports a full device and leaves the flag unset", async () => {
    await open();
    fake.failWrites = true;
    await expect(fileSpace.addOnce("copied", [file("A", 1)])).rejects.toBeInstanceOf(FileSpaceFullError);
    fake.failWrites = false;
    expect(await fileSpace.flag("copied")).toBe(false);
    expect(fileSpace.list()).toEqual([]);
  });
});

describe("freeName", () => {
  const entry = (name: string): TowerFileEntry => ({ id: name, name, kind: "tower", size: 1, modified: 1 });
  it("numbers a taken name and keeps the number within the cap", () => {
    expect(freeName("A", [])).toBe("A");
    expect(freeName("A", [entry("a"), entry("A (2)")])).toBe("A (3)");
    const long = "z".repeat(FILE_NAME_MAX);
    const next = freeName(long, [entry(long)]);
    expect(next.endsWith(" (2)")).toBe(true);
    expect(next).toHaveLength(FILE_NAME_MAX);
  });
});

describe("fileSpace.add", () => {
  afterEach(() => closeFileSpaceForTests());
  it("never replaces a file: a taken name gets a number", async () => {
    await open();
    const first = await fileSpace.add("Spire", "tdt", bytes(1));
    const second = await fileSpace.add("spire", "tower", bytes(2));
    const blank = await fileSpace.add(" ?? ", "tower", bytes(3));
    expect(first.name).toBe("Spire");
    expect(second.name).toBe("spire (2)");
    expect(blank.name).toBe("Tower");
    expect(await fileSpace.read(first.id)).toEqual(bytes(1));
    expect(fileSpace.usage().count).toBe(3);
  });
});

describe("two tabs writing before they hear each other", () => {
  type Module = typeof import("./fileSpace");
  /** A tab: its own copy of the module, on the same database. */
  const tab = async (): Promise<Module> => {
    vi.resetModules();
    const m = (await import("./fileSpace")) as Module;
    expect(await m.fileSpace.open(fake.asFactory())).toBe(true);
    return m;
  };
  const tabs: Module[] = [];
  afterEach(() => tabs.splice(0).forEach((m) => m.closeFileSpaceForTests()));
  const names = async () => {
    const fresh = await tab();
    tabs.push(fresh);
    return fresh.fileSpace.list().map((e) => e.name).sort();
  };

  it("keeps both tabs' files and every body", async () => {
    const [a, b] = [await tab(), await tab()];
    tabs.push(a, b);
    await a.fileSpace.add("From A", "tower", bytes(1));
    // Tab B still lists nothing when it writes.
    expect(b.fileSpace.list()).toEqual([]);
    const fromB = await b.fileSpace.add("From B", "tower", bytes(2));
    expect(await names()).toEqual(["From A", "From B"]);
    expect(b.fileSpace.list().map((e) => e.name).sort()).toEqual(["From A", "From B"]);
    expect(await b.fileSpace.read(fromB.id)).toEqual(bytes(2));
  });

  it("names, renames, copies and deletes against the list on disk", async () => {
    const [a, b] = [await tab(), await tab()];
    tabs.push(a, b);
    const kept = await b.fileSpace.add("Spire", "tower", bytes(3));
    const fromA = await a.fileSpace.add("Spire", "tower", bytes(4));
    expect(fromA.name).toBe("Spire (2)");
    await expect(b.fileSpace.rename(kept.id, "spire (2)")).rejects.toThrow(`A tower named "spire (2)" already exists.`);
    await b.fileSpace.duplicate(kept.id);
    await b.fileSpace.remove(kept.id);
    expect(await names()).toEqual(["Copy of Spire", "Spire (2)"]);
  });
});
