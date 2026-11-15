import type { GameApp } from "../main";
import { trackAppAction } from "../analytics";
import { FileNameTakenError, type TowerFileEntry } from "../storage/fileSpace";
import { canLinkFolder, linkedFolder } from "../storage/linkedFolder";
import { currentStamp } from "../storage/saveStamp";
import type { FileNote } from "../ui/fileDialog";
import type { LinkedPlaceCtx } from "../ui/fileDialogPlaces";
import type { FileRow } from "../ui/templates/fileDialog";
import { decodeTowerText, isBinaryTowerFile } from "../ui/uiImport";
import { autosaveLive } from "./autosaveSchedule";
import { forgetMirrorFile, mirrorAutosave, mirrorOn, setMirror } from "./autosaveMirror";
import { currentLinkedFile, setCurrentLinkedFile } from "./currentFile";
import { exportFile } from "./portLifecycle";

/**
 * What the Open and Save As windows do with the folder linked on the
 * player's computer (`storage/linkedFolder.ts`; design in
 * `docs/architecture/linked-folder.md`). Opening a file there hands its bytes
 * to the same importer My Towers and a picked file use, and saving writes the
 * bytes Save As would download, so the folder adds no format. My Towers and
 * the Auto-save are never read or written here.
 *
 * Analytics (`docs/analytics-data-map.md`, "Linked folder"): `app_action`
 * `folder_link` (`linked`, `cancel` or `refused`), `folder_allow` (`granted`
 * or `denied`), `folder_unlink`, `folder_open` (`tower` or `tdt`),
 * `folder_save` (`new`, `replace` or `current`), `folder_copy`,
 * `folder_failed` and `folder_mirror` (`on`, `off`, or `failed` once a visit,
 * `autosaveMirror.ts`). Codes only, never a folder's or a file's name.
 */

/** A failed folder step in the player's words. */
function folderFailed(err: unknown): FileNote {
  trackAppAction("folder_failed");
  if (err instanceof FileNameTakenError) return { text: err.message, kind: "bad" };
  if (err instanceof DOMException && err.name === "NotAllowedError") {
    return { text: "Your browser didn't allow the game to use that folder.", kind: "bad" };
  }
  if (err instanceof DOMException && err.name === "QuotaExceededError") {
    return { text: "There's no room left on your disk for that tower.", kind: "bad" };
  }
  return { text: `Couldn't use the linked folder: ${err instanceof Error ? err.message : String(err)}`, kind: "bad" };
}

/** Open a row of the linked folder. */
async function openLinkedRow(app: GameApp, row: FileRow): Promise<void> {
  let bytes: Uint8Array | null;
  try {
    bytes = await linkedFolder.read(row.id);
  } catch (err) {
    app.ui.sayVisibly(folderFailed(err).text);
    return;
  }
  if (!bytes) {
    app.ui.sayVisibly(`"${row.name}" isn't in the folder any more. It may have been moved or deleted.`);
    return;
  }
  trackAppAction("folder_open", row.type);
  if (row.type === "tdt") {
    void app.saveLoad.importLegacy(bytes.slice().buffer, row.id);
    return;
  }
  const before = app.enginePort.generation();
  await app.saveLoad.importGame(isBinaryTowerFile(bytes) ? bytes : decodeTowerText(bytes));
  if (app.enginePort.generation() !== before) setCurrentLinkedFile(row.id);
}

/** Write the live tower into the folder with `write`, and make the file it
 *  wrote the live tower's file. */
async function saveLinked(app: GameApp, why: "new" | "replace" | "current", write: (bytes: Uint8Array) => Promise<TowerFileEntry>): Promise<string> {
  const bytes = exportFile(app.enginePort, app.engine.viewState(), currentStamp());
  const entry = await write(bytes);
  setCurrentLinkedFile(entry.id);
  trackAppAction("folder_save", why);
  return entry.name;
}

/** The linked folder for the Open or Save As window, or null where this
 *  browser can't link one. */
export function linkedPlace(app: GameApp): LinkedPlaceCtx | null {
  if (!canLinkFolder()) return null;
  return {
    canLink: true,
    state: () => linkedFolder.state(),
    files: () => linkedFolder.list(),
    usage: () => linkedFolder.usage(),
    onChange: (listener) => linkedFolder.onChange(listener),
    refresh: () => linkedFolder.refresh(),
    // The picker is called before any await, so the click that asked for it
    // still counts; so is the permission prompt once the folder is read back
    // (`linkedFolder.allow`).
    link: () =>
      linkedFolder.link().then(
        (linked) => {
          trackAppAction("folder_link", linked ? "linked" : "cancel");
          // A new folder may hold a file of the same name: File > Save must
          // never write over it without asking.
          if (linked && currentLinkedFile() !== null) setCurrentLinkedFile(null);
          // Nor may the Auto-save copy: it starts a new file there.
          if (linked) forgetMirrorFile();
          return linked ? "linked" : "cancel";
        },
        (err: unknown) => {
          trackAppAction("folder_link", "refused");
          return folderFailed(err);
        },
      ),
    allow: () =>
      linkedFolder.allow().then(
        (access): FileNote | null => {
          trackAppAction("folder_allow", access === "granted" ? "granted" : "denied");
          return access === "granted" ? null : { text: "The folder stays closed until your browser allows it.", kind: "bad" };
        },
        (err: unknown) => folderFailed(err),
      ),
    unlink: async () => {
      try {
        await linkedFolder.unlink();
        if (currentLinkedFile() !== null) setCurrentLinkedFile(null);
        setMirror(false);
        forgetMirrorFile();
        trackAppAction("folder_unlink");
        return null;
      } catch (err) {
        return folderFailed(err);
      }
    },
    mirror: () => mirrorOn(),
    setMirror: async (on) => {
      const name = linkedFolder.state()?.name ?? "the linked folder";
      setMirror(on);
      trackAppAction("folder_mirror", on ? "on" : "off");
      if (!on) return { text: `The Auto-save is no longer copied to "${name}". The copy there stays.`, kind: "info" };
      // Write it now, so the player sees the file arrive. A folder waiting for
      // the browser's OK, or a tower that can't be saved yet, starts later.
      if (linkedFolder.state()?.access === "granted" && autosaveLive() && !(await mirrorAutosave(app, Date.now(), true))) {
        return { text: `Couldn't copy the Auto-save to "${name}". The game tries again every minute.`, kind: "bad" };
      }
      return { text: `The Auto-save is copied to "${name}" every minute while you play.`, kind: "info" };
    },
    open: (row) => void openLinkedRow(app, row),
    save: async (name, replace) => {
      try {
        const saved = await saveLinked(app, replace ? "replace" : "new", (bytes) => linkedFolder.save(name, bytes, replace));
        app.ui.toast(`Saved "${saved}" in ${linkedFolder.state()?.name ?? "the linked folder"}.`, "good");
        return null;
      } catch (err) {
        return folderFailed(err);
      }
    },
    duplicate: async (id) => {
      try {
        await linkedFolder.duplicate(id);
        trackAppAction("folder_copy");
        return null;
      } catch (err) {
        return folderFailed(err);
      }
    },
  };
}

/** File > Save for a tower that came from the linked folder: write its file
 *  there again. Answers false when the live tower has no file there. Never
 *  rejects; a failure is said on screen. */
export async function saveCurrentLinked(app: GameApp): Promise<boolean> {
  const id = currentLinkedFile();
  if (id === null) return false;
  try {
    // Ctrl+S is a key press, so the browser may ask for its OK here.
    if (linkedFolder.state()?.access !== "granted" && (await linkedFolder.allow()) !== "granted") {
      app.ui.sayVisibly("Your browser didn't allow the game to save in the linked folder. Use File > Save As… to save it somewhere else.");
      return true;
    }
    // By its name on disk: the very file the tower was opened from.
    const name = await saveLinked(app, "current", (bytes) => linkedFolder.saveOver(id, bytes));
    app.ui.toast(`Saved "${name}" in ${linkedFolder.state()?.name ?? "the linked folder"}.`, "good");
  } catch (err) {
    app.ui.sayVisibly(folderFailed(err).text);
  }
  return true;
}
