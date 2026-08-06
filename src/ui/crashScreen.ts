import type { Simulation } from "../engine/Simulation";
import { getPlatform } from "../platform";
import { buildCrashDetails, buildCrashReportZip, bugReportUrl } from "../game/crashReport";
import type { CrashDescription, FrameErrorEntry } from "../game/crashReport";
import { escapeHtml } from "./escape";
import { routeExternalInWrapper } from "./externalLink";

/**
 * The full-screen crash card. Shown when the game can no longer draw (the GPU
 * dropped the WebGL context). It replaces the old silent autosave-and-reload:
 * the player learns what happened, can download a crash-report zip (crash
 * details plus their tower save), can open a prefilled bug report, and reloads
 * when THEY choose to. Plain DOM on purpose: the canvas is dead, and
 * everything here must work without it.
 *
 * It is a real dialog element opened with showModal(), not a z-indexed div:
 * a crash can land while another dialog (help, stats, an emergency) is open,
 * and only the top layer wins over an open dialog's backdrop. showModal also
 * brings true modality: focus is trapped inside, the page behind goes inert,
 * and assistive tech gets the alertdialog for free.
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
 *  defensive second call must not stack a second card. main.ts's key handler
 *  also checks this id to mute game shortcuts (undo could otherwise mutate
 *  the sim behind the card, after the flush the card just described). */
export const CRASH_SCREEN_ID = "crash-screen";

/** The one-sentence save-outcome line, best case first. */
function saveLineFor(save: CrashScreenOptions["save"]): string {
  if (save.behindSplash) return "No game was in progress; your saved towers are untouched.";
  if (save.flushed) return "Your tower was saved. Nothing is lost.";
  const priorNote = save.hadPriorSave ? " Your last saved tower is safe." : "";
  if (save.storageBlame) return "Your latest changes couldn't be saved: storage is full or blocked." + priorNote;
  return "Your latest changes couldn't be saved: the save hit an unexpected error." + priorNote;
}

export function showCrashScreen(opts: CrashScreenOptions): void {
  if (document.getElementById(CRASH_SCREEN_ID)) return;

  const saveLine = saveLineFor(opts.save);
  // Device-distress advice: shown for a rapid double crash AND for a first
  // loss whose in-place recovery failed or timed out (the GPU stayed wedged
  // for seconds, which is the same distress signal by another route).
  const repeatLine = opts.crash.repeat
    ? `<p><b>This is the second crash in a row.</b> Closing other tabs or apps before reloading may help.</p>`
    : opts.crash.recoveryFailed
      ? `<p><b>The game tried to restart its graphics and couldn't.</b> Closing other tabs or apps before reloading may help.</p>`
      : "";

  const dialog = document.createElement("dialog");
  dialog.id = CRASH_SCREEN_ID;
  dialog.className = "win crash-card";
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-labelledby", "crash-screen-title");
  dialog.innerHTML = `
      <h2 id="crash-screen-title" class="win-title">The game crashed</h2>
      <p>The graphics driver reset while the game was running. On phones and tablets this usually means the device ran out of graphics memory, often on a very large tower at the fastest speed.</p>
      <p>${escapeHtml(saveLine)}</p>
      ${repeatLine}
      <p>A crash report helps us fix this. It's a zip with the crash details and your tower save; nothing is sent anywhere until you attach it to a bug report yourself.</p>
      <p class="crash-status" aria-live="polite"></p>
      <div class="modal-actions">
        <button class="btn" data-act="download">Download crash report</button>
        <a class="btn" data-act="report" target="_blank" rel="noopener noreferrer" href="${escapeHtml(bugReportUrl({ version: opts.version, crash: opts.crash }))}">Report a bug<span class="visually-hidden"> (opens GitHub in a new tab)</span></a>
        <button class="btn primary" data-act="reload" autofocus>Reload game</button>
      </div>`;
  document.body.appendChild(dialog);
  // Escape must not dismiss the card: the game behind it cannot draw, so
  // closing would strand the player on a dead canvas with no controls.
  dialog.addEventListener("cancel", (e) => e.preventDefault());
  try {
    dialog.showModal();
  } catch {
    // A runtime without dialog support (or a dialog already-open edge) still
    // gets the card: it renders as a plain block; the CSS keeps it visible.
    dialog.setAttribute("open", "");
  }

  const status = dialog.querySelector<HTMLElement>(".crash-status")!;
  const downloadBtn = dialog.querySelector<HTMLButtonElement>('[data-act="download"]')!;
  downloadBtn.addEventListener("click", () => {
    // Disable while packing so a double-tap can't race two exports; re-enable
    // on failure so the player can retry.
    downloadBtn.disabled = true;
    status.textContent = "Packing crash report…";
    void (async () => {
      // One sim capture per click: the JSON summary and the packed save must
      // describe the same state even if the app swaps the instance meanwhile.
      const sim = opts.getSim();
      const details = buildCrashDetails(sim, opts.crash, {
        version: opts.version,
        speed: opts.speed,
        frameErrors: opts.frameErrors,
      });
      const { filename, bytes } = await buildCrashReportZip(sim, details);
      await getPlatform().saveFile(filename, bytes, "application/zip");
      // No "downloaded!" claim: a native wrapper's share sheet RESOLVES on
      // cancel too (the platform contract), so like the export flow this
      // points at the downloads folder instead of asserting success.
      status.textContent = "Crash report ready. Check your downloads, then attach the zip to your bug report.";
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
  dialog.querySelector<HTMLButtonElement>('[data-act="reload"]')!.addEventListener("click", () => opts.onReload());
  // Inside a native wrapper the bug-report link routes to the system browser
  // through the platform port (same treatment as the Help dialog's link).
  routeExternalInWrapper(dialog.querySelector<HTMLAnchorElement>('[data-act="report"]')!);
  // showModal honors the autofocus above; the explicit call covers the
  // no-dialog-support fallback so focus still lands in the card.
  dialog.querySelector<HTMLButtonElement>('[data-act="reload"]')!.focus();
}
