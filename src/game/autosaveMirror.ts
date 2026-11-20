import type { GameApp } from "../main";
import { trackAppActionOnce } from "../analytics";
import { linkedFolder } from "../storage/linkedFolder";
import { packSave } from "../storage/savePacker";
import { currentStamp } from "../storage/saveStamp";
import { fileSpace } from "../storage/fileSpace";
import { autosaveLive } from "./autosaveSchedule";
import { currentFileId, currentLinkedFile } from "./currentFile";
import { saveBytes } from "./portLifecycle";

/**
 * A copy of each tower in the folder linked on the player's computer (owner,
 * 2026-11-15; `docs/architecture/linked-folder.md`), and the autosave of a
 * tower that came from that folder (#2380). Off until the player picks "Keep
 * a copy of my towers here too" in the Look in box. While it is on, the
 * autosave also writes the live tower, as the `.vctower` Save As would write,
 * to its own file there at most once a minute.
 *
 * The copy carries the tower's name (save-model party verdict item 6,
 * 2026-11-16): its first write in a folder takes the tower's My Towers name,
 * or "Name (2)" and up when a file of that name is there already, so it never
 * replaces a file it didn't write; after that it writes the same file. The
 * files are remembered by the link they were written through
 * ({@link linkedFolder.linkId}) and by the tower's My Towers file, so linking
 * another folder starts new files, and two tabs on two folders each keep
 * writing their own. The copy plain "Auto-save" that 4.4 to 4.10 wrote stays
 * in the folder as it is.
 *
 * My Towers stays the tower's own file; this copy is only written, never
 * read. It never asks the browser for its OK and never reads the folder back
 * on its own: it writes only while the folder is open this visit (linked, or
 * shown in a window with access allowed), so a restart starts copying again
 * once Open or Save As shows the folder. A tower opened from the folder has
 * its own file there already, and its autosave writes that file on the same
 * one-minute beat ({@link writeLinkedTower}), with or without the copy.
 *
 * The file is the binary `.vctower` Save As writes (`VCTOWER2`, a newline,
 * then the raw DEFLATE of the stamped save), the bytes the autosave already
 * packed in the save packer's worker, so the copy adds no compression to the
 * frame.
 */

/** Where the setting and the copy's file are kept. */
const KEY = "verticopolis-autosave-mirror";
/** The least time between two copies. */
export const MIRROR_EVERY_MS = 60_000;

interface MirrorPref {
  readonly on: boolean;
  /** The copy each tower writes in each folder: by the link's id, then by the
   *  tower's My Towers file, the copy's name on disk. Kept while the copy is
   *  off, so turning it on again writes the same files. One per link: two
   *  tabs on two folders each keep their own, and a file from another link is
   *  never written over. */
  readonly files: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

const OFF: MirrorPref = { on: false, files: {} };
/** The most links whose files are remembered; the oldest goes first. A link
 *  forgotten this way only starts new files if it copies again. */
const MAX_LINKS = 8;
/** The most towers remembered for one link; the oldest goes first. */
const MAX_TOWERS = 64;

/** One link's copies, from what storage held: 4.4 to 4.10 kept one name
 *  there (the plain Auto-save copy), which no tower writes again. */
function towersOf(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== "object") return out;
  for (const [tower, file] of Object.entries(value)) if (typeof file === "string") out[tower] = file;
  return out;
}

function readPref(): MirrorPref {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return OFF;
    const pref = JSON.parse(raw) as { on?: unknown; files?: unknown };
    const files: Record<string, Record<string, string>> = {};
    if (pref.files && typeof pref.files === "object") {
      for (const [link, towers] of Object.entries(pref.files)) files[link] = towersOf(towers);
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

/** Remember `file` as tower `tower`'s copy for `link`, newest last. */
function rememberFile(link: string, tower: string, file: string): void {
  const pref = readPref();
  const others = Object.entries(pref.files).filter(([l]) => l !== link);
  const towers = Object.entries(pref.files[link] ?? {}).filter(([t]) => t !== tower);
  const mine = Object.fromEntries([...towers.slice(-(MAX_TOWERS - 1)), [tower, file]]);
  writePref({ ...pref, files: Object.fromEntries([...others.slice(-(MAX_LINKS - 1)), [link, mine]]) });
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

/** Whether a minute has passed since the last write to the folder (`now`
 *  by the page's clock; `force` skips the minute), taking the beat if so. */
function beat(now: number, force: boolean): boolean {
  if (copying || (!force && now - lastCopy < MIRROR_EVERY_MS)) return false;
  lastCopy = now;
  return true;
}

/**
 * Copy the live tower into the linked folder under its name, when the player
 * turned the copy on, the folder is open with the browser's OK, the tower may
 * be autosaved and has a My Towers file, and a minute has passed since the
 * last write (`now` by the page's clock; `force` skips the minute). `file` is
 * the `.vctower` the autosave just packed; without it the tower is packed
 * here. Answers whether it wrote. Never rejects and never says anything on
 * screen: a failure is counted once per visit as `folder_mirror` `failed`, and
 * the next autosave tries again.
 */
export async function mirrorAutosave(
  app: Pick<GameApp, "enginePort" | "engine">,
  now = Date.now(),
  force = false,
  file?: Uint8Array,
): Promise<boolean> {
  const tower = currentFileId();
  if (!readPref().on || tower === null || linkedFolder.state()?.access !== "granted" || !autosaveLive()) return false;
  if (!beat(now, force)) return false;
  copying = true;
  const link = linkedFolder.linkId();
  try {
    const bytes =
      file ?? vctowerFileOf((await packSave(saveBytes(app.enginePort, app.engine.viewState(), currentStamp()))).packed);
    // Unlinked or linked again while the save packed: this file was for the
    // folder that was linked then.
    if (link === null || linkedFolder.linkId() !== link || linkedFolder.state()?.access !== "granted") return false;
    // Read again: another tab may have written this tower's file meanwhile.
    const copy = readPref().files[link]?.[tower];
    if (copy !== undefined) await linkedFolder.saveOver(copy, bytes);
    else {
      const entry = await linkedFolder.saveNew(
        fileSpace.get(tower)?.name ?? (app.enginePort.towerName() || "Tower"),
        bytes,
      );
      if (linkedFolder.linkId() === link) rememberFile(link, tower, entry.id);
    }
    return true;
  } catch {
    trackAppActionOnce("folder_mirror", "failed");
    return false;
  } finally {
    copying = false;
  }
}

/**
 * The autosave of a tower opened from the linked folder: write `file` (the
 * `.vctower` the autosave just packed) over the tower's own file there, at
 * most once a minute (`now` by the page's clock) and only while the folder is
 * open with the browser's OK. Answers whether it wrote. Never rejects: a
 * failure is counted once per visit as `folder_failed` `autosave`, and the
 * next autosave tries again; the crash copy in the browser holds the tower
 * meanwhile.
 */
export async function writeLinkedTower(file: Uint8Array, now = Date.now()): Promise<boolean> {
  const id = currentLinkedFile();
  if (id === null || linkedFolder.state()?.access !== "granted" || !beat(now, false)) return false;
  copying = true;
  try {
    await linkedFolder.saveOver(id, file);
    return true;
  } catch {
    trackAppActionOnce("folder_failed", "autosave");
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
