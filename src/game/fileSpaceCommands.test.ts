import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileDialogCtx } from "../ui/fileDialog";

const m = vi.hoisted(() => ({
  track: vi.fn(),
  dialog: vi.fn(),
  openImport: vi.fn(),
  readPickedFile: vi.fn(),
  exportFile: vi.fn(() => Uint8Array.of(7, 7, 7)),
  loadSave: vi.fn(),
  copySlots: vi.fn(async () => 0),
  openingFile: vi.fn(),
  keptSettled: vi.fn(() => Promise.resolve()),
  dialogOpen: false,
  stopped: false,
}));
vi.mock("../analytics", () => ({ trackAppAction: m.track }));
vi.mock("../ui/fileDialog", () => ({ showFileDialog: m.dialog }));
vi.mock("../ui/uiImport", async (actual) => ({ ...(await actual<typeof import("../ui/uiImport")>()), openImport: m.openImport, readPickedFile: m.readPickedFile }));
vi.mock("./portLifecycle", () => ({ exportFile: m.exportFile }));
vi.mock("./loadMenu", () => ({ loadSave: m.loadSave }));
vi.mock("./keepOutgoing", () => ({ openingFile: m.openingFile, keptSettled: m.keptSettled }));
vi.mock("../storage/fileSpaceMigrate", () => ({ copySlotsOnce: m.copySlots }));
vi.mock("./interactionState", () => ({ isDialogOpen: () => m.dialogOpen, isEngineStopped: () => m.stopped }));

import type { GameApp } from "../main";
import { closeFileSpaceForTests, fileSpace } from "../storage/fileSpace";
import { SaveGame } from "../storage/SaveGame";
import { recentTowers } from "../storage/recentTowers";
import { FakeIndexedDb } from "../tests/fakeIndexedDb";
import { currentFileId, setCurrentFile } from "./currentFile";
import { openFile, openFileSpace, openTowersFile, saveCurrentFile, saveFile, showOpenDialog, showSaveAsDialog, towerFileKind, wireTowerDrop } from "./fileSpaceCommands";

const text = (s: string) => new TextEncoder().encode(s);
const TDT = Uint8Array.of(0x00, 0x24, 1, 2);
const BINARY = text("VCTOWER2\nrest");

function makeApp() {
  let generation = 1;
  const app = {
    enginePort: { generation: vi.fn(() => generation), towerName: vi.fn(() => "Sky  Hotel") },
    engine: { viewState: vi.fn(() => ({ tile: 1, floor: 1, zoom: 1 })) },
    saveLoad: { importGame: vi.fn(async () => void generation++), importLegacy: vi.fn(async () => {}) },
    ui: { toast: vi.fn(), sayVisibly: vi.fn(), promptExport: vi.fn(), downloadFile: vi.fn() },
  };
  return { app, refuseNext: () => app.saveLoad.importGame.mockImplementationOnce(async () => {}) };
}

/** The window the last command opened, by its context. */
const lastCtx = (): FileDialogCtx => m.dialog.mock.lastCall![1] as FileDialogCtx;
const settle = () => new Promise((r) => setTimeout(r, 0));

let app: ReturnType<typeof makeApp>["app"];
let refuseNext: () => void;

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  m.dialogOpen = false;
  m.stopped = false;
  setCurrentFile(null);
  ({ app, refuseNext } = makeApp());
  closeFileSpaceForTests();
  await fileSpace.open(new FakeIndexedDb().asFactory());
  await openFileSpace(app as unknown as GameApp);
});
afterEach(() => closeFileSpaceForTests());

describe("which kind of tower file a picked file is", () => {
  it("knows a 1994 file, a binary tower and a text tower, and refuses anything else", () => {
    expect(towerFileKind("OLD.TDT", Uint8Array.of(1))).toBe("tdt");
    expect(towerFileKind("renamed.bin", TDT)).toBe("tdt");
    expect(towerFileKind("a.vctower", BINARY)).toBe("tower");
    expect(towerFileKind("a.vctower", text("VCTOWER1\nabc\n"))).toBe("tower");
    expect(towerFileKind("notes.txt", text("hello"))).toBeNull();
  });
});

describe("File > Open…", () => {
  it("falls back to the device's picker while My Towers is closed", () => {
    closeFileSpaceForTests();
    showOpenDialog(app as unknown as GameApp, "menu");
    expect(m.openImport).toHaveBeenCalledOnce();
    expect(m.dialog).not.toHaveBeenCalled();
  });

  it("shows the window while My Towers is still opening, and fills it in once the old slots are in", async () => {
    // Staging, 2026-11-15: on a phone the folder took a moment to open the
    // first time, and File > Open… fell back to the device's picker, which
    // showed none of the player's towers.
    closeFileSpaceForTests();
    let copyDone = () => {};
    m.copySlots.mockClear();
    m.copySlots.mockImplementationOnce(() => new Promise<number>((r) => (copyDone = () => r(2))));
    void fileSpace.open(new FakeIndexedDb().asFactory());
    const ready = openFileSpace(app as unknown as GameApp);
    expect(fileSpace.isOpening()).toBe(true);
    showOpenDialog(app as unknown as GameApp, "menu");
    expect(m.openImport).not.toHaveBeenCalled();
    const ctx = lastCtx();
    expect(ctx.loading()).toBe(true);
    expect(m.track).toHaveBeenCalledWith("files_waited", "open");
    const heard = vi.fn();
    ctx.onChange(heard);
    await vi.waitFor(() => expect(m.copySlots, "the folder opened and the copy began").toHaveBeenCalled());
    expect(fileSpace.isOpen()).toBe(true);
    expect(heard, "the window heard the folder open").toHaveBeenCalled();
    expect(ctx.loading(), "still copying the slots in").toBe(true);
    heard.mockClear();
    copyDone();
    await ready;
    await settle();
    expect(ctx.loading()).toBe(false);
    expect(heard, "the window draws once more when the copy is done").toHaveBeenCalled();
    expect(m.track).toHaveBeenCalledWith("files_copied", "2");
  });

  it("Save As… also waits for a folder that is still opening, and stops listening when closed", async () => {
    closeFileSpaceForTests();
    let copyDone = () => {};
    m.copySlots.mockClear();
    m.copySlots.mockImplementationOnce(() => new Promise<number>((r) => (copyDone = () => r(0))));
    void fileSpace.open(new FakeIndexedDb().asFactory());
    const ready = openFileSpace(app as unknown as GameApp);
    showSaveAsDialog(app as unknown as GameApp);
    expect(app.ui.promptExport).not.toHaveBeenCalled();
    const ctx = lastCtx();
    expect(ctx.loading()).toBe(true);
    expect(m.track).toHaveBeenCalledWith("files_waited", "save_as");
    const heard = vi.fn();
    ctx.onChange(heard)();
    await vi.waitFor(() => expect(m.copySlots).toHaveBeenCalled());
    copyDone();
    await ready;
    await settle();
    expect(heard, "an unsubscribed window is not drawn").not.toHaveBeenCalled();
  });

  it("gives the Auto-save row its tower's name and the size it takes", () => {
    const slots = vi.spyOn(SaveGame, "listSlots").mockReturnValue([{ slot: "auto", exists: true, present: true, size: 20_480, towerName: "Sky", savedAt: 5 }]);
    try {
      showOpenDialog(app as unknown as GameApp, "menu");
      expect(lastCtx().auto()).toEqual({ id: "auto", name: "Auto-save (Sky)", type: "auto", size: 20_480, modified: 5 });
    } finally {
      slots.mockRestore();
    }
  });

  it("lists a stored Auto-save even when it does not read now, under its plain name", () => {
    localStorage.setItem("verticopolis-save", "VCZ1:not a save");
    try {
      showOpenDialog(app as unknown as GameApp, "menu");
      expect(lastCtx().auto()).toEqual({ id: "auto", name: "Auto-save", type: "auto", modified: undefined });
    } finally {
      localStorage.removeItem("verticopolis-save");
    }
    showOpenDialog(app as unknown as GameApp, "menu");
    expect(lastCtx().auto(), "no row with nothing stored").toBeNull();
  });

  it("opens the window and counts it, telling the menu, its key and the title screen apart", () => {
    showOpenDialog(app as unknown as GameApp, "menu");
    expect(lastCtx().mode).toBe("open");
    expect(m.track).toHaveBeenLastCalledWith("files_open", "open");
    showOpenDialog(app as unknown as GameApp, "key");
    expect(m.track).toHaveBeenLastCalledWith("files_open", "open_key");
    showOpenDialog(app as unknown as GameApp, "title");
    expect(m.track).toHaveBeenLastCalledWith("files_open", "open_title");
    expect(m.track, "a ready folder kept nobody waiting").not.toHaveBeenCalledWith("files_waited", expect.anything());
    lastCtx().asked!("delete");
    expect(m.track).toHaveBeenCalledWith("file_ask", "delete");
  });

  it("adds dropped tower files and names the ones it refused", async () => {
    showOpenDialog(app as unknown as GameApp, "menu");
    const note = await lastCtx().add([new File([BINARY], "Spire.vctower"), new File(["hi"], "notes.txt")]);
    expect(note).toEqual({ text: `"notes.txt" isn't a tower file (.vctower or .TDT). Added the other 1.`, kind: "bad" });
    expect(fileSpace.list().map((f) => [f.name, f.kind])).toEqual([["Spire", "tower"]]);
    expect(m.track).toHaveBeenCalledWith("file_add", "drop");
  });

  it("deleting the live tower's file forgets it", async () => {
    const saved = await fileSpace.save("Mine", "tower", BINARY);
    setCurrentFile(saved.id);
    showOpenDialog(app as unknown as GameApp, "menu");
    expect(await lastCtx().remove(saved.id)).toBeNull();
    expect(currentFileId()).toBeNull();
    expect(m.track).toHaveBeenCalledWith("file_delete");
  });
});

describe("opening a My Towers file", () => {
  it("waits for the last tower's keep to be written before reading the file", async () => {
    const f = await fileSpace.save("Spire", "tower", text("VCTOWER1\nabc\n"));
    let written!: () => void;
    m.keptSettled.mockReturnValueOnce(new Promise<void>((resolve) => (written = resolve)));
    const read = vi.spyOn(fileSpace, "read");
    const opened = openFile(app as unknown as GameApp, f.id);
    await new Promise((r) => setTimeout(r, 0));
    expect(m.keptSettled).toHaveBeenCalledOnce();
    expect(read, "no read while a keep may still write this file").not.toHaveBeenCalled();
    written();
    await opened;
    expect(read).toHaveBeenCalledExactlyOnceWith(f.id);
    expect(app.saveLoad.importGame).toHaveBeenCalledExactlyOnceWith("VCTOWER1\nabc\n");
    read.mockRestore();
  });

  it("imports a tower's bytes and makes it the live tower's file once it is in", async () => {
    const f = await fileSpace.save("Spire", "tower", text("VCTOWER1\nabc\n"));
    await openFile(app as unknown as GameApp, f.id);
    expect(app.saveLoad.importGame).toHaveBeenCalledExactlyOnceWith("VCTOWER1\nabc\n");
    // Named before the swap, so a tower reopening its own file keeps the minutes since as a new file.
    expect(m.openingFile).toHaveBeenCalledExactlyOnceWith(f.id);
    expect(m.openingFile.mock.invocationCallOrder[0]).toBeLessThan(app.saveLoad.importGame.mock.invocationCallOrder[0]!);
    expect(currentFileId()).toBe(f.id);
    expect(fileSpace.list()).toHaveLength(1);
    expect(recentTowers()).toEqual([{ place: "towers", id: f.id, name: "Spire", kind: "tower" }]);
    expect(m.track).toHaveBeenCalledWith("file_open", "tower");
    expect(m.track).not.toHaveBeenCalledWith("import_save");
  });

  it("hands a binary tower over as bytes, and keeps nothing when the import is refused", async () => {
    const f = await fileSpace.save("Spire", "tower", BINARY);
    refuseNext();
    await openFile(app as unknown as GameApp, f.id);
    expect(app.saveLoad.importGame).toHaveBeenCalledExactlyOnceWith(BINARY);
    expect(currentFileId()).toBeNull();
    expect(recentTowers()).toEqual([]);
  });

  it("answers whether the file opened, is gone, or My Towers itself is closed (File > Open Recent)", async () => {
    const f = await fileSpace.save("Spire", "tower", text("VCTOWER1\nabc\n"));
    expect(await openTowersFile(app as unknown as GameApp, f.id)).toBe("opened");
    expect(await openTowersFile(app as unknown as GameApp, "no-such-id")).toBe("gone");
    closeFileSpaceForTests();
    expect(await openTowersFile(app as unknown as GameApp, f.id)).toBe("closed");
    expect(app.saveLoad.importGame).toHaveBeenCalledOnce();
  });

  it("sends a 1994 file to the legacy import under its own name", async () => {
    const f = await fileSpace.save("OLD", "tdt", TDT);
    await openFile(app as unknown as GameApp, f.id);
    const [buffer, name] = app.saveLoad.importLegacy.mock.calls[0] as unknown as [ArrayBuffer, string];
    expect(name).toBe("OLD.TDT");
    expect(new Uint8Array(buffer as ArrayBuffer)).toEqual(TDT);
  });

  it("opens the Auto-save row the Auto-save's way", () => {
    showOpenDialog(app as unknown as GameApp, "menu");
    lastCtx().open({ id: "auto", name: "Auto-save (Sky)", type: "auto" });
    expect(m.loadSave).toHaveBeenCalledExactlyOnceWith(app, "auto");
  });
});

describe("saving into My Towers", () => {
  it("Save As writes the tower's file bytes, toasts, and makes it the live tower's file", async () => {
    showSaveAsDialog(app as unknown as GameApp);
    expect(lastCtx().initialName).toBe("Sky Hotel");
    expect(await lastCtx().save("Sky Hotel", false)).toBeNull();
    const [f] = fileSpace.list();
    expect(await fileSpace.read(f.id)).toEqual(Uint8Array.of(7, 7, 7));
    expect(currentFileId()).toBe(f.id);
    expect(recentTowers()).toEqual([{ place: "towers", id: f.id, name: "Sky Hotel", kind: "tower" }]);
    expect(app.ui.toast).toHaveBeenCalledWith(`Saved "Sky Hotel" in My Towers.`, "good");
    expect(m.track).toHaveBeenCalledWith("file_save", "new");
  });

  it("a new name another tab took meanwhile is refused, and replaced once asked", async () => {
    showSaveAsDialog(app as unknown as GameApp);
    const other = await fileSpace.save("Spire", "tower", BINARY);
    expect(await lastCtx().save("spire", false)).toEqual({ text: `A tower named "Spire" already exists.`, kind: "bad" });
    expect(await fileSpace.read(other.id)).toEqual(BINARY);
    expect(await lastCtx().save("spire", true)).toBeNull();
    expect(await fileSpace.read(other.id)).toEqual(Uint8Array.of(7, 7, 7));
    expect(m.track).toHaveBeenCalledWith("file_save", "replace");
  });

  it("Save As downloads instead while My Towers is closed", () => {
    closeFileSpaceForTests();
    showSaveAsDialog(app as unknown as GameApp);
    expect(app.ui.promptExport).toHaveBeenCalledOnce();
    expect(m.dialog).not.toHaveBeenCalled();
  });

  it("saving under a taken name replaces that file and keeps its id", async () => {
    const id = await saveFile(app as unknown as GameApp, "Spire");
    m.exportFile.mockReturnValueOnce(Uint8Array.of(8));
    expect(await saveFile(app as unknown as GameApp, "Spire")).toBe(id);
    expect(await fileSpace.read(id)).toEqual(Uint8Array.of(8));
    expect(m.track).toHaveBeenLastCalledWith("file_save", "replace");
  });

  it("File > Save rewrites the live tower's file, and nothing without one", async () => {
    await saveCurrentFile();
    expect(fileSpace.list()).toHaveLength(0);
    const id = await saveFile(app as unknown as GameApp, "Spire");
    m.exportFile.mockReturnValueOnce(Uint8Array.of(9));
    await saveCurrentFile();
    expect(await fileSpace.read(id)).toEqual(Uint8Array.of(9));
    expect(m.track).toHaveBeenLastCalledWith("file_save", "current");
  });
});

describe("a tower file dropped on the game", () => {
  const dropEvent = (types: string[], files: File[]) => {
    const e = new Event("drop", { cancelable: true }) as DragEvent;
    Object.defineProperty(e, "dataTransfer", { value: { types, files } });
    return e;
  };

  it("opens as a picked file", () => {
    const target = new EventTarget() as Window;
    wireTowerDrop(app as unknown as GameApp, target);
    const file = new File([BINARY], "Spire.vctower");
    const e = dropEvent(["Files"], [file]);
    target.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(m.readPickedFile).toHaveBeenCalledExactlyOnceWith(app.ui, file);
    expect(m.track).toHaveBeenCalledWith("file_dropped");
  });

  it("is left to an open window, and a drag without files is not taken", async () => {
    const target = new EventTarget() as Window;
    wireTowerDrop(app as unknown as GameApp, target);
    m.dialogOpen = true;
    target.dispatchEvent(dropEvent(["Files"], [new File([BINARY], "a.vctower")]));
    const text = dropEvent(["text/plain"], []);
    target.dispatchEvent(text);
    await settle();
    expect(m.readPickedFile).not.toHaveBeenCalled();
    expect(text.defaultPrevented).toBe(false);
  });
});
