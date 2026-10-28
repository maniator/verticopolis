import { describe, it, expect, vi } from "vitest";
import { catalogFor } from "../engine/catalog";
import type { GameMode } from "../engine/types";
import { createUICallbacks, type GameAppPorts } from "./uiCallbacks";
import { Simulation } from "../engine/Simulation";
import type { EnginePort } from "../simport/enginePort";
import { TsEngine } from "../engine/port/tsEngine";
import { PortCodes } from "../simport/portCodes";

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
  const reader = { header: { mode: "classic" as GameMode } };
  const ports: GameAppPorts = {
    getCatalog: vi.fn(() => catalogFor("classic")),
    reader,
    enginePort: { flipAutoBridge: vi.fn(() => Float64Array.of(1, 0, 0)), autoBridge: vi.fn(() => true) } as unknown as EnginePort,
    portCodes: new PortCodes(new TsEngine(Simulation.newGame(1))),
    audio: { muted: true, musicVolume: 0.4, ambienceVolume: 0.7, sfxVolume: 0.6 },
    saveLoad: {
      save: vi.fn(),
      load: vi.fn(),
      exportGame: vi.fn(async () => {}),
      importGame: vi.fn(async () => {}),
      importLegacy: vi.fn(),
      exportLegacy: vi.fn(),
      newGame: vi.fn(),
    },
    editor: { handleEditAction: vi.fn(), renameTower: vi.fn(async () => {}) },
    inspector: { dismiss: vi.fn() },
    handleSelectTool: vi.fn(),
    setSpeed: vi.fn(),
    getSpeed: vi.fn(() => 1),
    undo: vi.fn(),
    redo: vi.fn(),
    setOverlay: vi.fn(),
    toggleMute: vi.fn(() => false),
    setVolume: vi.fn(),
    toggleReducedMotion: vi.fn(() => true),
    toggleSteadyClock: vi.fn(() => true),
    isSteadyClock: vi.fn(() => true),
    replayOnboarding: vi.fn(),
    clearBuildRefusal: vi.fn(),
    showStats: vi.fn(),
    showSaves: vi.fn(),
    saveToSlot: vi.fn(),
    loadFromSlot: vi.fn(),
    deleteSlot: vi.fn(),
  };
  return { ports, reader };
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
    // getSpeed delegates (and returns) the port's value, so the Compare modal's
    // pause/restore reads the live speed rather than a dropped call.
    expect(cb.getSpeed()).toBe(1);
    expect(ports.getSpeed).toHaveBeenCalledTimes(1);
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
    cb.onNew("modern", "realWorld", true);
    expect(ports.saveLoad.newGame).toHaveBeenCalledExactlyOnceWith("modern", "realWorld", true);
  });

  it("getMode reads the reader's header per call, so an adoptSim-style swap is seen", () => {
    const { ports, reader } = makePorts();
    const cb = createUICallbacks(ports);
    expect(cb.getMode()).toBe("classic");
    reader.header = { mode: "modern" };
    expect(cb.getMode()).toBe("modern");
  });

  it("getCatalog asks the app's catalog per call (#921)", () => {
    const { ports } = makePorts();
    const cb = createUICallbacks(ports);
    expect(cb.getCatalog().mode).toBe("classic");
    vi.mocked(ports.getCatalog).mockReturnValue(catalogFor("modern"));
    expect(cb.getCatalog().mode).toBe("modern");
    expect(ports.getCatalog).toHaveBeenCalledTimes(2);
  });

  it("audio: toggle, mute state, volume set and read", () => {
    const { ports } = makePorts();
    const cb = createUICallbacks(ports);
    expect(cb.onToggleAudio()).toBe(false); // passes toggleMute's return through
    expect(ports.toggleMute).toHaveBeenCalledTimes(1);
    expect(cb.isMuted()).toBe(true); // reads the live audio facade
    cb.onSetVolume("music", 0.5);
    expect(ports.setVolume).toHaveBeenCalledWith("music", 0.5);
    cb.onSetVolume("ambience", 0.9);
    expect(ports.setVolume).toHaveBeenCalledWith("ambience", 0.9);
    expect(cb.getVolumes()).toEqual({ music: 0.4, ambience: 0.7, sfx: 0.6 });
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

  it("the bridging switch is an engine port command that resolves to the engine's answer", async () => {
    const { ports } = makePorts();
    const cb = createUICallbacks(ports);
    // The fake flip answers false while the fake engine's getter still reads
    // true: the switch takes the flip's answer, the getter is asked apart.
    expect(await cb.onToggleAutoBridge()).toBe(false);
    expect(ports.enginePort.flipAutoBridge).toHaveBeenCalledOnce();
    expect(cb.isAutoBridge()).toBe(true);
    expect(ports.enginePort.autoBridge).toHaveBeenCalledOnce();
  });

  it("onboarding, rename, stats, inspector close", () => {
    const { ports } = makePorts();
    const cb = createUICallbacks(ports);
    cb.onReplayOnboarding();
    expect(ports.replayOnboarding).toHaveBeenCalledTimes(1);
    cb.onRenameTower("Skyline");
    expect(ports.editor.renameTower).toHaveBeenCalledWith("Skyline");
    cb.onShowStats();
    expect(ports.showStats).toHaveBeenCalledTimes(1);
    cb.onInspectorClose();
    expect(ports.inspector.dismiss).toHaveBeenCalledTimes(1);
    // The ✕ may be closing the build-refusal card, whose ownership latch is
    // GameApp state the InspectorController never touches: a leaked latch
    // would offset the next inspect card's anchor one floor down.
    expect(ports.clearBuildRefusal).toHaveBeenCalledTimes(1);
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
