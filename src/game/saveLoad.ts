import { Simulation } from "../engine/Simulation";
import type { GameMode, SerializedView } from "../engine/types";
import type { CalendarKind } from "../engine/calendar";
import { SLOT_COUNT, SaveGame, isStorageWriteError, saveFailureMessage } from "../storage/SaveGame";
import { LegacyExportError, buildTDT } from "../storage/tdtExport";
import type { BuiltLegacyTower } from "../storage/tdtExport";
import { LegacyImportError, parseTDT } from "../storage/tdtImport";
import type { ImportReport } from "../storage/tdtImport";
import { shouldArm } from "../ui/Onboarding";
import { gameplaySession } from "../analytics";
import { isCrashed, isSplashUp } from "./interactionState";
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
  /** The live camera as save cargo (GameApp reads TowerEngine.viewState).
   *  Stamped onto the sim right before every save/export of the CURRENT
   *  tower so the view travels with it; an imported sim keeps the view its
   *  own file carried, so its writes are never stamped. Null when no camera
   *  exists (headless tests); a null stamp never ERASES a view the sim
   *  already carries (see stampView). */
  getView(): SerializedView | null;
  /** Swap in a freshly loaded/created simulation (GameApp owns the rewiring).
   *  Deliberately takes NO preserveHistory flag: every path here adopts a
   *  *different* tower, which must invalidate the undo trail — otherwise Undo
   *  could resurrect an unrelated old tower. Only GameApp's own undo/redo
   *  restore may preserve history, and it doesn't go through this module. */
  adoptSim(sim: Simulation): void;
  ui: Pick<UI, "toast" | "sayVisibly" | "downloadFile" | "showImportReport" | "showExportReport">;
  /** Full-screen crash card (src/ui/crashScreen.ts, wired by main.ts with the
   *  app-side context: version, live sim, frame-error buffer). SaveLoad hands
   *  it only what it owns: the crash shape, the save outcome, and the reload
   *  action that stamps the recovery session flags. */
  showCrashScreen(info: {
    crash: {
      kind: "webgl-context-lost";
      repeat: boolean;
      saveFlushed: boolean;
      behindSplash: boolean;
      recoveryFailed: boolean;
    };
    save: { flushed: boolean; behindSplash: boolean; storageBlame: boolean; hadPriorSave: boolean };
    onReload: () => void;
  }): void;
  /** Try to rebuild the renderer in place after a context loss (GameApp waits
   *  for the browser's restored signal, then swaps in a fresh engine; see
   *  src/game/contextRecovery.ts). Reports exactly one outcome: `true` when
   *  the fresh engine is running, `false` on failure or timeout. */
  attemptGraphicsRecovery(done: (recovered: boolean) => void): void;
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

/**
 * sessionStorage key holding the time of the last context loss (or recovery
 * completion, or recovery reload). Two losses inside 90s of each other read
 * as a "repeat": the device is genuinely struggling, and the crash screen's
 * advice matters more than a silent recovery would.
 */
const GL_LOSS_STAMP_KEY = "vc-gl-lost-reload";

export class SaveLoad {
  private autosaveRun: Promise<void> | null = null;
  private autosaveQueued = false;
  /** In-memory shadow of {@link GL_LOSS_STAMP_KEY}, so the repeat guard still
   *  trips when sessionStorage is unavailable (otherwise a flapping GPU would
   *  loop flush, toast, and rebuild forever without ever reaching the crash
   *  screen's advice). */
  private lastLossAt = 0;

  constructor(private readonly deps: SaveLoadDeps) {}

  /** Record a context-loss event time in both stores (see lastLossAt). */
  private stampLoss(at: number): void {
    this.lastLossAt = at;
    try {
      sessionStorage.setItem(GL_LOSS_STAMP_KEY, String(at));
    } catch {
      /* best effort; the in-memory shadow still counts */
    }
  }

  /** Stamp the live camera onto the sim before a save/export. A null camera
   *  (headless context) stamps nothing rather than null, so it can never
   *  erase a view the sim already carries (e.g. one a TDT import brought
   *  over before any camera existed). */
  private stampView(sim: Simulation): void {
    const view = this.deps.getView();
    if (view) sim.view = view;
  }

  save(silent = false): void {
    const sim = this.deps.getSim();
    try {
      // Stamp inside the try: a disposed or context-lost engine can throw
      // from viewState() too, and the manual path's no-escaped-throw contract
      // must cover it (saveToSlot makes the same call the same way). Silent
      // callers see no change: they caught a stampView throw before this
      // reorder too, via the rethrow below.
      this.stampView(sim);
      SaveGame.save(sim);
    } catch (err) {
      // Silent callers rely on the THROW: saveBeforeUpdate's caller must not
      // reload on a failed write, recoverFromContextLoss words the failure on
      // the crash screen, and the autosave drain treats it as best-effort.
      // Each owns its own failure surface, so the silent path never toasts.
      if (silent) throw err;
      // A manual Quick Save must never fail silently: without this catch the
      // throw escapes the button handler as an uncaught error, the player
      // gets no feedback at all, and believes the tower saved. A failed
      // setItem is atomic (it never clobbers), so any prior save is intact.
      this.deps.ui.toast(saveFailureMessage(err), "bad");
      return;
    }
    if (silent) return;
    // Confirm the manual save landed, and when: a checkmark plus the
    // wall-clock time it was written (real time, not the in-sim clock), so a
    // deliberate or accidental Quick Save is always visibly acknowledged.
    const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    this.deps.ui.toast(`Saved ✓ · ${at}`, "good");
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
        const sim = this.deps.getSim();
        // Re-stamp per iteration: the camera may have moved while the
        // previous async compression was in flight.
        this.stampView(sim);
        await SaveGame.saveAsync(sim);
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
    if (isSplashUp()) return;
    this.save(true);
  }

  /**
   * The WebGL context is gone: the running Excalibur engine can't rebuild its
   * GPU resources, so nothing draws until a fresh engine exists. Flush the
   * tower to the autosave slot first, then pick the recovery path:
   *
   * - First mid-game loss with a clean flush: recover IN PLACE. The sim is
   *   intact in memory and every graphic is code-generated, so GameApp can
   *   swap in a fresh engine the moment the browser restores the context.
   *   Mobile systems reset GL contexts routinely (memory pressure elsewhere,
   *   GPU process restarts, backgrounding); a one-off reset should cost the
   *   player a moment of stillness and nothing more.
   * - Repeat loss (within 90s), a loss behind the splash, a failed flush, or
   *   a failed/timed-out recovery: the full crash screen. It says what
   *   happened and whether the tower was saved, offers the crash-report zip
   *   and a prefilled bug-report link, and reloads only when the player
   *   chooses; their reload stamps the recovery flag so the fresh boot drops
   *   them straight back into the tower.
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
    const behindSplash = isSplashUp();
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
        storageBlame = isStorageWriteError(err);
      }
    }

    // A second loss within 90 seconds of the previous one (or of the last
    // recovery reload) means recovering alone isn't fixing it; the screen adds
    // advice to close other tabs/apps. Every loss stamps the window, on every
    // path, so an in-place recovery cycle counts toward it too.
    let lastLoss = this.lastLossAt;
    try {
      lastLoss = Math.max(lastLoss, Number(sessionStorage.getItem(GL_LOSS_STAMP_KEY)) || 0);
    } catch {
      /* storage may be unavailable; the in-memory shadow still applies */
    }
    const now = Date.now();
    const repeat = now - lastLoss < 90_000;
    this.stampLoss(now);

    const showScreen = (recoveryFailed: boolean): void =>
      this.deps.showCrashScreen({
        crash: { kind: "webgl-context-lost", repeat, saveFlushed: flushed, behindSplash, recoveryFailed },
        save: { flushed, behindSplash, storageBlame, hadPriorSave },
        onReload: () => {
          this.stampLoss(Date.now());
          try {
            // Tell the fresh boot this reload was a recovery, so it resumes the
            // tower rather than showing the title screen (see resolveBootScreen
            // in src/bootScreen.ts, consumed by the boot branch in main.ts).
            sessionStorage.setItem(RESUME_AFTER_RECOVERY_KEY, String(Date.now()));
          } catch {
            /* best effort */
          }
          location.reload();
        },
      });

    // In-place recovery is reserved for the healthy one-off case: a first
    // mid-game loss whose flush succeeded. A repeat says the device is
    // genuinely struggling (the screen's advice matters more than seamlessness
    // would); behind the splash there is no session to preserve; and a failed
    // flush is storage news the player must see, on the screen that words it.
    if (repeat || behindSplash || !flushed) {
      showScreen(false);
      return;
    }
    // Captured so a tower swap during the wait (Load/New stay reachable) is
    // detectable at completion: the "your tower was saved" trace belongs to
    // THIS tower, and must not land in a different one's bulletin log.
    const simAtLoss = this.deps.getSim();
    this.deps.ui.toast("The device reset the game's graphics. Recovering...", "info");
    this.deps.attemptGraphicsRecovery((recovered) => {
      // Re-anchor the repeat window at the attempt's END too: a background
      // eviction can restore minutes after the loss, and a fresh loss soon
      // after play resumes must still read as a repeat.
      this.stampLoss(Date.now());
      if (!recovered) {
        showScreen(true);
        return;
      }
      // A parallel loss may have already put the crash screen up (a flapping
      // GPU); the screen owns the session then, so stay quiet rather than
      // contradict it with a success toast.
      if (isCrashed()) return;
      if (this.deps.getSim() === simAtLoss) {
        // Leave a durable trace in the bulletin log (the old silent reload
        // erased all evidence; recovering must not repeat that mistake).
        simAtLoss.emit(
          "The device reset the game's graphics; the game recovered on the spot. Your tower was saved first.",
          "info",
        );
        this.deps.ui.toast("Graphics recovered. Your tower was saved.", "good");
      } else {
        // The player swapped towers during the wait; the saved-tower claim
        // would be about the previous one, so keep the toast to the facts.
        this.deps.ui.toast("Graphics recovered.", "good");
      }
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
      this.stampView(sim);
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
      const sim = this.deps.getSim();
      this.stampView(sim);
      built = buildTDT(sim.serialize());
    } catch (err) {
      const msg =
        err instanceof LegacyExportError
          ? err.message
          : "Export failed: " + (err instanceof Error ? err.message : String(err));
      this.deps.ui.sayVisibly(msg); // not a toast: a dialog may be up (GH #658)
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
      this.deps.ui.sayVisibly("Import failed: " + (err as Error).message);
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

  /** Found a fresh tower under the chosen rule-set. The mode, and for Modern the
   *  calendar choice and the no-bridging option, are baked into the new
   *  Simulation at creation and immutable for that tower's life. Classic always
   *  runs the canon calendar and auto structure, so `modernCalendar` and
   *  `startUnbridged` is only consulted for Modern. */
  newGame(mode: GameMode = "classic", modernCalendar: CalendarKind = "realWorld", startUnbridged = false): void {
    this.deps.adoptSim(Simulation.newGame(Date.now() & 0x7fffffff, mode, modernCalendar, startUnbridged));
    gameplaySession.noteNewGame(mode); // funnel entry: a fresh tower was founded
    // Both rule-sets found an empty lot now, so the toast is the actionable
    // first-lobby cue (the engine's welcome log entry is rebased past by the UI
    // cursor, so the toast is the one visible signal). Keyed on tower state,
    // never on the mode string, so it stays correct if founding ever seeds again.
    const founded = this.deps.getSim();
    this.deps.ui.toast(
      founded.tower.units.length === 0
        ? "New tower founded. Lay a lobby on the ground line to open it."
        : "New tower founded. Good luck!",
      "good",
    );
    // Auto-arm onboarding only for a genuine first-timer. A returning player (a
    // save exists) is treated as already onboarded even if the localStorage flag
    // was cleared, so they're never re-onboarded unexpectedly (Replay via Help
    // still re-arms explicitly).
    if (shouldArm(true) && !SaveGame.hasSave()) this.deps.armOnboarding();
  }
}
