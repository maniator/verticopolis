import { describe, it, expect, vi } from "vitest";
import { createUICallbacks, type GameAppPorts } from "./uiCallbacks";
import type { Simulation } from "../engine/Simulation";

/**
 * The UI command boundary is pure wiring: every UICallbacks member delegates to
 * one GameAppPorts member. These tests pin THAT MAPPING (the part the extraction
 * introduced) with a fake ports object: a mis-wired, dropped, or mis-argumented
 * delegation fails here. The delegated method BODIES live on GameApp and moved
 * verbatim; their behavior is covered by the existing controller integration and
 * e2e suites (this file does not reconstruct GameApp). Each assertion checks the
 * callback calls the right port method with the right args, once per invocation,
 * and that value-returning callbacks pass the port's return value through.
 */

function makePorts() {
  const sim = { mode: "classic", tower: {} } as unknown as Simulation;
  const ports: GameAppPorts = {
    getSim: vi.fn(() => sim),
    audio: { muted: true, musicVolume: 0.4, sfxVolume: 0.6 },
    saveLoad: {
      save: vi.fn(),
      load: vi.fn(),
      exportGame: vi.fn(async () => {}),
      importGame: vi.fn(async () => {}),
      importLegacy: vi.fn(),
      exportLegacy: vi.fn(),
      newGame: vi.fn(),
    },
    editor: { handleEditAction: vi.fn() },
    inspector: { dismiss: vi.fn() },
    handleSelectTool: vi.fn(),
    setSpeed: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    setOverlay: vi.fn(),
    toggleMute: vi.fn(() => false),
    setVolume: vi.fn(),
    toggleReducedMotion: vi.fn(() => true),
    toggleSteadyClock: vi.fn(() => true),
    isSteadyClock: vi.fn(() => true),
    replayOnboarding: vi.fn(),
    renameTower: vi.fn(),
    showStats: vi.fn(),
    showSaves: vi.fn(),
    saveToSlot: vi.fn(),
    loadFromSlot: vi.fn(),
    deleteSlot: vi.fn(),
  };
  return { ports, sim };
}

describe("createUICallbacks delegates every callback to its port", () => {
  it("tool, speed, undo/redo, overlay", () => {
    const { ports } = makePorts();
    const cb = createUICallbacks(ports);
    const tool = { type: "bulldoze" } as const;
    cb.onSelectTool(tool);
    expect(ports.handleSelectTool).toHaveBeenCalledExactlyOnceWith(tool);
    cb.onSpeed(2);
    expect(ports.setSpeed).toHaveBeenCalledExactlyOnceWith(2);
    cb.onUndo();
    expect(ports.undo).toHaveBeenCalledTimes(1);
    cb.onRedo();
    expect(ports.redo).toHaveBeenCalledTimes(1);
    cb.onSetOverlay("congestion");
    expect(ports.setOverlay).toHaveBeenCalledExactlyOnceWith("congestion");
  });

  it("save/load/export/import via the saveLoad port", () => {
    const { ports } = makePorts();
    const cb = createUICallbacks(ports);
    cb.onSave();
    expect(ports.saveLoad.save).toHaveBeenCalledTimes(1);
    cb.onLoad();
    expect(ports.saveLoad.load).toHaveBeenCalledTimes(1);
    cb.onExport();
    expect(ports.saveLoad.exportGame).toHaveBeenCalledTimes(1);
    cb.onImport("data");
    expect(ports.saveLoad.importGame).toHaveBeenCalledExactlyOnceWith("data");
    const buf = new ArrayBuffer(4);
    cb.onImportLegacy(buf, "tower.TDT");
    expect(ports.saveLoad.importLegacy).toHaveBeenCalledExactlyOnceWith(buf, "tower.TDT");
    cb.onExportLegacy();
    expect(ports.saveLoad.exportLegacy).toHaveBeenCalledTimes(1);
    cb.onNew("modern", "realWorld");
    expect(ports.saveLoad.newGame).toHaveBeenCalledExactlyOnceWith("modern", "realWorld");
  });

  it("getMode reads the live sim's mode", () => {
    const { ports } = makePorts();
    const cb = createUICallbacks(ports);
    expect(cb.getMode()).toBe("classic");
    expect(ports.getSim).toHaveBeenCalled();
  });

  it("getMode re-reads the sim per call, so an adoptSim-style swap is seen", () => {
    // The whole point of the getSim() thunk: never cache the sim. Swap what the
    // port returns and confirm the callback reflects it rather than a stale hold.
    let current = { mode: "classic" } as unknown as Simulation;
    const { ports } = makePorts();
    ports.getSim = vi.fn(() => current);
    const cb = createUICallbacks(ports);
    expect(cb.getMode()).toBe("classic");
    current = { mode: "modern" } as unknown as Simulation;
    expect(cb.getMode()).toBe("modern");
  });

  it("audio: toggle, mute state, volume set and read", () => {
    const { ports } = makePorts();
    const cb = createUICallbacks(ports);
    expect(cb.onToggleAudio()).toBe(false); // passes toggleMute's return through
    expect(ports.toggleMute).toHaveBeenCalledTimes(1);
    expect(cb.isMuted()).toBe(true); // reads the live audio facade
    cb.onSetVolume("music", 0.5);
    expect(ports.setVolume).toHaveBeenCalledWith("music", 0.5);
    expect(cb.getVolumes()).toEqual({ music: 0.4, sfx: 0.6 });
  });

  it("edit action routes to the editor port", () => {
    const { ports } = makePorts();
    const cb = createUICallbacks(ports);
    const root = document.createElement("div");
    cb.onEditAction("rename", root);
    expect(ports.editor.handleEditAction).toHaveBeenCalledWith("rename", root);
  });

  it("prefs toggles pass their new state through", () => {
    const { ports } = makePorts();
    const cb = createUICallbacks(ports);
    expect(cb.onToggleReducedMotion()).toBe(true);
    expect(cb.onToggleSteadyClock()).toBe(true);
    expect(cb.isSteadyClock()).toBe(true);
  });

  it("onboarding, rename, stats, inspector close", () => {
    const { ports } = makePorts();
    const cb = createUICallbacks(ports);
    cb.onReplayOnboarding();
    expect(ports.replayOnboarding).toHaveBeenCalledTimes(1);
    cb.onRenameTower("Skyline");
    expect(ports.renameTower).toHaveBeenCalledWith("Skyline");
    cb.onShowStats();
    expect(ports.showStats).toHaveBeenCalledTimes(1);
    cb.onInspectorClose();
    expect(ports.inspector.dismiss).toHaveBeenCalledTimes(1);
  });

  it("save slots: show, save, load (incl. auto), delete", () => {
    const { ports } = makePorts();
    const cb = createUICallbacks(ports);
    cb.onShowSaves();
    expect(ports.showSaves).toHaveBeenCalledTimes(1);
    cb.onSaveSlot(2);
    expect(ports.saveToSlot).toHaveBeenCalledWith(2);
    // Each invocation delegates exactly once; assert counts so a double-fire or a
    // wrong-arg first call cannot hide behind a later matching call.
    cb.onLoadSlot(1);
    expect(ports.loadFromSlot).toHaveBeenCalledTimes(1);
    expect(ports.loadFromSlot).toHaveBeenLastCalledWith(1);
    cb.onLoadSlot("auto");
    expect(ports.loadFromSlot).toHaveBeenCalledTimes(2);
    expect(ports.loadFromSlot).toHaveBeenLastCalledWith("auto");
    cb.onDeleteSlot(3);
    expect(ports.deleteSlot).toHaveBeenCalledWith(3);
  });
});
