import { downloadFile } from "./downloadFile";

/**
 * The recovery copy's download (#1422 6b). It is not an export: the stored
 * save's text goes out as it is, with no engine involved, so it still works
 * when the engine is what failed. A .txt is a file type GitHub accepts on an
 * issue, and the save's own container is the one a `.vctower` uses, so the
 * importer can open a sound copy later.
 */
export const RECOVERY_COPY_FILENAME = "verticopolis-recovery-copy.txt";

export type RecoveryCopyOutcome = "saved" | "none" | "failed";

/** The status line for each outcome, said where the player clicked. */
export const RECOVERY_COPY_STATUS: Readonly<Record<RecoveryCopyOutcome, string>> = {
  saved: "Recovery copy ready. Check your downloads. It is your stored save exactly as it is, and you can attach it to a bug report.",
  none: "There is no stored save on this device to copy.",
  failed: "The recovery copy couldn't be saved. Your stored save is untouched.",
};

/** Read the stored text at click time and hand it to the browser. */
export function downloadRecoveryCopy(read: () => string | null): RecoveryCopyOutcome {
  const text = read();
  if (text === null) return "none";
  try {
    // octet-stream so a phone browser downloads the text instead of showing it.
    downloadFile(RECOVERY_COPY_FILENAME, text, "application/octet-stream");
    return "saved";
  } catch (err) {
    console.error("[recovery-copy] download failed:", err);
    return "failed";
  }
}
