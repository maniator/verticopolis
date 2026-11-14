import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";
import { wireEngine } from "./engineWiring";
import { placeSimpleBuild, isPaintTool, isTransportTool } from "./buildPreview";
import { NO_GESTURE } from "./appHistory";
import { BulldozeDragChoice } from "./bulldozeDrag";

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

vi.mock("./frameLoop", () => ({ runFrame: vi.fn(), SPEEDS: [0, 3, 15, 50] }));

interface DragHooks {
  onActionDown?: (tile: number, floor: number, touch: boolean, picked: unknown) => void;
  onActionMove?: (tile: number, floor: number, picked: unknown) => void;
  onActionUp?: () => void;
  onActionCancel?: () => void;
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
    keyboard: { pointerDrew: vi.fn(), followTower: vi.fn() },
    tool,
    bulldozeDrag: new BulldozeDragChoice(),
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

  it("drops the elevator ghost on the first move after an undo, and teaches nothing on release", () => {
    vi.mocked(placeSimpleBuild).mockReturnValue(null);
    vi.mocked(isTransportTool).mockReturnValue(true);
    const { app, undo, hooks } = makeApp({ type: "build", kind: "elevatorStandard" });
    hooks.onActionDown!(10, 1, false, null);
    hooks.transportPreview = { kind: "elevatorStandard", x: 10, bottom: 1, top: 3, valid: true };
    undo.gesture = NO_GESTURE; // Ctrl+Z mid-press
    hooks.onActionMove!(10, 4, null);
    expect([hooks.transportPreview, app.transportStart]).toEqual([null, null]);
    hooks.onActionUp!();
    expect(app.build.tryBuildTransport).not.toHaveBeenCalled();
    expect(app.ui.toast, "no drag-to-size hint").not.toHaveBeenCalled();
  });

  it("drops a touch room's ghost once the gesture closed, and places nothing", () => {
    const { app, undo, hooks } = makeApp({ type: "build", kind: "office" });
    hooks.onActionDown!(10, 5, true, null);
    hooks.preview = { kind: "office", floor: 5, x: 10, valid: true };
    undo.gesture = NO_GESTURE;
    hooks.onActionMove!(14, 6, null);
    expect([hooks.preview, app.buildAnchor]).toEqual([null, null]);
    hooks.onActionUp!();
    expect(placeSimpleBuild).not.toHaveBeenCalled();
  });

  it("leaves a gesture opened over it for that gesture to close", () => {
    const { app, undo, hooks } = makeApp({ type: "bulldoze" });
    hooks.onActionDown!(5, 2, false, { id: 1 });
    undo.gesture += 1; // another gesture opened and is still under way
    hooks.onActionUp!();
    expect(app.commitUndo).not.toHaveBeenCalled();
  });

  it("closes its own gesture when a pinch cuts a touch paint off, and paints no more", () => {
    vi.mocked(isPaintTool).mockReturnValue(true);
    const { app, hooks } = makeApp({ type: "build", kind: "floor" });
    hooks.onActionDown!(5, 2, true, null);
    hooks.onActionMove!(6, 2, null); // the first move lays the strip
    hooks.onActionCancel!(); // a second finger down: the press never releases
    expect(app.commitUndo, "the step holds what the drag did").toHaveBeenCalledOnce();
    hooks.onActionMove!(7, 2, null);
    expect(app.build.paintFloorRun).toHaveBeenCalledTimes(1);
  });

  it("drops the anchors and the run a cut-off press left, and places nothing", () => {
    const { app, hooks } = makeApp({ type: "build", kind: "office" });
    hooks.onActionDown!(10, 5, true, null); // a touch room waits for its release
    app.paintAnchor = { tile: 3, floor: 2 };
    app.transportStart = { x: 4, floor: 1 };
    app.build.clearPaint.mockClear();
    hooks.onActionCancel!();
    expect([app.paintAnchor, app.buildAnchor, app.transportStart]).toEqual([null, null, null]);
    expect(app.build.clearPaint).toHaveBeenCalledOnce();
    expect(placeSimpleBuild).not.toHaveBeenCalled();
  });

  it("drops the ghosts a cut-off elevator drag left, so a press that never moves builds nothing", () => {
    vi.mocked(placeSimpleBuild).mockReturnValue(null);
    vi.mocked(isTransportTool).mockReturnValue(true);
    const { app, hooks } = makeApp({ type: "build", kind: "elevatorStandard" });
    hooks.onActionDown!(10, 1, true, null);
    hooks.transportPreview = { kind: "elevatorStandard", x: 10, bottom: 1, top: 3, valid: true };
    hooks.preview = { kind: "office", floor: 5, x: 10, valid: true };
    hooks.onActionCancel!(); // the browser canceled the pointer mid-drag
    expect([hooks.preview, hooks.transportPreview]).toEqual([null, null]);
    hooks.onActionDown!(30, 4, true, null);
    hooks.onActionUp!();
    expect(app.build.tryBuildTransport).not.toHaveBeenCalled();
  });

  it("drops the ghost a lost release left, so the next press builds only what it sizes", () => {
    vi.mocked(placeSimpleBuild).mockReturnValue(null);
    vi.mocked(isTransportTool).mockReturnValue(true);
    const { app, hooks } = makeApp({ type: "build", kind: "elevatorStandard" });
    hooks.onActionDown!(10, 1, false, null);
    hooks.transportPreview = { kind: "elevatorStandard", x: 10, bottom: 1, top: 6, valid: true };
    // The release happened off the canvas, so no onActionUp or cancel came.
    hooks.onActionDown!(30, 4, false, null);
    expect(hooks.transportPreview).toBeNull();
    hooks.onActionUp!();
    expect(app.build.tryBuildTransport).not.toHaveBeenCalled();
  });

  it("leaves a gesture opened over a pinched drag for that gesture to close", () => {
    vi.mocked(isPaintTool).mockReturnValue(true);
    const { app, undo, hooks } = makeApp({ type: "build", kind: "floor" });
    hooks.onActionDown!(5, 2, true, null);
    undo.gesture += 1;
    hooks.onActionCancel!();
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

describe("a bulldoze drag removes only the kind it first touched (#644)", () => {
  const FLOOR_TILE = (x: number) => ({ type: "unit", id: 0, kind: "floor", cell: { floor: 2, x } });
  const SHAFT = { type: "transport", id: 9, kind: "elevatorStandard" };
  const OFFICE = { type: "unit", id: 4, kind: "office" };

  it("sweeps a floor's tiles and leaves the elevator it crosses", () => {
    const { app, hooks } = makeApp({ type: "bulldoze" });
    hooks.onActionDown!(5, 2, false, FLOOR_TILE(5));
    hooks.onActionMove!(6, 2, SHAFT);
    hooks.onActionMove!(7, 2, OFFICE);
    hooks.onActionMove!(8, 2, FLOOR_TILE(8));
    expect(vi.mocked(app.build.bulldozePicked).mock.calls.map(([p]) => p)).toEqual([FLOOR_TILE(5), FLOOR_TILE(8)]);
  });

  it("removes the elevator when the drag starts on it, and nothing else", () => {
    const { app, hooks } = makeApp({ type: "bulldoze" });
    hooks.onActionDown!(6, 2, false, SHAFT);
    hooks.onActionMove!(7, 2, FLOOR_TILE(7));
    expect(vi.mocked(app.build.bulldozePicked).mock.calls.map(([p]) => p)).toEqual([SHAFT]);
  });

  it("takes the kind of the first thing it reaches when it starts on empty sky", () => {
    const { app, hooks } = makeApp({ type: "bulldoze" });
    hooks.onActionDown!(1, 2, false, null);
    hooks.onActionMove!(2, 2, null);
    hooks.onActionMove!(3, 2, OFFICE);
    hooks.onActionMove!(4, 2, SHAFT);
    hooks.onActionMove!(5, 2, { ...OFFICE, id: 5 });
    expect(vi.mocked(app.build.bulldozePicked).mock.calls.slice(1).map(([p]) => p)).toEqual([OFFICE, { ...OFFICE, id: 5 }]);
  });

  it("starts fresh on the next press", () => {
    const { app, hooks } = makeApp({ type: "bulldoze" });
    hooks.onActionDown!(5, 2, false, FLOOR_TILE(5));
    hooks.onActionUp!();
    hooks.onActionDown!(6, 2, false, SHAFT);
    expect(app.build.bulldozePicked).toHaveBeenLastCalledWith(SHAFT);
  });
});

describe("a bulldoze drag sweeps more than one thing", () => {
  const LOBBY_TILE = (x: number) => ({ type: "unit", id: 0, kind: "lobby", cell: { floor: 15, x } });
  const FLOOR_TILE = (x: number) => ({ type: "unit", id: 0, kind: "floor", cell: { floor: 15, x } });
  const SHAFT = { type: "transport", id: 9, kind: "elevatorExpress" };
  const OFFICE = { type: "unit", id: 4, kind: "office" };
  const swept = (app: ReturnType<typeof makeApp>["app"]) => vi.mocked(app.build.bulldozePicked).mock.calls.map(([p]) => p);

  it("clears every sky lobby tile it crosses, past the shaft in the hall", () => {
    const { app, hooks } = makeApp({ type: "bulldoze" });
    hooks.onActionDown!(100, 15, false, LOBBY_TILE(100));
    for (const x of [101, 102, 103]) hooks.onActionMove!(x, 15, LOBBY_TILE(x));
    hooks.onActionMove!(104, 15, SHAFT);
    hooks.onActionMove!(105, 15, LOBBY_TILE(105));
    expect(swept(app)).toEqual([100, 101, 102, 103, 105].map(LOBBY_TILE));
  });

  it("clears everything it crosses once the Bulldoze card says Everything", () => {
    const { app, hooks } = makeApp({ type: "bulldoze" });
    app.bulldozeDrag.pick("everything");
    hooks.onActionDown!(100, 15, false, LOBBY_TILE(100));
    hooks.onActionMove!(101, 15, SHAFT);
    hooks.onActionMove!(102, 15, OFFICE);
    hooks.onActionMove!(103, 15, FLOOR_TILE(103));
    hooks.onActionMove!(104, 15, LOBBY_TILE(104));
    expect(swept(app)).toEqual([LOBBY_TILE(100), SHAFT, OFFICE, FLOOR_TILE(103), LOBBY_TILE(104)]);
  });

  it("goes back to one kind when the card says One kind again", () => {
    const { app, hooks } = makeApp({ type: "bulldoze" });
    app.bulldozeDrag.pick("everything");
    app.bulldozeDrag.pick("one kind");
    hooks.onActionDown!(100, 15, false, LOBBY_TILE(100));
    hooks.onActionMove!(101, 15, SHAFT);
    hooks.onActionMove!(102, 15, LOBBY_TILE(102));
    expect(swept(app)).toEqual([LOBBY_TILE(100), LOBBY_TILE(102)]);
  });
});
