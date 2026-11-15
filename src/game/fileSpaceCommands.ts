import type { GameApp } from "../main";
import { trackAppAction } from "../analytics";
import { cleanFileName, fileSpace, type TowerFileEntry, type TowerFileKind } from "../storage/fileSpace";
import { copySlotsOnce } from "../storage/fileSpaceMigrate";
import { SaveGame } from "../storage/SaveGame";
import { TOWER_FILE_MAGIC } from "../storage/saveCompression";
import { currentStamp } from "../storage/saveStamp";
import { looksLikeLegacyTower } from "../storage/tdtImportHelpers";
import { showFileDialog, type FileNote } from "../ui/fileDialog";
import type { FileRow } from "../ui/templates/fileDialog";
import { decodeTowerText, isBinaryTowerFile, openImport, readPickedFile } from "../ui/uiImport";
import { isDialogOpen, isEngineStopped } from "./interactionState";
import { linkedFolder } from "../storage/linkedFolder";
import { currentFileId, currentLinkedFile, setCurrentFile } from "./currentFile";
import { linkedPlace, saveCurrentLinked } from "./linkedFolderCommands";
import { baseName, failed } from "./fileKeep";
import { loadSave } from "./loadMenu";
import { exportFile } from "./portLifecycle";

/**
 * What File > Open…, Save As… and Save do with My Towers (owner,
 * 2026-11-15, layout A), and the file the live tower was opened from or
 * saved to. The windows themselves are `ui/fileDialog.ts`; the folder is
 * `storage/fileSpace.ts`. Opening a file hands its bytes to the importer a
 * picked file goes to, and saving writes the bytes Save As would download, so
 * neither adds a format.
 *
 * A tower picked from the device (Open's "From a file on your computer…", or
 * a file dropped on the game) is copied into My Towers once it opens, so it
 * is there next time. The live tower's file is the one it came from or was
 * saved as; any other tower arriving (a new one, a load, an import) forgets
 * it (`towerFollow.ts`), and Save then writes the Auto-save alone.
 *
 * Analytics (`docs/analytics-data-map.md`): `app_action` `files_open`
 * (`open`, `open_key`, `open_title` or `save_as`: see `OPEN_DETAIL`), `file_open` (`tower`, `tdt` or `auto`), `file_save`
 * (`new`, `replace` or `current`), `file_add` (`picked`, `drop` or
 * `folder`),
 * `file_rename`, `file_copy`, `file_delete`, and `file_failed` (`full` or
 * `error`), plus `files_copied` once with the number of slots copied in.
 * Codes and counts only: a name is the player's own text and is never sent.
 */

/** The app the commands act on, set once at boot. */
let live: GameApp | null = null;
/** Settles once the folder has opened (or refused) and the slots are in. */
let ready: Promise<void> = Promise.resolve();
/** False while {@link ready} has not settled. */
let settled = true;

/** Open the folder and copy the save slots in once. Never rejects. */
export function openFileSpace(app: GameApp): Promise<void> {
  live = app;
  settled = false;
  ready = (async () => {
    try {
      if (!(await fileSpace.open())) return;
      const copied = await copySlotsOnce();
      if (copied > 0) trackAppAction("files_copied", String(copied));
    } finally {
      settled = true;
    }
  })();
  return ready;
}

/**
 * Whether File > Open… and Save As… show their window: once the folder is
 * open, and also while it is still opening or the slots are still being
 * copied in. The first open on a device can take a moment on a phone, and a
 * window shown then fills in when the folder is ready; falling back to the
 * device's picker then hid every tower (#2319 on staging). Only a folder that
 * refused (a private window) sends the player to the picker.
 */
function folderUsable(): boolean {
  return fileSpace.isOpen() || fileSpace.isOpening() || !settled;
}

/** The My Towers file the live tower is, if any. */
export function currentFile(): TowerFileEntry | null {
  const id = currentFileId();
  return id === null ? null : (fileSpace.get(id) ?? null);
}

/** Open My Towers file `id`'s .vctower bytes; once the tower is in, the file
 *  is the live tower's. */
async function openTowerBytes(app: GameApp, id: string, bytes: Uint8Array): Promise<void> {
  const before = app.enginePort.generation();
  await app.saveLoad.importGame(isBinaryTowerFile(bytes) ? bytes : decodeTowerText(bytes));
  if (app.enginePort.generation() !== before) setCurrentFile(id);
}

/** Open a row of the Open window. */
async function openRow(app: GameApp, row: FileRow): Promise<void> {
  trackAppAction("file_open", row.type);
  if (row.type === "auto") {
    loadSave(app, "auto");
    return;
  }
  const bytes = await fileSpace.read(row.id);
  if (!bytes) {
    app.ui.sayVisibly("That tower is gone. It may have been deleted in another window.");
    return;
  }
  // The legacy import reads the copy, so the folder's bytes stay as they are.
  if (row.type === "tdt") void app.saveLoad.importLegacy(bytes.slice().buffer, `${row.name}.TDT`);
  else await openTowerBytes(app, row.id, bytes);
}

/** Open My Towers file `id`, as its row in the Open window would (File >
 *  Load lists the newest). Settles once the tower is in, or refused. */
export async function openFile(app: GameApp, id: string): Promise<void> {
  await ready;
  const f = fileSpace.get(id);
  if (f) await openRow(app, { id: f.id, name: f.name, type: f.kind, size: f.size, modified: f.modified });
}

/** The Auto-save's row, whenever one is stored. One that did not read now
 *  (the population check can fail on a phone short of memory) still shows,
 *  under its plain name; opening it says why if it won't load. */
function autoRow(): FileRow | null {
  try {
    const auto = SaveGame.listSlots().find((s) => s.slot === "auto");
    if (!auto?.exists && !auto?.present) return null;
    const name = auto.exists ? `Auto-save (${auto.towerName || "Tower"})` : "Auto-save";
    return { id: "auto", name, type: "auto", size: auto.size, modified: auto.savedAt };
  } catch {
    return null;
  }
}

/** Whether `bytes` named `name` are a tower file, and which kind. */
export function towerFileKind(name: string, bytes: Uint8Array): TowerFileKind | null {
  if (looksLikeLegacyTower(name, bytes)) return "tdt";
  if (isBinaryTowerFile(bytes)) return "tower";
  return /^\s*VCTOWER\d+/.test(decodeTowerText(bytes.subarray(0, 64))) ? "tower" : null;
}

/** Add files dropped on the Open or Save As window, or the towers of a folder
 *  picked with From a folder…, to My Towers. */
async function addDropped(files: readonly File[], how: "drop" | "folder" = "drop"): Promise<FileNote | null> {
  let added = 0;
  const refused: string[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = towerFileKind(file.name, bytes);
    if (!kind) {
      refused.push(file.name);
      continue;
    }
    try {
      await fileSpace.add(baseName(file.name), kind, bytes);
    } catch (err) {
      return failed(err);
    }
    trackAppAction("file_add", how);
    added++;
  }
  if (refused.length > 0) {
    const which = refused.length === 1 ? `"${refused[0]}" isn't` : `${refused.length} files aren't`;
    return { text: `${which} a tower file (.vctower or .TDT).${added > 0 ? ` Added the other ${added}.` : ""}`, kind: "bad" };
  }
  return { text: added === 1 ? "Added 1 tower." : `Added ${added} towers.`, kind: "info" };
}

/** The folder commands both windows share. */
function folderCommands() {
  return {
    files: () => fileSpace.list(),
    usage: () => fileSpace.usage(),
    loading: () => !settled,
    onChange: (listener: () => void) => {
      const off = fileSpace.onChange(listener);
      // Draw once more when the folder and the slot copy settle, whether or
      // not they changed the list.
      let on = true;
      if (!settled) void ready.then(() => on && listener());
      return () => {
        on = false;
        off();
      };
    },
    rename: async (id: string, name: string) => {
      try {
        await fileSpace.rename(id, name);
        trackAppAction("file_rename");
        return null;
      } catch (err) {
        return failed(err);
      }
    },
    duplicate: async (id: string) => {
      try {
        await fileSpace.duplicate(id);
        trackAppAction("file_copy");
        return null;
      } catch (err) {
        return failed(err);
      }
    },
    remove: async (id: string) => {
      try {
        await fileSpace.remove(id);
        if (currentFileId() === id) setCurrentFile(null);
        trackAppAction("file_delete");
        return null;
      } catch (err) {
        return failed(err);
      }
    },
    add: addDropped,
    asked: (kind: "replace" | "delete") => trackAppAction("file_ask", kind),
  };
}

/** The file name of a downloaded unreadable autosave. */
export const UNREADABLE_SAVE_FILENAME = "verticopolis-unreadable-save.txt";
/** The file name when the kept save downloads as a tower file. */
export const UNREADABLE_TOWER_FILENAME = "verticopolis-unreadable-save.vctower";

/** The download of a kept unreadable autosave, when there is one. The kept
 *  text downloads with no engine involved: a compressed save comes as a
 *  `.vctower` the game imports once it is updated, anything else as a .txt,
 *  a file type GitHub accepts on an issue. */
function keptDownload(app: GameApp): (() => void) | null {
  let kept: string | null;
  try {
    kept = SaveGame.unreadableBackup();
  } catch {
    kept = null;
  }
  if (kept === null) return null;
  const text = kept;
  const name = text.startsWith(TOWER_FILE_MAGIC) ? UNREADABLE_TOWER_FILENAME : UNREADABLE_SAVE_FILENAME;
  return () => void app.ui.downloadFile(name, text);
}

/** Where the player asked for the Open window: File > Open… in the menu,
 *  its Ctrl+O key, or the title screen's Open Tower… button. */
export type OpenFrom = "menu" | "key" | "title";

/** The `files_open` detail each place reports (owner, 2026-11-15: tell the
 *  title screen's button from the File menu). */
export const OPEN_DETAIL: Readonly<Record<OpenFrom, string>> = {
  menu: "open",
  key: "open_key",
  title: "open_title",
};

/** File > Open…: the Open window, or the device's picker while My Towers is
 *  closed (a private window that refuses storage). `from` says where the
 *  player asked for it, for the analytics. */
export function showOpenDialog(app: GameApp, from: OpenFrom): void {
  if (!folderUsable()) {
    openImport(app.ui);
    return;
  }
  trackAppAction("files_open", OPEN_DETAIL[from]);
  if (!settled) trackAppAction("files_waited", "open");
  showFileDialog(app.ui, {
    mode: "open",
    initialName: "",
    auto: autoRow,
    open: (row) => void openRow(app, row),
    save: async () => null,
    fromComputer: () => openImport(app.ui),
    downloadKept: keptDownload(app),
    ...folderCommands(),
    ...places(app),
  });
}

/** Write the live tower into My Towers as `name`, replacing a file of that
 *  name, and make it the live tower's file. */
async function saveTowerAs(app: GameApp, name: string, why: "new" | "replace" | "current"): Promise<TowerFileEntry> {
  const bytes = exportFile(app.enginePort, app.engine.viewState(), currentStamp());
  // A "new" save never replaces: a file of that name another tab just made
  // refuses the write, and the window asks again.
  const entry = await fileSpace.save(name, "tower", bytes, Date.now(), why !== "new");
  setCurrentFile(entry.id);
  trackAppAction("file_save", why);
  return entry;
}

/** Save the live tower in My Towers as `name`, as the Save As window does,
 *  and answer the file's id. Rejects when the folder is closed or full. */
export async function saveFile(app: GameApp, name: string): Promise<string> {
  await ready;
  if (!fileSpace.isOpen()) throw new Error("My Towers is not open");
  const clean = cleanFileName(name);
  return (await saveTowerAs(app, clean, fileSpace.find(clean) ? "replace" : "new")).id;
}

/** The linked folder for both windows where the browser can link one, and
 *  From a folder… where it can't but can pick a folder's files. */
function places(app: GameApp) {
  const linked = linkedPlace(app);
  return { linked, canPickFolder: !linked && typeof HTMLInputElement !== "undefined" && "webkitdirectory" in HTMLInputElement.prototype };
}

/** The live tower's file name in the linked folder, when it came from there. */
function linkedName(): string | null {
  const id = currentLinkedFile();
  return id === null ? null : (linkedFolder.find(id)?.name ?? id.slice(0, id.lastIndexOf(".")));
}

/** File > Save As…: the Save As window, or the download while My Towers is
 *  closed. */
export function showSaveAsDialog(app: GameApp): void {
  if (!folderUsable()) {
    app.ui.promptExport();
    return;
  }
  trackAppAction("files_open", "save_as");
  if (!settled) trackAppAction("files_waited", "save_as");
  showFileDialog(app.ui, {
    mode: "saveAs",
    initialName: currentFile()?.name ?? linkedName() ?? cleanFileName(app.enginePort.towerName() ?? ""),
    auto: () => null,
    open: () => {},
    save: async (name, replace) => {
      try {
        const entry = await saveTowerAs(app, name, replace ? "replace" : "new");
        app.ui.toast(`Saved "${entry.name}" in My Towers.`, "good");
        return null;
      } catch (err) {
        return failed(err);
      }
    },
    fromComputer: () => app.ui.promptExport(),
    downloadKept: null,
    ...folderCommands(),
    ...places(app),
    // A tower opened from the linked folder saves there by default.
    ...(currentLinkedFile() !== null ? { startIn: "linked" as const } : {}),
  });
}

/** File > Save also writes the live tower's file, in My Towers or in the
 *  linked folder, when it has one
 *  (the quick save to the Auto-save runs first, as before). Never rejects. */
export async function saveCurrentFile(): Promise<void> {
  const app = live;
  if (app && (await saveCurrentLinked(app))) return;
  const file = currentFile();
  if (!app || !file || file.kind !== "tower") return;
  try {
    await saveTowerAs(app, file.name, "current");
    app.ui.toast(`Saved "${file.name}" in My Towers.`, "good");
  } catch (err) {
    app.ui.sayVisibly(failed(err).text);
  }
}

/**
 * A tower file dropped on the game, outside a window, opens as a picked file
 * does (and is kept in My Towers once it opens). A drop over an open window
 * is that window's: the Open and Save As windows add dropped files to My
 * Towers instead. Only a drag that carries files is taken, so the browser
 * never navigates away to show a dropped file.
 */
export function wireTowerDrop(app: GameApp, target: Window = window): void {
  const carriesFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
  target.addEventListener("dragover", (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = isDialogOpen() ? "none" : "copy";
  });
  target.addEventListener("drop", (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (!file || isDialogOpen() || isEngineStopped()) return;
    trackAppAction("file_dropped");
    readPickedFile(app.ui, file);
  });
}
