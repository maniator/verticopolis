import { describe, expect, it, vi } from "vitest";
import * as ex from "excalibur";
import { EXCALIBUR_POINTER_BUTTONS, excaliburCanMapButton, guardPointerButtons } from "./pointerButtonGuard";

/** DOM `PointerEvent.button` codes for the buttons Excalibur 0.32 cannot map. */
const MOUSE_FORWARD_BUTTON = 4;
const PEN_ERASER_BUTTON = 5;

/** Excalibur's own DOM-to-enum button mapping, called the way its receiver
 *  calls it. It reads nothing from the receiver instance. */
function excaliburMaps(button: number): unknown {
  const receiver = ex.PointerEventReceiver.prototype as unknown as {
    _nativeButtonToPointerButton(code: number): unknown;
  };
  return receiver._nativeButtonToPointerButton.call({}, button);
}

function pointer(type: string, button: number): PointerEvent {
  return new PointerEvent(type, { button, bubbles: true, cancelable: true });
}

describe("Excalibur's pointer button mapping (the contract the guard relies on)", () => {
  it("maps every button the guard lets through", () => {
    for (const button of Object.values(EXCALIBUR_POINTER_BUTTONS)) {
      expect(() => excaliburMaps(button), `button ${button}`).not.toThrow();
    }
  });

  it("throws on the forward and eraser buttons, the crash the guard prevents", () => {
    expect(() => excaliburMaps(MOUSE_FORWARD_BUTTON)).toThrow("4");
    expect(() => excaliburMaps(PEN_ERASER_BUTTON)).toThrow("5");
  });
});

describe("excaliburCanMapButton", () => {
  it("accepts Excalibur's buttons and refuses the rest", () => {
    expect(excaliburCanMapButton(EXCALIBUR_POINTER_BUTTONS.left)).toBe(true);
    expect(excaliburCanMapButton(EXCALIBUR_POINTER_BUTTONS.back)).toBe(true);
    expect(excaliburCanMapButton(EXCALIBUR_POINTER_BUTTONS.none)).toBe(true);
    expect(excaliburCanMapButton(MOUSE_FORWARD_BUTTON)).toBe(false);
    expect(excaliburCanMapButton(PEN_ERASER_BUTTON)).toBe(false);
  });
});

describe("guardPointerButtons", () => {
  it("stops a forward-button press before a handler registered on the canvas later", () => {
    const canvas = document.createElement("canvas");
    guardPointerButtons(canvas);
    const handler = vi.fn();
    canvas.addEventListener("pointerdown", handler);
    canvas.addEventListener("pointerup", handler);

    const down = pointer("pointerdown", MOUSE_FORWARD_BUTTON);
    canvas.dispatchEvent(down);
    canvas.dispatchEvent(new PointerEvent("pointerup", { button: PEN_ERASER_BUTTON, buttons: 1, bubbles: true }));

    expect(handler).not.toHaveBeenCalled();
    expect(down.defaultPrevented).toBe(true);
  });

  it("hands on the last up of a chord that ends on the forward button, with no button named", () => {
    const canvas = document.createElement("canvas");
    guardPointerButtons(canvas);
    const ups: PointerEvent[] = [];
    canvas.addEventListener("pointerup", (e) => ups.push(e));

    canvas.dispatchEvent(
      new PointerEvent("pointerup", { button: MOUSE_FORWARD_BUTTON, buttons: 0, pointerId: 7, clientX: 30, clientY: 40, bubbles: true }),
    );

    expect(ups).toHaveLength(1);
    expect(ups[0]).toMatchObject({ button: EXCALIBUR_POINTER_BUTTONS.none, pointerId: 7, clientX: 30, clientY: 40 });
    // A view lets the browser add the page scroll to pageX/pageY, which Excalibur reads.
    expect(ups[0].view).toBe(window);
    expect(() => excaliburMaps(ups[0].button)).not.toThrow();
  });

  it("does not hand on an up while another button is still held", () => {
    const canvas = document.createElement("canvas");
    guardPointerButtons(canvas);
    const handler = vi.fn();
    canvas.addEventListener("pointerup", handler);
    const LEFT_HELD = 1; // `buttons` bit for the primary button
    canvas.dispatchEvent(new PointerEvent("pointerup", { button: MOUSE_FORWARD_BUTTON, buttons: LEFT_HELD, bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets every button Excalibur can map through untouched", () => {
    const canvas = document.createElement("canvas");
    guardPointerButtons(canvas);
    const handler = vi.fn();
    canvas.addEventListener("pointerdown", handler);

    const left = pointer("pointerdown", EXCALIBUR_POINTER_BUTTONS.left);
    canvas.dispatchEvent(left);
    canvas.dispatchEvent(pointer("pointerdown", EXCALIBUR_POINTER_BUTTONS.right));

    expect(handler).toHaveBeenCalledTimes(2);
    expect(left.defaultPrevented).toBe(false);
  });

  it("installs once per canvas", () => {
    const canvas = document.createElement("canvas");
    const add = vi.spyOn(canvas, "addEventListener");
    guardPointerButtons(canvas);
    guardPointerButtons(canvas);
    expect(add).toHaveBeenCalledTimes(4);
  });
});
