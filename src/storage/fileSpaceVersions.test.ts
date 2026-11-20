import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeIndexedDb } from "../tests/fakeIndexedDb";
import { closeFileSpaceForTests, FileConflictError, FileGoneError, FileSpaceFullError, fileSpace } from "./fileSpace";
import { VERSION_GAP_MS, VERSIONS_KEPT } from "./fileVersions";

/** My Towers' write by id and the versions it keeps (#2380). */

const DB = "verticopolis-files";
const bytes = (...values: number[]) => new Uint8Array(values);

let fake: FakeIndexedDb;

/** Another window writes file `id`, straight into the database. */
function otherWindowWrites(id: string, body: Uint8Array, modified: number): void {
  const db = fake.lastDb!;
  db.store("bodies").set(id, body);
  const index = db.store("meta").get("index") as { id: string; modified: number }[];
  db.store("meta").set(
    "index",
    index.map((e) => (e.id === id ? { ...e, modified } : e)),
  );
}
const open = () => fileSpace.open(fake.asFactory());
const reopen = async () => {
  closeFileSpaceForTests();
  return open();
};

beforeEach(async () => {
  fake = new FakeIndexedDb();
  await open();
});
afterEach(() => closeFileSpaceForTests());

describe("fileSpace.overwrite", () => {
  it("writes a tower file by id, keeping its name and place, and lasts a reload", async () => {
    const a = await fileSpace.save("Sky", "tower", bytes(1), 10);
    await fileSpace.rename(a.id, "Sky Hotel");
    const written = await fileSpace.overwrite(a.id, bytes(2, 3), 20);
    expect(written).toEqual({ id: a.id, name: "Sky Hotel", kind: "tower", size: 2, modified: 20 });
    await reopen();
    expect(fileSpace.list()).toEqual([written]);
    expect(await fileSpace.read(a.id)).toEqual(bytes(2, 3));
  });

  it("refuses a file that is gone, or a 1994 file, and writes nothing", async () => {
    const tdt = await fileSpace.save("OLD", "tdt", bytes(0, 0x24), 10);
    await expect(fileSpace.overwrite("nope", bytes(1))).rejects.toBeInstanceOf(FileGoneError);
    await expect(fileSpace.overwrite(tdt.id, bytes(1))).rejects.toBeInstanceOf(FileGoneError);
    expect(await fileSpace.read(tdt.id)).toEqual(bytes(0, 0x24));
    expect(fileSpace.list()).toEqual([tdt]);
  });

  it("leaves a file written after it alone when asked for newer only", async () => {
    const a = await fileSpace.save("Sky", "tower", bytes(1), 50);
    expect(await fileSpace.overwrite(a.id, bytes(2), 40, false, true)).toEqual(a);
    expect(await fileSpace.read(a.id)).toEqual(bytes(1));
    await fileSpace.overwrite(a.id, bytes(3), 60, false, true);
    expect(await fileSpace.read(a.id)).toEqual(bytes(3));
  });

  it("reports a full device and changes neither the file nor its versions", async () => {
    const a = await fileSpace.save("Sky", "tower", bytes(1), 10);
    await fileSpace.overwrite(a.id, bytes(2), 20);
    fake.failWrites = true;
    await expect(fileSpace.overwrite(a.id, bytes(3), 20 + VERSION_GAP_MS)).rejects.toBeInstanceOf(FileSpaceFullError);
    fake.failWrites = false;
    expect(await fileSpace.read(a.id)).toEqual(bytes(2));
    expect((await fileSpace.versions(a.id)).map((v) => v.at)).toEqual([20, 10]);
  });

  it("writes the file without a new version when only the version doesn't fit", async () => {
    const a = await fileSpace.save("Sky", "tower", bytes(1), 0);
    await fileSpace.overwrite(a.id, bytes(2), VERSION_GAP_MS);
    fake.failPutsOf = (key) => key.startsWith("v:");
    expect(await fileSpace.overwrite(a.id, bytes(3), 2 * VERSION_GAP_MS)).toMatchObject({
      modified: 2 * VERSION_GAP_MS,
    });
    fake.failPutsOf = null;
    expect(await fileSpace.read(a.id), "the save itself landed").toEqual(bytes(3));
    expect(
      (await fileSpace.versions(a.id)).map((v) => v.at / VERSION_GAP_MS),
      "the versions are as they were",
    ).toEqual([1, 0]);
  });

  it("keeps a file's original on a nearly full device, dropping only the new version", async () => {
    const a = await fileSpace.save("Sky", "tower", bytes(1), 0);
    fake.failPutsOf = (key) => key.startsWith("v:") && !key.includes(":o");
    await fileSpace.overwrite(a.id, bytes(2), VERSION_GAP_MS);
    fake.failPutsOf = null;
    expect(await fileSpace.read(a.id), "the save landed").toEqual(bytes(2));
    const [v, ...rest] = await fileSpace.versions(a.id);
    expect(rest).toEqual([]);
    expect(v.original, "the only version is the file as it was").toBe(true);
    expect(await fileSpace.readVersion(v.key)).toEqual(bytes(1));
  });

  it("refuses a file's first write when even its original doesn't fit, and leaves the file as it was", async () => {
    const a = await fileSpace.save("Sky", "tower", bytes(1), 0);
    fake.failPutsOf = (key) => key.startsWith("v:");
    await expect(fileSpace.overwrite(a.id, bytes(2), VERSION_GAP_MS)).rejects.toBeInstanceOf(FileSpaceFullError);
    fake.failPutsOf = null;
    expect(await fileSpace.read(a.id)).toEqual(bytes(1));
    expect(await fileSpace.versions(a.id)).toEqual([]);
    // With room again, the first write keeps the original after all.
    await fileSpace.overwrite(a.id, bytes(3), 2 * VERSION_GAP_MS);
    expect((await fileSpace.versions(a.id)).map((v) => [v.at / VERSION_GAP_MS, v.original ?? false])).toEqual([
      [2, false],
      [0, true],
    ]);
  });

  it("refuses to write over a file another window wrote since this one read or wrote it, and writes nothing", async () => {
    const a = await fileSpace.save("Sky", "tower", bytes(1), 10);
    await fileSpace.overwrite(a.id, bytes(2), 20);
    otherWindowWrites(a.id, bytes(7), 25);
    await expect(fileSpace.overwrite(a.id, bytes(3), 30)).rejects.toBeInstanceOf(FileConflictError);
    expect(fake.row(DB, "bodies", a.id)).toEqual(bytes(7));
    // Read again, the file is this window's to write.
    await fileSpace.read(a.id);
    await fileSpace.overwrite(a.id, bytes(3), 30);
    expect(await fileSpace.read(a.id)).toEqual(bytes(3));
  });

  it("writes a file this window never read (the one its crash copy names at boot)", async () => {
    const a = await fileSpace.save("Sky", "tower", bytes(1), 10);
    await reopen();
    otherWindowWrites(a.id, bytes(7), 25);
    expect(await fileSpace.overwrite(a.id, bytes(3), 30)).toMatchObject({ modified: 30 });
  });
});

describe("a tower file's versions in My Towers", () => {
  it("keeps the bytes of each version due, newest first, and the last one saved by hand", async () => {
    const a = await fileSpace.save("Sky", "tower", bytes(0), 0);
    for (let i = 1; i <= VERSIONS_KEPT + 1; i++) await fileSpace.overwrite(a.id, bytes(i), i * VERSION_GAP_MS);
    await fileSpace.overwrite(a.id, bytes(99), 99 * VERSION_GAP_MS, true);
    await reopen();
    const versions = await fileSpace.versions(a.id);
    expect(versions.map((v) => [v.at / VERSION_GAP_MS, v.manual ?? false, v.original ?? false])).toEqual([
      [99, true, false],
      [6, false, false],
      [5, false, false],
      [4, false, false],
      [3, false, false],
      [2, false, false],
      [0, false, true],
    ]);
    expect(await fileSpace.readVersion(versions[0].key)).toEqual(bytes(99));
    expect(await fileSpace.readVersion(versions[5].key)).toEqual(bytes(2));
    expect(await fileSpace.readVersion(versions[6].key), "the file as it was before the first write").toEqual(bytes(0));
    expect(
      fake.row(DB, "bodies", `v:${a.id}:${VERSION_GAP_MS}`),
      "the dropped version's bytes are gone",
    ).toBeUndefined();
  });

  it("are out of the list and the folder's count", async () => {
    const a = await fileSpace.save("Sky", "tower", bytes(1, 2), 0);
    await fileSpace.overwrite(a.id, bytes(1, 2), 1);
    expect(fileSpace.list()).toHaveLength(1);
    expect(fileSpace.usage()).toEqual({ count: 1, bytes: 2 });
  });

  it("go with their file when it is deleted, and stay with it through a rename", async () => {
    const a = await fileSpace.save("Sky", "tower", bytes(1), 0);
    await fileSpace.overwrite(a.id, bytes(2), 1);
    await fileSpace.rename(a.id, "Moon");
    const [v] = await fileSpace.versions(a.id);
    expect(await fileSpace.readVersion(v.key)).toEqual(bytes(2));
    await fileSpace.remove(a.id);
    expect(await fileSpace.versions(a.id)).toEqual([]);
    expect(await fileSpace.readVersion(v.key)).toBeNull();
    expect(fake.row(DB, "meta", `versions:${a.id}`)).toBeUndefined();
  });

  it("a file nobody wrote over yet has none", async () => {
    const a = await fileSpace.save("Sky", "tower", bytes(1), 0);
    expect(await fileSpace.versions(a.id)).toEqual([]);
  });
});
