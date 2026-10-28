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
/** Whether the latch holder is a legacy download; meaningful only while held. */
let latchIsLegacy = false;
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
  latchIsLegacy = false;
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
 * unlock a newer export. A late settle says it finished after all, so its
 * line reads as the end of the export the watchdog called stuck rather than
 * contradicting that warning.
 */
export async function runExportFlow(deps: ExportFlowDeps, save: () => { readonly text: string; readonly towerName: string | undefined }): Promise<void> {
  if (latchOwner !== 0) return;
  const run = ++nextRun;
  latchOwner = run;
  latchIsLegacy = false;
  let timedOut = false;
  const watchdog = setTimeout(() => {
    if (latchOwner !== run) return;
    latchOwner = 0;
    timedOut = true;
    deps.ui.toast("The export is not responding. You can try exporting again.", "bad");
  }, EXPORT_WATCHDOG_MS);
  try {
    let settling = deps.getSim();
    // The worker host's exact save first (a no-op on every other engine),
    // then the live camera, right before the save, or towers export at a
    // stale view.
    await settleEngine(settling);
    // The tower the app holds now (one adopted during the wait is the one
    // the player sees, so it is the one exported).
    let sim = deps.getSim();
    for (let tries = 0; sim !== settling && tries < 3; tries++) {
      await settleEngine(sim);
      [settling, sim] = [sim, deps.getSim()];
    }
    // The engine port saves the tower it holds now, with the camera stamped.
    const { text, towerName } = save();
    const file = await SaveGame.export(text);
    // A download that failed has already said so (GH #997); the success line
    // would contradict it.
    if (!deps.ui.downloadFile(SaveGame.exportFilename(towerName), file)) return;
    // The container is pure ASCII, so string length == bytes on disk.
    const size = `${(file.length / 1024).toFixed(1)} KB`;
    deps.ui.toast(
      timedOut
        ? `The earlier export finished after all (${size}). Check your downloads.`
        : `Tower exported (${size}). Check your downloads.`,
      "good",
    );
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
 * until `download()` settles, with the same watchdog escape hatch. The browser
 * download is a synchronous click, so the latch spans only that call; what it
 * buys is that a .TDT download never starts while a .vctower export is still
 * compressing.
 *
 * A .TDT click dropped because a .vctower export holds the latch says so
 * (GH #1012): the export report dialog has already closed when its Download
 * fires, and the .vctower export only ever announces itself, so the click would
 * otherwise vanish. It goes through `sayVisibly` because closing that dialog can
 * reopen a queued one, which would cover a plain toast. A second .TDT click
 * while the first is still downloading stays quiet: that is the player's own
 * download, already running. A .vctower click is not announced the other way
 * round either: a .TDT download holds the latch only for its synchronous click,
 * so there is no window to land in. Resolves to whether the download was
 * attempted, and rejects if `download()` throws (`UI.downloadFile` never does).
 */
export async function runLegacyDownload(
  ui: Pick<UI, "toast" | "sayVisibly">,
  download: () => void | Promise<void>,
): Promise<boolean> {
  if (latchOwner !== 0) {
    if (!latchIsLegacy) ui.sayVisibly("Another export is still running. Try again when it finishes.", "info");
    return false;
  }
  const run = ++nextRun;
  latchOwner = run;
  latchIsLegacy = true;
  const watchdog = setTimeout(() => {
    if (latchOwner !== run) return;
    latchOwner = 0;
    ui.toast("The export is not responding. You can try exporting again.", "bad");
  }, EXPORT_WATCHDOG_MS);
  try {
    await download();
    return true;
  } finally {
    clearTimeout(watchdog);
    if (latchOwner === run) latchOwner = 0;
  }
}
