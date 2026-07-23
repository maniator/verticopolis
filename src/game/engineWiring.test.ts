import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";
import { wireEngine } from "./engineWiring";
import { placeSimpleBuild, isTransportTool, isPaintTool, updateBuildPreview, touchBuildLiftFloors } from "./buildPreview";
import { runFrame } from "./frameLoop";

/**
 * Headless unit tests for wireEngine. The sibling helpers it delegates to
 * (buildPreview, frameLoop) are mocked so the wiring stays the unit under test;
 * gesture/facilities/placement stay real. After wireEngine(app), each installed
 * callback is invoked to prove the delegation. rebuildEngine is intentionally
 * NOT tested here: it constructs a real WebGL `new TowerEngine` and cannot run
 * headless.
 */

vi.mock("./buildPreview", () => ({
  placeSimpleBuild: vi.fn(() => ({})),
  isTransportTool: vi.fn(() => false),
  isPaintTool: vi.fn(() => false),
  updateBuildPreview: vi.fn(),
  touchBuildLiftFloors: vi.fn(() => 2),
}));

vi.mock("./frameLoop", () => ({
  runFrame: vi.fn(),
  SPEEDS: [0, 10, 30, 120],
}));

const mockPlaceSimpleBuild = vi.mocked(placeSimpleBuild);
const mockIsTransportTool = vi.mocked(isTransportTool);
const mockIsPaintTool = vi.mocked(isPaintTool);
const mockUpdateBuildPreview = vi.mocked(updateBuildPreview);
const mockLift = vi.mocked(touchBuildLiftFloors);
const mockRunFrame = vi.mocked(runFrame);

interface FakeEngine {
  classifyDown?: (...a: unknown[]) => unknown;
  onTap?: (tile: number, floor: number, touch: boolean, picked: unknown) => void;
  onActionDown?: (tile: number, floor: number, touch: boolean, picked: unknown) => void;
  onActionMove?: (tile: number, floor: number, picked: unknown) => void;
  onActionUp?: () => void;
  onHover?: (tile: number, floor: number, picked: unknown) => void;
  onSecondary?: (picked: unknown) => void;
  onExtendTo?: (end: unknown, target: unknown) => void;
  onExtendEnd?: () => void;
  onUpdate?: (ms: number) => void;
  onContextLost?: () => void;
  preview?: unknown;
  transportPreview?: unknown;
}

function makeApp(toolOver: Record<string, unknown> = {}) {
  const engine: FakeEngine = {};
  const canvas = document.createElement("canvas");
  const app = {
    engine,
    canvas,
    audio: { start: vi.fn() },
    tool: { type: "inspect", kind: "office", ...toolOver },
    build: {
      bulldozePicked: vi.fn(),
      clearPaint: vi.fn(),
      seedPaint: vi.fn(),
      paintFloorRun: vi.fn(),
      tryBuildTransport: vi.fn(),
    },
    sim: {
      tower: { placeTransportDryRun: vi.fn(() => true) },
      isUnlocked: vi.fn(() => true),
    },
    ui: { toast: vi.fn() },
    editor: { extendSelectedTo: vi.fn(), endExtend: vi.fn() },
    inspector: { inspectPicked: vi.fn() },
    saveLoad: { recoverFromContextLoss: vi.fn() },
    selectPicked: vi.fn(),
    captureUndo: vi.fn(),
    commitUndo: vi.fn(),
    mobileMq: { matches: false },
    paintAnchor: null as unknown,
    buildAnchor: null as unknown,
    transportStart: null as unknown,
    lastTickErrorLog: -1e9,
    frameErrors: [] as Array<{ at: string; message: string }>,
  };
  return app as unknown as GameApp & typeof app & { engine: FakeEngine };
}

beforeEach(() => {
  mockPlaceSimpleBuild.mockReturnValue({} as never);
  mockIsTransportTool.mockReturnValue(false);
  mockIsPaintTool.mockReturnValue(false);
  mockRunFrame.mockReset();
  mockRunFrame.mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("wireEngine installs all engine callbacks", () => {
  it("assigns every hook and a contextmenu listener", () => {
    const app = makeApp();
    wireEngine(app);
    for (const hook of [
      "classifyDown",
      "onTap",
      "onActionDown",
      "onActionMove",
      "onActionUp",
      "onHover",
      "onSecondary",
      "onExtendTo",
      "onExtendEnd",
      "onUpdate",
      "onContextLost",
    ] as const) {
      expect(typeof app.engine[hook]).toBe("function");
    }
    // classifyDown routes through the real gesture classifier without throwing.
    expect(() => app.engine.classifyDown!(0, false, { x: 0, y: 0 })).not.toThrow();
  });
});

describe("onTap", () => {
  it("inspect tool selects the picked entity", () => {
    const app = makeApp({ type: "inspect" });
    wireEngine(app);
    const picked = { id: "u1" };
    app.engine.onTap!(3, 4, false, picked);
    expect(app.audio.start).toHaveBeenCalled();
    expect(app.selectPicked).toHaveBeenCalledWith(picked);
  });

  it("a touch build tap captures undo, places, and commits", () => {
    const app = makeApp({ type: "build", kind: "office" });
    wireEngine(app);
    app.engine.onTap!(3, 4, true, null);
    expect(app.captureUndo).toHaveBeenCalled();
    expect(mockPlaceSimpleBuild).toHaveBeenCalledWith(app, "office", 3, 4);
    expect(app.commitUndo).toHaveBeenCalled();
  });

  it("a touch bulldoze tap bulldozes the picked entity", () => {
    const app = makeApp({ type: "bulldoze", kind: "office" });
    wireEngine(app);
    const picked = { id: "r1" };
    app.engine.onTap!(3, 4, true, picked);
    expect(app.build.bulldozePicked).toHaveBeenCalledWith(picked);
    expect(app.commitUndo).toHaveBeenCalled();
  });

  it("a non-touch build tap does nothing beyond starting audio", () => {
    const app = makeApp({ type: "build", kind: "office" });
    wireEngine(app);
    app.engine.onTap!(3, 4, false, null);
    expect(app.captureUndo).not.toHaveBeenCalled();
    expect(mockPlaceSimpleBuild).not.toHaveBeenCalled();
  });
});

describe("onActionDown", () => {
  it("a touch paint tool defers by stashing the paint anchor", () => {
    mockIsPaintTool.mockReturnValue(true);
    const app = makeApp({ type: "build", kind: "office" });
    wireEngine(app);
    app.engine.onActionDown!(5, 6, true, null);
    expect(app.paintAnchor).toEqual({ tile: 5, floor: 6 });
    expect(mockPlaceSimpleBuild).not.toHaveBeenCalled();
  });

  it("a drag-sized transport anchors transportStart when placeSimpleBuild returns null", () => {
    mockPlaceSimpleBuild.mockReturnValue(null);
    const app = makeApp({ type: "build", kind: "elevatorStandard" });
    wireEngine(app);
    app.engine.onActionDown!(7, 8, false, null);
    expect(app.transportStart).not.toBeNull();
    expect((app.transportStart as { floor: number }).floor).toBe(8);
  });
});

describe("onHover", () => {
  it("build tool updates the build preview", () => {
    const app = makeApp({ type: "build", kind: "office" });
    wireEngine(app);
    app.engine.onHover!(1, 2, null);
    expect(mockUpdateBuildPreview).toHaveBeenCalledWith(app, 1, 2);
  });

  it("inspect tool inspects the picked entity on desktop", () => {
    const app = makeApp({ type: "inspect" });
    wireEngine(app);
    const picked = { id: "u9" };
    app.engine.onHover!(1, 2, picked);
    expect(app.engine.preview).toBeNull();
    expect(app.inspector.inspectPicked).toHaveBeenCalledWith(picked);
  });
});

describe("secondary + extend", () => {
  it("onSecondary selects the picked entity", () => {
    const app = makeApp();
    wireEngine(app);
    const picked = { id: "s1" };
    app.engine.onSecondary!(picked);
    expect(app.selectPicked).toHaveBeenCalledWith(picked);
  });

  it("onExtendTo delegates to the editor and onExtendEnd commits", () => {
    const app = makeApp();
    wireEngine(app);
    app.engine.onExtendTo!("top", 12);
    expect(app.editor.extendSelectedTo).toHaveBeenCalledWith("top", 12);
    app.engine.onExtendEnd!();
    expect(app.editor.endExtend).toHaveBeenCalled();
    expect(app.commitUndo).toHaveBeenCalled();
  });
});

describe("onUpdate", () => {
  it("runs the frame each tick", () => {
    const app = makeApp();
    wireEngine(app);
    app.engine.onUpdate!(16);
    expect(mockRunFrame).toHaveBeenCalledWith(app, 16);
  });

  it("swallows a thrown frame and records a frame error", () => {
    const err = new Error("boom");
    mockRunFrame.mockImplementation(() => {
      throw err;
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = makeApp();
    wireEngine(app);
    expect(() => app.engine.onUpdate!(16)).not.toThrow();
    expect(app.frameErrors).toHaveLength(1);
    expect(app.frameErrors[0].message).toContain("boom");
    consoleSpy.mockRestore();
  });
});

describe("onContextLost + contextmenu", () => {
  it("onContextLost triggers save-load recovery", () => {
    const app = makeApp();
    wireEngine(app);
    app.engine.onContextLost!();
    expect(app.saveLoad.recoverFromContextLoss).toHaveBeenCalled();
  });

  it("the contextmenu listener prevents the default browser menu", () => {
    const app = makeApp();
    wireEngine(app);
    const evt = new Event("contextmenu", { cancelable: true });
    app.canvas.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
  });
});

describe("touch room-build offset-ghost flow", () => {
  it("defers a touch room, previews at the finger on press, lifts on a deliberate drag, commits on lift", () => {
    const app = makeApp({ type: "build", kind: "office" });
    wireEngine(app);
    // Press (touch): does NOT place; previews at the FINGER (no lift yet), reason card off.
    app.engine.onActionDown!(10, 5, true, null);
    expect(mockPlaceSimpleBuild).not.toHaveBeenCalled();
    expect(app.buildAnchor).toMatchObject({ tile: 10, floor: 5, lifting: false });
    expect(mockUpdateBuildPreview).toHaveBeenLastCalledWith(app, 10, 5, false);
    // Drag to a different floor: the lift latches, ghost floats above the finger (lift is 2 in the mock).
    app.engine.onActionMove!(12, 8, null);
    expect(app.buildAnchor).toMatchObject({ tile: 12, floor: 10, lifting: true });
    expect(mockUpdateBuildPreview).toHaveBeenLastCalledWith(app, 12, 10, false);
    expect(mockLift).toHaveBeenCalled();
    expect(mockPlaceSimpleBuild).not.toHaveBeenCalled();
    // Release over a VALID spot: commit at the lifted anchor, clear the ghost.
    app.engine.preview = { kind: "office", floor: 10, x: 12, valid: true };
    app.engine.onActionUp!();
    expect(mockPlaceSimpleBuild).toHaveBeenCalledWith(app, "office", 12, 10);
    expect(app.buildAnchor).toBeNull();
    expect(app.engine.preview).toBeNull();
  });

  it("a quick touch tap (no drag) places a room at the FINGER, not lifted", () => {
    const app = makeApp({ type: "build", kind: "office" });
    wireEngine(app);
    app.engine.onActionDown!(10, 5, true, null); // press, no move
    app.engine.preview = { kind: "office", floor: 5, x: 10, valid: true };
    app.engine.onActionUp!();
    expect(mockPlaceSimpleBuild).toHaveBeenCalledWith(app, "office", 10, 5); // at the finger, no lift
  });

  it("a tap's small jitter (same floor, under two tiles) does NOT engage the lift", () => {
    const app = makeApp({ type: "build", kind: "office" });
    wireEngine(app);
    app.engine.onActionDown!(10, 5, true, null);
    app.engine.onActionMove!(11, 5, null); // one tile over, same floor
    expect(app.buildAnchor).toMatchObject({ tile: 11, floor: 5, lifting: false });
    expect(mockUpdateBuildPreview).toHaveBeenLastCalledWith(app, 11, 5, false);
  });

  it("cancels on release over an invalid (red) spot: no placement, no toast", () => {
    const app = makeApp({ type: "build", kind: "office" });
    wireEngine(app);
    app.engine.onActionDown!(10, 5, true, null);
    app.engine.preview = { kind: "office", floor: 7, x: 10, valid: false };
    app.engine.onActionUp!();
    expect(mockPlaceSimpleBuild).not.toHaveBeenCalled();
    expect(app.ui.toast).not.toHaveBeenCalled();
    expect(app.buildAnchor).toBeNull();
  });

  it("a MOUSE room build still places on the press (no deferral, no anchor)", () => {
    const app = makeApp({ type: "build", kind: "office" });
    wireEngine(app);
    app.engine.onActionDown!(10, 5, false, null);
    expect(mockPlaceSimpleBuild).toHaveBeenCalledWith(app, "office", 10, 5);
    expect(app.buildAnchor).toBeNull();
  });

  it("a fresh press drops a buildAnchor a cancelled pinch left behind", () => {
    const app = makeApp({ type: "build", kind: "office" });
    app.buildAnchor = { tile: 3, floor: 9, oTile: 3, oFloor: 9, lifting: true };
    wireEngine(app);
    app.engine.onActionDown!(10, 5, true, null);
    expect(app.buildAnchor).toMatchObject({ tile: 10, floor: 5, lifting: false }); // stale anchor replaced by the fresh gesture
  });
});
