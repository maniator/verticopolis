import { Simulation } from "../engine/Simulation";
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
   *  Omitting `preserveHistory` invalidates the undo trail — every path here
   *  adopts a *different* tower, so all of them omit it. */
  adoptSim(sim: Simulation, preserveHistory?: boolean): void;
  ui: Pick<UI, "toast">;
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
   * Called by the PWA layer the instant a new version is ready, just before it
   * reloads onto the new assets. Flush the tower to the autosave slot so the
   * imminent reload can't cost the player any progress, and tell them what's
   * happening through the existing toast rail.
   */
  onUpdateReady(): void {
    this.save(true);
    this.deps.ui.toast("New version ready — saved your tower, updating…", "info");
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
    if (!document.getElementById("splash")) this.save(true);

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

  importGame(json: string): void {
    try {
      this.deps.adoptSim(SaveGame.import(json));
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

  newGame(): void {
    this.deps.adoptSim(Simulation.newGame(Date.now() & 0x7fffffff));
    this.deps.ui.toast("New tower founded. Good luck!", "good");
    // Auto-arm onboarding only for a genuine first-timer. A returning player (a
    // save exists) is treated as already onboarded even if the localStorage flag
    // was cleared, so they're never re-onboarded unexpectedly (Replay via Help
    // still re-arms explicitly).
    if (shouldArm(true) && !SaveGame.hasSave()) this.deps.armOnboarding();
  }
}
