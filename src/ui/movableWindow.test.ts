import { afterEach, describe, it, expect, vi } from "vitest";
import { clampSpot, MOVABLE_CLASS, MOVE_HINT, MovableWindow, type Spot } from "./movableWindow";

describe("clampSpot", () => {
  const bounds = { w: 800, h: 600 };
  const size = { w: 200, h: 300 };

  it("keeps a spot that fits", () => {
    expect(clampSpot({ x: 100, y: 50 }, size, bounds)).toEqual({ x: 100, y: 50 });
  });

  it("pulls a window past any edge back whole inside", () => {
    expect(clampSpot({ x: -40, y: -9 }, size, bounds)).toEqual({ x: 0, y: 0 });
    expect(clampSpot({ x: 900, y: 700 }, size, bounds)).toEqual({ x: 600, y: 300 });
  });

  it("keeps the top-left corner (the title bar) in view when the window is bigger than its bounds", () => {
    expect(clampSpot({ x: 30, y: 30 }, { w: 1000, h: 900 }, bounds)).toEqual({ x: 0, y: 0 });
  });

  it("lands on whole pixels", () => {
    expect(clampSpot({ x: 10.4, y: 20.6 }, size, bounds)).toEqual({ x: 10, y: 21 });
  });
});

/** A window in a stage at client (100, 50), 800 by 600, the window 200 by 150
 *  at (500, 400) in the stage. happy-dom lays nothing out, so the boxes are
 *  stubbed: the window's box follows the `left` and `top` the mover writes. */
function setup(opts: { enabled?: () => boolean } = {}) {
  const stage = document.createElement("div");
  const win = document.createElement("div");
  win.className = "win";
  win.innerHTML = `<div class="win-title"><span>Map</span><button type="button">✕</button></div><div class="body">body</div>`;
  stage.append(win);
  document.body.append(stage);
  const home = { x: 500, y: 400 };
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(new DOMRect(100, 50, 800, 600));
  Object.defineProperty(stage, "clientWidth", { value: 800 });
  Object.defineProperty(stage, "clientHeight", { value: 600 });
  Object.defineProperty(win, "offsetWidth", { value: 200, configurable: true });
  Object.defineProperty(win, "offsetHeight", { value: 150, configurable: true });
  vi.spyOn(win, "getBoundingClientRect").mockImplementation(() => {
    const x = win.style.left ? parseFloat(win.style.left) : home.x;
    const y = win.style.top ? parseFloat(win.style.top) : home.y;
    return new DOMRect(100 + x, 50 + y, 200, 150);
  });
  const title = win.querySelector<HTMLElement>(".win-title")!;
  title.setPointerCapture = vi.fn();
  const placed = vi.fn<(spot: Spot | null) => void>();
  const mover = new MovableWindow({ win, title: ".win > .win-title", within: stage, enabled: opts.enabled, placed });
  return { stage, win, title, close: win.querySelector("button")!, body: win.querySelector<HTMLElement>(".body")!, mover, placed };
}

function pointer(target: Element, type: string, x: number, y: number, init: PointerEventInit = {}): PointerEvent {
  const buttons = type === "pointerup" ? 0 : 1;
  const e = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", button: 0, buttons, clientX: x, clientY: y, ...init });
  target.dispatchEvent(e);
  return e;
}

/** Press the title bar 10 px into the window (client 610, 460) and drag by (dx, dy). */
function drag(target: Element, dx: number, dy: number, init: PointerEventInit = {}): PointerEvent {
  const down = pointer(target, "pointerdown", 610, 460, init);
  pointer(target, "pointermove", 610 + dx, 460 + dy, init);
  pointer(target, "pointerup", 610 + dx, 460 + dy, init);
  return down;
}

describe("MovableWindow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("marks the window movable", () => {
    const { win } = setup();
    expect(win.classList.contains(MOVABLE_CLASS)).toBe(true);
  });

  it("moves the window by its title bar, captures the pointer, and reports the spot once at the release", () => {
    const { win, title, mover, placed } = setup();
    const down = drag(title.querySelector("span")!, -300, -200);
    expect(down.defaultPrevented).toBe(true);
    expect(title.setPointerCapture).toHaveBeenCalledWith(1);
    expect([win.style.left, win.style.top, win.style.right, win.style.bottom, win.style.margin]).toEqual(["200px", "200px", "auto", "auto", "0px"]);
    expect(mover.placedAt()).toEqual({ x: 200, y: 200 });
    expect(placed.mock.calls).toEqual([[{ x: 200, y: 200 }]]);
  });

  it("stops at the stage's edges", () => {
    const { win, title } = setup();
    drag(title, 5000, 5000);
    expect([win.style.left, win.style.top]).toEqual(["600px", "450px"]);
  });

  it("never moves from a press on the close button, the body, or with another button", () => {
    const { win, title, close, body, mover, placed } = setup();
    drag(close, -100, -100);
    drag(body, -100, -100);
    drag(title, -100, -100, { button: 2 });
    expect(win.style.left).toBe("");
    expect(mover.isPlaced()).toBe(false);
    expect(placed).not.toHaveBeenCalled();
  });

  it("does nothing while disabled", () => {
    let on = false;
    const { win, title, mover } = setup({ enabled: () => on });
    drag(title, -100, -100);
    expect(win.style.left).toBe("");
    on = true;
    drag(title, -100, -100);
    expect(mover.placedAt()).toEqual({ x: 400, y: 300 });
  });

  it("ignores another pointer's moves during a drag", () => {
    const { win, title } = setup();
    pointer(title, "pointerdown", 610, 460);
    pointer(title, "pointermove", 0, 0, { pointerId: 2 });
    expect(win.style.left).toBe("");
    pointer(title, "pointermove", 600, 450);
    expect(win.style.left).toBe("490px");
  });

  it("a press and release with no move reports nothing", () => {
    const { title, placed, mover } = setup();
    pointer(title, "pointerdown", 610, 460);
    pointer(title, "pointerup", 610, 460);
    expect(placed).not.toHaveBeenCalled();
    expect(mover.isPlaced()).toBe(false);
  });

  it("a double-click on the title bar puts a moved window home and reports null", () => {
    const { win, title, mover, placed } = setup();
    drag(title, -100, -100);
    title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect([win.style.left, win.style.top, win.style.right, win.style.bottom, win.style.margin]).toEqual(["", "", "", "", ""]);
    expect(mover.isPlaced()).toBe(false);
    expect(placed).toHaveBeenLastCalledWith(null);
  });

  it("a double-click on an unmoved window, or on its close button, reports nothing", () => {
    const { title, close, placed } = setup();
    title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    drag(title, -100, -100);
    placed.mockClear();
    close.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(placed).not.toHaveBeenCalled();
  });

  it("moveTo places a stored spot and pulls it inside the stage", () => {
    const { win, mover } = setup();
    mover.moveTo({ x: 700, y: 20 });
    expect([win.style.left, win.style.top]).toEqual(["600px", "20px"]);
    expect(mover.placedAt()).toEqual({ x: 600, y: 20 });
  });

  it("moveTo keeps a hidden window's spot until it shows", () => {
    const { win, mover } = setup();
    Object.defineProperty(win, "offsetWidth", { value: 0, configurable: true });
    Object.defineProperty(win, "offsetHeight", { value: 0, configurable: true });
    mover.moveTo({ x: 700, y: 20 });
    expect(mover.placedAt()).toEqual({ x: 700, y: 20 });
  });

  it("reset during a drag ends it", () => {
    const { win, title, mover } = setup();
    pointer(title, "pointerdown", 610, 460);
    mover.reset();
    pointer(title, "pointermove", 500, 400);
    expect(win.style.left).toBe("");
  });

  it("a pointer the browser cannot capture still moves the window", () => {
    const { win, title } = setup();
    title.setPointerCapture = vi.fn(() => {
      throw new DOMException("no such pointer", "NotFoundError");
    });
    drag(title, -100, 0);
    expect(win.style.left).toBe("400px");
  });

  it("a mouse that moves with no button held ends a drag whose release was lost, and hovering then moves nothing", () => {
    const { win, title, placed } = setup();
    pointer(title, "pointerdown", 610, 460);
    pointer(title, "pointermove", 510, 460);
    expect(win.style.left).toBe("400px");
    pointer(title, "pointermove", 410, 460, { buttons: 0 });
    expect(win.style.left).toBe("400px");
    expect(placed.mock.calls).toEqual([[{ x: 400, y: 400 }]]);
    pointer(title, "pointermove", 310, 460);
    expect(win.style.left).toBe("400px");
  });

  it("a touch drag keeps going (a touch move reports its contact as held)", () => {
    const { win, title } = setup();
    drag(title, -100, 0, { pointerType: "touch" });
    expect(win.style.left).toBe("400px");
  });

  it("a new press by the pointer holding a lost drag starts over, and another pointer's press waits", () => {
    const { win, title } = setup();
    pointer(title, "pointerdown", 610, 460);
    pointer(title, "pointerdown", 610, 460, { pointerId: 2 });
    pointer(title, "pointermove", 0, 0, { pointerId: 2 });
    expect(win.style.left).toBe("");
    // The window moved under the pointer before its second press: the grab is measured again.
    pointer(title, "pointerdown", 650, 470);
    pointer(title, "pointermove", 550, 470);
    expect(win.style.left).toBe("400px");
  });

  it("names the move on the title bar's tooltip while it can move, and drops it while it cannot", () => {
    let on = true;
    const { title, body } = setup({ enabled: () => on });
    body.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(title.title).toBe("");
    title.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(title.title).toBe(MOVE_HINT);
    on = false;
    title.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(title.hasAttribute("title")).toBe(false);
  });

  it("dispose removes the listeners", () => {
    const { win, title, mover } = setup();
    mover.dispose();
    drag(title, -100, -100);
    expect(win.style.left).toBe("");
  });
});
