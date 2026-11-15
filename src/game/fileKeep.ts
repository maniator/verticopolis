import { trackAppAction } from "../analytics";
import { cleanFileName, fileSpace, FileSpaceFullError, type TowerFileEntry, type TowerFileKind } from "../storage/fileSpace";
import type { FileNote } from "../ui/fileDialog";
import { setCurrentFile } from "./currentFile";

/**
 * Keeping a tower file that just opened in My Towers (`fileSpaceCommands.ts`):
 * a file picked or dropped from the device, a 1994 file the import report
 * opened. Kept apart from the window commands so the legacy import's
 * adoption (`legacyImportAdopt.ts`) can reach it without the menus.
 */

/** A failed write in the player's words. */
export function failed(err: unknown): FileNote {
  trackAppAction("file_failed", err instanceof FileSpaceFullError ? "full" : "error");
  return { text: err instanceof Error ? err.message : String(err), kind: "bad" };
}

/** A file name without its extension: "MYTOWER.TDT" is "MYTOWER". */
export function baseName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return cleanFileName(dot > 0 ? filename.slice(0, dot) : filename);
}

/** Whether `bytes` are the bytes of `entry`. */
async function holds(entry: TowerFileEntry, bytes: Uint8Array): Promise<boolean> {
  if (entry.size !== bytes.byteLength) return false;
  const kept = await fileSpace.read(entry.id);
  return !!kept && kept.every((b, i) => b === bytes[i]);
}

/**
 * Keep a file that just opened in My Towers: the file already there under its
 * name with the same bytes (a 1994 file opened from My Towers itself, or a
 * file picked from the device a second time), else a new one.
 * A tower file becomes the live tower's file. Never rejects; null when the
 * folder is closed or the write failed (the tower is open either way).
 */
export async function keepOpenedFile(filename: string, bytes: Uint8Array, kind: TowerFileKind): Promise<TowerFileEntry | null> {
  // A file picked while the folder is still opening waits for it.
  if (!(await fileSpace.open())) return null;
  try {
    const name = baseName(filename) || "Tower";
    const same = fileSpace.find(name);
    const entry = same && same.kind === kind && (await holds(same, bytes)) ? same : await fileSpace.add(name, kind, bytes);
    if (entry !== same) trackAppAction("file_add", "picked");
    if (kind === "tower") setCurrentFile(entry.id);
    return entry;
  } catch (err) {
    failed(err);
    return null;
  }
}

