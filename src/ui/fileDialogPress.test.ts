import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../analytics", () => ({ trackAppAction: m.track }));

import { AFTER_LIFT_MS, ROW_HOLD_MS, ROW_HOLD_SLOP, rowPress } from "./fileDialogPress";

const finger = (type: string, x = 40, y = 60, init: PointerEventInit = {}) =>
  new PointerEvent(type, { clientX: x, clientY: y, pointerType: "touch", pointerId: 7, isPrimary: true, bubbles: true, cancelable: true, ...init });
const rightClick = (x = 40, y = 60) => new MouseEvent("contextmenu", { clientX: x, clientY: y, bubbles: true, cancelable: true });
/** A click as a finger or a mouse makes it (detail 1); a keyboard's has 0. */
const click = (detail = 1) => new MouseEvent("click", { detail, bubbles: true, cancelable: true });

let open: ReturnType<typeof vi.fn<(id: string, x: number, y: number) => void>>;
let press: ReturnType<typeof rowPress>;

/** A finger down on row `id`: the window's watch sees it first, then the row. */
function down(id = "a", e = finger("pointerdown")): void {
  press.watch.handleEvent(e);
  press.down(id, e);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  open = vi.fn<(id: string, x: number, y: number) => void>();
  press = rowPress(open);
});
afterEach(() => vi.useRealTimers());

describe("a finger held on a row of the Open or Save As list", () => {
  it("opens the row's menu once, where the finger went down, after the hold time", () => {
    down("a", finger("pointerdown", 40, 60));
    vi.advanceTimersByTime(ROW_HOLD_MS - 1);
    expect(open).not.toHaveBeenCalled();
    press.watch.handleEvent(finger("pointermove", 43, 62));
    vi.advanceTimersByTime(1);
    expect(open).toHaveBeenCalledExactlyOnceWith("a", 40, 60);
    expect(m.track).toHaveBeenCalledExactlyOnceWith("file_menu", "hold");
    vi.advanceTimersByTime(ROW_HOLD_MS * 4);
    expect(open).toHaveBeenCalledOnce();
  });

  it("does nothing for a tap, a finger that scrolls the list, or a second finger", () => {
    down();
    press.watch.handleEvent(finger("pointerup"));
    vi.advanceTimersByTime(ROW_HOLD_MS);
    down();
    press.watch.handleEvent(finger("pointermove", 40, 60 + ROW_HOLD_SLOP + 1));
    vi.advanceTimersByTime(ROW_HOLD_MS);
    down();
    press.watch.handleEvent(finger("pointercancel"));
    vi.advanceTimersByTime(ROW_HOLD_MS);
    down();
    down("b", finger("pointerdown", 90, 90, { pointerId: 8, isPrimary: false }));
    vi.advanceTimersByTime(ROW_HOLD_MS);
    expect(open).not.toHaveBeenCalled();
    expect(m.track).not.toHaveBeenCalled();
  });

  it("leaves a mouse to its right button, which opens the menu at once", () => {
    down("a", finger("pointerdown", 40, 60, { pointerType: "mouse", button: 2 }));
    vi.advanceTimersByTime(ROW_HOLD_MS);
    expect(open).not.toHaveBeenCalled();
    const e = rightClick(15, 25);
    press.contextMenu("a", e);
    expect(e.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith("a", 15, 25);
    expect(m.track).toHaveBeenCalledExactlyOnceWith("file_menu", "pointer");
  });

  it("drops an Android browser's own contextmenu that comes after the hold opened the menu", () => {
    down();
    vi.advanceTimersByTime(ROW_HOLD_MS);
    const late = rightClick(41, 61);
    press.contextMenu("a", late);
    expect(late.defaultPrevented).toBe(true);
    press.watch.handleEvent(finger("pointerup"));
    press.contextMenu("a", rightClick());
    expect(open).toHaveBeenCalledOnce();
    expect(m.track).toHaveBeenCalledExactlyOnceWith("file_menu", "hold");
  });

  it("lets an Android browser's contextmenu open the menu when it comes first, and the hold then stays quiet", () => {
    down();
    vi.advanceTimersByTime(ROW_HOLD_MS - 100);
    press.contextMenu("a", rightClick(41, 61));
    vi.advanceTimersByTime(ROW_HOLD_MS);
    expect(open).toHaveBeenCalledExactlyOnceWith("a", 41, 61);
    expect(m.track).toHaveBeenCalledExactlyOnceWith("file_menu", "hold");
  });

  it("swallows the one click a lifting finger sends, so the menu stays open and no item under it is pressed", () => {
    down();
    vi.advanceTimersByTime(ROW_HOLD_MS);
    press.watch.handleEvent(finger("pointerup"));
    const lifted = click();
    press.watch.handleEvent(lifted);
    expect([lifted.defaultPrevented, lifted.cancelBubble]).toEqual([true, true]);
    const next = click();
    press.watch.handleEvent(next);
    expect([next.defaultPrevented, next.cancelBubble]).toEqual([false, false]);
  });

  it("lets through a tap on a menu item, a keyboard's click and a click long after the lift", () => {
    const passes = (e: MouseEvent) => {
      press.watch.handleEvent(e);
      return !e.defaultPrevented && !e.cancelBubble;
    };
    const held = () => {
      down();
      vi.advanceTimersByTime(ROW_HOLD_MS);
      press.watch.handleEvent(finger("pointerup"));
    };
    held();
    press.watch.handleEvent(finger("pointerdown", 50, 70, { pointerId: 9 }));
    expect(passes(click()), "a new tap on a menu item").toBe(true);
    held();
    expect(passes(click(0)), "Enter on a menu item").toBe(true);
    vi.advanceTimersByTime(AFTER_LIFT_MS);
    expect(passes(click()), "after the lift's moment").toBe(true);
  });

  it("counts the context menu key on its own", () => {
    press.key();
    expect(m.track).toHaveBeenCalledExactlyOnceWith("file_menu", "key");
    expect(open).not.toHaveBeenCalled();
  });
});
