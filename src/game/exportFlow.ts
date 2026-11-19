import { headerNow, trackFileExported, trackFileFailure } from "../analytics";
import { ExportRefused } from "./portLifecycle";
import type { ViewReader } from "@verticopolis/components/port/viewReader";
import { SaveGame } from "../storage/SaveGame";
import type { UI } from "../ui/UI";

/**
 * The .vctower export flow, split out of `saveLoad.ts` at the 500-line guard.
 * `SaveLoad.exportGame` is a thin delegation here, so every export Save As's
 * "To a file on your computer…" starts (via `confirmExport` in uiDialogs, then
 * `onExport` -> `exportGame`) ends in the same download, toast and analytics.
 *
 * The flow is synchronous (#1655): the engine writes the `.vctower` on the main
 * thread and `UI.downloadFile` starts the download with one click, so a run
 * finishes before the page can take another click. The single-flight latch and
 * its watchdog (GH #760) guarded a compression promise that no longer exists,
 * and went with it; the PC measurements on #1655 kept the export on the main
 * thread (a full Modern tower writes in about 105 ms).
 */

/** The slice of {@link import("./saveLoad").SaveLoadDeps} the flow touches. */
export interface ExportFlowDeps {
  ui: Pick<UI, "toast" | "downloadFile">;
  /** The tower being exported, for the `file_exported` event. */
  reader(): Pick<ViewReader, "header">;
}

/**
 * Hand the player their tower as a compressed .vctower file (binary, `VCTOWER2`).
 *
 * Never fails silently: a throw from `save` (an engine refusal, or the camera
 * stamp) ends in an "Export failed" toast and an `export_failed` event with
 * the refusal's closed code, or `error` for a plain throw (#2075).
 */
export function runExportFlow(
  deps: ExportFlowDeps,
  save: () => { readonly file: string | Uint8Array; readonly towerName: string | undefined },
): void {
  try {
    // The engine writes the `.vctower` of the tower it holds now, with the
    // camera stamped; the page only downloads it.
    const { file, towerName } = save();
    const header = headerNow(() => deps.reader().header); // the tower the file was written from
    // A download that failed has already said so (GH #997); the success line
    // would contradict it.
    if (!deps.ui.downloadFile(SaveGame.exportFilename(towerName), file)) return;
    trackFileExported("vctower", header);
    // A binary file's length is its size on disk, and the text container is
    // pure ASCII, so its string length is too.
    deps.ui.toast(`Tower exported (${(file.length / 1024).toFixed(1)} KB). Check your downloads.`, "good");
  } catch (err) {
    trackFileFailure("export_failed", "save", err instanceof ExportRefused ? err.code : "error");
    deps.ui.toast("Export failed: " + (err instanceof Error ? err.message : String(err)), "bad");
  }
}
