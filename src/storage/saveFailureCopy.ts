/**
 * What the player is told when a save write fails. Kept beside the save store
 * so every save surface (Quick Save, the slots, the autosave notice) words the
 * same failure the same way.
 */

/** True when a failed save write is STORAGE's fault (quota full, private
 *  mode, storage disabled) rather than a serialize/compression bug. Callers
 *  word their failure feedback on this: "free up space or allow site storage"
 *  is real advice for a storage failure and a wild-goose chase for a code bug.
 *  Matched by NAME, not `instanceof DOMException`: a cross-realm exception or
 *  a wrapper rethrowing a plain error-like object fails the instanceof check
 *  while still being a genuine quota/security failure. SecurityError is only
 *  trusted on a real DOMException (the name is too generic on arbitrary
 *  objects); the two quota names are unambiguous wherever they appear. */
export function isStorageWriteError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null | undefined)?.name;
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") return true; // Firefox's quota name
  return err instanceof DOMException && err.name === "SecurityError";
}

/** The raw detail of a failure that is not storage's fault, for the neutral
 *  wording (the same diagnosability contract as "Import failed: <message>"). */
function failureDetail(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err);
}

/**
 * Honest manual-save failure copy, shared by Quick Save (saveLoad) and the
 * slot saves (appModals). Blames storage only when it IS a storage failure:
 * the "free up space or allow site storage" advice matches the
 * reload-hardening spec's crash-card wording, and would misdirect the player
 * if a serialize/compression bug threw instead (those keep the raw detail).
 */
export function saveFailureMessage(err: unknown): string {
  return isStorageWriteError(err)
    ? "Save failed: storage is full or blocked. Free up space or allow site storage, or export the tower to a file."
    : "Save failed: " + failureDetail(err);
}

/** The headline of the notice that stays up while saving is not working. */
export const SAVE_WARNING_TITLE = "Your tower isn't being saved";

/**
 * The body of that notice: the likely causes and what to do now. A storage
 * failure names the usual culprits (a private or incognito window, site
 * storage turned off, a full disk) and steers the player to export, the one
 * way to keep the tower when the browser will not hold it. Any other failure
 * keeps its raw detail for a bug report and still offers the export.
 */
export function saveWarningText(err: unknown): string {
  return isStorageWriteError(err)
    ? "This browser won't let the game store it. That usually means a private or incognito window, " +
        "site storage turned off for this site, or a full disk. Export the tower to a file to keep it, " +
        "then play in a normal window with site storage allowed."
    : `The game couldn't write its save (${failureDetail(err)}). Export the tower to a file to keep it.`;
}
