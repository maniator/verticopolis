import type { GameApp } from "../main";
import { trackAppActionOnce } from "../analytics";
import { linkedFolder } from "../storage/linkedFolder";
import { currentStamp } from "../storage/saveStamp";
import { autosaveLive } from "./autosaveSchedule";
import { exportFile } from "./portLifecycle";

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
 * that it writes the same file. Linking another folder starts a new file.
 */

/** Where the setting and the copy's file are kept. */
const KEY = "verticopolis-autosave-mirror";
/** The copy's name in the folder. */
export const MIRROR_NAME = "Auto-save";
/** The least time between two copies. */
export const MIRROR_EVERY_MS = 60_000;

interface MirrorPref {
  readonly on: boolean;
  /** The file the copy writes, once it has written one in this folder. Kept
   *  while the copy is off, so turning it on again writes the same file. */
  readonly file: string | null;
}

const OFF: MirrorPref = { on: false, file: null };

function readPref(): MirrorPref {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return OFF;
    const pref = JSON.parse(raw) as { on?: unknown; file?: unknown };
    return { on: pref.on === true, file: typeof pref.file === "string" ? pref.file : null };
  } catch {
    return OFF;
  }
}

function writePref(pref: MirrorPref): void {
  try {
    if (pref.on || pref.file !== null) localStorage.setItem(KEY, JSON.stringify(pref));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage refused: the setting lasts this visit at most */
  }
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

/** Forget the copy's file, so the next copy starts a new one: another folder
 *  may hold a file of that name that the game didn't write. */
export function forgetMirrorFile(): void {
  writePref({ ...readPref(), file: null });
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
  try {
    const bytes = exportFile(app.enginePort, app.engine.viewState(), currentStamp());
    if (pref.file !== null) await linkedFolder.saveOver(pref.file, bytes);
    else {
      const entry = await linkedFolder.saveNew(MIRROR_NAME, bytes);
      writePref({ ...readPref(), file: entry.id });
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
