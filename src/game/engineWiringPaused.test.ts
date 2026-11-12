import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";
import type { GameMode } from "../shared/types";
import { wireEngine } from "./engineWiring";
import { placeSimpleBuild, isPaintTool, isTransportTool } from "./buildPreview";
import { NO_GESTURE } from "./appHistory";
import { UNPAUSE_TO_BUILD } from "./pausedBuild";

/**
 * The pointer and touch build paths while paused (#1936). Classic's catalog
 * says it does not build while paused, so a press, a tap, a drag's moves and
 * its release place nothing at speed 0 and say why once; Modern's says it
 * does, so they place as usual. The sibling helpers are mocked, as in
 * engineWiringDrag.test.ts, and the catalog is the engine's fixture for the
 * reader's mode.
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

interface Hooks {
  onTap?: (tile: number, floor: number, touch: boolean, picked: unknown) => void;
  onActionDown?: (tile: number, floor: number, touch: boolean, picked: unknown) => void;
  onActionMove?: (tile: number, floor: number, picked: unknown) => void;
  onActionUp?: () => void;
  preview?: unknown;
  transportPreview?: unknown;
}

const PAUSED = 0;
const PLAYING = 1;

/** An app in `mode` at speed `speed` under `tool`. */
function makeApp(mode: GameMode, speed: number, tool: Record<string, unknown>) {
  const undo = { gesture: NO_GESTURE };
  const app = {
    engine: {} as Hooks,
    enginePort: { generation: () => 1 },
    reader: { header: { mode } },
    speed,
    canvas: document.createElement("canvas"),
    audio: { start: vi.fn(), sfx: vi.fn() },
    keyboard: { pointerDrew: vi.fn(), followTower: vi.fn() },
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
  return { app, hooks: app.engine };
}

const OFFICE = { type: "build", kind: "office" };
const FLOOR = { type: "build", kind: "floor" };
const ELEVATOR = { type: "build", kind: "elevatorStandard" };

beforeEach(() => {
  vi.mocked(placeSimpleBuild).mockReturnValue({} as never);
  vi.mocked(isTransportTool).mockReturnValue(false);
  vi.mocked(isPaintTool).mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("a mouse press with a build tool while paused", () => {
  it("places nothing in Classic, opens no undo step, and says to unpause", () => {
    const { app, hooks } = makeApp("classic", PAUSED, OFFICE);
    hooks.onActionDown!(10, 2, false, null);
    hooks.onActionUp!();
    expect(placeSimpleBuild).not.toHaveBeenCalled();
    expect(app.captureUndo).not.toHaveBeenCalled();
    expect(app.ui.toast).toHaveBeenCalledExactlyOnceWith(UNPAUSE_TO_BUILD, "bad");
    expect(app.audio.sfx).toHaveBeenCalledExactlyOnceWith("error");
  });

  it("places as usual in Modern", () => {
    const { app, hooks } = makeApp("modern", PAUSED, OFFICE);
    hooks.onActionDown!(10, 2, false, null);
    expect(placeSimpleBuild).toHaveBeenCalledOnce();
    expect(app.ui.toast).not.toHaveBeenCalled();
  });

  it("places as usual in Classic once the clock runs", () => {
    const { app, hooks } = makeApp("classic", PLAYING, OFFICE);
    hooks.onActionDown!(10, 2, false, null);
    expect(placeSimpleBuild).toHaveBeenCalledOnce();
    expect(app.ui.toast).not.toHaveBeenCalled();
  });

  it("lays no paint run on the drag that follows a refused press in Classic", () => {
    vi.mocked(isPaintTool).mockReturnValue(true);
    const { app, hooks } = makeApp("classic", PAUSED, FLOOR);
    hooks.onActionDown!(10, 2, false, null);
    hooks.onActionMove!(14, 2, null);
    hooks.onActionUp!();
    expect(app.build.paintFloorRun).not.toHaveBeenCalled();
    expect(app.ui.toast, "one note for the whole gesture").toHaveBeenCalledOnce();
  });

  it("leaves the bulldozer working in Classic", () => {
    const { app, hooks } = makeApp("classic", PAUSED, { type: "bulldoze", kind: "office" });
    hooks.onActionDown!(10, 2, false, { type: "unit", id: 7, kind: "office" });
    expect(app.build.bulldozePicked).toHaveBeenCalledOnce();
    expect(app.ui.toast).not.toHaveBeenCalled();
  });
});

describe("a touch tap with a build tool while paused", () => {
  it("places nothing in Classic and says to unpause", () => {
    const { app, hooks } = makeApp("classic", PAUSED, OFFICE);
    hooks.onTap!(10, 2, true, null);
    expect(placeSimpleBuild).not.toHaveBeenCalled();
    expect(app.captureUndo).not.toHaveBeenCalled();
    expect(app.ui.toast).toHaveBeenCalledExactlyOnceWith(UNPAUSE_TO_BUILD, "bad");
  });

  it("places as usual in Modern", () => {
    const { hooks } = makeApp("modern", PAUSED, OFFICE);
    hooks.onTap!(10, 2, true, null);
    expect(placeSimpleBuild).toHaveBeenCalledOnce();
  });
});

describe("a drag begun while the clock ran, after the game pauses", () => {
  it("stops laying its paint run in Classic", () => {
    vi.mocked(isPaintTool).mockReturnValue(true);
    const { app, hooks } = makeApp("classic", PLAYING, FLOOR);
    hooks.onActionDown!(10, 2, false, null);
    hooks.onActionMove!(12, 2, null);
    expect(app.build.paintFloorRun).toHaveBeenCalledOnce();
    app.speed = PAUSED;
    hooks.onActionMove!(14, 2, null);
    hooks.onActionMove!(16, 2, null);
    hooks.onActionUp!();
    expect(app.build.paintFloorRun, "no tile after the pause").toHaveBeenCalledOnce();
    expect(app.ui.toast, "the stop says why, once for the drag").toHaveBeenCalledExactlyOnceWith(UNPAUSE_TO_BUILD, "bad");
  });

  it("lays no deferred touch strip on release in Classic, and says why once", () => {
    vi.mocked(isPaintTool).mockReturnValue(true);
    const { app, hooks } = makeApp("classic", PLAYING, FLOOR);
    hooks.onActionDown!(10, 2, true, null);
    expect(app.paintAnchor, "a touch paint defers to the move").not.toBeNull();
    app.speed = PAUSED;
    hooks.onActionMove!(12, 2, null);
    hooks.onActionUp!();
    expect(app.build.seedPaint).not.toHaveBeenCalled();
    expect(app.build.paintFloorRun).not.toHaveBeenCalled();
    expect(app.ui.toast).toHaveBeenCalledExactlyOnceWith(UNPAUSE_TO_BUILD, "bad");
    expect(app.audio.sfx).toHaveBeenCalledExactlyOnceWith("error");
  });

  it("commits no shaft on release in Classic, and says why once", () => {
    vi.mocked(isTransportTool).mockReturnValue(true);
    vi.mocked(placeSimpleBuild).mockReturnValue(null);
    const { app, hooks } = makeApp("classic", PLAYING, ELEVATOR);
    hooks.onActionDown!(10, 2, false, null);
    expect(app.transportStart, "the press anchors the shaft").not.toBeNull();
    // The ghost a drag up to floor 6 drew (the move's quote is shaftPreview's).
    hooks.transportPreview = { kind: "elevatorStandard", x: 10, bottom: 2, top: 6, valid: true };
    app.speed = PAUSED;
    hooks.onActionUp!();
    expect(app.build.tryBuildTransport).not.toHaveBeenCalled();
    expect(app.ui.toast).toHaveBeenCalledExactlyOnceWith(UNPAUSE_TO_BUILD, "bad");
    expect(hooks.transportPreview, "the ghost is cleared").toBeNull();
  });

  it("commits the shaft on release in Modern", () => {
    vi.mocked(isTransportTool).mockReturnValue(true);
    vi.mocked(placeSimpleBuild).mockReturnValue(null);
    const { app, hooks } = makeApp("modern", PLAYING, ELEVATOR);
    hooks.onActionDown!(10, 2, false, null);
    hooks.transportPreview = { kind: "elevatorStandard", x: 10, bottom: 2, top: 6, valid: true };
    app.speed = PAUSED;
    hooks.onActionUp!();
    expect(app.build.tryBuildTransport).toHaveBeenCalledExactlyOnceWith("elevatorStandard", 10, 2, 6);
  });
});
