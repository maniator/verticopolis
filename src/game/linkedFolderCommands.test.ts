import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileNameTakenError } from "../storage/fileSpace";
import { recentTowers } from "../storage/recentTowers";

const m = vi.hoisted(() => ({
  track: vi.fn(),
  exportFile: vi.fn(() => Uint8Array.of(7, 7, 7)),
  canLink: true,
  live: vi.fn(() => true),
  mirror: { on: false, forget: vi.fn(), set: vi.fn(), copy: vi.fn(async () => true) },
  folder: {
    state: vi.fn(() => ({ name: "Towers", access: "granted" }) as { name: string; access: string } | null),
    linkId: vi.fn(() => "L1" as string | null),
    list: vi.fn(() => []),
    usage: vi.fn(() => "1 tower"),
    onChange: vi.fn(() => () => {}),
    refresh: vi.fn(async () => {}),
    link: vi.fn(async () => true),
    allow: vi.fn(async () => "granted"),
    unlink: vi.fn(async () => {}),
    read: vi.fn(async () => Uint8Array.of(1) as Uint8Array | null),
    save: vi.fn(async (name: string) => ({ id: `${name}.vctower`, name })),
    saveOver: vi.fn(async (id: string) => ({ id, name: id.replace(/\.[^.]+$/, "") })),
    duplicate: vi.fn(async () => ({ id: "Copy of A.vctower", name: "Copy of A" })),
    find: vi.fn((id: string) => ({ id, name: id.replace(/\.[^.]+$/, "") }) as { id: string; name: string } | undefined),
  },
}));
vi.mock("../analytics", () => ({ trackAppAction: m.track }));
vi.mock("./portLifecycle", () => ({ exportFile: m.exportFile }));
vi.mock("../storage/linkedFolder", () => ({ canLinkFolder: () => m.canLink, linkedFolder: m.folder }));
vi.mock("./autosaveSchedule", () => ({ autosaveLive: m.live }));
vi.mock("./autosaveMirror", () => ({
  mirrorOn: () => m.mirror.on,
  setMirror: m.mirror.set,
  forgetMirrorFile: m.mirror.forget,
  mirrorAutosave: m.mirror.copy,
}));

import type { GameApp } from "../main";
import type { FileRow } from "../ui/templates/fileDialog";
import { currentFileId, currentLinkedFile, setCurrentFile, setCurrentLinkedFile } from "./currentFile";
import { linkedPlace, openLinkedRow, saveCurrentLinked } from "./linkedFolderCommands";

const BINARY = new TextEncoder().encode("VCTOWER2\nrest");
const TDT = Uint8Array.of(0x00, 0x24, 1, 2);

function makeApp() {
  let generation = 1;
  return {
    enginePort: { generation: vi.fn(() => generation) },
    engine: { viewState: vi.fn(() => ({ tile: 1, floor: 1, zoom: 1 })) },
    saveLoad: { importGame: vi.fn(async () => void generation++), importLegacy: vi.fn(async () => {}) },
    ui: { toast: vi.fn(), sayVisibly: vi.fn() },
  };
}
const row = (id: string, type: "tower" | "tdt" = "tower"): FileRow =>
  ({ id, name: id.replace(/\.[^.]+$/, ""), type }) as FileRow;
const settle = () => new Promise((r) => setTimeout(r, 0));

let app: ReturnType<typeof makeApp>;
const place = () => linkedPlace(app as unknown as GameApp)!;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  m.canLink = true;
  m.folder.state.mockImplementation(() => ({ name: "Towers", access: "granted" }));
  m.folder.allow.mockImplementation(async () => "granted");
  m.folder.read.mockImplementation(async () => BINARY);
  m.live.mockReturnValue(true);
  m.mirror.copy.mockImplementation(async () => true);
  setCurrentFile(null);
  app = makeApp();
});

describe("the linked folder in the Open and Save As windows", () => {
  it("is left out where the browser can't link a folder", () => {
    m.canLink = false;
    expect(linkedPlace(app as unknown as GameApp)).toBeNull();
  });

  it("calls the folder picker before any await, so the click still counts", () => {
    void place().link();
    expect(m.folder.link).toHaveBeenCalledOnce();
  });

  it("answers linked, cancel or a note, and counts each", async () => {
    expect(await place().link()).toBe("linked");
    expect(m.track).toHaveBeenLastCalledWith("folder_link", "linked");
    m.folder.link.mockResolvedValueOnce(false);
    expect(await place().link()).toBe("cancel");
    expect(m.track).toHaveBeenLastCalledWith("folder_link", "cancel");
    m.folder.link.mockRejectedValueOnce(new DOMException("no", "NotAllowedError"));
    expect(await place().link()).toEqual({
      text: "Your browser didn't allow the game to use that folder.",
      kind: "bad",
    });
    expect(m.track).toHaveBeenCalledWith("folder_link", "refused");
    expect(m.track).toHaveBeenLastCalledWith("folder_failed");
  });

  it("asks for the OK again and says so when the browser keeps it closed", async () => {
    expect(await place().allow()).toBeNull();
    expect(m.track).toHaveBeenLastCalledWith("folder_allow", "granted");
    m.folder.allow.mockResolvedValueOnce("denied");
    expect(await place().allow()).toEqual({
      text: "The folder stays closed until your browser allows it.",
      kind: "bad",
    });
    expect(m.track).toHaveBeenLastCalledWith("folder_allow", "denied");
  });

  it("forgets a linked current file on unlink, and leaves a My Towers one alone", async () => {
    setCurrentLinkedFile("A.vctower");
    expect(await place().unlink()).toBeNull();
    expect(currentLinkedFile()).toBeNull();
    expect(m.track).toHaveBeenLastCalledWith("folder_unlink");
    setCurrentFile("slot-1");
    await place().unlink();
    expect(currentFileId()).toBe("slot-1");
  });

  it("opens a tower file through the importer and makes it the live tower's file", async () => {
    place().open(row("A.vctower"));
    await settle();
    expect(m.folder.read).toHaveBeenCalledExactlyOnceWith("A.vctower");
    expect(app.saveLoad.importGame).toHaveBeenCalledExactlyOnceWith(BINARY);
    expect(currentLinkedFile()).toBe("A.vctower");
    expect(recentTowers()).toEqual([
      { place: "folder", id: "A.vctower", name: "A.vctower", kind: "tower", link: "L1" },
    ]);
    expect(m.track).toHaveBeenCalledWith("folder_open", "tower");
  });

  it("answers whether the file was there, for File > Open Recent", async () => {
    expect(await openLinkedRow(app as unknown as GameApp, row("A.vctower"))).toBe(true);
    m.folder.read.mockResolvedValueOnce(null);
    expect(await openLinkedRow(app as unknown as GameApp, row("Gone.vctower"))).toBe(false);
    m.folder.read.mockRejectedValueOnce(new DOMException("no", "NotAllowedError"));
    expect(await openLinkedRow(app as unknown as GameApp, row("B.vctower"))).toBe(true);
  });

  it("keeps the old file when the importer refuses the tower", async () => {
    setCurrentLinkedFile("Old.vctower");
    app.saveLoad.importGame.mockImplementationOnce(async () => {});
    place().open(row("A.vctower"));
    await settle();
    expect(currentLinkedFile()).toBe("Old.vctower");
    expect(recentTowers()).toEqual([]);
  });

  it("hands a 1994 file to the legacy importer by its name", async () => {
    m.folder.read.mockResolvedValueOnce(TDT);
    place().open(row("OLD.TDT", "tdt"));
    await settle();
    expect(app.saveLoad.importLegacy).toHaveBeenCalledExactlyOnceWith(TDT.buffer, "OLD.TDT");
    expect(app.saveLoad.importGame).not.toHaveBeenCalled();
    expect(m.track).toHaveBeenCalledWith("folder_open", "tdt");
  });

  it("says when a file left the folder", async () => {
    m.folder.read.mockResolvedValueOnce(null);
    place().open(row("Gone.vctower"));
    await settle();
    expect(app.ui.sayVisibly).toHaveBeenCalledExactlyOnceWith(
      `"Gone" isn't in the folder any more. It may have been moved or deleted.`,
    );
    expect(app.saveLoad.importGame).not.toHaveBeenCalled();
  });

  it("says an empty file holds no tower, and counts it, without importing (#2337)", async () => {
    m.folder.read.mockResolvedValueOnce(new Uint8Array());
    place().open(row("Sky.vctower"));
    await settle();
    expect(app.ui.sayVisibly).toHaveBeenCalledExactlyOnceWith(
      `"Sky" is an empty file, so there's no tower in it. A save that didn't finish can leave one; saving under that name uses it.`,
    );
    expect(app.saveLoad.importGame).not.toHaveBeenCalled();
    expect(m.track).toHaveBeenCalledExactlyOnceWith("folder_failed", "empty");
    expect(currentLinkedFile()).toBeNull();
  });

  it("says an empty 1994 file holds no tower, without promising a save reuses it", async () => {
    m.folder.read.mockResolvedValueOnce(new Uint8Array());
    place().open(row("OLD.TDT", "tdt"));
    await settle();
    expect(app.ui.sayVisibly).toHaveBeenCalledExactlyOnceWith(`"OLD" is an empty file, so there's no tower in it.`);
    expect(app.saveLoad.importLegacy).not.toHaveBeenCalled();
    expect(m.track).toHaveBeenCalledExactlyOnceWith("folder_failed", "empty");
  });

  it("saves the exported bytes under the typed name and toasts where", async () => {
    expect(await place().save("Sky", false)).toBeNull();
    expect(m.folder.save).toHaveBeenCalledExactlyOnceWith("Sky", Uint8Array.of(7, 7, 7), false);
    expect(currentLinkedFile()).toBe("Sky.vctower");
    expect(recentTowers()).toEqual([
      { place: "folder", id: "Sky.vctower", name: "Sky.vctower", kind: "tower", link: "L1" },
    ]);
    expect(m.track).toHaveBeenCalledWith("folder_save", "new");
    expect(app.ui.toast).toHaveBeenCalledWith(`Saved "Sky" in Towers.`, "good");
    await place().save("Sky", true);
    expect(m.track).toHaveBeenLastCalledWith("folder_save", "replace");
  });

  it("turns a taken name or a full disk into a note", async () => {
    m.folder.save.mockRejectedValueOnce(new FileNameTakenError("Sky"));
    expect((await place().save("Sky", false))?.kind).toBe("bad");
    m.folder.save.mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"));
    expect(await place().save("Sky", false)).toEqual({
      text: "There's no room left on your disk for that tower.",
      kind: "bad",
    });
    expect(currentLinkedFile()).toBeNull();
  });

  it("copies a file and counts it", async () => {
    expect(await place().duplicate("A.vctower")).toBeNull();
    expect(m.folder.duplicate).toHaveBeenCalledExactlyOnceWith("A.vctower");
    expect(m.track).toHaveBeenCalledWith("folder_copy");
  });
});

describe("the copy of each tower in the linked folder", () => {
  beforeEach(() => setCurrentFile("T1"));

  it("turns on, writes the copy now, and says how often it is written", async () => {
    expect(await place().setMirror(true)).toEqual({
      text: `The tower you play is copied to "Towers" every minute, under its own name.`,
      kind: "info",
    });
    expect(m.mirror.set).toHaveBeenCalledExactlyOnceWith(true);
    expect(m.mirror.copy).toHaveBeenCalledExactlyOnceWith(app, expect.any(Number), true);
    expect(m.track).toHaveBeenCalledWith("folder_mirror", "on");
  });

  it("says when the first copy failed", async () => {
    m.mirror.copy.mockResolvedValueOnce(false);
    expect((await place().setMirror(true))?.kind).toBe("bad");
  });

  it("waits to write while the folder needs the browser's OK or the tower can't be saved", async () => {
    m.folder.state.mockImplementation(() => ({ name: "Towers", access: "prompt" }));
    expect(await place().setMirror(true)).toEqual({
      text: `Your towers will be copied to "Towers" once your browser allows the folder.`,
      kind: "info",
    });
    m.folder.state.mockImplementation(() => ({ name: "Towers", access: "granted" }));
    m.live.mockReturnValue(false);
    await place().setMirror(true);
    expect(m.mirror.copy).not.toHaveBeenCalled();
  });

  it("writes no copy now for a tower without a My Towers file yet", async () => {
    setCurrentFile(null);
    expect((await place().setMirror(true))?.kind).toBe("info");
    expect(m.mirror.copy).not.toHaveBeenCalled();
  });

  it("turns off and says the copy stays", async () => {
    expect(await place().setMirror(false)).toEqual({
      text: `Your towers are no longer copied to "Towers". The copies there stay.`,
      kind: "info",
    });
    expect(m.mirror.set).toHaveBeenCalledExactlyOnceWith(false);
    expect(m.mirror.copy).not.toHaveBeenCalled();
    expect(m.track).toHaveBeenCalledWith("folder_mirror", "off");
  });

  it("starts a new copy file when another folder is linked, and not when the picker is cancelled", async () => {
    m.folder.link.mockResolvedValueOnce(false);
    await place().link();
    expect(m.mirror.forget).not.toHaveBeenCalled();
    await place().link();
    expect(m.mirror.forget, "the replaced link's file").toHaveBeenCalledExactlyOnceWith("L1");
  });

  it("stops copying and forgets the file on unlink", async () => {
    await place().unlink();
    expect(m.mirror.set).toHaveBeenCalledExactlyOnceWith(false);
    expect(m.mirror.forget).toHaveBeenCalledExactlyOnceWith("L1");
  });
});

describe("File > Save for a tower from the linked folder", () => {
  it("does nothing when the live tower isn't a linked file", async () => {
    expect(await saveCurrentLinked(app as unknown as GameApp)).toBe(false);
    expect(m.folder.save).not.toHaveBeenCalled();
    expect(m.folder.saveOver).not.toHaveBeenCalled();
  });

  it("forgets the file when another folder is linked, so Save never writes over a same-named file there", async () => {
    setCurrentLinkedFile("Sky.vctower");
    expect(await place().link()).toBe("linked");
    expect(currentLinkedFile()).toBeNull();
    expect(await saveCurrentLinked(app as unknown as GameApp)).toBe(false);
    expect(m.folder.saveOver).not.toHaveBeenCalled();
    expect(m.folder.save).not.toHaveBeenCalled();
  });

  it("keeps the file when the player cancels the folder picker", async () => {
    setCurrentLinkedFile("Sky.vctower");
    m.folder.link.mockResolvedValueOnce(false);
    await place().link();
    expect(currentLinkedFile()).toBe("Sky.vctower");
  });

  it("writes the same file again", async () => {
    setCurrentLinkedFile("Sky.vctower");
    expect(await saveCurrentLinked(app as unknown as GameApp)).toBe(true);
    expect(m.folder.allow).not.toHaveBeenCalled();
    expect(m.folder.saveOver).toHaveBeenCalledExactlyOnceWith("Sky.vctower", Uint8Array.of(7, 7, 7));
    expect(m.folder.save).not.toHaveBeenCalled();
    expect(m.track).toHaveBeenCalledWith("folder_save", "current");
  });

  it("asks for the OK first, and saves nothing when the browser says no", async () => {
    setCurrentLinkedFile("Sky.vctower");
    m.folder.state.mockImplementation(() => ({ name: "Towers", access: "prompt" }));
    m.folder.allow.mockResolvedValueOnce("denied");
    expect(await saveCurrentLinked(app as unknown as GameApp)).toBe(true);
    expect(m.folder.saveOver).not.toHaveBeenCalled();
    expect(app.ui.sayVisibly).toHaveBeenCalledOnce();
  });
});
