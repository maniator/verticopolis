import { swapDone } from "./portLifecycle";
import { trackFileImported } from "../analytics";
import { keepOpenedFile } from "./fileKeep";
import { claimTower } from "./towerDocument";
import type { SaveLoadDeps } from "./saveLoad";

/**
 * Adopt a CONFIRMED 1994 `.TDT` import: the body of the fidelity report's
 * "Open tower" action, split out of `saveLoad.ts` when it crossed the 500-line
 * guard. Reading the file, staging it and the report stay in `SaveLoad`; this
 * is only what happens after the player clicks the primary: the engine swaps
 * the staged tower in (`adoptTdt`) and the app follows.
 *
 * `file` is the confirmed report's own file: it is read into the engine
 * again, since another file read after it would have replaced the one staged
 * tower, and kept in My Towers once the tower is in.
 *
 * `flushCurrent` is the caller's `saveBeforeUpdate` bound, kept as a thunk so
 * the flush contract (throws on failure, caller decides) stays owned by
 * `SaveLoad` where its tests live.
 */
export function adoptConfirmedLegacyImport(
  deps: Pick<SaveLoadDeps, "enginePort" | "portCodes" | "reader" | "towerSwapped" | "beforeSwap" | "swapRefused" | "ui">,
  towerName: string,
  flushCurrent: () => void,
  file: { readonly bytes: Uint8Array; readonly filename: string },
): void {
  // Flush the CURRENT tower to the autosave slot first (same splash guard as
  // every other flush), so adopting the import can't cost the player their
  // in-progress tower even if they never saved manually. A failure must not
  // block the adoption the player just asked for, but it must be SAID: the
  // report modal promised the autosave.
  let flushFailed = false;
  try {
    flushCurrent();
  } catch {
    flushFailed = true;
  }
  const port = deps.enginePort();
  // The flushed Auto-save is about to hold the 1994 tower: keep this one in
  // My Towers once it does (`keepOutgoing.ts`).
  deps.beforeSwap?.("tdt");
  try {
    swapDone(port, port.loadTdt(file.bytes, file.filename));
    swapDone(port, port.adoptTdt());
  } catch (err) {
    // The file no longer reads or adopts: nothing swapped.
    deps.swapRefused?.();
    deps.ui.toast(`The tower could not be opened: ${(err as Error).message}`, "bad");
    return;
  }
  deps.towerSwapped();
  trackFileImported("tdt", () => deps.reader().header);
  // Keep the 1994 file in My Towers (owner, 2026-11-15), so the player can
  // always get back to it: a bad import clobbers nothing, and the file opens
  // again from there. A file opened from My Towers is already there and is
  // not added twice (`keepOpenedFile`). The Auto-save, the crash copy, holds
  // the imported tower from the swap on (`towerSwapped`).
  // "info" keeps this bulletin log-only: renderLog also toasts "good" entries,
  // and the explicit success toast below already covers that.
  port.logLine(`Imported from SimTower (1994): welcome back to ${towerName}.`, deps.portCodes().code("logKinds", "info"));
  // The tower's own file comes once the 1994 file is in (`towerDocument.ts`),
  // so the 1994 file keeps its name.
  void claimTower(() =>
    keepOpenedFile(file.filename, file.bytes, "tdt").then((kept) =>
      deps.ui.toast(
        kept ? `Tower imported. The 1994 file is in My Towers as "${kept.name}".` : "Tower imported. Use File > Save As… to keep it.",
        "good",
      ),
    ),
  );
  if (flushFailed) {
    deps.ui.toast("Your previous tower couldn't be backed up to the autosave (storage is full or blocked).", "bad");
  }
}
