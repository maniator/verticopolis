import { settleEngine } from "../wasmhost/stepGate";
import { Simulation } from "../engine/Simulation";
import type { GameMode, SerializedView } from "../engine/types";
import type { CalendarKind } from "../engine/calendar";
import { SaveGame, isStorageWriteError, saveFailureMessage } from "../storage/SaveGame";
import { exportReport, type ExportReport } from "../storage/tdtExportReport";
import { importReport } from "../storage/tdtImportReport";
import { runExportFlow, runLegacyDownload } from "./exportFlow";
import { adoptConfirmedLegacyImport } from "./legacyImportAdopt";
import { shouldArm } from "../ui/Onboarding";
import type { EnginePort } from "../simport/enginePort";
import type { PortCodes } from "../simport/portCodes";
import type { ViewReader } from "../simport/viewReader";
import { loadStored, saveText, stampCamera, swapDone } from "./portLifecycle";
import { exportFacts, importFacts } from "../simport/tdtRecords";
import { isCrashed, isEngineStopped, isSplashUp } from "./interactionState";
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
  /** The live simulation (never cached — adoptSim swaps the instance), for
   *  the file flows and the background hosts' settle that have not moved to
   *  the engine port yet. */
  getSim(): Simulation;
  /** The engine port the saves, loads and new towers go through; a done swap
   *  reaches the app's adoptSim inside the call. */
  enginePort(): EnginePort;
  /** The layout's code tables, for the port's mode, calendar and log codes. */
  portCodes(): PortCodes;
  /** The shared reader, current as of the last swap. */
  reader(): Pick<ViewReader, "rooms" | "structure">;
  /** A tower arrived through the port (load or found): break the report
   *  dialogs' leash, as `adoptSim` does for the file imports. */
  towerSwapped(): void;
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

  /** The live tower's save text through the port, the camera stamped first. */
  private saveText(): string {
    return saveText(this.deps.enginePort(), this.deps.getView());
  }

  save(silent = false): void {
    try {
      // Stamp inside the try: a disposed or context-lost engine can throw
      // from viewState() too, and the manual path's no-escaped-throw contract
      // must cover it (saveToSlot makes the same call the same way). Silent
      // callers see no change: they caught a stampView throw before this
      // reorder too, via the rethrow below.
      SaveGame.save(this.saveText());
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
        const tower = this.deps.enginePort().generation();
        // Re-stamp per iteration: the camera may have moved while the
        // previous async compression was in flight.
        // The experimental worker host answers `serialize` from the engine
        // only once its read model has caught up; wait for that here, where
        // waiting costs nothing (no-op on every other engine). The camera is
        // stamped after the wait, so the save carries where it is now.
        await settleEngine(this.deps.getSim());
        // A tower adopted during the wait is not the one to write: go round
        // again with the tower the app holds now.
        if (this.deps.enginePort().generation() !== tower) {
          this.autosaveQueued = true;
          continue;
        }
        await SaveGame.saveAsync(this.saveText());
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
    // A wasm-only build that stopped on its engine already owns the session:
    // no engine holds the tower, so nothing may be flushed over the save the
    // engine-failure message points back to, and a reload is the way out.
    if (isEngineStopped()) return;
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
    const towerAtLoss = this.deps.enginePort().generation();
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
      const port = this.deps.enginePort();
      if (port.generation() === towerAtLoss) {
        // Leave a durable trace in the bulletin log (the old silent reload
        // erased all evidence; recovering must not repeat that mistake).
        port.logLine(
          "The device reset the game's graphics; the game recovered on the spot. Your tower was saved first.",
          this.deps.portCodes().code("logKinds", "info"),
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
    if (SaveGame.load(loadStored(this.deps.enginePort()))) {
      this.deps.towerSwapped();
      this.deps.ui.toast("Tower loaded.", "good");
    } else {
      this.deps.ui.toast("No saved tower found.", "bad");
    }
  }

  /** Hand the player their tower as a compressed .vctower file download.
   *  Only ever called from the export confirm dialog — the tower is not
   *  serialized or packed until the player has actually clicked Export. The
   *  flow body (stored-byte vs live path, plus the single-flight latch and
   *  its watchdog, GH #760) lives in ./exportFlow, split out at the 500-line
   *  guard; delegating keeps the latch on the one choke point every export
   *  entry converges on. */
  exportGame(): Promise<void> {
    return runExportFlow(this.deps, () => ({ text: this.saveText(), towerName: this.deps.enginePort().towerName() }));
  }

  /**
   * Export the live tower as an original 1994 SimTower save (`.TDT`). Same
   * two-step contract as the .vctower path: the reverse fidelity modal shows
   * what does and does not survive the trip back to 1994, and nothing is
   * downloaded until the player clicks the primary. Modern-mode towers are
   * refused outright (the 1994 rule set cannot represent them).
   */
  exportLegacy(): void {
    const port = this.deps.enginePort();
    let bytes: Uint8Array | undefined;
    let report: ExportReport;
    try {
      // A null camera (headless) stamps nothing, so it never erases the view
      // a TDT import brought over before any camera existed.
      stampCamera(port, this.deps.getView());
      const rec = port.tdtExport();
      bytes = rec[0] === 1 ? port.tdtFile() : undefined;
      if (!bytes) {
        // The engine's refusal is the player's sentence (a Modern tower, a
        // tower too deep for 1994).
        this.deps.ui.sayVisibly(port.lastReason() ?? "Export failed."); // not a toast: a dialog may be up (GH #658)
        return;
      }
      report = exportReport(exportFacts(rec, this.deps.portCodes(), port.towerName()));
    } catch (err) {
      this.deps.ui.sayVisibly("Export failed: " + (err instanceof Error ? err.message : String(err)));
      return;
    }
    const file = bytes;
    this.deps.ui.showExportReport(report, {
      // Through the shared export latch (GH #760 follow-on), so a .TDT download
      // and a .vctower export can never run at once.
      onDownload: () =>
        void runLegacyDownload(this.deps.ui, () => {
          this.deps.ui.downloadFile(report.filename, file);
        }),
    });
  }

  async importGame(data: string): Promise<void> {
    try {
      // SaveGame holds the file to its checks and copy; the engine loads it
      // (the `stored` source, with the founder rule) and the app follows.
      const text = await SaveGame.importText(data);
      const port = this.deps.enginePort();
      swapDone(port, port.loadSave(text));
      this.deps.towerSwapped();
      this.deps.ui.toast("Tower imported.", "good");
    } catch (err) {
      this.deps.ui.sayVisibly("Import failed: " + (err as Error).message);
    }
  }

  /**
   * Import an original 1994 SimTower save (`.TDT`). The engine reads and
   * checks it first (the binary walker's hardening, then the trust boundary
   * every save goes through) and stages it; the fidelity report comes from
   * its record. Nothing is adopted or persisted until the player confirms
   * with "Open tower". A garbage file never reaches the tower, the same
   * contract as importGame.
   */
  importLegacy(buffer: ArrayBuffer, filename: string): void {
    const port = this.deps.enginePort();
    const bytes = new Uint8Array(buffer);
    const rec = port.loadTdt(bytes, filename);
    if (rec[0] !== 1) {
      // The refusal is already player-readable: the importer's own sentence,
      // or "This SimTower save couldn't be read." with the detail.
      this.deps.ui.toast(port.lastReason() ?? "This SimTower save couldn't be read.", "bad");
      return;
    }
    const report = importReport(importFacts(rec, this.deps.portCodes(), port));
    this.deps.ui.showImportReport(report, {
      // The confirmed-adoption flow (flush, adopt, fresh-slot copy, honest
      // toasts) lives in ./legacyImportAdopt, split out at the 500-line guard.
      // The flush stays a bound thunk so its throw contract is owned here.
      // The engine stages one file at a time, so the confirmation stages its
      // own file again: a second read finished meanwhile cannot swap in.
      onOpen: () =>
        adoptConfirmedLegacyImport(this.deps, report.towerName, () => this.saveBeforeUpdate(), () => port.loadTdt(bytes, filename)),
    });
  }

  /** Found a fresh tower under the chosen rule-set. The mode, and for Modern the
   *  calendar choice and the no-bridging option, are baked into the new
   *  Simulation at creation and immutable for that tower's life. Classic always
   *  runs the canon calendar and auto structure, so `modernCalendar` and
   *  `startUnbridged` is only consulted for Modern. */
  newGame(mode: GameMode = "classic", modernCalendar: CalendarKind = "realWorld", startUnbridged = false): void {
    const port = this.deps.enginePort();
    const codes = this.deps.portCodes();
    swapDone(port, port.foundTower(Date.now() & 0x7fffffff, codes.code("modes", mode), codes.code("calendars", modernCalendar), startUnbridged));
    this.deps.towerSwapped();
    // Both rule-sets found an empty lot now, so the toast is the actionable
    // first-lobby cue (the engine's welcome log entry is rebased past by the UI
    // cursor, so the toast is the one visible signal). Keyed on tower state,
    // never on the mode string, so it stays correct if founding ever seeds again.
    const founded = this.deps.reader();
    this.deps.ui.toast(
      founded.rooms.length === 0 && founded.structure.length === 0
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
