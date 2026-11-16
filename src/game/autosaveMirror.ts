import type { GameApp } from "../main";
import { trackAppActionOnce } from "../analytics";
import { linkedFolder } from "../storage/linkedFolder";
import { packSave } from "../storage/savePacker";
import { currentStamp } from "../storage/saveStamp";
import { autosaveLive } from "./autosaveSchedule";
import { saveBytes } from "./portLifecycle";

/**
 * A copy of the Auto-save in the folder linked on the player's computer
 * (owner, 2026-11-15; `docs/architecture/linked-folder.md`). Off until the
 * player picks "Keep the Auto-save here too" in the Look in box. While it is
 * on, the timer autosave also writes the live tower, as the `.vctower` Save As
 * would write, to one file there at most once a minute.
 *
 * The Auto-save in the browser stays the one the game loads; this copy is
 * only written, never read. It never asks the browser for its OK and never
 * reads the folder back on its own: it writes only while the folder is open
 * this visit (linked, or shown in a window with access allowed), so a restart
 * starts copying again once Open or Save As shows the folder. Its first write
 * in a folder takes "Auto-save", or "Auto-save (2)" and up when a file of that
 * name is there already, so it never replaces a file it didn't write; after
 * that it writes the same file. The file is remembered by the link it was
 * written through ({@link linkedFolder.linkId}), so linking another folder,
 * even one with a file of that name, starts a new file, and two tabs on two
 * folders each keep writing their own.
 *
 * The file is the binary `.vctower` Save As writes (`VCTOWER2`, a newline,
 * then the raw DEFLATE of the stamped save), built from the same stamped
 * bytes the autosave asks the engine for and packed in the save packer's
 * worker, so the copy adds no compression to the frame. The engine's own
 * file export compresses on the main thread (about 19 ms on a large tower).
 */

/** Where the setting and the copy's file are kept. */
const KEY = "verticopolis-autosave-mirror";
/** The copy's name in the folder. */
export const MIRROR_NAME = "Auto-save";
/** The least time between two copies. */
export const MIRROR_EVERY_MS = 60_000;

interface MirrorPref {
  readonly on: boolean;
  /** The file the copy writes in each folder, by the link's id, once it has
   *  written one there. Kept while the copy is off, so turning it on again
   *  writes the same file. One per link: two tabs on two folders each keep
   *  their own, and a file from another link is never written over. */
  readonly files: Readonly<Record<string, string>>;
}

const OFF: MirrorPref = { on: false, files: {} };
/** The most links whose files are remembered; the oldest goes first. A link
 *  forgotten this way only starts one new file if it copies again. */
const MAX_LINKS = 8;

function readPref(): MirrorPref {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return OFF;
    const pref = JSON.parse(raw) as { on?: unknown; files?: unknown };
    const files: Record<string, string> = {};
    if (pref.files && typeof pref.files === "object") {
      for (const [link, file] of Object.entries(pref.files)) if (typeof file === "string") files[link] = file;
    }
    return { on: pref.on === true, files };
  } catch {
    return OFF;
  }
}

function writePref(pref: MirrorPref): void {
  try {
    if (pref.on || Object.keys(pref.files).length > 0) localStorage.setItem(KEY, JSON.stringify(pref));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage refused: the setting lasts this visit at most */
  }
}

/** Remember `file` for `link`, newest last. */
function rememberFile(link: string, file: string): void {
  const pref = readPref();
  const kept = Object.entries(pref.files).filter(([l]) => l !== link);
  writePref({ ...pref, files: Object.fromEntries([...kept.slice(-(MAX_LINKS - 1)), [link, file]]) });
}

let lastCopy = -Infinity;
let copying = false;

/** Whether the player asked for the copy. */
export function mirrorOn(): boolean {
  return readPref().on;
}

/** Turn the copy on or off. Off leaves the file in the folder. */
export function setMirror(on: boolean): void {
  writePref({ ...readPref(), on });
  lastCopy = -Infinity;
}

/** Forget the file remembered for `link` (a link being replaced or
 *  unlinked), so the list of files stays short. */
export function forgetMirrorFile(link: string | null): void {
  if (link === null) return;
  const pref = readPref();
  if (!(link in pref.files)) return;
  writePref({ ...pref, files: Object.fromEntries(Object.entries(pref.files).filter(([l]) => l !== link)) });
}

/** The stamp and newline that open a binary `.vctower` file. */
const BINARY_HEAD = new TextEncoder().encode("VCTOWER2\n");

/** A binary `.vctower` file around `packed`, the raw DEFLATE of a save. */
export function vctowerFileOf(packed: Uint8Array): Uint8Array {
  const file = new Uint8Array(BINARY_HEAD.length + packed.length);
  file.set(BINARY_HEAD);
  file.set(packed, BINARY_HEAD.length);
  return file;
}

/**
 * Copy the live tower into the linked folder as the Auto-save, when the
 * player turned the copy on, the folder is open with the browser's OK, the
 * tower may be autosaved, and a minute has passed since the last copy (`now`
 * by the page's clock; `force` skips the minute). Answers whether it wrote.
 * Never rejects and never says anything on screen: a failure is counted once
 * per visit as `folder_mirror` `failed`, and the next tick tries again.
 */
export async function mirrorAutosave(app: Pick<GameApp, "enginePort" | "engine">, now = Date.now(), force = false): Promise<boolean> {
  const pref = readPref();
  if (!pref.on || copying || linkedFolder.state()?.access !== "granted" || !autosaveLive()) return false;
  if (!force && now - lastCopy < MIRROR_EVERY_MS) return false;
  copying = true;
  lastCopy = now;
  const link = linkedFolder.linkId();
  try {
    const save = saveBytes(app.enginePort, app.engine.viewState(), currentStamp());
    const bytes = vctowerFileOf((await packSave(save)).packed);
    // Unlinked or linked again while the save packed: this file was for the
    // folder that was linked then.
    if (link === null || linkedFolder.linkId() !== link || linkedFolder.state()?.access !== "granted") return false;
    // Read again: another tab may have written this link's file meanwhile.
    const file = readPref().files[link];
    if (file !== undefined) await linkedFolder.saveOver(file, bytes);
    else {
      const entry = await linkedFolder.saveNew(MIRROR_NAME, bytes);
      if (linkedFolder.linkId() === link) rememberFile(link, entry.id);
    }
    return true;
  } catch {
    trackAppActionOnce("folder_mirror", "failed");
    return false;
  } finally {
    copying = false;
  }
}

/** Forget this page's last copy time, for tests. */
export function resetMirrorForTests(): void {
  lastCopy = -Infinity;
  copying = false;
}
