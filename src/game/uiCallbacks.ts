import { trackAppAction } from "../analytics";
import type { UICallbacks, Tool } from "../ui/UI";
import type { Simulation } from "../engine/Simulation";
import type { AudioEngine } from "../audio/Audio";
import type { SaveLoad } from "./saveLoad";
import type { EditorActions } from "./editorActions";
import type { InspectorController } from "./inspector";

/**
 * The narrow slice of `GameApp` that {@link createUICallbacks} wires the UI to.
 * Typing the factory against this interface (never the concrete `GameApp`) is
 * the encapsulation boundary: the factory can only touch these members, so it
 * cannot reach a `GameApp` private, and `class GameApp implements GameAppPorts`
 * makes the compiler prove every callback is backed by a real method with the
 * right type.
 *
 * Live state is always re-read (`getSim()`, the audio facade, the controllers'
 * own `getSim` thunks), never destructured, so an `adoptSim()` swap stays
 * visible to the callbacks. Keep the factory parameter typed `GameAppPorts`, not
 * `GameApp`, or that boundary is lost.
 */
export interface GameAppPorts {
  /** The live simulation, re-read per call so an adoptSim() swap is seen. */
  getSim(): Simulation;
  /** The audio facade. Read per call (never destructured), so it stays correct
   *  whatever its lifecycle: that per-call read is the guarantee, not any
   *  assumption that the facade is never replaced. */
  readonly audio: Pick<AudioEngine, "muted" | "musicVolume" | "ambienceVolume" | "sfxVolume">;
  /** Save/load controller; each method re-asks its own live-sim thunk. */
  readonly saveLoad: Pick<
    SaveLoad,
    "save" | "load" | "exportGame" | "importGame" | "importLegacy" | "exportLegacy" | "newGame"
  >;
  readonly editor: Pick<EditorActions, "handleEditAction">;
  readonly inspector: Pick<InspectorController, "dismiss">;

  handleSelectTool(tool: Tool): void;
  setSpeed(speed: number): void;
  /** The live game-speed index, so a dialog can restore it after pausing. */
  getSpeed(): number;
  undo(): void;
  redo(): void;
  setOverlay(mode: string): void;
  toggleMute(): boolean;
  setVolume(kind: "music" | "ambience" | "sfx", value: number): void;
  toggleReducedMotion(): boolean;
  toggleSteadyClock(): boolean;
  isSteadyClock(): boolean;
  replayOnboarding(): void;
  renameTower(name: string): void;
  /** Drop the Modern build-refusal card and its ownership latch (no-op when
   *  the build path doesn't own the card). The inspector ✕ routes through
   *  this before the dismissal latch: the refusal card shares the inspector
   *  DOM, and a leaked latch would silently offset a later card's anchor
   *  (panelAnchoring reads it as the caption-below signal). */
  clearBuildRefusal(): void;
  showStats(): void;
  showSaves(): void;
  saveToSlot(slot: number): void;
  loadFromSlot(slot: number | "auto"): void;
  deleteSlot(slot: number): void;
}

/**
 * Build the UI command callbacks from the app spine. This is the `UICallbacks`
 * object that used to live inline in the `GameApp` constructor; each callback is
 * a thin delegation to a {@link GameAppPorts} member, so the command boundary the
 * UI depends on lives in one place that a later declarative UI layer can rebind
 * without touching `GameApp`. Called at UI-construction time, AFTER the
 * controllers exist, because the `UI` constructor's initial `selectTool` fires
 * `onSelectTool` synchronously.
 */
export function createUICallbacks(app: GameAppPorts): UICallbacks {
  return {
    onSelectTool: (tool) => app.handleSelectTool(tool),
    onSpeed: (speed) => app.setSpeed(speed),
    getSpeed: () => app.getSpeed(),
    onSave: () => {
      trackAppAction("quick_save");
      app.saveLoad.save();
    },
    onLoad: () => app.saveLoad.load(),
    onExport: () => {
      trackAppAction("export_save");
      void app.saveLoad.exportGame();
    },
    onImport: (data) => {
      trackAppAction("import_save");
      void app.saveLoad.importGame(data);
    },
    onImportLegacy: (buffer, filename) => {
      trackAppAction("import_tdt");
      app.saveLoad.importLegacy(buffer, filename);
    },
    onExportLegacy: () => {
      trackAppAction("export_tdt");
      app.saveLoad.exportLegacy();
    },
    getMode: () => app.getSim().mode,
    onNew: (mode, modernCalendar, manualStructure) => app.saveLoad.newGame(mode, modernCalendar, manualStructure),
    onToggleAudio: () => app.toggleMute(),
    isMuted: () => app.audio.muted,
    onSetVolume: (kind, value) => app.setVolume(kind, value),
    getVolumes: () => ({
      music: app.audio.musicVolume,
      ambience: app.audio.ambienceVolume,
      sfx: app.audio.sfxVolume,
    }),
    onUndo: () => app.undo(),
    onRedo: () => app.redo(),
    onEditAction: (action, root) => app.editor.handleEditAction(action, root),
    onToggleReducedMotion: () => app.toggleReducedMotion(),
    onToggleSteadyClock: () => app.toggleSteadyClock(),
    isSteadyClock: () => app.isSteadyClock(),
    onReplayOnboarding: () => {
      trackAppAction("replay_onboarding");
      app.replayOnboarding();
    },
    onRenameTower: (name) => app.renameTower(name),
    onShowStats: () => {
      trackAppAction("stats_open"); // the user open; the exterminator refresh reopens showStats directly
      app.showStats();
    },
    onSetOverlay: (mode) => app.setOverlay(mode),
    // dismiss() latches the ✕ so the next hover pick over the same facility
    // does not instantly re-open the card the player just closed. The ✕ may
    // instead be closing the build-refusal card (the build path borrows the
    // same DOM surface), so drop that ownership latch first; it is a no-op
    // when the inspect tool owns the card.
    onInspectorClose: () => {
      app.clearBuildRefusal();
      app.inspector.dismiss();
    },
    onShowSaves: () => app.showSaves(),
    onSaveSlot: (slot) => app.saveToSlot(slot),
    onLoadSlot: (slot) => app.loadFromSlot(slot),
    onDeleteSlot: (slot) => app.deleteSlot(slot),
  };
}
