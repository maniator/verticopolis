import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeIndexedDb } from "../tests/fakeIndexedDb";
import { FileNameTakenError } from "./fileSpace";
import { canLinkFolder, linkedFileKind, linkedFolder, resetLinkedFolderForTests } from "./linkedFolder";

/** A stand-in for a folder the browser hands over: its files by name, with
 *  spies on every call the module may make, including the two it must never
 *  make (removeEntry and a file's move). */
function fakeFolder(name: string, files: Record<string, number[]>, dirs: string[] = []) {
  const disk = new Map(Object.entries(files).map(([n, b]) => [n, { bytes: new Uint8Array(b), modified: 1000 }]));
  const writes: { name: string; bytes: Uint8Array }[] = [];
  const failNextWrite = { on: false };
  /** Files another program holds (a cloud drive syncing them), and whether
   *  walking the folder fails as a whole. */
  const locked = new Set<string>();
  const walk = { fails: false };
  const writer = (file: string) => {
    let pending: Uint8Array<ArrayBuffer> | null = null;
    return {
      write: vi.fn(async (b: Uint8Array) => {
        if (failNextWrite.on) {
          failNextWrite.on = false;
          throw new DOMException("disk full", "QuotaExceededError");
        }
        pending = b.slice();
      }),
      close: vi.fn(async () => {
        disk.set(file, { bytes: pending ?? new Uint8Array(), modified: 2000 });
        writes.push({ name: file, bytes: pending ?? new Uint8Array() });
      }),
      abort: vi.fn(async () => {}),
    };
  };
  const writers: ReturnType<typeof writer>[] = [];
  const fileHandle = (file: string) => ({
    kind: "file" as const,
    name: file,
    getFile: async () => {
      const f = disk.get(file);
      if (!f) throw new DOMException("gone", "NotFoundError");
      if (locked.has(file)) throw new DOMException("in use", "NotReadableError");
      return { size: f.bytes.byteLength, lastModified: f.modified, arrayBuffer: async () => f.bytes.slice().buffer } as unknown as File;
    },
    createWritable: vi.fn(async () => {
      const w = writer(file);
      writers.push(w);
      return w;
    }),
    move: vi.fn(),
  });
  const handle = {
    kind: "directory" as const,
    name,
    queryPermission: vi.fn(async () => "granted" as PermissionState),
    requestPermission: vi.fn(async () => "granted" as PermissionState),
    removeEntry: vi.fn(),
    async *values() {
      if (walk.fails) throw new DOMException("folder busy", "NotReadableError");
      for (const n of disk.keys()) yield { kind: "file" as const, name: n };
      for (const n of dirs) yield { kind: "directory" as const, name: n };
    },
    getFileHandle: vi.fn(async (file: string, options?: { create?: boolean }) => {
      if (dirs.includes(file)) throw new DOMException("a folder", "TypeMismatchError");
      if (!disk.has(file) && !options?.create) throw new DOMException("none", "NotFoundError");
      return fileHandle(file);
    }),
  };
  return { handle, disk, writes, writers, failNextWrite, locked, walk };
}

type Folder = ReturnType<typeof fakeFolder>;
let fake: FakeIndexedDb;
let picker: ReturnType<typeof vi.fn>;
const win = () => ({ showDirectoryPicker: picker }) as unknown as Window;
const link = (folder: Folder) => {
  picker = vi.fn(async () => folder.handle);
  return linkedFolder.link(win());
};
/** A new page: the module forgets the folder, the IndexedDB and the mark stay. */
const reload = () => resetLinkedFolderForTests(fake.asFactory());

beforeEach(() => {
  fake = new FakeIndexedDb();
  localStorage.clear();
  resetLinkedFolderForTests(fake.asFactory());
});

describe("whether this browser can link a folder", () => {
  const page = (over: Record<string, unknown>) => {
    const w: Record<string, unknown> = { showDirectoryPicker: () => {}, isSecureContext: true, ...over };
    w.top = w.top ?? w;
    w.self = w;
    return w as unknown as Window;
  };
  it("needs the picker, a secure page and the top window", () => {
    expect(canLinkFolder(page({}))).toBe(true);
    expect(canLinkFolder(page({ showDirectoryPicker: undefined })), "Safari and Firefox have no picker").toBe(false);
    expect(canLinkFolder(page({ isSecureContext: false }))).toBe(false);
    expect(canLinkFolder(page({ top: {} })), "a page in a frame").toBe(false);
  });
});

describe("the files it lists", () => {
  it("takes .vctower and .TDT files by extension, in any case", () => {
    expect(linkedFileKind("Sky.vctower")).toBe("tower");
    expect(linkedFileKind("OLD.TDT")).toBe("tdt");
    expect(linkedFileKind("old.tdt")).toBe("tdt");
    expect(linkedFileKind("notes.txt")).toBeNull();
    expect(linkedFileKind("vctower")).toBeNull();
  });

  it("lists the folder's top-level tower files and skips everything else", async () => {
    const folder = fakeFolder("Towers", { "Sky.vctower": [1, 2, 3], "OLD.TDT": [9], "notes.txt": [0] }, ["Backups"]);
    expect(await link(folder)).toBe(true);
    expect(linkedFolder.list().map((e) => [e.id, e.name, e.kind, e.size])).toEqual([
      ["Sky.vctower", "Sky", "tower", 3],
      ["OLD.TDT", "OLD", "tdt", 1],
    ]);
    expect(linkedFolder.usage()).toEqual({ count: 2, bytes: 4 });
  });
});

describe("linking", () => {
  it("asks for read and write access to one folder and remembers it", async () => {
    const folder = fakeFolder("Towers", {});
    await link(folder);
    expect(picker).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mode: "readwrite", id: "verticopolis-towers" }));
    expect(linkedFolder.state()).toEqual({ name: "Towers", access: "granted" });
    expect(localStorage.getItem("verticopolis-linked-folder")).toBe("Towers");
  });

  it("links nothing when the player closes the picker", async () => {
    picker = vi.fn(async () => {
      throw new DOMException("closed", "AbortError");
    });
    expect(await linkedFolder.link(win())).toBe(false);
    expect(linkedFolder.state()).toBeNull();
    expect(localStorage.getItem("verticopolis-linked-folder")).toBeNull();
  });

  it("passes on a folder the browser refuses", async () => {
    picker = vi.fn(async () => {
      throw new DOMException("system folder", "NotAllowedError");
    });
    await expect(linkedFolder.link(win())).rejects.toThrow("system folder");
    expect(linkedFolder.state()).toBeNull();
  });
});

describe("after a reload", () => {
  it("names the folder from its mark without reading the handle back", async () => {
    const folder = fakeFolder("Towers", { "Sky.vctower": [1] });
    await link(folder);
    folder.handle.queryPermission.mockClear();
    reload();
    expect(linkedFolder.state()).toEqual({ name: "Towers", access: "prompt" });
    expect(linkedFolder.list()).toEqual([]);
    expect(folder.handle.queryPermission, "the handle stays in IndexedDB until a window shows it").not.toHaveBeenCalled();
  });

  it("reads the handle back when a window shows the folder", async () => {
    const folder = fakeFolder("Towers", { "Sky.vctower": [1] });
    await link(folder);
    reload();
    folder.handle.queryPermission.mockResolvedValueOnce("prompt");
    await linkedFolder.refresh();
    expect(linkedFolder.state()).toEqual({ name: "Towers", access: "prompt" });
    expect(linkedFolder.list(), "nothing is read before the player's OK").toEqual([]);

    await linkedFolder.allow();
    expect(folder.handle.requestPermission).toHaveBeenCalledExactlyOnceWith({ mode: "readwrite" });
    expect(linkedFolder.list().map((e) => e.name)).toEqual(["Sky"]);
  });

  it("lists at once when the browser kept the OK", async () => {
    const folder = fakeFolder("Towers", { "Sky.vctower": [1] });
    await link(folder);
    reload();
    await linkedFolder.refresh();
    expect(linkedFolder.state()?.access).toBe("granted");
    expect(folder.handle.requestPermission).not.toHaveBeenCalled();
    expect(linkedFolder.list().map((e) => e.name)).toEqual(["Sky"]);
  });

  it("forgets a mark whose handle is gone", async () => {
    localStorage.setItem("verticopolis-linked-folder", "Old");
    await linkedFolder.refresh();
    expect(linkedFolder.state()).toBeNull();
    expect(localStorage.getItem("verticopolis-linked-folder")).toBeNull();
  });

  it("stays closed when the player says no", async () => {
    const folder = fakeFolder("Towers", { "Sky.vctower": [1] });
    await link(folder);
    reload();
    folder.handle.queryPermission.mockResolvedValue("prompt");
    folder.handle.requestPermission.mockResolvedValueOnce("denied");
    expect(await linkedFolder.allow()).toBe("denied");
    expect(linkedFolder.list()).toEqual([]);
    await expect(linkedFolder.read("Sky.vctower")).rejects.toThrow("needs your OK");
  });
});

describe("saving", () => {
  it("writes name.vctower through the browser's writable and lists it", async () => {
    const folder = fakeFolder("Towers", {});
    await link(folder);
    const entry = await linkedFolder.save(" Sky  Hotel ", new Uint8Array([7, 8]), false);
    expect(entry).toMatchObject({ id: "Sky Hotel.vctower", name: "Sky Hotel", kind: "tower", size: 2 });
    expect(folder.writes).toEqual([{ name: "Sky Hotel.vctower", bytes: new Uint8Array([7, 8]) }]);
    expect(folder.writers[0]!.close).toHaveBeenCalledOnce();
  });

  it("refuses a name a tower already has unless asked to replace it", async () => {
    const folder = fakeFolder("Towers", { "Sky.vctower": [1] });
    await link(folder);
    await expect(linkedFolder.save("sky", new Uint8Array([2]), false)).rejects.toBeInstanceOf(FileNameTakenError);
    expect(folder.writes).toEqual([]);
    await linkedFolder.save("sky", new Uint8Array([2]), true);
    expect(folder.writes, "the replace keeps the file's own name").toEqual([{ name: "Sky.vctower", bytes: new Uint8Array([2]) }]);
  });

  it("never replaces a file another program wrote since the list was read, and numbers the save instead", async () => {
    const folder = fakeFolder("Towers", {});
    await link(folder);
    folder.disk.set("Sky.vctower", { bytes: new Uint8Array([5]), modified: 1 });
    folder.disk.set("Sky (2).vctower", { bytes: new Uint8Array([6]), modified: 1 });
    const entry = await linkedFolder.save("Sky", new Uint8Array([2]), false);
    expect(entry.name).toBe("Sky (3)");
    expect(folder.disk.get("Sky.vctower")!.bytes).toEqual(new Uint8Array([5]));
    expect(folder.disk.get("Sky (2).vctower")!.bytes).toEqual(new Uint8Array([6]));
    expect(folder.writes).toEqual([{ name: "Sky (3).vctower", bytes: new Uint8Array([2]) }]);
  });

  it("saves a new file without asking, numbered past a listed tower and a file only on disk (the Auto-save copy)", async () => {
    const folder = fakeFolder("Towers", { "Auto-save.vctower": [1] });
    await link(folder);
    folder.disk.set("Auto-save (2).vctower", { bytes: new Uint8Array([6]), modified: 1 });
    const entry = await linkedFolder.saveNew("Auto-save", new Uint8Array([3]));
    expect(entry.id).toBe("Auto-save (3).vctower");
    expect(folder.disk.get("Auto-save.vctower")!.bytes).toEqual(new Uint8Array([1]));
    expect(folder.disk.get("Auto-save (2).vctower")!.bytes).toEqual(new Uint8Array([6]));
    expect(folder.writes).toEqual([{ name: "Auto-save (3).vctower", bytes: new Uint8Array([3]) }]);
  });

  it("saves a new file under its own name when nothing has it", async () => {
    const folder = fakeFolder("Towers", {});
    await link(folder);
    expect((await linkedFolder.saveNew("Auto-save", new Uint8Array([3]))).id).toBe("Auto-save.vctower");
  });

  it("saves beside a 1994 file of the same name without touching it", async () => {
    const folder = fakeFolder("Towers", { "TOWER2.TDT": [9] });
    await link(folder);
    await linkedFolder.save("TOWER2", new Uint8Array([3]), false);
    expect(folder.disk.get("TOWER2.TDT")!.bytes).toEqual(new Uint8Array([9]));
    expect(folder.disk.get("TOWER2.vctower")!.bytes).toEqual(new Uint8Array([3]));
  });

  it("drops a write that fails partway and keeps the old file", async () => {
    const folder = fakeFolder("Towers", { "Sky.vctower": [1] });
    await link(folder);
    folder.failNextWrite.on = true;
    await expect(linkedFolder.save("Sky", new Uint8Array([2]), true)).rejects.toThrow("disk full");
    expect(folder.writers[0]!.abort).toHaveBeenCalledOnce();
    expect(folder.writers[0]!.close).not.toHaveBeenCalled();
    expect(folder.disk.get("Sky.vctower")!.bytes).toEqual(new Uint8Array([1]));
  });
});

describe("reading and copying", () => {
  it("reads a file's bytes, and answers null for one gone from the disk", async () => {
    const folder = fakeFolder("Towers", { "Sky.vctower": [4, 5] });
    await link(folder);
    expect(await linkedFolder.read("Sky.vctower")).toEqual(new Uint8Array([4, 5]));
    folder.disk.delete("Sky.vctower");
    expect(await linkedFolder.read("Sky.vctower")).toBeNull();
  });

  it("copies a file beside itself as Copy of …, keeping its extension", async () => {
    const folder = fakeFolder("Towers", { "OLD.TDT": [9], "Copy of OLD.TDT": [8] });
    await link(folder);
    await linkedFolder.duplicate("OLD.TDT");
    expect(folder.disk.get("Copy (2) of OLD.TDT")!.bytes).toEqual(new Uint8Array([9]));
    expect(folder.disk.get("Copy of OLD.TDT")!.bytes, "the older copy stays").toEqual(new Uint8Array([8]));
  });
});

describe("the player's files", () => {
  it("are never deleted or renamed, whatever the windows do", async () => {
    const folder = fakeFolder("Towers", { "Sky.vctower": [1], "OLD.TDT": [9] });
    await link(folder);
    await linkedFolder.save("Sky", new Uint8Array([2]), true);
    await linkedFolder.duplicate("OLD.TDT");
    await linkedFolder.unlink();
    expect(folder.handle.removeEntry).not.toHaveBeenCalled();
    expect(folder.disk.has("Sky.vctower") && folder.disk.has("OLD.TDT")).toBe(true);
  });

  it("stay where they are after Unlink, which forgets the folder", async () => {
    const folder = fakeFolder("Towers", { "Sky.vctower": [1] });
    await link(folder);
    await linkedFolder.unlink();
    expect(linkedFolder.state()).toBeNull();
    expect(localStorage.getItem("verticopolis-linked-folder")).toBeNull();
    reload();
    await linkedFolder.refresh();
    expect(linkedFolder.state(), "the handle is gone from IndexedDB too").toBeNull();
    expect(folder.disk.has("Sky.vctower")).toBe(true);
  });
});

describe("a file it can't read right now", () => {
  it("leaves it out of the list and links the folder anyway", async () => {
    const folder = fakeFolder("Towers", { "Sky.vctower": [1], "Synced.vctower": [2] });
    folder.locked.add("Synced.vctower");
    expect(await link(folder)).toBe(true);
    expect(linkedFolder.list().map((e) => e.id)).toEqual(["Sky.vctower"]);
  });

  it("keeps the folder linked after a restart when it can't be listed", async () => {
    const folder = fakeFolder("Towers", { "Sky.vctower": [1] });
    await link(folder);
    reload();
    folder.walk.fails = true;
    await linkedFolder.restore();
    expect(linkedFolder.state()).toEqual({ name: "Towers", access: "granted" });
    expect(localStorage.getItem("verticopolis-linked-folder")).toBe("Towers");
  });

  it("reports a save that was written as saved, even when the list can't be read again", async () => {
    const folder = fakeFolder("Towers", {});
    await link(folder);
    folder.walk.fails = true;
    const entry = await linkedFolder.save("Sky", Uint8Array.of(5), false);
    expect(entry.id).toBe("Sky.vctower");
    expect(folder.writes.map((w) => w.name)).toEqual(["Sky.vctower"]);
  });
});

describe("saving over the file a tower came from", () => {
  it("writes the file by its name on disk, however it is spelled", async () => {
    const folder = fakeFolder("Towers", { "My  Tower: v2.vctower": [1] });
    await link(folder);
    await linkedFolder.saveOver("My  Tower: v2.vctower", Uint8Array.of(8));
    expect(folder.writes).toEqual([{ name: "My  Tower: v2.vctower", bytes: Uint8Array.of(8) }]);
    expect([...folder.disk.keys()]).toEqual(["My  Tower: v2.vctower"]);
  });

  it("matches a typed name to that file before cleaning it, so Save As replaces it", async () => {
    const folder = fakeFolder("Towers", { "My  Tower.vctower": [1] });
    await link(folder);
    await expect(linkedFolder.save("My  Tower", Uint8Array.of(3), false)).rejects.toBeInstanceOf(FileNameTakenError);
    await linkedFolder.save("My  Tower", Uint8Array.of(3), true);
    expect(folder.writes.map((w) => w.name)).toEqual(["My  Tower.vctower"]);
  });
});
