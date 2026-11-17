import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeIndexedDb } from "../tests/fakeIndexedDb";
import { closeFileSpaceForTests, FileGoneError, FileSpaceFullError, fileSpace } from "./fileSpace";
import { VERSION_GAP_MS, VERSIONS_KEPT } from "./fileVersions";

/** My Towers' write by id and the versions it keeps (#2380). */

const DB = "verticopolis-files";
const bytes = (...values: number[]) => new Uint8Array(values);

let fake: FakeIndexedDb;
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
    expect((await fileSpace.versions(a.id)).map((v) => v.at)).toEqual([20]);
  });
});

describe("a tower file's versions in My Towers", () => {
  it("keeps the bytes of each version due, newest first, and the last one saved by hand", async () => {
    const a = await fileSpace.save("Sky", "tower", bytes(0), 0);
    for (let i = 1; i <= VERSIONS_KEPT + 1; i++) await fileSpace.overwrite(a.id, bytes(i), i * VERSION_GAP_MS);
    await fileSpace.overwrite(a.id, bytes(99), 99 * VERSION_GAP_MS, true);
    await reopen();
    const versions = await fileSpace.versions(a.id);
    expect(versions.map((v) => [v.at / VERSION_GAP_MS, v.manual ?? false])).toEqual([[99, true], [6, false], [5, false], [4, false], [3, false], [2, false]]);
    expect(await fileSpace.readVersion(versions[0].key)).toEqual(bytes(99));
    expect(await fileSpace.readVersion(versions[5].key)).toEqual(bytes(2));
    expect(fake.row(DB, "bodies", `v:${a.id}:${VERSION_GAP_MS}`), "the dropped version's bytes are gone").toBeUndefined();
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
