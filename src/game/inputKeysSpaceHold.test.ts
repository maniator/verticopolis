import { describe, it, expect, vi, afterEach } from "vitest";
import { makeApp, pointer, press, release } from "./inputKeys.fixture";

/**
 * Which Space the game follows as a hold, and what a cover that comes up mid-hold
 * gets. The camera's pan key is that same hold, so a Space chord or a Space typed
 * into a field neither builds nor pans. The rest of the Space split is in
 * `inputKeysSpace.test.ts` and `inputKeysSpaceFocus.test.ts`.
 */

vi.mock("./audioPrefs", () => ({ flushPrefsSave: vi.fn() }));

/** A pointer press's `button`: which button changed state. */
const MIDDLE_BUTTON = 1;

afterEach(() => {
  (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.innerHTML = "";
});

/** Send a Space release and say whether the game canceled it. */
function releaseIsCanceled(init: KeyboardEventInit = { key: " " }): boolean {
  const up = new KeyboardEvent("keyup", { cancelable: true, ...init });
  window.dispatchEvent(up);
  return up.defaultPrevented;
}

function openDialog(): void {
  const dialog = document.createElement("dialog");
  dialog.id = "modal";
  document.body.appendChild(dialog);
  dialog.open = true;
}

describe("the Space hold the game follows", () => {
  it("is the camera's pan key, and a chord or a Space typed into a field is not", () => {
    const app = makeApp();
    const panKey = (): boolean => app.spacePanKey!();
    expect(panKey(), "Space is up").toBe(false);
    press(" ");
    expect(panKey(), "a plain Space").toBe(true);
    release(" ");
    expect(panKey(), "released").toBe(false);
    for (const chord of ["ctrlKey", "metaKey", "altKey"] as const) {
      press(" ", { [chord]: true });
      expect(panKey(), `a Space chord with ${chord}`).toBe(false);
      release(" ", { [chord]: true });
    }
    const field = document.body.appendChild(document.createElement("input"));
    field.focus();
    press(" ");
    expect(panKey(), "a Space typed into a field").toBe(false);
    release(" ");
    const box = document.body.appendChild(document.createElement("input"));
    box.type = "checkbox";
    box.focus();
    press(" ");
    expect(panKey(), "a Space over a focused checkbox still pans").toBe(true);
  });

  it("a dialog that opens mid-hold gets neither the repeats nor the release", () => {
    const app = makeApp();
    for (const pans of [true, false]) {
      press(" ");
      if (pans) {
        pointer("pointerdown");
        pointer("pointerup");
      }
      openDialog(); // an emergency choice, its button focused
      const repeat = new KeyboardEvent("keydown", { key: " ", repeat: true, cancelable: true });
      window.dispatchEvent(repeat);
      expect(repeat.defaultPrevented, "the repeat does not press the dialog's button").toBe(true);
      const modal = document.getElementById("modal")!;
      const coverHeard = vi.fn();
      modal.addEventListener("keydown", coverHeard);
      modal.dispatchEvent(new KeyboardEvent("keydown", { key: " ", repeat: true, bubbles: true, cancelable: true }));
      expect(coverHeard, "nor do the dialog's own listeners hear it").not.toHaveBeenCalled();
      expect(releaseIsCanceled(), "nor does the release click it").toBe(true);
      document.body.innerHTML = "";
    }
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("Space typed into a field, a chord, or a press on a dialog that gives way to another is not the new dialog's", () => {
    makeApp();
    const dialogWithButton = (): HTMLButtonElement => {
      document.body.innerHTML = "";
      openDialog();
      const button = document.getElementById("modal")!.appendChild(document.createElement("button"));
      button.focus();
      return button;
    };
    const repeatIsCanceled = (): boolean => {
      const repeat = new KeyboardEvent("keydown", { key: " ", repeat: true, cancelable: true });
      window.dispatchEvent(repeat);
      return repeat.defaultPrevented;
    };
    const field = document.body.appendChild(document.createElement("input"));
    field.focus();
    press(" ");
    dialogWithButton(); // an emergency choice takes focus mid-press
    expect(repeatIsCanceled(), "a typed Space's repeat").toBe(true);
    expect(releaseIsCanceled(), "a typed Space's release").toBe(true);
    press(" ", { ctrlKey: true });
    dialogWithButton();
    expect(releaseIsCanceled({ key: " ", ctrlKey: true }), "a chord's release").toBe(true);
    dialogWithButton();
    press(" "); // on dialog A's button, which a click then swaps for dialog B
    dialogWithButton();
    expect(repeatIsCanceled(), "the swapped-in dialog's repeat").toBe(true);
    expect(releaseIsCanceled(), "and its release").toBe(true);
    const own = dialogWithButton();
    press(" ");
    expect(document.activeElement).toBe(own);
    expect(releaseIsCanceled(), "a Space pressed on the dialog's own button stays its").toBe(false);
  });

  it("Cmd's release or a native context menu ends a hold whose Space release never came", () => {
    const app = makeApp();
    press(" ");
    pointer("pointerdown");
    pointer("pointerup");
    press("Meta", { metaKey: true });
    press("z", { metaKey: true }); // Cmd+Z: macOS sends no Space release while Cmd is down
    release("Meta");
    expect(app.spacePanKey!(), "the next mouse press builds").toBe(false);
    press(" ");
    window.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(app.spacePanKey!(), "the menu took the keyboard").toBe(false);
  });

  it("a cursor key that settles a tap under a dialog that opened mid-hold builds nothing", () => {
    const app = makeApp();
    press(" ");
    openDialog();
    press("ArrowRight");
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("a Space-drag over a focused slider pans, and its release is canceled", () => {
    makeApp();
    const slider = document.body.appendChild(document.createElement("input"));
    slider.type = "range";
    slider.focus();
    press(" ");
    pointer("pointerdown");
    pointer("pointerup");
    expect(releaseIsCanceled()).toBe(true);
  });

  it("a cursor key held since before Space builds the tap at its first repeat, before it moves", () => {
    const app = makeApp();
    press(" ");
    press("ArrowRight", { repeat: true });
    release(" ");
    expect(app.keyboard.commitCursor).toHaveBeenCalledTimes(1);
    const [commit] = app.keyboard.commitCursor.mock.invocationCallOrder;
    const [move] = app.keyboard.moveCursor.mock.invocationCallOrder;
    expect(commit, "the build lands where Space went down").toBeLessThan(move!);
  });

  it("another held key drops the tap at its first repeat, and Shift or a lock key keeps it", () => {
    const app = makeApp();
    press(" ");
    press("q", { repeat: true });
    release(" ");
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
    const keepers = ["Shift", "CapsLock", "NumLock", "ScrollLock", "FnLock", "SymbolLock", "Fn"];
    for (const key of keepers) {
      for (const repeat of [false, true]) {
        press(" ");
        press(key, { repeat });
        release(" ");
      }
    }
    expect(app.keyboard.commitCursor, "each keeps the tap, pressed or held").toHaveBeenCalledTimes(keepers.length * 2);
  });

  it("a Space reported as a no-break space without Option still taps", () => {
    const app = makeApp();
    const down = new KeyboardEvent("keydown", { key: "\u00a0", code: "Space", cancelable: true });
    window.dispatchEvent(down);
    expect(down.defaultPrevented, "the press is the game's").toBe(true);
    release("\u00a0", { code: "Space" });
    expect(app.keyboard.commitCursor).toHaveBeenCalledTimes(1);
  });

  it("a release with Option held (a no-break space) still ends a pan hold", () => {
    const app = makeApp();
    press(" ");
    pointer("pointerdown");
    pointer("pointerup");
    expect(releaseIsCanceled({ key: "\u00a0", code: "Space", altKey: true })).toBe(true);
    expect(app.spacePanKey!(), "the hold is over").toBe(false);
  });

  it("a plain Space tap on a focused checkbox or radio is left to it", () => {
    const app = makeApp();
    for (const type of ["checkbox", "radio"]) {
      const box = document.body.appendChild(document.createElement("input"));
      box.type = type;
      box.focus();
      press(" ");
      expect(releaseIsCanceled(), `the ${type} toggles on its own release`).toBe(false);
      box.remove();
    }
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("the pan key is the hold as each press went down, which the camera reads a frame later", () => {
    const app = makeApp();
    const before = new PointerEvent("pointerdown", { pointerId: 1, bubbles: true });
    window.dispatchEvent(before);
    press(" ");
    expect(app.spacePanKey!(before), "a drag under way when Space went down keeps its tool").toBe(false);
    pointer("pointerup");
    const during = new PointerEvent("pointerdown", { pointerId: 1, bubbles: true });
    window.dispatchEvent(during);
    expect(releaseIsCanceled(), "Space comes up before the frame").toBe(true);
    expect(app.spacePanKey!(during), "the press made with Space held still pans").toBe(true);
    expect(app.spacePanKey!(), "the hold now").toBe(false);
  });

  it("a pan hold that Cmd's release, a native menu or drag, or a dropdown's key ended still cancels its late Space release", () => {
    const app = makeApp();
    const dropdown = document.body.appendChild(document.createElement("select"));
    const image = document.body.appendChild(document.createElement("img"));
    image.addEventListener("dragstart", (e) => e.preventDefault());
    press(" ");
    image.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }));
    expect(app.spacePanKey!(), "a drag the page canceled leaves the hold").toBe(true);
    const enders: Record<string, () => void> = {
      "Cmd's release": () => release("Meta"),
      "a native menu": () => window.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
      "a native drag": () => window.dispatchEvent(new Event("dragstart", { bubbles: true })),
      "Alt + Down on a focused dropdown": () => {
        dropdown.focus();
        press("ArrowDown", { altKey: true });
        dropdown.blur();
      },
    };
    for (const [name, end] of Object.entries(enders)) {
      press(" ");
      pointer("pointerdown");
      pointer("pointerup");
      end();
      expect(app.spacePanKey!(), `${name} ends the hold`).toBe(false);
      expect(releaseIsCanceled(), `the release after ${name}`).toBe(true);
      press(" "); // a plain hold owes nothing
      end();
      expect(releaseIsCanceled(), `a plain hold's release after ${name}`).toBe(false);
      press(" "); // unless a press since would have made it a pan
      end();
      pointer("pointerdown");
      pointer("pointerup");
      expect(releaseIsCanceled(), `a release after ${name} and a press`).toBe(true);
      press(" "); // two enders in a row keep what the first one owed
      pointer("pointerdown");
      pointer("pointerup");
      release("Meta");
      end();
      expect(releaseIsCanceled(), `a pan hold's release after Cmd's release and ${name}`).toBe(true);
      press(" "); // the other order: a live hold reaches every ender first
      end();
      release("Meta");
      pointer("pointerdown");
      pointer("pointerup");
      expect(releaseIsCanceled(), `a release after ${name}, Cmd's release and a press`).toBe(true);
    }
    press(" "); // a zooming wheel turn after an ender owes the cancel too
    release("Meta");
    app.canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true }));
    expect(releaseIsCanceled(), "a release after Cmd's release and a wheel turn").toBe(true);
    press(" "); // and so does a press first seen as a move with a button held
    release("Meta");
    pointer("pointermove", 1, window, { buttons: 1 });
    expect(releaseIsCanceled(), "a release after Cmd's release and a held move").toBe(true);
    pointer("pointermove", 1, window, { buttons: 0 });
    press(" "); // that move makes a hold a pan
    pointer("pointermove", 1, window, { buttons: 1 });
    expect(releaseIsCanceled(), "a release after a held move").toBe(true);
    pointer("pointermove", 1, window, { buttons: 0 });
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("a Space the page first sees as repeats is not an open dialog's", () => {
    makeApp();
    openDialog();
    document.getElementById("modal")!.appendChild(document.createElement("button")).focus();
    const repeat = new KeyboardEvent("keydown", { key: " ", repeat: true, cancelable: true });
    window.dispatchEvent(repeat);
    expect(repeat.defaultPrevented, "its repeat does not press the dialog's button").toBe(true);
    expect(releaseIsCanceled(), "nor does its release click it").toBe(true);
  });

  it("a press or a key that opens a dropdown ends the hold, since its popup can take the release", () => {
    const app = makeApp();
    const select = document.body.appendChild(document.createElement("select"));
    const pressOn = (target: Element, init: PointerEventInit = {}): void => {
      pointer("pointerdown", 1, target, init);
      pointer("pointerup", 1, target);
    };
    press(" ");
    pressOn(select, { button: MIDDLE_BUTTON });
    expect(app.spacePanKey!(), "a middle press opens nothing").toBe(true);
    select.disabled = true;
    pressOn(select);
    expect(app.spacePanKey!(), "a disabled dropdown opens nothing").toBe(true);
    select.disabled = false;
    pressOn(select);
    expect(app.spacePanKey!(), "the popup opens").toBe(false);
    expect(releaseIsCanceled(), "the press made it a pan, so its late release is canceled").toBe(true);
    select.multiple = true; // a list box, which a phone shows in a picker
    press(" ");
    expect(app.spacePanKey!(), "held again").toBe(true);
    pressOn(select);
    expect(app.spacePanKey!(), "a list box").toBe(false);
    select.multiple = false;
    press(" ");
    select.focus(); // tabbed to while Space is held
    for (const key of ["Shift", "Tab", "o", "Escape", "ArrowLeft", "ArrowRight"]) {
      press(key);
      expect(app.spacePanKey!(), `${key} keeps the hold`).toBe(true);
    }
    for (const [key, init] of [
      ["ArrowDown", { altKey: true }], ["ArrowUp", {}], ["F4", {}], ["Enter", {}],
      ["ArrowDown", { repeat: true }], // held since before the focus came (a Mac)
      [" ", { repeat: true }], // Space's own repeats open it too
      ["\u00a0", { repeat: true, code: "Space" }], // known by its physical key
    ] as const) {
      select.blur();
      press(" ");
      select.focus();
      expect(app.spacePanKey!(), `held before ${key} ${JSON.stringify(init)}`).toBe(true);
      press(key, init);
      expect(app.spacePanKey!(), `${key} ${JSON.stringify(init)} opens it`).toBe(false);
    }
  });

  it("after an ender, a Space still down holds again from its next press or followed repeat", () => {
    const app = makeApp();
    press(" ");
    release("Meta"); // ends the hold with Space still down
    const drag = new PointerEvent("pointerdown", { pointerId: 1, bubbles: true });
    window.dispatchEvent(drag);
    expect(app.spacePanKey!(drag), "a drag after the ender keeps its tool").toBe(false);
    pointer("pointerup");
    press(" ", { repeat: true, ctrlKey: true });
    expect(app.spacePanKey!(), "a chord's repeat starts nothing").toBe(false);
    press(" ", { repeat: true });
    expect(app.spacePanKey!(), "a repeat the game follows starts a new hold").toBe(true);
    release("Meta"); // ends that hold too, with Space still down
    expect(app.spacePanKey!(), "the hold ended again").toBe(false);
    press(" ");
    expect(app.spacePanKey!(), "and so does its next press").toBe(true);
  });

  it("a cover that comes up after a hold ended does not get its late release", () => {
    makeApp();
    press(" ");
    release("Meta"); // ends the hold with Space still down
    openDialog(); // an emergency choice, its button focused
    document.getElementById("modal")!.appendChild(document.createElement("button")).focus();
    expect(releaseIsCanceled(), "the release does not click its button").toBe(true);
  });

  it("a Space pressed under a cover that its own press closes never builds", () => {
    const app = makeApp();
    openDialog();
    // A cover that closes on its own key press, after the game saw the press.
    window.addEventListener("keydown", () => document.getElementById("modal")?.remove(), { capture: true, once: true });
    press(" ");
    release(" ");
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("a release a cover took lifts the pressed look of a control the cover left focused", () => {
    makeApp();
    const button = document.body.appendChild(document.createElement("button"));
    button.focus();
    vi.spyOn(button, "matches").mockImplementation((selector) => selector === ":active");
    const blur = vi.spyOn(button, "blur");
    press(" ");
    openDialog(); // a cover that takes no focus, such as the engine-failure card
    expect(releaseIsCanceled()).toBe(true);
    expect(blur).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(button);
  });

  it("a key held since before a cover came up does not press the cover's controls with its repeats", () => {
    makeApp();
    const repeatIsCanceled = (key: string): boolean => {
      const repeat = new KeyboardEvent("keydown", { key, repeat: true, cancelable: true });
      window.dispatchEvent(repeat);
      return repeat.defaultPrevented;
    };
    press("Backspace");
    press("Enter"); // its build brings up an emergency choice, its button focused
    openDialog();
    const modal = document.getElementById("modal")!;
    const coverHeard = vi.fn();
    modal.addEventListener("keydown", coverHeard);
    modal.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true, cancelable: true }));
    expect(coverHeard, "the cover's own listeners do not hear it").not.toHaveBeenCalled();
    expect(repeatIsCanceled("Enter"), "Enter").toBe(true);
    expect(repeatIsCanceled("Backspace"), "Backspace").toBe(true);
    release("Enter");
    press("Enter"); // pressed on the cover: its own
    expect(repeatIsCanceled("Enter"), "an Enter pressed on the cover").toBe(false);
  });
});
