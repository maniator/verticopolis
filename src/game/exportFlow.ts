import { settleEngine } from "../wasmhost/stepGate";
import type { Simulation } from "../engine/Simulation";
import { SaveGame } from "../storage/SaveGame";
import type { UI } from "../ui/UI";

/**
 * The .vctower export flow, split out of `saveLoad.ts` at the 500-line guard
 * when the single-flight latch landed (GH #760). `SaveLoad.exportGame` is a
 * thin delegation here, so the latch guards the choke point every export
 * converges on: the saves dialog's Export button opens `confirmExport` (in
 * uiDialogs), whose two choices are `.vctower` (via `onExport` -> `exportGame`
 * -> `runExportFlow`) and the legacy `.TDT` (via `onExportLegacy`, whose
 * download runs through {@link runLegacyDownload}). Both formats share the one
 * latch, so neither can be re-fired while the other is still building.
 */

/** The slice of {@link import("./saveLoad").SaveLoadDeps} the flow touches. */
export interface ExportFlowDeps {
  getSim(): Simulation;
  ui: Pick<UI, "toast" | "downloadFile">;
}

/**
 * How long a single export may hold the latch before the watchdog frees it.
 *
 * "Never time out" plus a single-flight latch would let one stuck export
 * brick Export for the rest of the session, which is worse than the reentry
 * the latch exists to stop. Ten minutes is far past any plausible compression
 * or download, so tripping it means something is stuck, and the honest move is
 * to free the latch and say so.
 */
export const EXPORT_WATCHDOG_MS = 10 * 60_000;

/** The run id currently holding the single-flight latch; 0 when free. */
let latchOwner = 0;
let nextRun = 0;

/**
 * Test seam for this module's state.
 *
 * Frees the latch but leaves `nextRun` alone, so run ids stay unique for the
 * life of the module. Resetting the counter recycled them, and a run still in
 * flight across a reset would then read a LATER run's latch as its own and free
 * the new run's latch on the way out.
 */
export function resetExportFlowForTests(): void {
  latchOwner = 0;
}

/**
 * Hand the player their tower as a compressed .vctower file.
 *
 * Single-flight (GH #760): a second run while the first is still compressing
 * would stack a second download. Reentry is a quiet no-op, since the first
 * export's toast is already on its way.
 *
 * The watchdog is the latch's escape hatch, and deliberately does NOT abandon
 * the awaited call: it frees the latch and tells the player, and if the
 * original export settles late its download still lands. The settle path
 * releases only a latch its own run still holds, so a late settle can never
 * unlock a newer export.
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
    // The worker host's exact save first (a no-op on every other engine),
    // then the live camera, right before the save, or towers export at a
    // stale view.
    await settleEngine(sim);
    stampView(sim);
    const file = await SaveGame.export(sim);
    deps.ui.downloadFile(SaveGame.exportFilename(sim), file);
    // The container is pure ASCII, so string length == bytes on disk.
    deps.ui.toast(`Tower exported (${(file.length / 1024).toFixed(1)} KB). Check your downloads.`, "good");
  } catch (err) {
    // Never fail silently: main.ts fires this with `void`, so an unhandled
    // rejection here would leave the player with no download and no feedback.
    deps.ui.toast("Export failed: " + (err as Error).message, "bad");
  } finally {
    clearTimeout(watchdog);
    if (latchOwner === run) latchOwner = 0;
  }
}

/**
 * Single-flight wrapper for the LEGACY (`.TDT`) download, sharing the SAME latch
 * as {@link runExportFlow} so the two export formats are mutually exclusive and
 * neither can be re-fired mid-dialog. The legacy path builds its bytes before
 * the confirm dialog, so only the download itself needs guarding: hold the latch
 * until `download()` settles, with the same watchdog escape hatch and the same
 * quiet-no-op reentry.
 */
export async function runLegacyDownload(ui: Pick<UI, "toast">, download: () => void | Promise<void>): Promise<void> {
  if (latchOwner !== 0) return;
  const run = ++nextRun;
  latchOwner = run;
  const watchdog = setTimeout(() => {
    if (latchOwner !== run) return;
    latchOwner = 0;
    ui.toast("The export is not responding. You can try exporting again.", "bad");
  }, EXPORT_WATCHDOG_MS);
  try {
    await download();
  } finally {
    clearTimeout(watchdog);
    if (latchOwner === run) latchOwner = 0;
  }
}
