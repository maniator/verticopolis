import type { Simulation } from "../engine/Simulation";
import { getPlatform } from "../platform";
import { buildCrashDetails, buildCrashReportZip, bugReportUrl } from "../game/crashReport";
import type { CrashDescription, FrameErrorEntry } from "../game/crashReport";
import { escapeHtml } from "./escape";

/**
 * The full-screen crash card. Shown when the game can no longer draw (the GPU
 * dropped the WebGL context). It replaces the old silent autosave-and-reload:
 * the player learns what happened, can download a crash-report zip (crash
 * details plus their tower save), can open a prefilled bug report, and reloads
 * when THEY choose to. The card is plain DOM on purpose: the canvas is dead,
 * and everything here must work without it.
 */

export interface CrashScreenOptions {
  crash: CrashDescription;
  /** Save-status detail for the message. `flushed` is the normal case;
   *  `behindSplash` means nothing was in progress to save. */
  save: { flushed: boolean; behindSplash: boolean; storageBlame: boolean; hadPriorSave: boolean };
  version: string;
  speed: number;
  /** Read live at click time; the sim outlives its renderer. */
  getSim: () => Simulation;
  frameErrors: readonly FrameErrorEntry[];
  /** Stamps the recovery session flags, then reloads (owned by SaveLoad). */
  onReload: () => void;
}

/** Idempotence guard: context loss can only fire once per engine, but a
 *  defensive second call must not stack a second card. */
const CARD_ID = "crash-screen";

export function showCrashScreen(opts: CrashScreenOptions): void {
  if (document.getElementById(CARD_ID)) return;

  const saveLine = opts.save.behindSplash
    ? "No game was in progress; your saved towers are untouched."
    : opts.save.flushed
      ? "Your tower was saved. Nothing is lost."
      : opts.save.storageBlame
      ? "Your latest changes couldn't be saved: storage is full or blocked." +
        (opts.save.hadPriorSave ? " Your last saved tower is safe." : "")
      : "Your latest changes couldn't be saved: the save hit an unexpected error." +
        (opts.save.hadPriorSave ? " Your last saved tower is safe." : "");
  const repeatLine = opts.crash.repeat
    ? `<p><b>This is the second crash in a row.</b> Closing other tabs or apps before reloading may help.</p>`
    : "";

  const overlay = document.createElement("div");
  overlay.id = CARD_ID;
  overlay.setAttribute("role", "alertdialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "crash-screen-title");
  // A fixed overlay above everything: the game underneath is frozen (the
  // render clock stopped when the context died), so nothing behind needs to
  // stay reachable.
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.55)";
  overlay.innerHTML = `
    <div class="win" style="max-width:440px;padding:16px;display:flex;flex-direction:column;gap:10px">
      <h2 id="crash-screen-title" class="win-title">The game crashed</h2>
      <p>The graphics driver reset while the game was running. On phones and tablets this usually means the device ran out of graphics memory, often on a very large tower at the fastest speed.</p>
      <p>${escapeHtml(saveLine)}</p>
      ${repeatLine}
      <p>A crash report helps us fix this. It's a zip with the crash details and your tower save; nothing is sent anywhere until you attach it to a bug report yourself.</p>
      <p class="crash-status" aria-live="polite" style="min-height:1.2em;color:var(--muted)"></p>
      <div class="modal-actions" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        <button class="btn" data-act="download">Download crash report</button>
        <a class="btn" data-act="report" target="_blank" rel="noopener noreferrer" href="${escapeHtml(bugReportUrl({ version: opts.version, crash: opts.crash }))}">Report a bug<span class="visually-hidden"> (opens GitHub in a new tab)</span></a>
        <button class="btn primary" data-act="reload">Reload game</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const status = overlay.querySelector<HTMLElement>(".crash-status")!;
  const downloadBtn = overlay.querySelector<HTMLButtonElement>('[data-act="download"]')!;
  downloadBtn.addEventListener("click", () => {
    // Disable while packing so a double-tap can't race two exports; re-enable
    // on failure so the player can retry.
    downloadBtn.disabled = true;
    status.textContent = "Packing crash report…";
    void (async () => {
      const details = buildCrashDetails(opts.getSim(), opts.crash, {
        version: opts.version,
        speed: opts.speed,
        frameErrors: opts.frameErrors,
      });
      const { filename, bytes } = await buildCrashReportZip(opts.getSim(), details);
      await getPlatform().saveFile(filename, bytes, "application/zip");
      status.textContent = "Crash report downloaded. Please attach the zip when you report the bug.";
      downloadBtn.disabled = false;
    })().catch((err) => {
      // Keep the diagnostic trail: this is the one feature whose whole point
      // is preserving evidence. The neutral wording covers both halves of the
      // pipeline (zip build and the platform file save).
      console.error("[crash-report] packing or saving failed:", err);
      status.textContent = "The crash report couldn't be saved. You can still reload; your tower's save state is described above.";
      downloadBtn.disabled = false;
    });
  });
  overlay.querySelector<HTMLButtonElement>('[data-act="reload"]')!.addEventListener("click", () => opts.onReload());
  // Move keyboard/screen-reader focus into the dialog (the canvas underneath
  // is dead); the primary action is the safe default.
  overlay.querySelector<HTMLButtonElement>('[data-act="reload"]')!.focus();
}
