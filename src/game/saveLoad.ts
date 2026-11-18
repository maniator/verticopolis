import type { GameMode, SerializedView } from "../shared/types";
import type { CalendarKind } from "../shared/engineTypes";
import { SaveGame } from "../storage/SaveGame";
import { isStorageWriteError } from "../storage/saveFailureCopy";
import { SaveFailureNotice, type SaveWarningSurface } from "./saveFailureNotice";
import { headerNow, refusalCode, trackAppAction, trackAppActionOnce, trackFileExported, trackFileFailure, trackFileImported, trackTdtImportRead, type FileFailureCode } from "../analytics";
import { exportReport, type ExportReport } from "../storage/tdtExportReport";
import { importReport } from "../storage/tdtImportReport";
import { runExportFlow, runLegacyDownload } from "./exportFlow";
import { adoptConfirmedLegacyImport } from "./legacyImportAdopt";
import { shouldArm } from "../ui/Onboarding";
import type { EnginePort, PortRecord } from "../simport/enginePort";
import type { PortCodes } from "../simport/portCodes";
import type { ViewReader } from "../simport/viewReader";
import { NEWER_SAVE_REFUSAL, SWAP_REFUSED, exportFile, loadStored, newerSaveRefused, saveBytes, saveText, stampCamera, swapDone } from "./portLifecycle";
import { currentStamp } from "../storage/saveStamp";
import { exportFacts, importFacts } from "../simport/tdtRecords";
import { isCrashed, isEngineStopped, isSplashUp } from "./interactionState";
import type { UI } from "../ui/UI";
import type { SwapKind } from "./keepOutgoing";

/**
 * Save/load/new-game flows for the game shell. Split out of the GameApp class
 * so the tower-swap contracts (a new/imported tower invalidates the undo
 * trail; a garbage import never reaches the sim) can be unit-tested without a
 * DOM game shell. Following a swapped-in tower (rewiring the renderer,
 * selection, inspector and undo history) is the app spine's job, so it
 * arrives here as the injected `towerSwapped`.
 */
export interface SaveLoadDeps {
  /** The engine port the saves, loads and new towers go through. */
  enginePort(): EnginePort;
  /** The layout's code tables, for the port's mode, calendar and log codes. */
  portCodes(): PortCodes;
  /** The shared reader, current as of the last swap. */
  reader(): Pick<ViewReader, "rooms" | "structure" | "header">;
  /** A tower arrived through the port (a load, a new tower, an import): the
   *  app follows it and breaks the report dialogs' leash. Every path here
   *  brings a *different* tower, so the undo trail goes too; only the app's
   *  own undo and redo keep it, and they do not come through here. */
  towerSwapped(): void;
  /** Right before a swap of that kind, while the engine still holds the tower
   *  being left (`keepOutgoing.ts`); `refused` forgets it when none swapped. */
  beforeSwap?(kind: SwapKind): void;
  swapRefused?(): void;
  /** The Auto-save (the crash copy) now holds tower `generation`, written
   *  with stamp `savedAt`; `packed` is the raw DEFLATE an autosave wrote, null
   *  for a synchronous save (`towerDocument.ts`). Never throws. */
  crashCopy?(generation: number, savedAt: number, packed: Uint8Array | null): void;
  /** The live camera as save cargo (GameApp reads TowerEngine.viewState).
   *  Stamped onto the sim right before every save/export of the CURRENT
   *  tower so the view travels with it; an imported sim keeps the view its
   *  own file carried, so its writes are never stamped. Null when no camera
   *  exists (headless tests); a null stamp never ERASES a view the sim
   *  already carries (see stampView). */
  getView(): SerializedView | null;
  ui: Pick<UI, "toast" | "sayVisibly" | "downloadFile" | "showImportReport" | "showExportReport">;
  /** The notice that stays up while saving fails (src/ui/saveWarning.ts); absent in headless tests. */
  saveWarning?: SaveWarningSurface;
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
  /** Show the card that holds the page during recovery; returns its closer (#321).
   *  `behindSplash` words it for the title screen, where no tower is in play. */
  showRecoveryWait(behindSplash: boolean): () => void;
  /** Arm first-run onboarding on the just-adopted sim. */
  armOnboarding(): void;
}

/**
 * sessionStorage key stamped right before the WebGL context-loss recovery
 * reload: the fresh boot reads and clears it, and drops the player straight
 * back into their tower (paused). Kept apart from `vc-gl-lost-reload`, which
 * persists across the boot to detect a rapid double crash.
 */
export const RESUME_AFTER_RECOVERY_KEY = "vc-resume-after-recovery";

/** sessionStorage key holding the time of the last context loss (or
 *  recovery). Two losses inside 90s read as a "repeat": the crash screen's
 *  advice matters more than a silent recovery then. */
const GL_LOSS_STAMP_KEY = "vc-gl-lost-reload";

export class SaveLoad {
  private autosaveRun: Promise<void> | null = null;
  private autosaveQueued = false;
  private autosaveNext: "timer" | "swap" = "timer"; // the next save's source (#1631)
  /** What the player hears about failed saves; public so the slot saves use it too. */
  readonly notice = new SaveFailureNotice(() => this.deps);
  /** In-memory shadow of {@link GL_LOSS_STAMP_KEY}, so the repeat guard still
   *  trips when sessionStorage is unavailable. */
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

  /** Tell `crashCopy` the Auto-save holds the live tower now; it never fails a save. */
  private wroteCrashCopy(generation: () => number, savedAt: number, packed: Uint8Array | null): void {
    try {
      this.deps.crashCopy?.(generation(), savedAt, packed);
    } catch {
      /* the file follows on the next autosave */
    }
  }

  save(silent = false): void {
    try {
      // Stamp inside the try: a disposed or context-lost engine can throw from
      // viewState() too, and the no-escaped-throw contract must cover it.
      const { savedAt } = SaveGame.save(this.saveText());
      this.wroteCrashCopy(() => this.deps.enginePort().generation(), savedAt, null);
    } catch (err) {
      // Silent callers rely on the THROW and own their failure surface (no
      // reload on a failed write before an update, the crash screen's words,
      // a best-effort flush), so the silent path never toasts.
      if (silent) {
        // Reported as a background `timer` failure (the pre-update, context-loss
        // and TDT adoption flushes land here). Telemetry must never replace the
        // save error: recoverFromContextLoss reads whether it was storage's.
        try {
          trackAppActionOnce("autosave_failed", "timer");
        } catch {
          /* reporting is best effort here */
        }
        throw err;
      }
      // A manual Quick Save must never fail silently (the player would believe
      // it saved). A failed write is atomic, so any prior save is intact.
      this.notice.manualFailed(err);
      return;
    }
    this.notice.worked();
    if (silent) return;
    // Acknowledge every Quick Save with the real wall-clock time it landed.
    const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    this.deps.ui.toast(`Saved ✓ · ${at}`, "good");
  }

  /** Autosave in the background; `swap` is the save right after a tower swap. */
  autosave(source: "timer" | "swap" = "timer"): Promise<void> {
    if (source === "swap") this.autosaveNext = "swap";
    if (this.autosaveRun) {
      this.autosaveQueued = true;
      return this.autosaveRun;
    }
    this.autosaveRun = this.drainAutosaves().finally(() => {
      this.autosaveRun = null;
      this.autosaveNext = "timer"; // a request a failed drain dropped
    });
    return this.autosaveRun;
  }

  private async drainAutosaves(): Promise<void> {
    let source: "timer" | "swap" = "timer"; // the save in flight's own source
    try {
      do {
        this.autosaveQueued = false;
        source = this.autosaveNext;
        this.autosaveNext = "timer";
        // Re-stamp per save: the camera may have moved during the last one.
        let made = { generation: 0, savedAt: 0 };
        const packed = await SaveGame.saveAsync(() => {
          const port = this.deps.enginePort();
          const stamp = currentStamp();
          made = { generation: port.generation(), savedAt: stamp.savedAt };
          return saveBytes(port, this.deps.getView(), stamp);
        });
        if (packed) this.wroteCrashCopy(() => made.generation, made.savedAt, packed);
      } while (this.autosaveQueued);
      this.notice.worked();
    } catch (err) {
      trackAppActionOnce("autosave_failed", source);
      this.notice.backgroundFailed(err);
    }
  }

  /**
   * Flush the tower to the autosave slot just before the app reloads onto a new
   * build (the "Update now" path), with no toast. Throws if the save fails; the
   * caller must NOT reload on a throw, or the player would lose their progress.
   */
  saveBeforeUpdate(): void {
    // Same guard as the autosave timer. Behind the splash the sim is either a
    // first-timer's throwaway boot sim (never persisted) or the returning
    // player's tower, frozen, so it still equals the autosave byte for byte.
    // Load-bearing: never let anything mutate the sim while the splash is up.
    if (isSplashUp()) return;
    this.save(true);
  }

  /**
   * The WebGL context is gone: the running Excalibur engine can't rebuild its
   * GPU resources, so nothing draws until a fresh engine exists. Flush the
   * tower to the autosave slot first, then pick the recovery path:
   *
   * - First loss with a clean flush, or behind the title screen (nothing to
   *   flush there): recover IN PLACE. The sim is intact in memory and every
   *   graphic is code-generated, so GameApp can swap in a fresh engine the
   *   moment the browser restores the context. Mobile systems reset GL
   *   contexts routinely (memory pressure, GPU process restarts, a
   *   backgrounded app, title screen included); a one-off reset should cost
   *   the player a moment of stillness and nothing more.
   * - Repeat loss (within 90s), a failed flush, or a failed/timed-out
   *   recovery: the full crash screen. It says what happened and whether the
   *   tower was saved, offers the crash-report zip and a prefilled bug-report
   *   link, and reloads only when the player chooses; their reload stamps the
   *   recovery flag so the fresh boot drops them straight back into the tower.
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
        // The pre-crash flush failed: the screen words it instead of promising
        // "your tower was saved". A failed setItem is atomic, so any prior
        // autosave is intact; say so only when one exists. hasSave() itself
        // throws when storage is disabled, so it has its own try/catch.
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

    // In-place recovery is reserved for the one-off case. A repeat says the
    // device is struggling (the screen's advice matters more than seamlessness
    // would); a failed flush is storage news the player must see on the screen.
    if (repeat || !flushed) {
      showScreen(false);
      return;
    }
    // A swap begun just before the loss is caught at completion: the saved-tower trace belongs to THIS tower.
    const towerAtLoss = this.deps.enginePort().generation();
    const endWait = this.deps.showRecoveryWait(behindSplash);
    this.deps.attemptGraphicsRecovery((recovered) => {
      endWait();
      // Re-anchor the repeat window at the attempt's END too: an eviction can restore minutes
      // after the loss, and a fresh loss soon after play resumes must still read as a repeat.
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
      // Behind the title screen nothing was saved and the sim must not change, so no log line.
      if (!behindSplash && port.generation() === towerAtLoss) {
        // Leave a durable trace in the bulletin log (the old silent reload
        // erased all evidence; recovering must not repeat that mistake).
        port.logLine(
          "The device reset the game's graphics; the game recovered on the spot. Your tower was saved first.",
          this.deps.portCodes().code("logKinds", "info"),
        );
        this.deps.ui.toast("Graphics recovered. Your tower was saved.", "good");
      } else {
        // Title screen, or a tower swapped during the wait: no saved-tower claim.
        this.deps.ui.toast("Graphics recovered.", "good");
      }
      trackAppAction("graphics_recovered", behindSplash ? "title" : "game");
    });
  }

  load(): void {
    const port = this.deps.enginePort();
    this.deps.beforeSwap?.("load");
    const swap = loadStored(port);
    let newer = false;
    const loaded = SaveGame.load((text) => {
      const ok = swap(text);
      if (!ok && newerSaveRefused(port)) newer = true;
      return ok;
    });
    if (loaded) {
      this.deps.towerSwapped();
      this.deps.ui.toast("Tower loaded.", "good");
    } else {
      this.deps.swapRefused?.();
      this.deps.ui.toast(newer ? NEWER_SAVE_REFUSAL : "No saved tower found.", "bad");
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
    return runExportFlow(this.deps, () => {
      const port = this.deps.enginePort();
      return { file: exportFile(port, this.deps.getView(), currentStamp()), towerName: port.towerName() };
    });
  }

  /**
   * Export the live tower as an original 1994 SimTower save (`.TDT`). Same
   * two-step contract as the .vctower path: the reverse fidelity modal shows
   * what does and does not survive the trip back to 1994, and nothing is
   * downloaded until the player clicks the primary. Modern-mode towers are
   * refused outright (the 1994 rule set cannot represent them).
   */
  async exportLegacy(): Promise<void> {
    const port = this.deps.enginePort();
    let bytes: Uint8Array | undefined;
    let report: ExportReport;
    try {
      // The codec's own load can fail (a chunk that cannot be fetched offline);
      // that ends in the same "Export failed" line, not a silent rejection.
      await port.prepareTdt?.();
      // A null camera (headless) stamps nothing, so it never erases the view
      // a TDT import brought over before any camera existed.
      stampCamera(port, this.deps.getView());
      const rec = port.tdtExport();
      bytes = rec[0] === 1 ? port.tdtFile() : undefined;
      if (!bytes) {
        // The engine's refusal is the player's sentence (a Modern tower, a
        // tower too deep for 1994); analytics gets its closed code.
        trackFileFailure("export_failed", "tdt", refusalCode(port.lastRefusalCode()));
        this.deps.ui.sayVisibly(port.lastReason() ?? "Export failed."); // not a toast: a dialog may be up (GH #658)
        return;
      }
      report = exportReport(exportFacts(rec, this.deps.portCodes(), port));
    } catch (err) {
      trackFileFailure("export_failed", "tdt", "error");
      this.deps.ui.sayVisibly("Export failed: " + (err instanceof Error ? err.message : String(err)));
      return;
    }
    const file = bytes;
    const header = headerNow(() => this.deps.reader().header); // the tower the file was written from
    this.deps.ui.showExportReport(report, {
      // Through the shared export latch (GH #760 follow-on), so a .TDT download
      // and a .vctower export can never run at once.
      onDownload: () =>
        void runLegacyDownload(this.deps.ui, () => {
          if (this.deps.ui.downloadFile(report.filename, file)) trackFileExported("tdt", header);
        }),
    });
  }

  /** Import a `.vctower` file: a binary one as bytes, text as text (`uiImport.ts`). */
  async importGame(data: string | Uint8Array): Promise<void> {
    let reason: FileFailureCode = "error"; // a throw before the engine answered
    try {
      // The engine reads the file, and words a refusal for the player with a
      // closed code for analytics; the founder rule is the engine's too.
      const port = this.deps.enginePort();
      this.deps.beforeSwap?.("open");
      const loaded = typeof data === "string" ? port.loadVctower(data) : port.loadVctowerBytes(data);
      if (loaded[0] !== 1) reason = refusalCode(port.lastRefusalCode());
      if (loaded[0] !== 1) throw new Error(port.lastReason() ?? SWAP_REFUSED);
      this.deps.towerSwapped();
      trackFileImported("vctower", () => this.deps.reader().header);
      this.deps.ui.toast("Tower imported.", "good");
    } catch (err) {
      this.deps.swapRefused?.();
      trackFileFailure("import_failed", "save", reason);
      this.deps.ui.sayVisibly("Import failed: " + (err as Error).message);
    }
  }

  /**
   * Import a 1994 SimTower save (`.TDT`): the engine reads, checks and stages
   * it, and nothing is adopted until the player confirms with "Open tower"
   * (importGame's contract). A refusal or a throw is an import_failed. */
  async importLegacy(buffer: ArrayBuffer, filename: string): Promise<void> {
    const port = this.deps.enginePort();
    const bytes = new Uint8Array(buffer);
    let rec: PortRecord | undefined;
    try {
      await port.prepareTdt?.();
      rec = port.loadTdt(bytes, filename);
    } catch {
      rec = undefined; // the reader threw before answering
    }
    if (rec?.[0] !== 1) {
      trackFileFailure("import_failed", "tdt", rec ? refusalCode(port.lastRefusalCode()) : "error");
      this.deps.ui.toast((rec && port.lastReason()) ?? "This SimTower save couldn't be read.", "bad");
      return;
    }
    const facts = importFacts(rec, this.deps.portCodes(), port);
    const report = importReport(facts);
    this.deps.ui.showImportReport(report, {
      // The confirmed adoption is ./legacyImportAdopt. The engine stages one
      // file at a time, so the confirmation stages its own file again.
      onOpen: () =>
        adoptConfirmedLegacyImport(this.deps, report.towerName, () => this.saveBeforeUpdate(), { bytes, filename }),
      // Sent once the report is on screen: one dropped while it waits is not a read.
      onShown: () => trackTdtImportRead(facts),
    });
  }

  /** Found a fresh tower under the chosen rule-set. The mode, and for Modern the
   *  calendar and the no-bridging option, are fixed at founding for the tower's
   *  life; Classic runs the canon calendar and auto structure and ignores both. */
  newGame(mode: GameMode = "classic", modernCalendar: CalendarKind = "realWorld", startUnbridged = false): void {
    const port = this.deps.enginePort();
    const codes = this.deps.portCodes();
    this.deps.beforeSwap?.("new");
    swapDone(port, port.foundTower(Date.now() & 0x7fffffff, codes.code("modes", mode), codes.code("calendars", modernCalendar), startUnbridged));
    this.deps.towerSwapped();
    // The toast is the first-lobby cue, keyed on tower state, never the mode.
    const founded = this.deps.reader();
    this.deps.ui.toast(
      founded.rooms.length === 0 && founded.structure.length === 0
        ? "New tower founded. Lay a lobby on the ground line to open it."
        : "New tower founded. Good luck!",
      "good",
    );
    // Auto-arm onboarding only for a first-timer: a saved tower means already
    // onboarded even with the flag cleared (Replay via Help still re-arms).
    if (shouldArm(true) && !SaveGame.hasSave()) this.deps.armOnboarding();
  }
}
