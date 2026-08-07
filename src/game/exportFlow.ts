import type { Simulation } from "../engine/Simulation";
import { SaveGame } from "../storage/SaveGame";
import { IS_WRAPPED_BUILD } from "../platform";
import { exportStoredTower } from "./manualSavePersist";
import type { UI } from "../ui/UI";

/**
 * The .vctower export flow, split out of `saveLoad.ts` at the 500-line guard
 * when the single-flight latch landed (GH #760). `SaveLoad.exportGame` is a
 * thin delegation here, so the latch guards the one choke point on the sole
 * production route to an export: the saves dialog's Export button
 * (`confirmExport` in uiDialogs, then `onExport`, then `exportGame`). There
 * is no menu command or keyboard shortcut for export today; if one lands, it
 * must route through `exportGame` to stay inside the latch.
 */

/** The slice of {@link import("./saveLoad").SaveLoadDeps} the flow touches. */
export interface ExportFlowDeps {
  getSim(): Simulation;
  ui: Pick<UI, "toast" | "downloadFile">;
}

/**
 * How long a single export may hold the latch before the watchdog frees it.
 *
 * `exportRecord` is awaited RAW on purpose: the shell's save dialog
 * legitimately sits open for minutes while the player picks a folder, so a
 * request-scale timeout would cancel real sessions. But "never time out" plus
 * a single-flight latch would let a hung bridge brick Export for the rest of
 * the session, which is worse than the reentry the latch exists to stop. Ten
 * minutes is far past any plausible dialog session, so tripping it means the
 * bridge is stuck, and the honest move is to free the latch and say so. The
 * wrapped fallback's saveFile dialog is awaited raw under this same watchdog
 * (GH #773), on the same reasoning.
 */
export const EXPORT_WATCHDOG_MS = 10 * 60_000;

/** The run id currently holding the single-flight latch; 0 when free. */
let latchOwner = 0;
let nextRun = 0;

/** Test seam, mirroring `resetManualSaveForTests` for this module's state. */
export function resetExportFlowForTests(): void {
  latchOwner = 0;
  nextRun = 0;
}

/**
 * Hand the player their tower as a compressed .vctower file.
 *
 * Single-flight (GH #760): the desktop port contract makes the shell's save
 * dialog modal to the game window, but a platform whose app-level menu is not
 * blocked by a window-modal dialog (macOS) can still fire Export mid-dialog,
 * and a nonconforming shell can too. A second run would stack a second flush
 * plus a second dialog, or drop a live-path download dialog on top of the
 * stored-export one. Reentry is a quiet no-op: on every reachable reentry
 * path the first dialog is already on screen, so a toast would only compete
 * with it.
 *
 * The watchdog is the latch's escape hatch, and deliberately does NOT abandon
 * the awaited call: it frees the latch and tells the player, and if the
 * original dialog settles late its outcome still lands (a late success still
 * exports; a late cancel still says nothing). The one exception is a late
 * "fallback": every other late outcome finishes something, but fallback would
 * START the live path and drop a fresh dialog on top of whatever the player
 * is doing minutes later, so a run that no longer holds the latch stops there
 * (the Edge Case Hunter demonstrated the collision). The settle path releases
 * only a latch its own run still holds, so a late settle can never unlock a
 * newer export's dialog.
 */
export async function runExportFlow(deps: ExportFlowDeps, stampView: (sim: Simulation) => void): Promise<void> {
  if (latchOwner !== 0) return;
  const run = ++nextRun;
  latchOwner = run;
  const watchdog = setTimeout(() => {
    if (latchOwner !== run) return;
    latchOwner = 0;
    deps.ui.toast("The export is not responding. You can try exporting again.", "bad");
  }, EXPORT_WATCHDOG_MS);
  try {
    const sim = deps.getSim();
    // stampView FIRST, before either path: the stored-byte flush below
    // must carry the camera exactly as the live-serialize path always has
    // (a party catch: dropping it would export towers at a stale view).
    stampView(sim);
    // Stored-byte export (story D7, D2's AC22): on a hydrated desktop
    // session, flush to auto and let the shell COPY the stored file, so
    // the destination bytes equal the stored bytes. Cancel is a CHOICE
    // (Copilot caught the success toast firing on it): say nothing, open
    // nothing else. Only "fallback" runs the live-serialize path below,
    // which is what every other build runs.
    if (IS_WRAPPED_BUILD) {
      const stored = await exportStoredTower(sim, SaveGame.exportFilename(sim));
      if (stored === "exported") {
        deps.ui.toast("Tower exported. Check where you saved it.", "good");
        return;
      }
      if (stored === "canceled") return;
      // A late "fallback" (the hung bridge finally rejected or answered
      // malformed, long after the watchdog freed the latch) must not run the
      // live path: that OPENS a download or saveFile dialog, possibly on top
      // of a retry's dialog, the exact collision the latch exists to stop.
      // An immediate fallback still owns the latch and proceeds normally.
      if (latchOwner !== run) return;
    }
    const file = await SaveGame.export(sim);
    const delivered = deps.ui.downloadFile(SaveGame.exportFilename(sim), file);
    // The container is pure ASCII, so string length == bytes on disk.
    deps.ui.toast(`Tower exported (${(file.length / 1024).toFixed(1)} KB). Check your downloads.`, "good");
    // On a wrapped session this live path opened the shell's saveFile dialog,
    // which outlives the call, so hold the latch until it settles (GH #773):
    // releasing on return reopened the reentry window the latch exists to
    // close (a second flush plus a second dialog off the macOS menu). The
    // toast stays above the await on purpose: the port contract resolves
    // saveFile identically for a written file and a canceled dialog (types.ts,
    // cancel is not an error), so waiting for the settle could not tell the
    // player anything more, and the residual is that a cancel still gets this
    // toast. In a browser build the branch folds away and the anchor-click
    // download keeps its synchronous timing, toast included.
    if (IS_WRAPPED_BUILD) await delivered;
  } catch (err) {
    // Never fail silently: main.ts fires this with `void`, so an unhandled
    // rejection here would leave the player with no download and no feedback.
    deps.ui.toast("Export failed: " + (err as Error).message, "bad");
  } finally {
    clearTimeout(watchdog);
    if (latchOwner === run) latchOwner = 0;
  }
}
