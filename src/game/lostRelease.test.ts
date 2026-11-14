import { describe, it, expect, vi, afterEach } from "vitest";
import type { GameApp } from "../main";
import { PinchTracker } from "../render/pinchTracker";
import { watchLostRelease } from "./lostRelease";

/**
 * The page-level end of a tower press (#1014, #824): a release elsewhere on
 * the page, or a blur, cancels the press the canvas still holds. The tower
 * renderer is a fake holding the real tracker; the assertions are the hooks
 * the cancel reaches.
 */

const MOUSE = 1;

function setup() {
  const canvas = document.createElement("canvas");
  const panel = document.createElement("div");
  document.body.append(canvas, panel);
  const tracker = new PinchTracker();
  const engine = {
    tracker,
    gesture: "action" as "pan" | "action" | null,
    arrowDrag: null as { end: "up" | "down"; shaft: number | null } | null,
    longPressTimer: null,
    longPressFired: false,
    onActionCancel: vi.fn(),
    onExtendEnd: vi.fn(),
    onLongPressEnd: vi.fn(),
  };
  tracker.down(MOUSE, 0, 0);
  const live = new AbortController();
  watchLostRelease({ canvas, engine } as unknown as GameApp, live.signal);
  return { canvas, panel, engine, live };
}

const up = (target: EventTarget, pointerId = MOUSE, type = "pointerup") =>
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId }));

let stop: AbortController | null = null;
afterEach(() => {
  stop?.abort();
  document.body.innerHTML = "";
});

describe("watchLostRelease", () => {
  it("a release over a panel cancels the press the canvas holds", () => {
    const s = setup();
    stop = s.live;
    up(s.panel);
    expect(s.engine.onActionCancel).toHaveBeenCalledOnce();
    expect(s.engine.gesture).toBeNull();
    expect(s.engine.tracker.size, "the contact is forgotten").toBe(0);
  });

  it("a release on the canvas is left to the canvas", () => {
    const s = setup();
    stop = s.live;
    up(s.canvas);
    expect(s.engine.onActionCancel).not.toHaveBeenCalled();
    expect(s.engine.tracker.tracks(MOUSE)).toBe(true);
  });

  it("a release from a pointer that never pressed the canvas changes nothing", () => {
    const s = setup();
    stop = s.live;
    up(s.panel, MOUSE + 1);
    expect(s.engine.onActionCancel).not.toHaveBeenCalled();
    expect(s.engine.gesture).toBe("action");
  });

  it("a canceled pointer off the canvas ends an extend drag and closes its step", () => {
    const s = setup();
    stop = s.live;
    s.engine.gesture = null;
    s.engine.arrowDrag = { end: "up", shaft: 3 };
    up(s.panel, MOUSE, "pointercancel");
    expect(s.engine.onExtendEnd).toHaveBeenCalledOnce();
    expect(s.engine.arrowDrag).toBeNull();
  });

  it("a blur mid-press cancels it", () => {
    const s = setup();
    stop = s.live;
    window.dispatchEvent(new Event("blur"));
    expect(s.engine.onActionCancel).toHaveBeenCalledOnce();
  });

  it("stops listening when its signal aborts", () => {
    const s = setup();
    s.live.abort();
    up(s.panel);
    expect(s.engine.onActionCancel).not.toHaveBeenCalled();
  });
});
