import { autosaveKey, UNREADABLE_KEY } from "./SaveGame";

/**
 * The text of the recovery copy (#1422 6b, layer 1 of the 3.0 format
 * boundary): the stored autosave exactly as browser storage holds it. There is
 * no parse, no decode and no validation, so a save the running engine cannot
 * read, or one written while an engine failed, still comes out whole. With no
 * autosave it falls back to the unreadable stash (`SaveGame.preserveUnreadable`).
 * Null when neither is stored, or when storage itself cannot be read.
 */
export function readRecoveryText(): string | null {
  try {
    return localStorage.getItem(autosaveKey()) ?? localStorage.getItem(UNREADABLE_KEY);
  } catch {
    return null;
  }
}
