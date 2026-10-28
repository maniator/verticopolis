import { SLOT_COUNT, SaveGame } from "../storage/SaveGame";
import type { PortRecord } from "../simport/enginePort";
import { saveText, swapDone } from "./portLifecycle";
import type { SaveLoadDeps } from "./saveLoad";

/**
 * Adopt a CONFIRMED 1994 `.TDT` import: the body of the fidelity report's
 * "Open tower" action, split out of `saveLoad.ts` when it crossed the 500-line
 * guard. Reading the file, staging it and the report stay in `SaveLoad`; this
 * is only what happens after the player clicks the primary: the engine swaps
 * the staged tower in (`adoptTdt`) and the app follows.
 *
 * `stage` reads the confirmed report's own file into the engine again, since
 * another file read after it would have replaced the one staged tower.
 *
 * `flushCurrent` is the caller's `saveBeforeUpdate` bound, kept as a thunk so
 * the flush contract (throws on failure, caller decides) stays owned by
 * `SaveLoad` where its tests live.
 */
export function adoptConfirmedLegacyImport(
  deps: Pick<SaveLoadDeps, "enginePort" | "portCodes" | "towerSwapped" | "ui">,
  towerName: string,
  flushCurrent: () => void,
  stage: () => PortRecord,
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
  try {
    swapDone(port, stage());
    swapDone(port, port.adoptTdt());
  } catch (err) {
    // The file no longer reads or adopts: nothing swapped.
    deps.ui.toast(`The tower could not be opened: ${(err as Error).message}`, "bad");
    return;
  }
  deps.towerSwapped();
  // Auto-save the IMPORTED tower to a fresh slot so a bad import can't clobber
  // anything and the player can always get back to it. "Fresh" is a RAW
  // presence check (hasSlot), never the parse-based listSlots().exists: a
  // corrupt-but-present slot may still be recoverable by a later build and
  // must not be an overwrite target.
  let savedTo: number | null = null;
  let slotWriteFailed = false;
  try {
    for (let n = 1; n <= SLOT_COUNT; n++) {
      if (!SaveGame.hasSlot(n)) {
        // The engine holds the imported tower now; its save keeps the view
        // the file carried (no camera is stamped). Through `saveText`, like
        // every save, so an engine that trapped writes nothing.
        SaveGame.saveSlot(n, saveText(port, null));
        savedTo = n;
        break;
      }
    }
  } catch {
    slotWriteFailed = true; // quota/disabled storage, NOT "slots full"
  }
  // "info" keeps this bulletin log-only: renderLog also toasts "good" entries,
  // and the explicit success toast below already covers that.
  port.logLine(`Imported from SimTower (1994): welcome back to ${towerName}.`, deps.portCodes().code("logKinds", "info"));
  // Honest feedback: a failed slot write is not "slots full".
  if (slotWriteFailed) {
    deps.ui.toast(
      "Tower imported, but the slot copy failed (storage is full or blocked). Export it to a file soon.",
      "bad",
    );
  } else {
    deps.ui.toast(
      savedTo !== null
        ? `Tower imported and saved to slot ${savedTo}.`
        : "Tower imported. All save slots are full, so save it yourself soon.",
      "good",
    );
  }
  if (flushFailed) {
    deps.ui.toast("Your previous tower couldn't be backed up to the autosave (storage is full or blocked).", "bad");
  }
}
