import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  track: vi.fn(),
  once: vi.fn(),
  autosave: vi.fn(() => true),
  mirror: vi.fn(async () => false),
  linked: vi.fn(async (_file: Uint8Array, _now: number) => true),
  linkId: "L1" as string | null,
}));
vi.mock("../analytics", () => ({ trackAppAction: m.track, trackAppActionOnce: m.once }));
vi.mock("./autosaveSchedule", () => ({ autosaveIfLive: m.autosave }));
vi.mock("./autosaveMirror", async (actual) => ({
  ...(await actual<typeof import("./autosaveMirror")>()),
  mirrorAutosave: m.mirror,
  writeLinkedTower: m.linked,
}));
vi.mock("../storage/linkedFolder", () => ({ linkedFolder: { linkId: () => m.linkId } }));

import type { SlotInfo } from "../storage/slotInfo";
import { closeFileSpaceForTests, fileSpace } from "../storage/fileSpace";
import { SaveGame } from "../storage/SaveGame";
import { FakeIndexedDb } from "../tests/fakeIndexedDb";
import { currentFileId, currentLinkedFile, forgetCurrentFile, setCurrentFile, setCurrentLinkedFile } from "./currentFile";
import {
  bootTowerDocument,
  claimTower,
  crashCopyLoaded,
  crashCopyRef,
  crashCopyWritten,
  liveFileId,
  readRef,
  REF_KEY,
  resetTowerDocumentForTests,
  towerDocumentSettled,
  wireTowerDocument,
} from "./towerDocument";

const PACKED = Uint8Array.of(1, 2, 3);
/** A crash copy's text: the least a save holds to read as a tower. */
const tower = (name: string) => JSON.stringify({ name, minutes: 0, units: [] });
const head = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes.subarray(0, 9)) : null);

function makeApp(name = "Sky Hotel") {
  let generation = 1;
  const app = {
    enginePort: { generation: vi.fn(() => generation), towerName: vi.fn(() => name) },
    engine: { viewState: vi.fn(() => null) },
    ui: { sayVisibly: vi.fn(), toast: vi.fn() },
    saveLoad: { autosave: vi.fn() },
  };
  /** Another tower comes in, as a swap does: the app forgets the last one's file. */
  const swap = () => {
    generation++;
    forgetCurrentFile();
  };
  return { app, swap };
}

/** The Auto-save's listing, as SaveGame reads it. */
function listing(savedAt: number | undefined, towerName = "Sky Hotel") {
  return vi.spyOn(SaveGame, "listSlots").mockReturnValue([{ slot: "auto", exists: savedAt !== undefined, present: true, towerName, savedAt } as SlotInfo]);
}

let app: ReturnType<typeof makeApp>["app"];
let fake: FakeIndexedDb;
let swap: () => void;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  localStorage.clear();
  m.linkId = "L1";
  resetTowerDocumentForTests();
  setCurrentFile(null);
  ({ app, swap } = makeApp());
  closeFileSpaceForTests();
  fake = new FakeIndexedDb();
  await fileSpace.open(fake.asFactory());
  wireTowerDocument(app as never);
});
afterEach(() => closeFileSpaceForTests());

describe("the tower's own file, written by the autosave", () => {
  it("gives a new tower a file under its name with the autosave's own bytes, then writes that same file", async () => {
    crashCopyWritten(1, 1000, PACKED);
    await towerDocumentSettled();
    const [file] = fileSpace.list();
    expect(file).toMatchObject({ name: "Sky Hotel", kind: "tower", modified: 1000 });
    expect(currentFileId()).toBe(file.id);
    const body = await fileSpace.read(file.id);
    expect(head(body), "the binary .vctower Save As writes").toBe("VCTOWER2\n");
    expect(body!.subarray(9)).toEqual(PACKED);
    expect(m.track).toHaveBeenCalledExactlyOnceWith("tower_file", "founded");

    crashCopyWritten(1, 2000, Uint8Array.of(9));
    await towerDocumentSettled();
    expect(fileSpace.list().map((f) => f.id), "no second file").toEqual([file.id]);
    expect((await fileSpace.read(file.id))!.subarray(9)).toEqual(Uint8Array.of(9));
    expect(fileSpace.get(file.id)!.modified).toBe(2000);
    expect((await fileSpace.versions(file.id)).map((v) => v.at), "its first write keeps a version, and the file as it was founded").toEqual([2000, 1000]);
  });

  it("names a new file 'Name (2)' when that name is taken, never writing over the other", async () => {
    const other = await fileSpace.save("Sky Hotel", "tower", Uint8Array.of(5), 1);
    crashCopyWritten(1, 1000, PACKED);
    await towerDocumentSettled();
    expect(fileSpace.get(currentFileId()!)!.name).toBe("Sky Hotel (2)");
    expect(await fileSpace.read(other.id)).toEqual(Uint8Array.of(5));
  });

  it("writes nothing for a tower that has gone by the time its autosave lands", async () => {
    swap();
    crashCopyWritten(1, 1000, PACKED);
    await towerDocumentSettled();
    expect(fileSpace.list()).toEqual([]);
  });

  it("writes nothing more for a synchronous save (a tab hide): the crash copy holds it", async () => {
    crashCopyWritten(1, 1000, null);
    await towerDocumentSettled();
    expect(fileSpace.list()).toEqual([]);
  });

  it("gives a tower whose file was deleted in another window a new one", async () => {
    const gone = await fileSpace.save("Sky Hotel", "tower", Uint8Array.of(5), 1);
    setCurrentFile(gone.id);
    await fileSpace.remove(gone.id);
    crashCopyWritten(1, 1000, PACKED);
    await towerDocumentSettled();
    expect(fileSpace.list().map((f) => f.name)).toEqual(["Sky Hotel"]);
    expect(currentFileId()).not.toBe(gone.id);
  });

  it("says once when My Towers can't take the file, counts it once, and keeps trying", async () => {
    const add = vi.spyOn(fileSpace, "add").mockRejectedValue(new Error("No room."));
    crashCopyWritten(1, 1000, PACKED);
    crashCopyWritten(1, 2000, PACKED);
    await towerDocumentSettled();
    expect(add).toHaveBeenCalledTimes(2);
    expect(app.ui.sayVisibly).toHaveBeenCalledOnce();
    expect(app.ui.sayVisibly.mock.calls[0][0]).toMatch(/^Couldn't save your tower in My Towers: No room\./);
    expect(m.once).toHaveBeenCalledWith("autosave_failed", "file");
  });

  it("writes a linked folder tower's own file there, and no My Towers file", async () => {
    setCurrentLinkedFile("Sky.vctower");
    crashCopyWritten(1, 1000, PACKED, 5);
    await towerDocumentSettled();
    expect(m.linked).toHaveBeenCalledExactlyOnceWith(expect.any(Uint8Array), 5);
    expect(head((m.linked.mock.calls[0] as unknown[])[0] as Uint8Array)).toBe("VCTOWER2\n");
    expect(fileSpace.list()).toEqual([]);
    expect(m.mirror).not.toHaveBeenCalled();
  });

  it("hands the same bytes to the copy in the linked folder", async () => {
    crashCopyWritten(1, 1000, PACKED, 7);
    await towerDocumentSettled();
    expect(m.mirror).toHaveBeenCalledExactlyOnceWith(app, 7, false, expect.any(Uint8Array));
    expect((m.mirror.mock.calls[0] as unknown[])[3]).toEqual(await fileSpace.read(currentFileId()!));
  });
});

describe("two windows playing the same tower", () => {
  it("moves this window's tower to a file of its own once the other window wrote the file, and says so", async () => {
    crashCopyWritten(1, 1000, PACKED);
    await towerDocumentSettled();
    const [sky] = fileSpace.list();
    // The other window writes the same file, straight into the database.
    const index = fake.lastDb!.store("meta").get("index") as { id: string; modified: number }[];
    fake.lastDb!.store("meta").set("index", index.map((e) => ({ ...e, modified: 1500 })));
    fake.lastDb!.store("bodies").set(sky.id, Uint8Array.of(5));
    crashCopyWritten(1, 2000, Uint8Array.of(9));
    await towerDocumentSettled();
    expect(fake.row("verticopolis-files", "bodies", sky.id), "the other window's write stays").toEqual(Uint8Array.of(5));
    const fork = fileSpace.find("Sky Hotel (2)")!;
    expect(currentFileId()).toBe(fork.id);
    expect((await fileSpace.read(fork.id))!.subarray(9)).toEqual(Uint8Array.of(9));
    expect(m.track).toHaveBeenLastCalledWith("tower_file", "forked");
    expect(app.ui.toast).toHaveBeenCalledWith(`Another window saved "Sky Hotel" too, so this window's tower is now "Sky Hotel (2)".`, "info");
    // From then on it writes its own file.
    crashCopyWritten(1, 3000, Uint8Array.of(4));
    await towerDocumentSettled();
    expect((await fileSpace.read(fork.id))!.subarray(9)).toEqual(Uint8Array.of(4));
  });
});

describe("the file behind the title screen", () => {
  it("is the one the ref names for the crash copy as it is now, not the one this window booted with", () => {
    setCurrentFile("booted with");
    localStorage.setItem(REF_KEY, JSON.stringify({ file: "Sky", savedAt: 1000 }));
    listing(1000);
    expect(crashCopyRef()).toEqual({ file: "Sky", savedAt: 1000 });
    listing(1200);
    expect(crashCopyRef(), "another window wrote the crash copy since").toBeNull();
    expect(liveFileId(), "in a tower, the live file").toBe("booted with");
  });
});

describe("opens that name the tower's file themselves", () => {
  it("make no file of their own while they run, and none after when the open named one", async () => {
    const mine = await fileSpace.save("Mine", "tower", Uint8Array.of(5), 1);
    await claimTower(async () => {
      crashCopyWritten(1, 1000, PACKED);
      await towerDocumentSettled();
      expect(fileSpace.list()).toHaveLength(1);
      setCurrentFile(mine.id);
    });
    expect(m.autosave).not.toHaveBeenCalled();
    expect(fileSpace.list()).toHaveLength(1);
  });

  it("ask for an autosave once they settle with no file named, so the tower gets one at once", async () => {
    await expect(claimTower(async () => "done")).resolves.toBe("done");
    expect(m.autosave).toHaveBeenCalledExactlyOnceWith(app.saveLoad);
    await expect(claimTower(async () => Promise.reject(new Error("refused")))).rejects.toThrow("refused");
    expect(m.autosave).toHaveBeenCalledTimes(2);
  });
});

describe("the crash copy's file, across a reload", () => {
  it("is remembered with the crash copy's write time, and follows the tower's file", async () => {
    const f = await fileSpace.save("Sky", "tower", Uint8Array.of(5), 1);
    crashCopyWritten(1, 1000, null);
    expect(readRef()).toEqual({ savedAt: 1000 });
    setCurrentFile(f.id);
    expect(readRef()).toEqual({ savedAt: 1000, file: f.id });
    setCurrentLinkedFile("Sky.vctower");
    expect(readRef()).toEqual({ savedAt: 1000, linked: { link: "L1", id: "Sky.vctower" } });
  });

  it("is not changed once another tower is in and the crash copy still holds the last one", async () => {
    const f = await fileSpace.save("Sky", "tower", Uint8Array.of(5), 1);
    setCurrentFile(f.id);
    crashCopyWritten(1, 1000, null);
    swap();
    setCurrentFile("someone else");
    expect(readRef()).toEqual({ savedAt: 1000, file: f.id });
  });

  it("names the file again at boot when the tag matches, and writes a newer crash copy into it", async () => {
    localStorage.setItem("verticopolis-save", SaveGame.packSync(tower("Sky")));
    const f = await fileSpace.save("Sky", "tower", Uint8Array.of(5), 500);
    localStorage.setItem(REF_KEY, JSON.stringify({ file: f.id, savedAt: 1000 }));
    listing(1000);
    await bootTowerDocument(app as never, 1000, Promise.resolve());
    expect(currentFileId()).toBe(f.id);
    const synced = await fileSpace.read(f.id);
    expect(new TextDecoder().decode(synced!).startsWith("VCTOWER"), "the crash copy, re-headered").toBe(true);
    expect(fileSpace.get(f.id)!.modified).toBe(1000);
    expect(fileSpace.list()).toHaveLength(1);
    expect(m.track).toHaveBeenCalledWith("tower_file", "synced");
  });

  it("leaves a file already as new as the crash copy alone", async () => {
    localStorage.setItem("verticopolis-save", SaveGame.packSync(tower("Sky")));
    const f = await fileSpace.save("Sky", "tower", Uint8Array.of(5), 1000);
    localStorage.setItem(REF_KEY, JSON.stringify({ file: f.id, savedAt: 1000 }));
    await bootTowerDocument(app as never, 1000, Promise.resolve());
    expect(await fileSpace.read(f.id)).toEqual(Uint8Array.of(5));
    expect(m.track).not.toHaveBeenCalled();
  });

  it("gives a crash copy whose tag doesn't match its own new file, never writing the tagged one", async () => {
    localStorage.setItem("verticopolis-save", SaveGame.packSync(tower("Sky")));
    const f = await fileSpace.save("Sky Hotel", "tower", Uint8Array.of(5), 500);
    localStorage.setItem(REF_KEY, JSON.stringify({ file: f.id, savedAt: 999 }));
    listing(1000);
    await bootTowerDocument(app as never, 1000, Promise.resolve());
    expect(await fileSpace.read(f.id)).toEqual(Uint8Array.of(5));
    const made = fileSpace.get(currentFileId()!)!;
    expect(made).toMatchObject({ name: "Sky Hotel (2)", modified: 1000 });
    expect(m.track).toHaveBeenCalledWith("tower_file", "adopted");
    expect(readRef()).toEqual({ savedAt: 1000, file: made.id });
  });

  it("gives an Auto-save from before this change a file of its own (4.10 storage)", async () => {
    localStorage.setItem("verticopolis-save", SaveGame.packSync(tower("Harmony")));
    listing(1000, "Harmony");
    await bootTowerDocument(app as never, 1000, Promise.resolve());
    expect(fileSpace.list().map((f) => f.name)).toEqual(["Harmony"]);
    expect(currentFileId()).toBe(fileSpace.list()[0].id);
  });

  it("does nothing at boot once another tower came in, or with no tower loaded", async () => {
    localStorage.setItem("verticopolis-save", SaveGame.packSync(tower("Sky")));
    listing(1000);
    let resolve!: () => void;
    const ready = new Promise<void>((r) => (resolve = r));
    const booting = bootTowerDocument(app as never, 1000, ready);
    swap();
    resolve();
    await booting;
    expect(fileSpace.list()).toEqual([]);
    await bootTowerDocument(app as never, undefined, Promise.resolve());
    expect(fileSpace.list()).toEqual([]);
  });

  it("names a linked folder tower's file again only through the same link", async () => {
    localStorage.setItem(REF_KEY, JSON.stringify({ linked: { link: "L1", id: "Sky.vctower" }, savedAt: 1000 }));
    crashCopyLoadedAt(1000);
    expect(currentLinkedFile()).toBe("Sky.vctower");
    forgetCurrentFile();
    m.linkId = "L2";
    crashCopyLoadedAt(1000);
    expect(currentLinkedFile()).toBeNull();
  });

  it("names the file again when the Auto-save is loaded (Continue)", async () => {
    localStorage.setItem(REF_KEY, JSON.stringify({ file: "F1", savedAt: 1000 }));
    crashCopyLoadedAt(999);
    expect(currentFileId(), "another crash copy").toBeNull();
    crashCopyLoadedAt(1000);
    expect(currentFileId()).toBe("F1");
  });
});

function crashCopyLoadedAt(savedAt: number): void {
  const spy = listing(savedAt);
  crashCopyLoaded(app as never);
  spy.mockRestore();
}
