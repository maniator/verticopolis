import { describe, it, expect, vi, afterEach } from "vitest";
import { CRASH_SCREEN_ID } from "../ui/crashScreen";
import { ENGINE_FAILURE_ID } from "./interactionState";
import { catalogFor } from "../engine/catalog";
import { buildPalette } from "../ui/uiPalette";
import type { UI } from "../ui/UI";
import { makeApp, pointer, press, release, tap } from "./inputKeys.fixture";

/**
 * Space is both the build key of keyboard play and the pan key held through a
 * mouse drag. A hold with a pointer down (or a wheel turn) at any moment is a
 * pan hold and does nothing at the keyboard cursor; any other hold is a tap and
 * builds on release. These pin that split; the rest of the keyboard wiring is in
 * `inputKeys.test.ts`.
 */

vi.mock("./audioPrefs", () => ({ flushPrefsSave: vi.fn() }));

afterEach(() => {
  (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.innerHTML = "";
});

describe("Space builds on release, never as the pan key", () => {
  it("Enter commits on the press, Space on the release", () => {
    const app = makeApp();
    press("Enter");
    expect(app.keyboard.commitCursor).toHaveBeenCalledTimes(1);
    press(" ");
    expect(app.keyboard.commitCursor).toHaveBeenCalledTimes(1);
    release(" ");
    expect(app.keyboard.commitCursor).toHaveBeenCalledTimes(2);
  });

  it("Space held through a pointer press is the pan key and never commits", () => {
    const app = makeApp();
    press(" ");
    pointer("pointerdown");
    press(" ", { repeat: true });
    pointer("pointerup");
    release(" ");
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
    // The next plain tap commits again: the pan only spent that one hold.
    tap(" ");
    expect(app.keyboard.commitCursor).toHaveBeenCalledTimes(1);
  });

  it("a pointer already down when Space is pressed makes the hold the pan key", () => {
    const app = makeApp();
    pointer("pointerdown");
    press(" ");
    release(" ");
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
    pointer("pointerup");
    tap(" ");
    expect(app.keyboard.commitCursor).toHaveBeenCalledTimes(1);
  });

  it("a wheel turn over the world while Space is held makes the hold the pan key", () => {
    const app = makeApp();
    press(" ");
    app.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true }));
    release(" ");
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("a wheel that scrolls the palette or a panel, or a sideways swipe the camera ignores, leaves the tap", () => {
    const app = makeApp();
    const panel = document.body.appendChild(document.createElement("div"));
    const wheels: [EventTarget, WheelEventInit][] = [
      [panel, { deltaY: 100 }],
      [app.canvas, { deltaX: 40 }], // no Shift, so the world does not zoom
    ];
    for (const [target, init] of wheels) {
      press(" ");
      target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, ...init }));
      const up = new KeyboardEvent("keyup", { key: " ", cancelable: true });
      window.dispatchEvent(up);
      expect(up.defaultPrevented, "not a pan release").toBe(false);
    }
    expect(app.keyboard.commitCursor, "each tap builds").toHaveBeenCalledTimes(2);
    press(" ");
    const shiftSwipe = new WheelEvent("wheel", { deltaX: 40, bubbles: true });
    Object.defineProperty(shiftSwipe, "shiftKey", { value: true }); // happy-dom drops it from the init
    app.canvas.dispatchEvent(shiftSwipe);
    release(" ");
    expect(app.keyboard.commitCursor, "Shift + a sideways swipe zooms, so it pans").toHaveBeenCalledTimes(2);
  });

  it("cancels the release of a pan-key hold, so a focused button is not clicked by it", () => {
    makeApp();
    press(" ");
    pointer("pointerdown");
    pointer("pointerup");
    const panRelease = new KeyboardEvent("keyup", { key: " ", cancelable: true });
    window.dispatchEvent(panRelease);
    expect(panRelease.defaultPrevented).toBe(true);
    // A tap's release is left alone: it is what activates a focused button.
    press(" ");
    const tapRelease = new KeyboardEvent("keyup", { key: " ", cancelable: true });
    window.dispatchEvent(tapRelease);
    expect(tapRelease.defaultPrevented).toBe(false);
  });

  it("another key pressed while Space is held cancels the tap", () => {
    const app = makeApp();
    press(" ");
    press("Enter");
    release(" ");
    expect(app.keyboard.commitCursor).toHaveBeenCalledTimes(1); // only Enter's build
    // Escape cancels a pending shaft anchor; the Space release must not set a new one.
    press(" ");
    press("Escape");
    release(" ");
    expect(app.keyboard.commitCursor).toHaveBeenCalledTimes(1);
  });

  it("a cursor key pressed before Space comes up builds the tap first, where Space went down", () => {
    const app = makeApp();
    press(" ");
    press("ArrowRight");
    release(" ");
    expect(app.keyboard.commitCursor).toHaveBeenCalledTimes(1);
    expect(app.keyboard.moveCursor).toHaveBeenCalledWith(1, 0);
    const [built] = app.keyboard.commitCursor.mock.invocationCallOrder;
    const [moved] = app.keyboard.moveCursor.mock.invocationCallOrder;
    expect(built, "the build lands before the move").toBeLessThan(moved!);
  });

  it("follows a hold that reaches the page only as repeats (focus came back mid-hold)", () => {
    const app = makeApp();
    press(" ", { repeat: true });
    pointer("pointerdown");
    pointer("pointerup");
    const panRelease = new KeyboardEvent("keyup", { key: " ", cancelable: true });
    window.dispatchEvent(panRelease);
    expect(panRelease.defaultPrevented, "a pan, so a focused button is not clicked").toBe(true);
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("cancels a pan release before a focused palette item sees it (the capture phase)", () => {
    makeApp();
    const palette = document.createElement("div");
    const selectTool = vi.fn();
    const ui = { el: { palette, paletteTabs: document.createElement("div") }, selectTool, cb: { getCatalog: () => catalogFor("classic") } } as unknown as UI;
    buildPalette(ui);
    document.body.appendChild(palette);
    const lobby = palette.querySelector<HTMLElement>('.pal-item[data-kind="lobby"]')!;
    lobby.focus();
    const key = (type: string): void => {
      lobby.dispatchEvent(new KeyboardEvent(type, { key: " ", bubbles: true, cancelable: true }));
    };
    key("keydown");
    pointer("pointerdown");
    pointer("pointerup");
    key("keyup");
    expect(selectTool, "a Space-drag does not pick the tool again").not.toHaveBeenCalled();
    key("keydown");
    key("keyup");
    expect(selectTool, "a Space tap on the item still picks it").toHaveBeenCalledTimes(1);
  });

  it("a cursor key pressed during a pan hold moves the cursor and builds nothing", () => {
    const app = makeApp();
    press(" ");
    pointer("pointerdown");
    press("ArrowRight");
    pointer("pointerup");
    release(" ");
    press(" ");
    app.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true }));
    press("ArrowRight");
    release(" ");
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
    expect(app.keyboard.moveCursor).toHaveBeenCalledTimes(2);
  });

  it("Shift pressed while Space is held leaves the tap in place", () => {
    const app = makeApp();
    press(" ");
    press("Shift", { shiftKey: true });
    release(" ", { shiftKey: true });
    expect(app.keyboard.commitCursor).toHaveBeenCalledTimes(1);
    // Shift then Shift + an arrow: the tap builds first, then the cursor jumps.
    press(" ");
    press("Shift", { shiftKey: true });
    press("ArrowRight", { shiftKey: true });
    release(" ", { shiftKey: true });
    expect(app.keyboard.commitCursor).toHaveBeenCalledTimes(2);
    expect(app.keyboard.moveCursor).toHaveBeenCalledWith(10, 0);
    const built = app.keyboard.commitCursor.mock.invocationCallOrder[1]!;
    const [moved] = app.keyboard.moveCursor.mock.invocationCallOrder;
    expect(built, "the build lands before the move").toBeLessThan(moved!);
  });

  it("Ctrl, Cmd or Alt pressed while Space is held drops the tap (macOS sends Cmd + Space no release)", () => {
    const app = makeApp();
    for (const key of ["Meta", "Control", "Alt"]) {
      press(" ");
      press(key); // Space's release never arrives while Cmd is held
      release(key);
      press("ArrowRight");
      release(" ");
    }
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
    expect(app.keyboard.moveCursor).toHaveBeenCalledTimes(3);
  });

  it("the splash, the crash card or a focused field keeps its Space release", () => {
    makeApp();
    const panRelease = (): KeyboardEvent => {
      press(" ");
      pointer("pointerdown");
      pointer("pointerup");
      const up = new KeyboardEvent("keyup", { key: " ", cancelable: true });
      window.dispatchEvent(up);
      return up;
    };
    const splash = document.createElement("div");
    splash.id = "splash";
    document.body.appendChild(splash);
    expect(panRelease().defaultPrevented, "the splash").toBe(false);
    splash.remove();
    const crash = document.createElement("div");
    crash.id = CRASH_SCREEN_ID;
    document.body.appendChild(crash);
    expect(panRelease().defaultPrevented, "the crash card").toBe(false);
    crash.remove();
    const failure = document.createElement("div");
    failure.id = ENGINE_FAILURE_ID;
    document.body.appendChild(failure);
    expect(panRelease().defaultPrevented, "the engine-failure card").toBe(false);
    failure.remove();
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    editable.tabIndex = 0;
    for (const field of [document.createElement("input"), document.createElement("textarea"), document.createElement("select"), editable]) {
      document.body.appendChild(field);
      field.focus();
      expect(panRelease().defaultPrevented, `a focused ${field.tagName} types or opens with Space`).toBe(false);
      field.remove();
    }
  });

  it("a Space-drag over a focused checkbox or radio cancels its release, as over a button", () => {
    const app = makeApp();
    for (const type of ["checkbox", "radio"]) {
      const box = document.createElement("input");
      box.type = type;
      document.body.appendChild(box);
      box.focus();
      press(" ");
      pointer("pointerdown");
      pointer("pointerup");
      const up = new KeyboardEvent("keyup", { key: " ", cancelable: true });
      window.dispatchEvent(up);
      expect(up.defaultPrevented, `the ${type} is not toggled by the pan`).toBe(true);
      box.remove();
    }
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("a hold that reaches a focused field only as repeats is the field's", () => {
    makeApp();
    const field = document.body.appendChild(document.createElement("input"));
    field.focus();
    press(" ", { repeat: true });
    pointer("pointerdown");
    pointer("pointerup");
    const up = new KeyboardEvent("keyup", { key: " ", cancelable: true });
    window.dispatchEvent(up);
    expect(up.defaultPrevented, "the field keeps its Space").toBe(false);
  });

  it("a Space chord or a Space typed into a field ends a pan hold whose release was lost", () => {
    makeApp();
    const lostPanHold = (): void => {
      press(" ");
      pointer("pointerdown");
      pointer("pointerup"); // and the Space release never arrives
    };
    const releaseIsCanceled = (): boolean => {
      const up = new KeyboardEvent("keyup", { key: " ", cancelable: true });
      window.dispatchEvent(up);
      return up.defaultPrevented;
    };
    for (const chord of ["ctrlKey", "metaKey", "altKey"] as const) {
      lostPanHold();
      press(" ", { [chord]: true });
      expect(releaseIsCanceled(), `a Space chord with ${chord} is the system's`).toBe(false);
    }
    lostPanHold();
    const field = document.body.appendChild(document.createElement("input"));
    field.focus();
    press(" ");
    expect(releaseIsCanceled(), "the field's Space").toBe(false);
  });

  it("a pan hold with a dialog open leaves Space to the dialog's controls", () => {
    const app = makeApp();
    const dialog = document.createElement("dialog");
    dialog.id = "modal";
    document.body.appendChild(dialog);
    dialog.open = true;
    press(" ");
    pointer("pointerdown");
    pointer("pointerup");
    const releaseInDialog = new KeyboardEvent("keyup", { key: " ", cancelable: true });
    window.dispatchEvent(releaseInDialog);
    expect(releaseInDialog.defaultPrevented, "a dialog button still gets its Space").toBe(false);
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("lifts the pressed look only from a native control Space presses, never from what the mouse holds", () => {
    makeApp();
    const panOver = (el: HTMLElement): ReturnType<typeof vi.fn> => {
      document.body.appendChild(el);
      el.focus();
      vi.spyOn(el, "matches").mockImplementation((selector) => selector === ":active");
      const blur = vi.spyOn(el, "blur");
      press(" ");
      pointer("pointerdown");
      pointer("pointerup");
      release(" ");
      return blur as unknown as ReturnType<typeof vi.fn>;
    };
    const button = document.createElement("button");
    expect(panOver(button), "the button Space pressed is reset").toHaveBeenCalledTimes(1);
    expect(document.activeElement, "and keeps the focus").toBe(button);
    const box = document.createElement("input");
    box.type = "checkbox";
    expect(panOver(box), "so is a checkbox").toHaveBeenCalledTimes(1);
    expect(document.activeElement, "which keeps the focus too").toBe(box);
    const map = document.createElement("canvas");
    map.tabIndex = 0;
    map.setAttribute("role", "application");
    expect(panOver(map), "the Map keeps its drag").not.toHaveBeenCalled();
    const item = document.createElement("div");
    item.tabIndex = 0;
    item.setAttribute("role", "button"); // a palette item, whose mouse press a blur would end
    expect(panOver(item), "a palette item the mouse holds keeps its press").not.toHaveBeenCalled();
    // A text field clicked into while Space is held keeps its edit.
    const field = document.body.appendChild(document.createElement("input"));
    press(" ");
    field.focus();
    vi.spyOn(field, "matches").mockImplementation((selector) => selector === ":active");
    const fieldBlur = vi.spyOn(field, "blur");
    pointer("pointerdown");
    pointer("pointerup");
    release(" ");
    expect(fieldBlur, "the text field is never blurred").not.toHaveBeenCalled();
  });

  it("Enter and a Space tap on a focused palette item or button pick it and never build", () => {
    const app = makeApp();
    const palette = document.createElement("div");
    const selectTool = vi.fn();
    const ui = { el: { palette, paletteTabs: document.createElement("div") }, selectTool, cb: { getCatalog: () => catalogFor("classic") } } as unknown as UI;
    buildPalette(ui);
    document.body.appendChild(palette);
    const button = document.createElement("button");
    document.body.appendChild(button);
    const lobby = palette.querySelector<HTMLElement>('.pal-item[data-kind="lobby"]')!;
    for (const control of [lobby, button]) {
      control.focus();
      const key = (type: string, k: string): void => {
        control.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));
      };
      key("keydown", "Enter");
      key("keyup", "Enter");
      key("keydown", " ");
      key("keyup", " ");
    }
    expect(selectTool, "Enter and Space each picked the item").toHaveBeenCalledTimes(2);
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("a held Space commits once, however many repeats the keyboard sends", () => {
    const app = makeApp();
    press(" ");
    press(" ", { repeat: true });
    press(" ", { repeat: true });
    press(" ", { repeat: true });
    release(" ");
    expect(app.keyboard.commitCursor).toHaveBeenCalledTimes(1);
  });

  it("Space still keeps the page from scrolling on the press", () => {
    makeApp();
    const event = new KeyboardEvent("keydown", { key: " ", cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    release(" ");
  });

  it("a release with no press of its own does not commit", () => {
    const app = makeApp();
    release(" ");
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("a dialog opened while Space is held keeps the release from committing", () => {
    const app = makeApp();
    press(" ");
    const dialog = document.createElement("dialog");
    dialog.id = "modal";
    document.body.appendChild(dialog);
    dialog.open = true;
    release(" ");
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("a field focused while Space is held keeps the release from committing", () => {
    const app = makeApp();
    press(" ");
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    release(" ");
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("the crash card coming up while Space is held keeps the release from committing", () => {
    const app = makeApp();
    press(" ");
    const crash = document.createElement("div");
    crash.id = CRASH_SCREEN_ID;
    document.body.appendChild(crash);
    release(" ");
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("focus leaving the window mid-hold drops the pending commit", () => {
    const app = makeApp();
    press(" ");
    window.dispatchEvent(new Event("blur"));
    release(" ");
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("a Space pressed on the Map window's canvas does not commit when released over the world", () => {
    const app = makeApp();
    const map = document.createElement("canvas");
    map.tabIndex = 0;
    map.setAttribute("role", "application");
    document.body.appendChild(map);
    map.focus();
    press(" ");
    map.blur();
    release(" ");
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
    map.remove();
  });
});
