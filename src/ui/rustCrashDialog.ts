import { html, type TemplateResult } from "lit-html";
import { APP_VERSION } from "../appVersion";
import { crashReportDue, markCrashReportShown, tabStore, type RustCrashFacts } from "../engineCohort/crashReload";
import { buildCrashDetails, buildCrashReportZip, bugReportUrl, timesText, type CrashEngines, type CrashTower, type RustCrashDescription } from "../game/crashReport";
import { TS_ENGINE_SOURCES, TS_ENGINE_VERSION } from "../wasmhost/tsEngineIdentity";
import { downloadFile } from "./downloadFile";
import type { UI } from "./UI";

/**
 * The Rust engine's crash report (#1422, owner 2026-10-28). After the tab's
 * second Rust crash on a build the game reloads onto the TypeScript engine,
 * and that boot says why once, in a dialog that offers the crash-report zip
 * (both engines, the fault's codes, the browser and the tower save) and a
 * prefilled bug report. Nothing is sent: the player downloads the zip and
 * attaches it. The save is the TypeScript engine's, so it always downloads.
 * Later boots in the tab keep the one-line notice instead.
 */

/** The slice of the app the dialog reads, at click time: the tower can be
 *  swapped while the dialog is open. */
export interface RustCrashApp {
  ui: Pick<UI, "openModalTemplate" | "closeModal" | "wireActions">;
  reader: CrashTower["view"];
  enginePort: CrashTower["port"];
  speed?: number;
}

export function rustCrashTemplate(crash: RustCrashDescription, reportHref: string): TemplateResult {
  return html`
    <h2>The Rust engine crashed</h2>
    <p>The Rust engine crashed ${timesText(crash.crashes)}, so this game is running on the TypeScript engine for now. You can switch back in Settings.</p>
    <p>A bug report helps us fix it. The crash report is a zip with the crash details and your tower save; nothing is sent anywhere until you attach it to a bug report yourself.</p>
    <p class="crash-status" aria-live="polite"></p>
    <div class="modal-actions">
      <button class="btn" data-act="download">Download crash report</button>
      <a class="btn" data-act="report" target="_blank" rel="noopener noreferrer" href=${reportHref}>Report a bug<span class="visually-hidden"> (opens GitHub in a new tab)</span></a>
      <button class="btn primary" data-act="close" autofocus>Keep playing</button>
    </div>`;
}

/** Both engines as the report names them: the Rust engine that crashed, as
 *  its boot recorded it, and the TypeScript engine running now. */
export function crashEngines(last: RustCrashFacts): CrashEngines {
  return { rust: last.rust, typescript: { version: TS_ENGINE_VERSION, sources: TS_ENGINE_SOURCES } };
}

export function showRustCrashReport(app: RustCrashApp, crash: RustCrashDescription, engines: CrashEngines): void {
  const { ui } = app;
  const href = bugReportUrl({ version: APP_VERSION, crash, engines });
  const box = ui.openModalTemplate(rustCrashTemplate(crash, href));
  const status = box.querySelector<HTMLElement>(".crash-status")!;
  const download = box.querySelector<HTMLButtonElement>('[data-act="download"]')!;
  ui.wireActions(box, {
    download: () => {
      // Disabled while packing, so a double tap cannot race two zips.
      download.disabled = true;
      status.textContent = "Packing crash report…";
      void (async () => {
        // One capture per click, so the summary and the save describe one tower.
        const tower: CrashTower = { view: app.reader, port: app.enginePort };
        const details = buildCrashDetails(tower, crash, { version: APP_VERSION, speed: app.speed ?? 0, frameErrors: [], engines });
        const { filename, bytes } = await buildCrashReportZip(tower, details);
        downloadFile(filename, bytes, "application/zip");
        status.textContent = "Crash report ready. Check your downloads, then attach the zip to your bug report.";
        download.disabled = false;
      })().catch((err) => {
        console.error("[crash-report] packing or saving failed:", err);
        status.textContent = "The crash report couldn't be saved. Your game is still running and saving as usual.";
        download.disabled = false;
      });
    },
  });
}

/** Offer the crash report once, when this tab's crashes on the build are spent
 *  and their facts were kept. Returns whether it was offered, so the caller
 *  shows the one-line notice otherwise. */
export function offerRustCrashReport(app: RustCrashApp, sha: string): boolean {
  const store = tabStore();
  const due = crashReportDue(store, sha);
  if (!due) return false;
  const crash: RustCrashDescription = { kind: "rust-engine-trap", crashes: due.count, reason: due.last.reason, stage: due.last.stage };
  showRustCrashReport(app, crash, crashEngines(due.last));
  // A mark storage did not keep shows the report again on the next boot,
  // which errs toward telling the player, so its result is not checked.
  markCrashReportShown(store, sha);
  return true;
}
