import { vi } from "vitest";
import * as ex from "excalibur";
import { PinchTracker } from "../pinchTracker";
import { FLOOR, TILE } from "../scale";
import { bindInput } from "./towerInputCamera";

/**
 * The fake engine and pointer events the pointer-input tests drive
 * `bindInput`'s real handlers with (captured from a fake pointer bus), with a
 * real {@link PinchTracker}.
 */

export type Handlers = Record<string, (ev: unknown) => void>;

/** A fake engine plus the captured pointer handlers. The tracker is real; the
 *  camera transform is the standard centered-camera affine so wheel-zoom and
 *  the coordinate reads behave like the real getters. */
export function inputEng(over: Record<string, unknown> = {}) {
  const handlers: Handlers = {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests set and read the fake's fields freely
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
    onActionCancel: vi.fn(),
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
export function ptr(opts: {
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
