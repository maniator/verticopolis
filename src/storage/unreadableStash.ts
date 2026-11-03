import { STORE_MAGIC } from "./saveCompression";
import { toTowerFile } from "./towerFileCodec";

/**
 * Backup key for an autosave that couldn't be read at boot. A truly corrupt
 * save is dead, but a save written by a *newer* build and opened on an older
 * one is only unreadable *here*: stashing the raw bytes keeps them off the
 * autosave slot's chopping block, so an updated game can still recover them.
 */
export const UNREADABLE_KEY = "simtower-clone-unreadable";

/**
 * Copy the unreadable save stored under `key` to the backup key, so the 30
 * second autosave cannot destroy it. A save a newer build wrote (`newer`)
 * replaces whatever the stash holds; a merely damaged one never replaces a
 * stash that already holds a different save. True when the bytes are kept (or
 * already were); false when there was nothing to keep, the stash was left
 * alone, or the write failed, such as a full quota. The caller tells the
 * player.
 */
export function stashUnreadable(key: string, newer = false): boolean {
  const raw = localStorage.getItem(key);
  if (raw === null) return false;
  try {
    const held = localStorage.getItem(UNREADABLE_KEY);
    if (held === raw) return true;
    if (held !== null && !newer) return false;
    localStorage.setItem(UNREADABLE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * The kept save as text a download can carry, or null when none is kept. A
 * compressed store value comes back as the `.vctower` file text it holds, so
 * the download imports once the game is updated; anything else comes back as
 * stored.
 */
export function stashedText(): string | null {
  const raw = localStorage.getItem(UNREADABLE_KEY);
  if (raw === null || !raw.startsWith(STORE_MAGIC)) return raw;
  const file = toTowerFile(raw, true);
  return file.ok ? file.text : raw;
}
