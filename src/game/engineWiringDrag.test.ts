import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";
import { wireEngine } from "./engineWiring";
import { placeSimpleBuild, isPaintTool, isTransportTool } from "./buildPreview";
import { NO_GESTURE } from "./appHistory";

/**
 * A build or bulldoze drag changes the tower only inside the undo gesture its
 * press opened. An undo or a redo taken mid-drag, another gesture opened over
 * it, or a tower swapped in closes that gesture; the engine records edits
 * only while one is open, so from then on the drag must change nothing, or
 * its edits would be in no undo step and an older step would meet a tower it
 * does not know. The sibling helpers are mocked, as in engineWiring.test.ts,
 * and the engine port is a stub: a drag reads only its generation, and the
 * catalog takes the mode from the reader.
 */

vi.mock("./buildPreview", () => ({
  placeSimpleBuild: vi.fn(() => ({})),
  isTransportTool: vi.fn(() => false),
  isPaintTool: vi.fn(() => false),
  updateBuildPreview: vi.fn(),
  touchBuildLiftFloors: vi.fn(() => 2),
  clearBuildRefusal: vi.fn(),
}));

vi.mock("./frameLoop", () => ({ runFrame: vi.fn(), SPEEDS: [0, 10, 30, 120] }));

interface DragHooks {
  onActionDown?: (tile: number, floor: number, touch: boolean, picked: unknown) => void;
  onActionMove?: (tile: number, floor: number, picked: unknown) => void;
  onActionUp?: () => void;
  preview?: unknown;
  transportPreview?: unknown;
}

/** An app whose undo gesture the test moves by hand. */
function makeApp(tool: Record<string, unknown>) {
  const enginePort = { generation: () => 1 };
  const reader = { header: { mode: "modern" } };
  const undo = { gesture: NO_GESTURE };
  const app = {
    engine: {} as DragHooks,
    enginePort,
    reader,
    canvas: document.createElement("canvas"),
    audio: { start: vi.fn() },
    tool,
    build: {
      bulldozePicked: vi.fn(),
      clearPaint: vi.fn(),
      seedPaint: vi.fn(),
      paintFloorRun: vi.fn(),
      tryBuildTransport: vi.fn(),
    },
    ui: { toast: vi.fn() },
    captureUndo: vi.fn(() => (undo.gesture += 1)),
    commitUndo: vi.fn(() => (undo.gesture = NO_GESTURE)),
    discardUndo: vi.fn(),
    undoGesture: () => undo.gesture,
    paintAnchor: null as unknown,
    buildAnchor: null as unknown,
    transportStart: null as unknown,
  };
  wireEngine(app as unknown as GameApp);
  return { app, undo, hooks: app.engine };
}

beforeEach(() => {
  vi.mocked(placeSimpleBuild).mockReturnValue({} as never);
  vi.mocked(isTransportTool).mockReturnValue(false);
  vi.mocked(isPaintTool).mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("a drag whose undo gesture closed", () => {
  it("stops bulldozing once an undo closes the gesture", () => {
    const { app, undo, hooks } = makeApp({ type: "bulldoze" });
    hooks.onActionDown!(5, 2, false, { id: 1 });
    hooks.onActionMove!(6, 2, { id: 2 });
    expect(app.build.bulldozePicked).toHaveBeenCalledTimes(2);
    undo.gesture = NO_GESTURE; // Ctrl+Z mid-drag
    hooks.onActionMove!(7, 2, { id: 3 });
    expect(app.build.bulldozePicked).toHaveBeenCalledTimes(2);
  });

  it("stops painting once another gesture opens over it", () => {
    vi.mocked(isPaintTool).mockReturnValue(true);
    const { app, undo, hooks } = makeApp({ type: "build", kind: "floor" });
    hooks.onActionDown!(5, 2, false, null);
    hooks.onActionMove!(6, 2, null);
    expect(app.build.paintFloorRun).toHaveBeenCalledTimes(1);
    undo.gesture += 1; // keyboard play captured its own build
    hooks.onActionMove!(7, 2, null);
    expect(app.build.paintFloorRun).toHaveBeenCalledTimes(1);
  });

  it("places no touch room on release once the gesture closed", () => {
    const { undo, hooks } = makeApp({ type: "build", kind: "office" });
    hooks.onActionDown!(10, 5, true, null);
    hooks.preview = { kind: "office", floor: 5, x: 10, valid: true };
    undo.gesture = NO_GESTURE;
    hooks.onActionUp!();
    expect(placeSimpleBuild).not.toHaveBeenCalled();
  });

  it("builds no elevator on release once another tower was swapped in", () => {
    vi.mocked(placeSimpleBuild).mockReturnValue(null);
    vi.mocked(isTransportTool).mockReturnValue(true);
    const { app, hooks } = makeApp({ type: "build", kind: "elevatorStandard" });
    hooks.onActionDown!(10, 1, false, null);
    hooks.transportPreview = { kind: "elevatorStandard", x: 10, bottom: 1, top: 3, valid: true };
    vi.spyOn(app.enginePort, "generation").mockReturnValue(app.enginePort.generation() + 1);
    hooks.onActionUp!();
    expect(app.build.tryBuildTransport).not.toHaveBeenCalled();
    expect(hooks.transportPreview).toBeNull();
  });

  it("leaves a gesture opened over it for that gesture to close", () => {
    const { app, undo, hooks } = makeApp({ type: "bulldoze" });
    hooks.onActionDown!(5, 2, false, { id: 1 });
    undo.gesture += 1; // another gesture opened and is still under way
    hooks.onActionUp!();
    expect(app.commitUndo).not.toHaveBeenCalled();
  });

  it("still acts on release while its own gesture is open", () => {
    vi.mocked(placeSimpleBuild).mockReturnValue(null);
    vi.mocked(isTransportTool).mockReturnValue(true);
    const { app, hooks } = makeApp({ type: "build", kind: "elevatorStandard" });
    hooks.onActionDown!(10, 1, false, null);
    hooks.transportPreview = { kind: "elevatorStandard", x: 10, bottom: 1, top: 3, valid: true };
    hooks.onActionUp!();
    expect(app.build.tryBuildTransport).toHaveBeenCalledWith("elevatorStandard", 10, 1, 3);
    expect(app.commitUndo).toHaveBeenCalledOnce();
  });
});
