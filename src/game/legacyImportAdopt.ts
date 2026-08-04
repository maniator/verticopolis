import type { Simulation } from "../engine/Simulation";
import { SLOT_COUNT, SaveGame } from "../storage/SaveGame";
import { IS_WRAPPED_BUILD } from "../platform";
import { noteTowerOriginForSlot, storeReadDegraded } from "./desktopSaveStore";
import type { SaveLoadDeps } from "./saveLoad";

/**
 * Adopt a CONFIRMED 1994 `.TDT` import: the body of the fidelity report's
 * "Open tower" action, split out of `saveLoad.ts` when it crossed the 500-line
 * guard. Parsing, validation and the report itself stay in `SaveLoad`; this is
 * only what happens after the player clicks the primary.
 *
 * `flushCurrent` is the caller's `saveBeforeUpdate` bound, kept as a thunk so
 * the flush contract (throws on failure, caller decides) stays owned by
 * `SaveLoad` where its tests live.
 */
export function adoptConfirmedLegacyImport(
  deps: Pick<SaveLoadDeps, "adoptSim" | "getSim" | "ui">,
  sim: Simulation,
  flushCurrent: () => void,
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
  // A TDT import has no stored origin either (see importGame).
  if (IS_WRAPPED_BUILD) noteTowerOriginForSlot(undefined);
  deps.adoptSim(sim);
  // Auto-save the IMPORTED tower to a fresh slot so a bad import can't clobber
  // anything and the player can always get back to it. "Fresh" is a RAW
  // presence check (hasSlot), never the parse-based listSlots().exists: a
  // corrupt-but-present slot may still be recoverable by a later build and
  // must not be an overwrite target.
  //
  // A degraded desktop session skips the pick entirely and reports the write
  // as failed. Degraded means hasSlot is answering from a localStorage view
  // the store contradicts, so "free" cannot be trusted, and the copy would be
  // overwritten by the next successful hydration anyway. The existing failure
  // toast already tells the player to export to a file soon, which is the
  // right advice here too.
  let savedTo: number | null = null;
  let slotWriteFailed = false;
  if (IS_WRAPPED_BUILD && storeReadDegraded()) {
    slotWriteFailed = true;
  } else {
    try {
      for (let n = 1; n <= SLOT_COUNT; n++) {
        if (!SaveGame.hasSlot(n)) {
          SaveGame.saveSlot(n, sim);
          savedTo = n;
          break;
        }
      }
    } catch {
      slotWriteFailed = true; // quota/disabled storage, NOT "slots full"
    }
  }
  // "info" keeps this bulletin log-only: renderLog also toasts "good" entries,
  // and the explicit success toast below already covers that.
  deps.getSim().emit(`Imported from SimTower (1994): welcome back to ${sim.tower.towerName}.`, "info");
  // Honest feedback: distinguish "no free slot" from "the write failed".
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
