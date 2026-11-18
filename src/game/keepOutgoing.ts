import type { GameApp } from "../main";
import { trackAppAction } from "../analytics";
import { cleanFileName, FileConflictError, FileGoneError, fileSpace } from "../storage/fileSpace";
import { noteTowersFile } from "../storage/recentTowers";
import { autosaveKey, SaveGame } from "../storage/SaveGame";
import { packSave } from "../storage/savePacker";
import { currentStamp } from "../storage/saveStamp";
import { saveStore } from "../storage/saveStore";
import { toTowerFile } from "../storage/towerFileCodec";
import { autosaveLive } from "./autosaveSchedule";
import { vctowerFileOf } from "./autosaveMirror";
import { linkedFolder } from "../storage/linkedFolder";
import { currentFileId, currentLinkedFile } from "./currentFile";
import { saveBytes } from "./portLifecycle";
import { claimsSettled, crashCopyRef } from "./towerDocument";

/**
 * Never lose the tower the player leaves (owner, 2026-11-16, NO LOST SAVES).
 *
 * There is one Auto-save, and every tower swap (File > Open…, New…, a picked
 * or dropped file, a 1994 import) autosaves the tower that arrives at once
 * (`towerSwapped`, #1422). Before this, that write replaced
 * the tower before it: one never saved into My Towers was gone, and one that
 * had a file lost everything since its last Save.
 *
 * So right before a swap, {@link captureOutgoing} takes the tower being left:
 * the live tower's save bytes (the same call the 30-second autosave makes),
 * or, behind the title screen, the tower the Auto-save holds, which is the
 * one Continue would bring back. Once the new tower is in, {@link keepOutgoing}
 * writes it into its own file (`towerDocument.ts`): its My Towers file, or,
 * for a tower from the linked folder, its file there while the browser's OK
 * holds (the autosave writes that file too, #2380). A tower with no file yet
 * gets a new My Towers file under its name, with "Name (2)" when that name is
 * taken, and so does a folder tower whose folder is closed. When My Towers
 * can't take it (full, or a window that keeps no site data), a message box
 * offers the tower as a `.vctower` download, and its button downloads it
 * inside the click.
 *
 * An open of a My Towers file waits for a keep still being written
 * ({@link keptSettled}), so going straight back to the tower just left reads
 * the kept copy, never the older one.
 *
 * Loading the Auto-save (Continue, the Open window's Auto-save row) is not a
 * swap here: the Auto-save is the live tower's own last autosave, so that
 * load brings the same tower back.
 *
 * Analytics (`docs/analytics-data-map.md`): `app_action` `tower_kept` with
 * `file`, `folder`, `new`, `offered`, `download` or `failed`. A code only:
 * names are never sent.
 */

/** What the player was doing: a load is the Auto-save coming in. */
export type SwapKind = "load" | "open" | "new" | "tdt";

/** The tower being left, between its capture and the swap that follows. */
interface Outgoing {
  /** The live tower's stamped save bytes, packed after the swap. */
  readonly save?: Uint8Array;
  /** The Auto-save's tower as a `.vctower` file, when nothing was live. */
  readonly file?: Uint8Array;
  readonly name: string;
  /** The My Towers file the live tower is, when it has one. */
  readonly fileId: string | null;
  /** The linked folder's file the live tower is, by its name there, and the
   *  link it came through. */
  readonly linked?: { readonly id: string; readonly link: string | null };
  /** The engine's generation at the capture: a swap moves it. */
  readonly generation: number;
  /** The tower could not be read at the capture: counted once a swap follows. */
  readonly unread?: true;
}

let pending: Outgoing | null = null;
/** The keep being written, if any: opens wait for it ({@link keptSettled}). */
let keeping: Promise<unknown> = Promise.resolve();
/** The My Towers file about to open, between {@link openingFile} and the capture. */
let opening: string | null = null;

/** File > Open… is about to open My Towers file `id`. When that is the live
 *  tower's own file (opening it again to go back to it), the tower being left
 *  is kept as a new file, so going back never writes over the file it reads. */
export function openingFile(id: string | null): void {
  opening = id;
}

/** The name a kept tower gets when it has no file. */
function towerFileName(name: string | null | undefined): string {
  return cleanFileName(name ?? "") || "Tower";
}

/** The tower the Auto-save holds, as a `.vctower` file, or null. Stored bytes
 *  are re-headered, never decoded (`towerFileCodec.ts`). */
function storedAutosave(): Uint8Array | null {
  try {
    const raw = saveStore.get(autosaveKey());
    const file = raw ? toTowerFile(raw) : null;
    return file?.ok ? new TextEncoder().encode(file.text) : null;
  } catch {
    return null;
  }
}

/** The Auto-save's tower name, read from its listing. */
function storedName(): string | null {
  try {
    return SaveGame.listSlots().find((s) => s.slot === "auto")?.towerName ?? null;
  } catch {
    return null;
  }
}

/**
 * Take the tower about to be left, right before a swap of `kind`. Synchronous,
 * so it runs before the engine holds the next tower. Never throws: a tower
 * that can't be read now is not kept, and the swap goes ahead as before.
 */
export function captureOutgoing(app: Pick<GameApp, "enginePort">, kind: SwapKind): void {
  pending = null;
  const reopened = opening;
  opening = null;
  try {
    const generation = app.enginePort.generation();
    if (autosaveLive()) {
      // No camera stamp: a swap that is refused must leave the live tower
      // exactly as it was (the camera rides along with the next autosave).
      const save = saveBytes(app.enginePort, null, currentStamp());
      pending = { save, name: towerFileName(app.enginePort.towerName()), ...ownFile(reopened), generation };
      return;
    }
    // Behind the title screen the engine holds a throwaway tower; the
    // player's tower is the Auto-save. Loading it brings it back, so only
    // another tower arriving leaves it behind.
    if (kind === "load") return;
    // Its file is the one the ref names for the Auto-save as it is now, never
    // the one this window booted with: another window may have written
    // another tower into the Auto-save since (`towerDocument.ts`).
    const file = storedAutosave();
    if (file) pending = { file, name: towerFileName(storedName()), ...crashCopyOwnFile(reopened), generation };
  } catch {
    // Counted only if the swap goes ahead (`keepOutgoing`); one refused is no loss.
    try {
      pending = { name: "", fileId: null, generation: app.enginePort.generation(), unread: true };
    } catch {
      pending = null;
    }
  }
}

/** The live tower's own file, unless it is the one about to open again. */
function ownFile(reopened: string | null): Pick<Outgoing, "fileId" | "linked"> {
  const fileId = currentFileId();
  const linked = currentLinkedFile();
  if (linked !== null && linked !== reopened) return { fileId: null, linked: { id: linked, link: linkedFolder.linkId() } };
  return { fileId: fileId === reopened ? null : fileId };
}

/** The Auto-save's own file, unless it is the one about to open again. */
function crashCopyOwnFile(reopened: string | null): Pick<Outgoing, "fileId" | "linked"> {
  const ref = crashCopyRef();
  if (ref?.linked && ref.linked.id !== reopened) return { fileId: null, linked: { id: ref.linked.id, link: ref.linked.link } };
  return { fileId: ref?.file !== undefined && ref.file !== reopened ? ref.file : null };
}

/** Forget a capture whose swap was refused (the file didn't read). */
export function dropOutgoing(): void {
  pending = null;
}

/** The kept file's bytes: the Auto-save's re-headered file, or the live
 *  tower's save packed off the main thread, as the folder copy does. */
async function fileBytes(o: Outgoing): Promise<Uint8Array> {
  if (o.file) return o.file;
  return vctowerFileOf((await packSave(o.save!)).packed);
}

/** Settles once no keep is being written. An open of a My Towers file awaits
 *  it before reading, so it never reads a file a keep is about to replace. */
export function keptSettled(): Promise<void> {
  return keeping.then(() => undefined);
}

/** Tell the player their last tower could not be kept, and count it. */
function keepFailed(app: Pick<GameApp, "ui">): "failed" {
  trackAppAction("tower_kept", "failed");
  app.ui.sayVisibly("Your last tower couldn't be kept in My Towers. Save the tower you're in with File > Save As… to be safe.");
  return "failed";
}

/** My Towers couldn't take the tower: a message box offers it as a file, and
 *  its button downloads inside the click, so the browser lets it through. */
function offerDownload(app: Pick<GameApp, "ui">, name: string, bytes: Uint8Array): "offered" {
  const file = `${name}.vctower`;
  trackAppAction("tower_kept", "offered");
  app.ui.confirmModal(
    "Keep your last tower",
    `My Towers couldn't keep "${name}". Download it as "${file}" so it isn't lost?`,
    () => {
      // A failed download is already said by `downloadFile` itself.
      if (app.ui.downloadFile(file, bytes)) trackAppAction("tower_kept", "download");
    },
    "Download",
  );
  return "offered";
}

/**
 * Keep the captured tower once the swap is done. Answers what happened, for
 * tests; never rejects. Says where the tower went, or offers it as a file.
 */
export function keepOutgoing(app: Pick<GameApp, "enginePort" | "ui">): Promise<"file" | "folder" | "new" | "offered" | "failed" | null> {
  const o = pending;
  pending = null;
  if (!o || app.enginePort.generation() === o.generation) return Promise.resolve(null);
  const done = keep(app, o);
  keeping = Promise.allSettled([keeping, done]);
  return done;
}

async function keep(app: Pick<GameApp, "ui">, o: Outgoing): Promise<"file" | "folder" | "new" | "offered" | "failed"> {
  if (o.unread) return keepFailed(app);
  let bytes: Uint8Array;
  try {
    bytes = await fileBytes(o);
  } catch {
    return keepFailed(app);
  }
  if (o.linked && (await keptInFolder(o.linked, bytes))) {
    trackAppAction("tower_kept", "folder");
    app.ui.toast(`Saved "${o.linked.id}" in ${linkedFolder.state()?.name ?? "the linked folder"}.`, "good");
    return "folder";
  }
  try {
    if (!(await fileSpace.open())) throw new Error("My Towers is not open");
    const own = o.fileId === null ? undefined : fileSpace.get(o.fileId);
    if (own && own.kind === "tower" && (await keptInOwnFile(own.id, bytes))) {
      trackAppAction("tower_kept", "file");
      app.ui.toast(`Saved "${own.name}" in My Towers.`, "good");
      return "file";
    }
    const entry = await fileSpace.add(o.name, "tower", bytes);
    // The tower just left heads File > Open Recent, so going back is one pick.
    await noteKept(entry);
    trackAppAction("tower_kept", "new");
    app.ui.toast(`Kept your last tower in My Towers as "${entry.name}".`, "good");
    return "new";
  } catch {
    // Nowhere in the browser to keep it: offer it as a file.
    return offerDownload(app, o.name, bytes);
  }
}

/** Put the kept tower at the head of File > Open Recent once the open that
 *  replaced it has noted the tower coming in. The keep starts inside that open
 *  (the swap happens mid-import). When the open writes the file it brought in
 *  first (File > Open… from the device, a 1994 import), the keep can finish
 *  first, as a keep with no packing does, and the tower left must still head
 *  the list. */
async function noteKept(entry: Parameters<typeof noteTowersFile>[0]): Promise<void> {
  await claimsSettled();
  noteTowersFile(entry);
}

/** Write the tower into its own My Towers file. False when the file is gone
 *  or another window wrote it since, so the tower gets a new file instead. */
async function keptInOwnFile(id: string, bytes: Uint8Array): Promise<boolean> {
  try {
    await noteKept(await fileSpace.overwrite(id, bytes));
    return true;
  } catch (err) {
    if (err instanceof FileGoneError || err instanceof FileConflictError) return false;
    throw err;
  }
}

/** Write a folder tower back into its file there, while the folder it came
 *  through is linked and open with the browser's OK. Answers whether it did. */
async function keptInFolder(linked: NonNullable<Outgoing["linked"]>, bytes: Uint8Array): Promise<boolean> {
  if (linked.link === null || linkedFolder.linkId() !== linked.link || linkedFolder.state()?.access !== "granted") return false;
  try {
    await linkedFolder.saveOver(linked.id, bytes);
    return true;
  } catch {
    return false;
  }
}

/** Forget any capture, for tests. */
export function resetOutgoingForTests(): void {
  pending = null;
  opening = null;
  keeping = Promise.resolve();
}
