import { Simulation } from "../engine/Simulation";
import type { GameMode } from "../engine/types";
import type { CalendarKind } from "../engine/calendar";
import { SLOT_COUNT, SaveGame } from "../storage/SaveGame";
import { LegacyExportError, buildTDT } from "../storage/tdtExport";
import type { BuiltLegacyTower } from "../storage/tdtExport";
import { LegacyImportError, parseTDT } from "../storage/tdtImport";
import type { ImportReport } from "../storage/tdtImport";
import { shouldArm } from "../ui/Onboarding";
import type { UI } from "../ui/UI";

/**
 * Save/load/new-game flows for the game shell. Split out of the GameApp class
 * so the tower-swap contracts (a new/imported tower invalidates the undo
 * trail; a garbage import never reaches the sim) can be unit-tested without a
 * DOM game shell. Swapping the live simulation in — rewiring the engine,
 * selection, inspector and undo history — is the app spine's job, so adoptSim
 * stays in GameApp and arrives here as an injected callback.
 */
export interface SaveLoadDeps {
  /** The live simulation (never cached — adoptSim swaps the instance). */
  getSim(): Simulation;
  /** Swap in a freshly loaded/created simulation (GameApp owns the rewiring).
   *  Deliberately takes NO preserveHistory flag: every path here adopts a
   *  *different* tower, which must invalidate the undo trail — otherwise Undo
   *  could resurrect an unrelated old tower. Only GameApp's own undo/redo
   *  restore may preserve history, and it doesn't go through this module. */
  adoptSim(sim: Simulation): void;
  ui: Pick<UI, "toast" | "downloadFile" | "showImportReport" | "showExportReport">;
  /** Full-screen crash card (src/ui/crashScreen.ts, wired by main.ts with the
   *  app-side context: version, live sim, frame-error buffer). SaveLoad hands
   *  it only what it owns: the crash shape, the save outcome, and the reload
   *  action that stamps the recovery session flags. */
  showCrashScreen(info: {
    crash: { kind: "webgl-context-lost"; repeat: boolean; saveFlushed: boolean; behindSplash: boolean };
    save: { flushed: boolean; behindSplash: boolean; storageBlame: boolean; hadPriorSave: boolean };
    onReload: () => void;
  }): void;
  /** Arm first-run onboarding on the just-adopted sim. */
  armOnboarding(): void;
}

/**
 * sessionStorage key stamped right before the WebGL context-loss recovery
 * reload. The fresh boot reads (and clears) it to learn this reload was an
 * app-initiated recovery, so it drops the player straight back into their tower
 * (paused) instead of showing the title screen. Same idea as the update-resume
 * flag in main.ts. Kept SEPARATE from `vc-gl-lost-reload`, which must persist
 * across the boot to detect a rapid double crash; this one is consumed at boot
 * so a later manual reload still shows the splash.
 */
export const RESUME_AFTER_RECOVERY_KEY = "vc-resume-after-recovery";

export class SaveLoad {
  private autosaveRun: Promise<void> | null = null;
  private autosaveQueued = false;

  constructor(private readonly deps: SaveLoadDeps) {}

  save(silent = false): void {
    SaveGame.save(this.deps.getSim());
    if (!silent) this.deps.ui.toast("Tower saved.", "good");
  }

  autosave(): Promise<void> {
    if (this.autosaveRun) {
      this.autosaveQueued = true;
      return this.autosaveRun;
    }
    this.autosaveRun = this.drainAutosaves().finally(() => {
      this.autosaveRun = null;
    });
    return this.autosaveRun;
  }

  private async drainAutosaves(): Promise<void> {
    try {
      do {
        this.autosaveQueued = false;
        await SaveGame.saveAsync(this.deps.getSim());
      } while (this.autosaveQueued);
    } catch {
      /* periodic autosave is best effort and has no UI surface; manual and pre-reload saves still report errors */
    }
  }

  /**
   * Flush the tower to the autosave slot just before the app reloads onto a new
   * build (the "Update now" path). The player already chose to update via the
   * modal, so there's no toast here — the reload is imminent. Throws if the save
   * fails (e.g. localStorage quota); the caller must NOT reload on a throw, or a
   * failed save would cost the player their progress — the one thing this exists
   * to prevent.
   */
  saveBeforeUpdate(): void {
    // Same guard as the autosave timer and recoverFromContextLoss. The splash
    // shows on EVERY boot: for a first-timer the sim behind it is a throwaway
    // boot sim (persisting it would flip hasSave() true for a tower the player
    // never started); for a returning player it's their real tower, but the
    // splash pauses time and blocks all input, so in-memory state still equals
    // the autosave byte-for-byte — skipping the save loses nothing. That
    // invariant is load-bearing: never let anything mutate the sim while the
    // splash is up.
    if (document.getElementById("splash")) return;
    this.save(true);
  }

  /**
   * The WebGL context is gone and Excalibur can't rebuild its GPU resources in
   * place, so this session can no longer draw. Flush the tower to the autosave
   * slot, then show the crash screen: what happened, a crash-report zip
   * download, a bug-report link, and a Reload button. The reload is the
   * player's choice (no more silent auto-reload, which erased every trace of
   * the crash); their reload stamps the recovery flag so the fresh boot drops
   * them straight back into the tower.
   */
  recoverFromContextLoss(): void {
    // Same guard as the autosave timer: never persist the throwaway boot sim
    // while the first-run splash is still up. The splash also means there is
    // nothing to flush (it pauses the sim), so "flushed" stays honest.
    let flushed = true;
    let storageBlame = false;
    let hadPriorSave = false;
    // Behind the splash nothing needed flushing, but "your tower was saved"
    // would be a false claim (a first-timer has no tower at all), so the screen
    // words that case separately.
    const behindSplash = !!document.getElementById("splash");
    if (!behindSplash) {
      try {
        this.save(true);
      } catch (err) {
        // The pre-crash flush failed. Left unhandled this throw would escape
        // the onContextLost handler and skip the crash screen, stranding the
        // player on a dead GPU canvas with no explanation. A failed setItem is
        // atomic (it never clobbers), so any prior autosave is intact, but we
        // must not promise "your tower was saved" either; the screen words the
        // failure. Only promise the prior tower is safe when one actually
        // exists: a first-session crash before any autosave has none to
        // reassure about. hasSave() READS localStorage, which itself throws
        // when storage is *disabled* (a SecurityError) rather than merely full,
        // so guard it in its own try/catch.
        flushed = false;
        try {
          hadPriorSave = SaveGame.hasSave();
        } catch {
          /* storage is unreadable too — just omit the reassurance */
        }
        // Only blame storage for an actual storage failure — quota full,
        // private-mode, or disabled. A serialize/stringify/compression bug
        // throws here too, and "free up space" would send the player down the
        // wrong path; those get the neutral wording.
        storageBlame =
          err instanceof DOMException &&
          (err.name === "QuotaExceededError" ||
            err.name === "SecurityError" ||
            err.name === "NS_ERROR_DOM_QUOTA_REACHED"); // Firefox's quota name
      }
    }

    // A second loss within 90 seconds of the last recovery reload means
    // reloading alone isn't fixing it; the screen adds advice to close other
    // tabs/apps. (The timestamp is stamped by the reload action below.)
    const KEY = "vc-gl-lost-reload";
    let lastReload = 0;
    try {
      lastReload = Number(sessionStorage.getItem(KEY)) || 0;
    } catch {
      /* storage may be unavailable; treat as first loss */
    }
    const repeat = Date.now() - lastReload < 90_000;

    this.deps.showCrashScreen({
      crash: { kind: "webgl-context-lost", repeat, saveFlushed: flushed, behindSplash },
      save: { flushed, behindSplash, storageBlame, hadPriorSave },
      onReload: () => {
        try {
          const now = String(Date.now());
          sessionStorage.setItem(KEY, now);
          // Tell the fresh boot this reload was a recovery, so it resumes the
          // tower rather than showing the title screen (see resolveBootScreen
          // in src/bootScreen.ts, consumed by the boot branch in main.ts).
          sessionStorage.setItem(RESUME_AFTER_RECOVERY_KEY, now);
        } catch {
          /* best effort */
        }
        location.reload();
      },
    });
  }

  load(): void {
    const loaded = SaveGame.load();
    if (loaded) {
      this.deps.adoptSim(loaded);
      this.deps.ui.toast("Tower loaded.", "good");
    } else {
      this.deps.ui.toast("No saved tower found.", "bad");
    }
  }

  /** Hand the player their tower as a compressed .vctower file download.
   *  Only ever called from the export confirm dialog — the tower is not
   *  serialized or packed until the player has actually clicked Export. */
  async exportGame(): Promise<void> {
    try {
      const sim = this.deps.getSim();
      const file = await SaveGame.export(sim);
      this.deps.ui.downloadFile(SaveGame.exportFilename(sim), file);
      // The container is pure ASCII, so string length == bytes on disk.
      this.deps.ui.toast(`Tower exported (${(file.length / 1024).toFixed(1)} KB). Check your downloads.`, "good");
    } catch (err) {
      // Never fail silently: main.ts fires this with `void`, so an unhandled
      // rejection here would leave the player with no download and no feedback.
      this.deps.ui.toast("Export failed: " + (err as Error).message, "bad");
    }
  }

  /**
   * Export the live tower as an original 1994 SimTower save (`.TDT`). Same
   * two-step contract as the .vctower path: the reverse fidelity modal shows
   * what does and does not survive the trip back to 1994, and nothing is
   * downloaded until the player clicks the primary. Modern-mode towers are
   * refused outright (the 1994 rule set cannot represent them).
   */
  exportLegacy(): void {
    let built: BuiltLegacyTower;
    try {
      built = buildTDT(this.deps.getSim().serialize());
    } catch (err) {
      const msg =
        err instanceof LegacyExportError
          ? err.message
          : "Export failed: " + (err instanceof Error ? err.message : String(err));
      this.deps.ui.toast(msg, "bad");
      return;
    }
    this.deps.ui.showExportReport(built.report, {
      onDownload: () => this.deps.ui.downloadFile(built.report.filename, built.bytes),
    });
  }

  async importGame(data: string): Promise<void> {
    try {
      this.deps.adoptSim(await SaveGame.import(data));
      this.deps.ui.toast("Tower imported.", "good");
    } catch (err) {
      this.deps.ui.toast("Import failed: " + (err as Error).message, "bad");
    }
  }

  /**
   * Import an original 1994 SimTower save (`.TDT`). Parse and validate FIRST
   * (through both the binary walker's hardening and `Simulation.deserialize`'s
   * trust-boundary coercion), then show the fidelity report; nothing is
   * adopted or persisted until the player confirms with "Open tower". A
   * garbage file never reaches the sim, the same contract as importGame.
   */
  importLegacy(buffer: ArrayBuffer, filename: string): void {
    let sim: Simulation;
    let report: ImportReport;
    try {
      const parsed = parseTDT(buffer, filename);
      // Deliberate second hardening layer: the importer's output goes through
      // the exact trust boundary every other save does.
      sim = Simulation.deserialize(parsed.save);
      report = parsed.report;
    } catch (err) {
      // LegacyImportError messages are already player-readable; anything else
      // (a deserialize trust-boundary refusal, an importer bug) keeps the
      // plain lead but carries the underlying detail, matching importGame's
      // "Import failed: <message>" diagnosability.
      const detail = err instanceof Error && err.message ? ` (${err.message})` : "";
      const msg =
        err instanceof LegacyImportError
          ? err.message
          : `This SimTower save couldn't be read.${detail}`;
      this.deps.ui.toast(msg, "bad");
      return;
    }
    this.deps.ui.showImportReport(report, {
      onOpen: () => {
        // Flush the CURRENT tower to the autosave slot first (same splash
        // guard as every other flush), so adopting the import can't cost the
        // player their in-progress tower even if they never saved manually.
        // A failure must not block the adoption the player just asked for,
        // but it must be SAID: the report modal promised the autosave.
        let flushFailed = false;
        try {
          this.saveBeforeUpdate();
        } catch {
          flushFailed = true;
        }
        this.deps.adoptSim(sim);
        // Auto-save the IMPORTED tower to a fresh slot so a bad import can't
        // clobber anything and the player can always get back to it. "Fresh"
        // is a RAW presence check (hasSlot), never the parse-based
        // listSlots().exists: a corrupt-but-present slot may still be
        // recoverable by a later build and must not be an overwrite target.
        let savedTo: number | null = null;
        let slotWriteFailed = false;
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
        // "info" keeps this bulletin log-only: renderLog also toasts "good"
        // entries, and the explicit success toast below already covers that.
        this.deps
          .getSim()
          .emit(`Imported from SimTower (1994): welcome back to ${sim.tower.towerName}.`, "info");
        // Honest feedback: distinguish "no free slot" from "the write failed".
        if (slotWriteFailed) {
          this.deps.ui.toast(
            "Tower imported, but the slot copy failed (storage is full or blocked). Export it to a file soon.",
            "bad",
          );
        } else {
          this.deps.ui.toast(
            savedTo !== null
              ? `Tower imported and saved to slot ${savedTo}.`
              : "Tower imported. All save slots are full, so save it yourself soon.",
            "good",
          );
        }
        if (flushFailed) {
          this.deps.ui.toast(
            "Your previous tower couldn't be backed up to the autosave (storage is full or blocked).",
            "bad",
          );
        }
      },
    });
  }

  /** Found a fresh tower under the chosen rule-set. The mode (and, for Modern,
   *  the calendar choice) is baked into the new Simulation at creation and is
   *  immutable for that tower's life. Classic always runs the canon calendar, so
   *  `modernCalendar` is only consulted for Modern. */
  newGame(mode: GameMode = "classic", modernCalendar: CalendarKind = "realWorld"): void {
    this.deps.adoptSim(Simulation.newGame(Date.now() & 0x7fffffff, mode, modernCalendar));
    this.deps.ui.toast(
      mode === "modern" ? "New Modern tower founded. Good luck!" : "New tower founded. Good luck!",
      "good",
    );
    // Auto-arm onboarding only for a genuine first-timer. A returning player (a
    // save exists) is treated as already onboarded even if the localStorage flag
    // was cleared, so they're never re-onboarded unexpectedly (Replay via Help
    // still re-arms explicitly).
    if (shouldArm(true) && !SaveGame.hasSave()) this.deps.armOnboarding();
  }
}
