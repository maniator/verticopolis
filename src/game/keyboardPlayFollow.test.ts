import { beforeEach, describe, expect, it, vi } from "vitest";
import { KeyboardPlay, type KeyboardPlayDeps } from "./keyboardPlay";

// The cursor's cell math, the catalog's names and the shaft quote stand in for
// the world and the engine, which this test does not boot.
vi.mock("../ui/placement", () => ({
  stepCursor: (from: { tile: number; floor: number } | null, dTile: number, dFloor: number) => ({
    tile: (from?.tile ?? 10) + dTile,
    floor: (from?.floor ?? 1) + dFloor,
  }),
  snapX: (_catalog: unknown, _kind: unknown, tile: number) => tile,
  announceForPlacement: () => "",
}));
vi.mock("../catalog/catalogTypes", () => ({ catalogFacility: () => ({ name: "Elevator" }) }));
vi.mock("./portAccess", () => ({ quoteShaft: () => ({ ok: true }) }));

/**
 * After an undo, a redo, a load or a lost graphics context, the renderer's
 * input reset clears the build ghost. `KeyboardPlay.followTower` draws it again
 * on the same tower only when the keyboard cursor drew it last, so a player
 * back on the mouse does not see it jump to an old keyboard cell. Another tower
 * drops the cursor and a shaft anchor, so nothing is built at a cell picked on
 * the old tower, and the next cursor key reveals a fresh cursor.
 */
function keyboardUnder(tool: "office" | "elevator") {
  const engine = { ensureVisible: vi.fn(), preview: null as unknown, transportPreview: null as unknown };
  const deps = {
    engine: () => engine,
    tool: () => ({ type: "build", kind: tool }),
    isTransportTool: () => tool === "elevator",
    updateBuildPreview: vi.fn(),
    placeSimpleBuild: () => null,
    pickedAt: () => null,
    announce: vi.fn(),
    captureUndo: vi.fn(),
    commitUndo: vi.fn(),
    catalog: () => ({}),
    enginePort: () => ({}),
    portCodes: () => ({}),
    isUnlocked: () => true,
  };
  const keyboard = new KeyboardPlay(deps as unknown as KeyboardPlayDeps);
  return { keyboard, engine, deps };
}

describe("the keyboard cursor following a tower", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws its ghost again on the same tower when the keyboard drew it last", () => {
    const { keyboard, deps } = keyboardUnder("office");
    keyboard.moveCursor(0, 1);
    deps.updateBuildPreview.mockClear();
    keyboard.followTower("same tower");
    expect(deps.updateBuildPreview).toHaveBeenCalledExactlyOnceWith(10, 2);
  });

  it("leaves the ghost to the pointer once the pointer drew it", () => {
    const { keyboard, deps } = keyboardUnder("office");
    keyboard.moveCursor(0, 1);
    keyboard.pointerDrew();
    deps.updateBuildPreview.mockClear();
    keyboard.followTower("same tower");
    expect(deps.updateBuildPreview).not.toHaveBeenCalled();
  });

  it("draws nothing for a cursor the player never revealed", () => {
    const { keyboard, deps } = keyboardUnder("office");
    keyboard.followTower("same tower");
    expect(deps.updateBuildPreview).not.toHaveBeenCalled();
  });

  it("drops the cursor on another tower, whose camera may not show the old cell", () => {
    const { keyboard, engine, deps } = keyboardUnder("office");
    keyboard.moveCursor(0, 1);
    deps.updateBuildPreview.mockClear();
    keyboard.followTower("another tower");
    expect(deps.updateBuildPreview).not.toHaveBeenCalled();
    expect(keyboard.cursor()).toBeNull();
    // A later follow on that tower does not bring the old ghost back either.
    keyboard.followTower("same tower");
    expect(deps.updateBuildPreview).not.toHaveBeenCalled();
    // Enter only reveals a fresh cursor, and builds nothing.
    const place = vi.spyOn(deps, "placeSimpleBuild");
    keyboard.commitCursor();
    expect(place).not.toHaveBeenCalled();
    expect(engine.ensureVisible, "the fresh cursor is shown").toHaveBeenLastCalledWith(10, 1);
    expect(deps.updateBuildPreview).toHaveBeenCalledExactlyOnceWith(10, 1);
  });

  it("keeps a shaft anchor through an undo or redo step, and drops one from another tower", () => {
    const shaftAfterFollow = (tower: "same tower" | "another tower"): unknown => {
      const { keyboard, engine } = keyboardUnder("elevator");
      keyboard.moveCursor(0, 0);
      keyboard.commitCursor(); // anchors the shaft at the cursor
      keyboard.moveCursor(0, 3);
      keyboard.followTower(tower);
      engine.transportPreview = null;
      keyboard.moveCursor(0, 0); // the next cursor key draws from the anchor, if one is left
      return engine.transportPreview;
    };
    expect(shaftAfterFollow("same tower"), "the step keeps the anchor").toEqual({
      kind: "elevator",
      x: 10,
      bottom: 1,
      top: 4,
      valid: true,
    });
    expect(shaftAfterFollow("another tower"), "another tower drops it").toBeNull();
  });
});
