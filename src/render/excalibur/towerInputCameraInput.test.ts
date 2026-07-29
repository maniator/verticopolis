import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as ex from "excalibur";
import { PinchTracker } from "../pinchTracker";
import { FLOOR, TILE } from "../scale";
import { bindInput } from "./towerInputCamera";

/**
 * The Excalibur pointer gesture handlers registered by bindInput, exercised
 * through the real handlers it binds (captured from a fake pointer bus) with a
 * real {@link PinchTracker}. These pin the tap/pan/action/hover routing, the
 * in-world extend-arrow drag, the right-click inspect, and the pinch handoff,
 * asserting the exact controller hook that fires and its tile/floor arguments,
 * not just that nothing threw.
 */

type Handlers = Record<string, (ev: unknown) => void>;

/** A fake engine plus the captured pointer handlers. The tracker is real; the
 *  camera transform is the standard centered-camera affine so wheel-zoom and
 *  the coordinate reads behave like the real getters. */
function inputEng(over: Record<string, unknown> = {}) {
  const handlers: Handlers = {};

  const e: any = {
    cam: { pos: ex.vec(1000, -1000), zoom: 1 },
    viewWidth: 800,
    viewHeight: 600,
    tracker: new PinchTracker(),
    gesture: null,
    moved: 0,
    downTouch: false,
    lastSx: 0,
    lastSy: 0,
    downSx: 0,
    downSy: 0,
    longPressTimer: null,
    longPressFired: false,
    arrowDrag: null,
    arrowHit: {},
    selectedId: null,
    preview: { kind: "office" },
    transportPreview: { kind: "elevatorStandard" },
    classifyDown: () => "pan",
    onTap: vi.fn(),
    onActionDown: vi.fn(),
    onActionMove: vi.fn(),
    onActionUp: vi.fn(),
    onHover: vi.fn(),
    onLongPress: vi.fn(),
    onLongPressEnd: vi.fn(),
    onSecondary: vi.fn(),
    onExtendTo: vi.fn(),
    onExtendEnd: vi.fn(),
    transportActors: new Map(),
    sim: { tower: { getTransport: () => undefined, unitAt: () => undefined } },
    engine: {
      input: {
        pointers: { on: (name: string, cb: (ev: unknown) => void) => (handlers[name] = cb) },
        keyboard: { isHeld: () => false },
      },
    },
    screenToWorld(sx: number, sy: number) {
      return ex.vec((sx - e.viewWidth / 2) / e.cam.zoom + e.cam.pos.x, (sy - e.viewHeight / 2) / e.cam.zoom + e.cam.pos.y);
    },
    screenToFloor(sy: number) {
      return Math.ceil(-e.screenToWorld(e.viewWidth / 2, sy).y / FLOOR);
    },
    ...over,
  };
  bindInput(e);
  return { e, handlers };
}

/** A fake Excalibur PointerEvent. worldPos is chosen so tf() resolves to the
 *  requested tile/floor: worldToCell floors x/TILE and ceils -y/FLOOR. */
function ptr(opts: {
  tile?: number;
  floor?: number;
  sx?: number;
  sy?: number;
  button?: ex.PointerButton;
  touch?: boolean;
  pointerId?: number;
  shift?: boolean;
}): unknown {
  const tile = opts.tile ?? 10;
  const floor = opts.floor ?? 5;
  return {
    button: opts.button ?? ex.PointerButton.Left,
    pointerType: opts.touch ? "Touch" : "Mouse",
    pointerId: opts.pointerId ?? 1,
    nativeEvent: { pointerId: opts.pointerId ?? 1, shiftKey: opts.shift ?? false },
    worldPos: ex.vec(tile * TILE, -floor * FLOOR),
    screenPos: { x: opts.sx ?? 400, y: opts.sy ?? 300 },
  };
}

describe("wheel zoom", () => {
  it("scrolls up to zoom in and down to zoom out", () => {
    const { e, handlers } = inputEng();
    const z0 = e.cam.zoom;
    handlers.wheel({ deltaY: -1, x: 400, y: 300 });
    expect(e.cam.zoom).toBeGreaterThan(z0);
    const z1 = e.cam.zoom;
    handlers.wheel({ deltaY: 1, x: 400, y: 300 });
    expect(e.cam.zoom).toBeLessThan(z1);
  });

  it("Shift+wheel (browser-remapped to deltaX) still zooms both directions", () => {
    // Browsers move Shift+wheel motion into deltaX with deltaY 0. Shift is a
    // sanctioned held pan key, so the handler must read the fallback axis
    // instead of treating "deltaY not negative" as zoom-out on every notch.
    const { e, handlers } = inputEng();
    const z0 = e.cam.zoom;
    handlers.wheel({ deltaY: 0, deltaX: -1, x: 400, y: 300, ev: { shiftKey: true } });
    expect(e.cam.zoom).toBeGreaterThan(z0);
    const z1 = e.cam.zoom;
    handlers.wheel({ deltaY: 0, deltaX: 1, x: 400, y: 300, ev: { shiftKey: true } });
    expect(e.cam.zoom).toBeLessThan(z1);
    const z2 = e.cam.zoom;
    handlers.wheel({ deltaY: 0, deltaX: 0, x: 400, y: 300, ev: { shiftKey: true } });
    expect(e.cam.zoom).toBe(z2); // dead event: no-op
  });

  it("an unmodified horizontal scroll never zooms (the deltaX fallback is Shift-only)", () => {
    // A two-finger sideways trackpad swipe is a scroll gesture, not a zoom;
    // only the Shift remap earns the fallback axis.
    const { e, handlers } = inputEng();
    const z0 = e.cam.zoom;
    handlers.wheel({ deltaY: 0, deltaX: -3, x: 400, y: 300, ev: { shiftKey: false } });
    handlers.wheel({ deltaY: 0, deltaX: 3, x: 400, y: 300 }); // no native ev at all
    expect(e.cam.zoom).toBe(z0);
  });
});

describe("pointer down routing", () => {
  it("an action gesture reports the tile/floor under the pointer", () => {
    const { e, handlers } = inputEng({ classifyDown: () => "action" });
    handlers.down(ptr({ tile: 12, floor: 7 }));
    expect(e.gesture).toBe("action");
    expect(e.onActionDown).toHaveBeenCalledWith(12, 7, false, null);
  });

  it("Shift at the press reaches classifyDown as the pan key (Shift+drag pans)", () => {
    const classifyDown = vi.fn(() => "pan");
    const { e, handlers } = inputEng({ classifyDown });
    handlers.down(ptr({ shift: true }));
    expect(classifyDown).toHaveBeenCalledWith(0, false, true);
    expect(e.gesture).toBe("pan");
    expect(e.onActionDown).not.toHaveBeenCalled();
  });

  it("without Shift (and no Space) the pan key is false", () => {
    const classifyDown = vi.fn(() => "action");
    const { handlers } = inputEng({ classifyDown });
    handlers.down(ptr({}));
    expect(classifyDown).toHaveBeenCalledWith(0, false, false);
  });

  it("held Space still reaches classifyDown as the pan key (unchanged by Shift support)", () => {
    const classifyDown = vi.fn(() => "pan");
    const { e, handlers } = inputEng({ classifyDown });
    e.engine.input.keyboard.isHeld = () => true;
    handlers.down(ptr({}));
    expect(classifyDown).toHaveBeenCalledWith(0, false, true);
  });

  it("a right-click inspects under the cursor without starting a gesture", () => {
    const { e, handlers } = inputEng();
    handlers.down(ptr({ button: ex.PointerButton.Right, tile: 3, floor: 2 }));
    expect(e.onSecondary).toHaveBeenCalledTimes(1);
    expect(e.gesture).toBeNull();
    expect(e.onActionDown).not.toHaveBeenCalled();
  });

  it("a press on the selected elevator's extend arrow begins an arrow drag", () => {
    const { e, handlers } = inputEng({
      onExtendTo: vi.fn(),
      arrowHit: { up: { x: 380, y: 280, w: 40, h: 40 } },
    });
    handlers.down(ptr({ sx: 400, sy: 300 }));
    expect(e.arrowDrag).toEqual({ end: "up" });
    expect(e.gesture).toBeNull();
  });

  it("a held pan key skips the extend arrow: Shift+press on it pans, never resizes", () => {
    // The modifier's promise is that the drag only pans; a shaft resize is a
    // paid mutation, exactly what it exists to escape.
    const { e, handlers } = inputEng({
      onExtendTo: vi.fn(),
      arrowHit: { up: { x: 380, y: 280, w: 40, h: 40 } },
    });
    handlers.down(ptr({ sx: 400, sy: 300, shift: true }));
    expect(e.arrowDrag).toBeNull();
    expect(e.gesture).toBe("pan");
    expect(e.onExtendTo).not.toHaveBeenCalled();
  });

  it("a second finger forming a pinch cancels a live arrow drag and clears previews", () => {
    const { e, handlers } = inputEng({ onExtendEnd: vi.fn() });
    handlers.down(ptr({ pointerId: 1, sx: 100, sy: 100 })); // single
    e.arrowDrag = { end: "down" };
    handlers.down(ptr({ pointerId: 2, sx: 300, sy: 300 })); // pinch-start
    expect(e.onExtendEnd).toHaveBeenCalledTimes(1);
    expect(e.arrowDrag).toBeNull();
    expect(e.preview).toBeNull();
    expect(e.transportPreview).toBeNull();
  });
});

describe("pointer move routing", () => {
  it("a pan drag moves the camera and accumulates travel", () => {
    const { e, handlers } = inputEng();
    handlers.down(ptr({ sx: 400, sy: 300 })); // gesture -> pan
    const x0 = e.cam.pos.x;
    handlers.move(ptr({ sx: 360, sy: 300 }));
    expect(e.cam.pos.x).not.toBe(x0);
    expect(e.moved).toBeGreaterThan(0);
  });

  it("an action drag reports the moved-over cell", () => {
    const { e, handlers } = inputEng({ classifyDown: () => "action" });
    handlers.down(ptr({ tile: 5, floor: 5 }));
    handlers.move(ptr({ tile: 6, floor: 8 }));
    expect(e.onActionMove).toHaveBeenCalledWith(6, 8, null);
  });

  it("a mouse move with no gesture hovers", () => {
    const { e, handlers } = inputEng();
    handlers.move(ptr({ tile: 9, floor: 4 }));
    expect(e.onHover).toHaveBeenCalledWith(9, 4, null);
  });

  it("a touch move with no gesture never hovers (no stranded ghost)", () => {
    const { e, handlers } = inputEng();
    handlers.move(ptr({ touch: true, tile: 9, floor: 4 }));
    expect(e.onHover).not.toHaveBeenCalled();
  });

  it("an arrow drag extends toward the dragged-to floor", () => {
    const { e, handlers } = inputEng({ onExtendTo: vi.fn() });
    e.arrowDrag = { end: "up" };
    handlers.move(ptr({ sx: 400, sy: 120 }));
    expect(e.onExtendTo).toHaveBeenCalledTimes(1);
    expect(e.onExtendTo.mock.calls[0][0]).toBe("up");
  });

  it("a two-finger pinch pans the camera by the midpoint delta", () => {
    const { e, handlers } = inputEng();
    handlers.down(ptr({ pointerId: 1, sx: 200, sy: 300 }));
    handlers.down(ptr({ pointerId: 2, sx: 400, sy: 300 })); // pinch-start
    const x0 = e.cam.pos.x;
    // Slide both fingers right: the midpoint moves, so the camera pans.
    handlers.move(ptr({ pointerId: 1, sx: 240, sy: 300 }));
    handlers.move(ptr({ pointerId: 2, sx: 440, sy: 300 }));
    expect(e.cam.pos.x).not.toBe(x0);
  });
});

describe("pointer up routing", () => {
  it("a short pan is a tap", () => {
    const { e, handlers } = inputEng();
    handlers.down(ptr({ tile: 4, floor: 6, sx: 400, sy: 300 }));
    handlers.up(ptr({ tile: 4, floor: 6, sx: 401, sy: 300 }));
    expect(e.onTap).toHaveBeenCalledWith(4, 6, false, null);
  });

  it("a long pan is not a tap", () => {
    const { e, handlers } = inputEng();
    handlers.down(ptr({ sx: 400, sy: 300 }));
    handlers.move(ptr({ sx: 300, sy: 300 })); // moved 100 px, past the slop
    handlers.up(ptr({ sx: 300, sy: 300 }));
    expect(e.onTap).not.toHaveBeenCalled();
  });

  it("an action gesture reports its release cell", () => {
    const { e, handlers } = inputEng({ classifyDown: () => "action" });
    handlers.down(ptr({ tile: 2, floor: 2 }));
    handlers.up(ptr({ tile: 2, floor: 3 }));
    expect(e.onActionUp).toHaveBeenCalledWith(2, 3, null);
  });

  it("an arrow-tap (no drag) extends the selected shaft one floor and ends the gesture", () => {
    const { e, handlers } = inputEng({
      selectedId: 5,
      onExtendTo: vi.fn(),
      onExtendEnd: vi.fn(),
      sim: { tower: { getTransport: () => ({ top: 20, bottom: 4 }), unitAt: () => undefined } },
    });
    e.arrowDrag = { end: "up" };
    e.moved = 0;
    handlers.up(ptr({ sx: 400, sy: 300 }));
    expect(e.onExtendTo).toHaveBeenCalledWith("up", 21); // top + 1
    expect(e.onExtendEnd).toHaveBeenCalledTimes(1);
    expect(e.arrowDrag).toBeNull();
  });

  it("cancel routes through the up handler", () => {
    const { e, handlers } = inputEng({ classifyDown: () => "action" });
    handlers.down(ptr({ tile: 1, floor: 1 }));
    handlers.cancel(ptr({ tile: 1, floor: 1 }));
    expect(e.onActionUp).toHaveBeenCalledTimes(1);
  });

  it("a pinch that ends with a surviving finger hands it a pan continuation", () => {
    const { e, handlers } = inputEng();
    handlers.down(ptr({ pointerId: 1, sx: 200, sy: 300 }));
    handlers.down(ptr({ pointerId: 2, sx: 400, sy: 300 })); // pinch
    handlers.up(ptr({ pointerId: 1, sx: 200, sy: 300 })); // one finger left
    expect(e.gesture).toBe("pan");
    expect(e.moved).toBeGreaterThan(1000); // slop poisoned so the release can't tap
  });

  it("lifting one finger of a three-finger pinch keeps the pinch live", () => {
    const { e, handlers } = inputEng();
    handlers.down(ptr({ pointerId: 1, sx: 100, sy: 300 }));
    handlers.down(ptr({ pointerId: 2, sx: 300, sy: 300 }));
    handlers.down(ptr({ pointerId: 3, sx: 500, sy: 300 }));
    handlers.up(ptr({ pointerId: 3, sx: 500, sy: 300 }));
    expect(e.gesture).toBeNull();
    expect(e.tracker.pinching).toBe(true);
  });
});

describe("long-press to peek (touch hold)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // A press only peeks over a real facility (armLongPress skips null/floor/lobby),
  // so tests that expect a peek to fire put an inspectable unit under the finger.
  const OVER_ROOM = { sim: { tower: { getTransport: () => undefined, unitAt: () => ({ id: 1, kind: "office" }) } } };

  it("a stationary touch hold fires onLongPress at the knee with the pressed cell and pick", () => {
    const unit = { id: 7, kind: "office" };
    const { e, handlers } = inputEng({
      sim: { tower: { getTransport: () => undefined, unitAt: () => unit } },
    });
    handlers.down(ptr({ touch: true, tile: 8, floor: 3, sx: 400, sy: 300 }));
    expect(e.onLongPress).not.toHaveBeenCalled(); // not yet at the knee
    vi.advanceTimersByTime(500);
    expect(e.onLongPress).toHaveBeenCalledWith(8, 3, { type: "unit", id: 7, kind: "office" });
    expect(e.longPressFired).toBe(true);
  });

  it("a mouse press never arms the hold", () => {
    const { e, handlers } = inputEng({ classifyDown: () => "action" });
    handlers.down(ptr({ touch: false, tile: 8, floor: 3 }));
    vi.advanceTimersByTime(1000);
    expect(e.onLongPress).not.toHaveBeenCalled();
  });

  it("moving past the tap slop before the knee cancels the peek (it becomes a drag)", () => {
    const { e, handlers } = inputEng();
    handlers.down(ptr({ touch: true, sx: 400, sy: 300 }));
    handlers.move(ptr({ touch: true, sx: 420, sy: 300 })); // 20 px > slop
    vi.advanceTimersByTime(1000);
    expect(e.onLongPress).not.toHaveBeenCalled();
  });

  it("a tiny jitter within slop still peeks", () => {
    const { e, handlers } = inputEng(OVER_ROOM);
    handlers.down(ptr({ touch: true, sx: 400, sy: 300 }));
    handlers.move(ptr({ touch: true, sx: 405, sy: 302 })); // 7 px < slop
    vi.advanceTimersByTime(500);
    expect(e.onLongPress).toHaveBeenCalledTimes(1);
  });

  it("releasing before the knee cancels the peek and taps as usual", () => {
    const { e, handlers } = inputEng();
    handlers.down(ptr({ touch: true, tile: 4, floor: 6, sx: 400, sy: 300 }));
    handlers.up(ptr({ touch: true, tile: 4, floor: 6, sx: 401, sy: 300 }));
    vi.advanceTimersByTime(1000);
    expect(e.onLongPress).not.toHaveBeenCalled();
    expect(e.onTap).toHaveBeenCalledWith(4, 6, true, null); // still a tap
  });

  it("releasing after a peek dismisses it and swallows the tap", () => {
    const { e, handlers } = inputEng(OVER_ROOM);
    handlers.down(ptr({ touch: true, tile: 4, floor: 6, sx: 400, sy: 300 }));
    vi.advanceTimersByTime(500); // peek fires
    handlers.up(ptr({ touch: true, tile: 4, floor: 6, sx: 400, sy: 300 }));
    expect(e.onLongPressEnd).toHaveBeenCalledTimes(1);
    expect(e.onTap).not.toHaveBeenCalled(); // the glance never opens the editor
    expect(e.longPressFired).toBe(false);
    expect(e.gesture).toBeNull();
  });

  it("a second finger cancels a pending peek", () => {
    const { e, handlers } = inputEng();
    handlers.down(ptr({ touch: true, pointerId: 1, sx: 200, sy: 300 }));
    handlers.down(ptr({ touch: true, pointerId: 2, sx: 400, sy: 300 })); // pinch-start
    vi.advanceTimersByTime(1000);
    expect(e.onLongPress).not.toHaveBeenCalled();
  });

  it("does not arm over empty space or a floor/lobby tile (a slow tap/build still lands)", () => {
    // Empty: unitAt returns undefined, pickEntityAt is null.
    const empty = inputEng();
    empty.handlers.down(ptr({ touch: true, tile: 8, floor: 3 }));
    vi.advanceTimersByTime(1000);
    expect(empty.e.onLongPress).not.toHaveBeenCalled();
    // Floor tile: a non-inspectable unit, so no peek arms.
    const floor = inputEng({
      sim: { tower: { getTransport: () => undefined, unitAt: () => ({ id: 1, kind: "floor" }) } },
    });
    floor.handlers.down(ptr({ touch: true, tile: 8, floor: 3 }));
    vi.advanceTimersByTime(1000);
    expect(floor.e.onLongPress).not.toHaveBeenCalled();
  });

  it("while a peek is PENDING, a within-slop jitter does not drive the tool (no stray paint)", () => {
    const unit = { id: 9, kind: "office" };
    const { e, handlers } = inputEng({
      classifyDown: () => "action",
      sim: { tower: { getTransport: () => undefined, unitAt: () => unit } },
    });
    handlers.down(ptr({ touch: true, tile: 5, floor: 5, sx: 400, sy: 300 }));
    handlers.move(ptr({ touch: true, tile: 5, floor: 5, sx: 405, sy: 302 })); // 7px jitter, timer still pending
    expect(e.onActionMove).not.toHaveBeenCalled(); // pending hold is inert
    vi.advanceTimersByTime(500);
    expect(e.onLongPress).toHaveBeenCalledTimes(1); // and the peek still fires
  });

  it("a fired peek owns the gesture: a later move neither pans nor drives the tool", () => {
    const unit = { id: 2, kind: "office" };
    const { e, handlers } = inputEng({
      classifyDown: () => "action",
      sim: { tower: { getTransport: () => undefined, unitAt: () => unit } },
    });
    handlers.down(ptr({ touch: true, tile: 5, floor: 5, sx: 400, sy: 300 }));
    vi.advanceTimersByTime(500); // peek fires
    expect(e.gesture).toBeNull(); // gesture surrendered on fire
    const x0 = e.cam.pos.x;
    handlers.move(ptr({ touch: true, tile: 9, floor: 9, sx: 300, sy: 300 })); // big move
    expect(e.onActionMove).not.toHaveBeenCalled(); // tool not re-driven
    expect(e.cam.pos.x).toBe(x0); // camera did not pan
  });

  it("a second finger AFTER the peek dismisses it and leaves the survivor able to pan", () => {
    const unit = { id: 3, kind: "office" };
    const { e, handlers } = inputEng({
      sim: { tower: { getTransport: () => undefined, unitAt: () => unit } },
    });
    handlers.down(ptr({ touch: true, pointerId: 1, sx: 200, sy: 300 }));
    vi.advanceTimersByTime(500); // peek fires
    handlers.down(ptr({ touch: true, pointerId: 2, sx: 400, sy: 300 })); // pinch-start
    expect(e.onLongPressEnd).toHaveBeenCalledTimes(1); // dismissed by the second finger
    expect(e.longPressFired).toBe(false); // latch reset
    handlers.up(ptr({ touch: true, pointerId: 1, sx: 200, sy: 300 })); // one finger left
    expect(e.gesture).toBe("pan"); // survivor seeded a pan, not swallowed
    expect(e.moved).toBeGreaterThan(1000);
  });

  it("a hovering mouse move does not cancel a touch's pending peek or drive its gesture", () => {
    // Hybrid touch+mouse hardware: the mouse hovers (never pressed, so never
    // tracked) while a finger holds for the peek. Its move must not reach the
    // slop check (which would cancel the hold at mouse-vs-touch distance) nor
    // the gesture branches (which would pan or paint at the mouse position).
    const { e, handlers } = inputEng(OVER_ROOM);
    handlers.down(ptr({ touch: true, pointerId: 1, sx: 400, sy: 300 }));
    handlers.move(ptr({ touch: false, pointerId: 99, sx: 100, sy: 100 })); // far past slop
    expect(e.longPressTimer).not.toBeNull(); // hold still pending
    expect(e.onHover).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(e.onLongPress).toHaveBeenCalledTimes(1); // the peek still fires
  });

  it("an untracked release does not end a fired peek or fire the touch's gesture", () => {
    // A mouse press begun off-canvas releasing over it while a finger holds:
    // the stray up must not dismiss the peek, tap, or act at mouse coordinates.
    const { e, handlers } = inputEng(OVER_ROOM);
    handlers.down(ptr({ touch: true, pointerId: 1, sx: 400, sy: 300 }));
    vi.advanceTimersByTime(500); // peek fires
    handlers.up(ptr({ touch: false, pointerId: 99, tile: 2, floor: 8, sx: 100, sy: 100 }));
    expect(e.longPressFired).toBe(true); // peek still owns its finger's release
    expect(e.onLongPressEnd).not.toHaveBeenCalled();
    expect(e.onTap).not.toHaveBeenCalled();
    handlers.up(ptr({ touch: true, pointerId: 1, sx: 400, sy: 300 }));
    expect(e.onLongPressEnd).toHaveBeenCalledTimes(1); // the owner's lift dismisses
  });

  it("with no contact down, a mouse move still hovers", () => {
    const { e, handlers } = inputEng();
    handlers.move(ptr({ touch: false, pointerId: 99, tile: 6, floor: 2 }));
    expect(e.onHover).toHaveBeenCalledWith(6, 2, null);
  });

  it("a new press after a lost release dismisses the orphaned peek, not just its latch", () => {
    const { e, handlers } = inputEng(OVER_ROOM);
    handlers.down(ptr({ touch: true, pointerId: 1, sx: 400, sy: 300 }));
    vi.advanceTimersByTime(500); // peek fires
    expect(e.longPressFired).toBe(true);
    // The browser swallows the up and a tower swap drops the contact (setSim's
    // tracker reset): the fired latch is now an orphan with its card still up.
    e.tracker.reset();
    handlers.down(ptr({ touch: true, pointerId: 2, sx: 100, sy: 100 }));
    expect(e.onLongPressEnd).toHaveBeenCalledTimes(1); // stranded card dismissed on the fresh press
    expect(e.longPressFired).toBe(false);
  });
});
