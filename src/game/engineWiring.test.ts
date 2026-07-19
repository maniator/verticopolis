import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";
import { wireEngine } from "./engineWiring";
import { placeSimpleBuild, isTransportTool, isPaintTool, updateBuildPreview } from "./buildPreview";
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
}));

vi.mock("./frameLoop", () => ({
  runFrame: vi.fn(),
  SPEEDS: [0, 10, 30, 120],
}));

const mockPlaceSimpleBuild = vi.mocked(placeSimpleBuild);
const mockIsTransportTool = vi.mocked(isTransportTool);
const mockIsPaintTool = vi.mocked(isPaintTool);
const mockUpdateBuildPreview = vi.mocked(updateBuildPreview);
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
