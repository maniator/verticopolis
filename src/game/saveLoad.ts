import { Simulation } from "../engine/Simulation";
import type { GameMode } from "../engine/types";
import { SaveGame } from "../storage/SaveGame";
import { parseTWR } from "../storage/twrImport";
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
  ui: Pick<UI, "toast" | "downloadFile">;
  /** Full-screen boot card (lives with the boot functions in main.ts). */
  showBootMessage(msg: string, withReload?: boolean): void;
  /** Arm first-run onboarding on the just-adopted sim. */
  armOnboarding(): void;
}

export class SaveLoad {
  constructor(private readonly deps: SaveLoadDeps) {}

  save(silent = false): void {
    SaveGame.save(this.deps.getSim());
    if (!silent) this.deps.ui.toast("Tower saved.", "good");
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
   * place, so recovery is the same as a manual refresh: flush the tower to the
   * autosave slot, then reload onto a fresh context — automatically, so the
   * player never sees a dead screen. Two guards keep this safe:
   * - a sessionStorage timestamp stops a GPU that dies on every boot from
   *   reload-looping (second loss within 90s falls back to a manual card), and
   * - a hidden tab defers the reload until it's visible again, so we don't
   *   re-boot the renderer in the background just to have the GPU reap it anew.
   */
  recoverFromContextLoss(): void {
    // Same guard as the autosave timer: never persist the throwaway boot sim
    // while the first-run splash is still up.
    if (!document.getElementById("splash")) {
      try {
        this.save(true);
      } catch {
        // The pre-reload flush failed — localStorage quota, private-mode, or a
        // security exception. Left unhandled this throw would escape the
        // onContextLost handler and abort the reload, stranding the player on a
        // dead GPU canvas with no explanation. A failed setItem is atomic (it
        // never clobbers), so any prior autosave is intact — but we must NOT
        // silently reload past the unsaved changes either. Hand the player a
        // card (with a Reload button), as we do for a repeat GPU crash. Only
        // promise the prior tower is safe when one actually exists — a
        // first-session crash before any autosave has none to reassure about.
        // hasSave() READS localStorage, which itself throws when storage is
        // *disabled* (a SecurityError) rather than merely full — so guard it in
        // its own try/catch. Otherwise this catch would re-throw before the card
        // is shown and re-abort the reload, the exact bug this fix exists to kill.
        let priorSaveNote = "";
        try {
          if (SaveGame.hasSave()) priorSaveNote = " Your last saved tower is safe.";
        } catch {
          /* storage is unreadable too — just omit the reassurance */
        }
        // Cover both failure classes the catch handles: storage FULL (quota) and
        // storage BLOCKED (private mode / SecurityError), where "free up space"
        // alone would be wrong advice.
        this.deps.showBootMessage(
          "The graphics driver crashed and your latest changes couldn't be saved — " +
            "storage is full or blocked." +
            priorSaveNote +
            "<br>Free up space or allow site storage, then reload.",
          true,
        );
        return;
      }
    }

    const KEY = "vc-gl-lost-reload";
    let lastReload = 0;
    try {
      lastReload = Number(sessionStorage.getItem(KEY)) || 0;
    } catch {
      /* storage may be unavailable; treat as first loss */
    }
    if (Date.now() - lastReload < 90_000) {
      // Auto-reload didn't stick — hand control back to the player.
      this.deps.showBootMessage(
        "The graphics driver crashed twice in a row.<br>Your tower is saved — close other tabs or apps and try again.",
        true,
      );
      return;
    }

    const reload = () => {
      try {
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch {
        /* best effort */
      }
      location.reload();
    };
    if (document.visibilityState === "hidden") {
      document.addEventListener("visibilitychange", function onVis() {
        if (document.visibilityState === "visible") {
          document.removeEventListener("visibilitychange", onVis);
          reload();
        }
      });
    } else {
      reload();
    }
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
      this.deps.ui.toast(`Tower exported (${(file.length / 1024).toFixed(1)} KB) — check your downloads.`, "good");
    } catch (err) {
      // Never fail silently: main.ts fires this with `void`, so an unhandled
      // rejection here would leave the player with no download and no feedback.
      this.deps.ui.toast("Export failed: " + (err as Error).message, "bad");
    }
  }

  async importGame(data: string): Promise<void> {
    try {
      this.deps.adoptSim(await SaveGame.import(data));
      this.deps.ui.toast("Tower imported.", "good");
    } catch (err) {
      this.deps.ui.toast("Import failed: " + (err as Error).message, "bad");
    }
  }

  importLegacy(buffer: ArrayBuffer, filename: string): void {
    try {
      const data = parseTWR(buffer);
      this.deps.adoptSim(Simulation.deserialize(data));
      this.deps.ui.toast("Imported original SimTower save.", "good");
    } catch (err) {
      // Expected today: the .TWR decoder is a planned v2 feature.
      this.deps.ui.toast((err as Error).message, "info");
      void filename;
    }
  }

  /** Found a fresh tower under the chosen rule-set. The mode is baked into the
   *  new Simulation at creation and is immutable for that tower's life. */
  newGame(mode: GameMode = "classic"): void {
    this.deps.adoptSim(Simulation.newGame(Date.now() & 0x7fffffff, mode));
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
