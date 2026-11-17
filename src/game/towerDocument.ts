import type { GameApp } from "../main";
import { trackAppAction, trackAppActionOnce } from "../analytics";
import { cleanFileName, FileGoneError, fileSpace } from "../storage/fileSpace";
import { linkedFolder } from "../storage/linkedFolder";
import { autosaveKey, SaveGame } from "../storage/SaveGame";
import { saveStore } from "../storage/saveStore";
import { toTowerFile } from "../storage/towerFileCodec";
import { autosaveIfLive } from "./autosaveSchedule";
import { mirrorAutosave, vctowerFileOf, writeLinkedTower } from "./autosaveMirror";
import { currentFileId, currentLinkedFile, onCurrentFileChange, setCurrentFile, setCurrentLinkedFile } from "./currentFile";

/**
 * The tower is the document (owner, 2026-11-16; save-model party verdict
 * items 2, 4 and 6, #2380). Every tower has its own file from its founding,
 * named after the tower ("Name (2)" when that name is taken), and both File >
 * Save and the 30-second autosave write it. A tower from the linked folder is
 * written back there by the autosave too, at most once a minute while the
 * browser's OK holds.
 *
 * The Auto-save stays as the game's crash copy: every autosave still writes
 * it first, synchronously on a tab hide, and Continue loads it. It is no
 * longer a row of the Open window. Beside it, {@link REF_KEY} names the file
 * the crash copy's tower is, tagged with the crash copy's own write time, so a
 * reload finds the file again only while the crash copy is the one that tag
 * names. A crash copy whose tag does not match (another tab's tower, a write
 * that failed) is given a new file of its own: a tower is never written into
 * a file the game can't prove is its own.
 *
 * At boot, once My Towers is open, the crash copy is written into its file
 * when it is newer (a tab closed between the crash copy and the file), and a
 * crash copy with no file (every Auto-save from before this change) gets one
 * ({@link adoptCrashCopy}). The autosave's file write reuses the bytes the
 * crash copy just packed in the save packer's worker, so it compresses
 * nothing more on the page.
 *
 * Analytics (`docs/analytics-data-map.md`): `app_action` `tower_file`
 * (`founded`, `adopted` or `synced`), and `autosave_failed` `file` once a
 * page life when the file could not be written.
 */

/** Where the crash copy's file is remembered. */
export const REF_KEY = "verticopolis-tower-file";

/** The file the crash copy's tower is. */
export interface TowerRef {
  /** A My Towers file, by id. */
  readonly file?: string;
  /** A file in the linked folder: the link it was opened through, and its name there. */
  readonly linked?: { readonly link: string; readonly id: string };
  /** The crash copy's write time: the ref holds only while they match. */
  readonly savedAt: number;
}

type DocApp = Pick<GameApp, "enginePort" | "engine" | "ui" | "saveLoad">;

let live: DocApp | null = null;
/** The tower the crash copy holds now, and its write time. */
let crash: { generation: number; savedAt: number } | null = null;
/** Opens that will name the live tower's file themselves (`claimTower`). */
let claims = 0;
/** The file writes, one after another. */
let writing: Promise<unknown> = Promise.resolve();
let unsubscribe: (() => void) | null = null;

/** The remembered ref, or null. */
export function readRef(): TowerRef | null {
  try {
    const raw = localStorage.getItem(REF_KEY);
    if (raw === null) return null;
    const ref = JSON.parse(raw) as Partial<TowerRef> | null;
    if (!ref || typeof ref.savedAt !== "number") return null;
    const file = typeof ref.file === "string" ? ref.file : undefined;
    const l = ref.linked;
    const linked = l && typeof l.link === "string" && typeof l.id === "string" ? { link: l.link, id: l.id } : undefined;
    return { savedAt: ref.savedAt, ...(file ? { file } : {}), ...(linked ? { linked } : {}) };
  } catch {
    return null;
  }
}

/** Remember the live tower's file beside the crash copy, while the crash copy holds it. */
function remember(): void {
  if (!live || !crash || crash.generation !== live.enginePort.generation()) return;
  const file = currentFileId();
  const linkedId = currentLinkedFile();
  const link = linkedFolder.linkId();
  const ref: TowerRef = {
    savedAt: crash.savedAt,
    ...(file ? { file } : {}),
    ...(linkedId && link ? { linked: { link, id: linkedId } } : {}),
  };
  try {
    localStorage.setItem(REF_KEY, JSON.stringify(ref));
  } catch {
    /* storage refused: a reload gives the crash copy a new file, never a wrong one */
  }
}

/** Make the live tower the file the ref names, when the ref is for a crash
 *  copy written at `savedAt`. Answers whether it named one. */
function restoreRef(savedAt: number | undefined): boolean {
  const ref = savedAt === undefined ? null : readRef();
  if (!ref || ref.savedAt !== savedAt) return false;
  if (ref.file) setCurrentFile(ref.file);
  else if (ref.linked && ref.linked.link === linkedFolder.linkId()) setCurrentLinkedFile(ref.linked.id);
  else return false;
  return true;
}

/** The crash copy as a `.vctower` file, re-headered, never decoded. */
function crashCopyFile(): Uint8Array | null {
  try {
    const raw = saveStore.get(autosaveKey());
    const file = raw ? toTowerFile(raw) : null;
    return file?.ok ? new TextEncoder().encode(file.text) : null;
  } catch {
    return null;
  }
}

/** The crash copy's write time and tower name, from its listing. */
function crashListing(): { savedAt?: number; name: string } {
  try {
    const auto = SaveGame.listSlots().find((s) => s.slot === "auto");
    return { savedAt: auto?.exists ? auto.savedAt : undefined, name: auto?.towerName ?? "" };
  } catch {
    return { name: "" };
  }
}

/** The name a tower's new file takes. */
function fileName(name: string | null | undefined): string {
  return cleanFileName(name ?? "") || "Tower";
}

/** Run `write` after every file write before it. Never rejects. */
function queue(write: () => Promise<void>): Promise<void> {
  const run = writing.then(write).catch(() => undefined);
  writing = run;
  return run;
}

/** The file could not be written: count it once and say it once a page life. */
function writeFailed(app: DocApp, err: unknown): void {
  trackAppActionOnce("autosave_failed", "file");
  if (fileFailSaid) return;
  fileFailSaid = true;
  app.ui.sayVisibly(`Couldn't save your tower in My Towers: ${err instanceof Error ? err.message : String(err)} The game keeps trying.`);
}
let fileFailSaid = false;

/** Give the live tower (generation `generation`) a new My Towers file. */
async function found(app: DocApp, generation: number, bytes: Uint8Array, modified: number, why: "founded" | "adopted"): Promise<void> {
  const entry = await fileSpace.add(fileName(app.enginePort.towerName()), "tower", bytes, modified);
  // Another tower arrived, or an open named the file, while it was written:
  // the file stays (it holds this tower), but it is not the live tower's.
  if (app.enginePort.generation() !== generation || currentFileId() !== null || currentLinkedFile() !== null) return;
  setCurrentFile(entry.id);
  trackAppAction("tower_file", why);
}

/** Write the live tower's file with an autosave's bytes. */
async function writeFile(app: DocApp, generation: number, savedAt: number, packed: Uint8Array, now: number): Promise<void> {
  if (app.enginePort.generation() !== generation) return;
  const bytes = vctowerFileOf(packed);
  if (currentLinkedFile() !== null) {
    await writeLinkedTower(bytes, now);
    return;
  }
  if (!fileSpace.isOpen()) return;
  try {
    const id = currentFileId();
    if (id !== null) {
      try {
        await fileSpace.overwrite(id, bytes, savedAt, false, true);
      } catch (err) {
        // Deleted in another window: the live tower gets a new file.
        if (!(err instanceof FileGoneError)) throw err;
        if (currentFileId() === id) setCurrentFile(null);
        await found(app, generation, bytes, savedAt, "founded");
      }
    } else if (claims === 0) {
      await found(app, generation, bytes, savedAt, "founded");
    }
  } catch (err) {
    writeFailed(app, err);
    return;
  }
  await mirrorAutosave(app, now, false, bytes);
}

/**
 * The crash copy now holds tower `generation`, written at `savedAt`
 * (`SaveLoadDeps.crashCopy`). Remembers its file beside it and, for an
 * autosave (`packed`), writes the tower's own file with the same bytes.
 */
export function crashCopyWritten(generation: number, savedAt: number, packed: Uint8Array | null, now = Date.now()): void {
  crash = { generation, savedAt };
  remember();
  const app = live;
  if (!app || !packed) return;
  void queue(() => writeFile(app, generation, savedAt, packed, now));
}

/**
 * An open that names the live tower's file itself once the tower is in (a
 * My Towers file, the linked folder's, a picked file kept in My Towers): the
 * autosave of the arriving tower gives it no file of its own meanwhile. Once
 * every open settles, a live tower still without a file gets one at once.
 */
export async function claimTower<T>(work: () => Promise<T>): Promise<T> {
  claims++;
  try {
    return await work();
  } finally {
    claims--;
    if (claims === 0 && live && currentFileId() === null && currentLinkedFile() === null) autosaveIfLive(live.saveLoad);
  }
}

/** The Auto-save came back in (Continue's load, Open Recent's): it is the tower the ref names. */
export function crashCopyLoaded(app: DocApp): void {
  const { savedAt } = crashListing();
  if (savedAt !== undefined) crash = { generation: app.enginePort.generation(), savedAt };
  restoreRef(savedAt);
}

/**
 * At boot, with the crash copy's tower loaded (written at `savedAt`; undefined
 * when none loaded): find its file from the ref. Then, once My Towers is open
 * (`ready`), write the crash copy into that file when it is newer, or give a
 * crash copy with no file one of its own. Nothing happens once another tower
 * has come in. Never rejects.
 */
export async function bootTowerDocument(app: DocApp, savedAt: number | undefined, ready: Promise<void>): Promise<void> {
  wireTowerDocument(app);
  if (savedAt === undefined) return;
  let generation: number;
  try {
    generation = app.enginePort.generation();
  } catch {
    return; // no engine to ask: nothing to find
  }
  crash = { generation, savedAt };
  restoreRef(savedAt);
  await ready;
  await adoptCrashCopy(app, generation, savedAt);
}

/** {@link bootTowerDocument}'s write, in the file-write queue. */
function adoptCrashCopy(app: DocApp, generation: number, savedAt: number): Promise<void> {
  return queue(() => adopt(app, generation, savedAt).catch((err: unknown) => writeFailed(app, err)));
}

async function adopt(app: DocApp, generation: number, savedAt: number): Promise<void> {
  if (app.enginePort.generation() !== generation || currentLinkedFile() !== null || !fileSpace.isOpen()) return;
  const id = currentFileId();
  const own = id === null ? undefined : fileSpace.get(id);
  if (own && own.kind === "tower" && own.modified >= savedAt) return;
  const bytes = crashCopyFile();
  if (!bytes) return;
  if (own && own.kind === "tower") {
    await fileSpace.overwrite(own.id, bytes, savedAt, false, true);
    trackAppAction("tower_file", "synced");
    return;
  }
  const entry = await fileSpace.add(fileName(crashListing().name), "tower", bytes, savedAt);
  if (app.enginePort.generation() !== generation || currentLinkedFile() !== null) return;
  setCurrentFile(entry.id);
  trackAppAction("tower_file", "adopted");
}

/** Hear the live tower's file changing, so the ref follows it. Once a page. */
export function wireTowerDocument(app: DocApp): void {
  live = app;
  unsubscribe ??= onCurrentFileChange(remember);
}

/** Forget this page's state, for tests. */
export function resetTowerDocumentForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  live = null;
  crash = null;
  claims = 0;
  writing = Promise.resolve();
  fileFailSaid = false;
}

/** Settles once every file write queued so far is done, for tests. */
export function towerDocumentSettled(): Promise<void> {
  return writing.then(() => undefined);
}
