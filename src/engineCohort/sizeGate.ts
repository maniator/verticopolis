import { SaveGame } from "../storage/SaveGame";

/** The size gate's measure (#1197): the longest stored save, decoded, in
 *  characters, read before any engine sees it (0 with none). Every stored
 *  candidate counts, so a small unreadable autosave cannot hide a large
 *  legacy one the boot falls back to. Reads only. */
export function storedSaveChars(): number {
  let chars = 0;
  SaveGame.loadResult((text) => {
    chars = Math.max(chars, text.length);
    return false;
  });
  return chars;
}
