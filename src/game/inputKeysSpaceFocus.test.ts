import { describe, it, expect, vi, afterEach } from "vitest";
import { makeApp, pointer, press, release, tap } from "./inputKeys.fixture";

/**
 * Where focus goes during a Space press, two of the places the game tells
 * Space apart from other keys (the palette's is in `uiPalette.test.ts`), the
 * order of the context-menu ender, and the record of other keys held with
 * nothing covering the world. The rest of the Space hold is in
 * `inputKeysSpace.test.ts` and `inputKeysSpaceHold.test.ts`.
 */

vi.mock("./audioPrefs", () => ({ flushPrefsSave: vi.fn() }));

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

/** Send a key repeat and say whether the game canceled it. */
function repeatIsCanceled(key: string, target: EventTarget = window, code = ""): boolean {
  const repeat = new KeyboardEvent("keydown", { key, code, repeat: true, bubbles: true, cancelable: true });
  target.dispatchEvent(repeat);
  return repeat.defaultPrevented;
}

function openDialog(): void {
  const dialog = document.createElement("dialog");
  dialog.id = "modal";
  document.body.appendChild(dialog);
  dialog.open = true;
}

/** The controls that act on a Space release, for a script to focus mid-press. */
const CONTROLS: Record<string, () => HTMLElement> = {
  // Stands in for the Map's button, which gets focus when a narrower
  // window closes the Map.
  button: () => document.createElement("button"),
  "palette item": () => {
    const item = document.createElement("div");
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    return item;
  },
  checkbox: () => Object.assign(document.createElement("input"), { type: "checkbox" }),
  radio: () => Object.assign(document.createElement("input"), { type: "radio" }),
  "input button": () => Object.assign(document.createElement("input"), { type: "button" }),
};

describe("focus and Space", () => {
  it("a control focused mid-press gets neither Space's repeats nor its release", () => {
    for (const [name, make] of Object.entries(CONTROLS)) {
      const app = makeApp();
      press(" ");
      const control = document.body.appendChild(make());
      const heard = vi.fn();
      control.addEventListener("keydown", heard);
      control.focus();
      expect(repeatIsCanceled(" ", control), `a repeat does not arm the ${name}`).toBe(true);
      expect(heard, `nor reaches the ${name}'s own listener`).not.toHaveBeenCalled();
      expect(releaseIsCanceled(), `the release does not press the ${name}`).toBe(true);
      // The focus rule returns before the build, and without it blocksGameKey
      // (its focused-control or typing-target rule) would keep the build out.
      // This check fails only if both break.
      expect(app.keyboard.commitCursor, `nor builds past the ${name}`).not.toHaveBeenCalled();
      press(" "); // pressed on the control: its own, even after focus leaves and comes back
      control.blur();
      control.focus();
      expect(repeatIsCanceled(" ", control), `the ${name}'s own repeat`).toBe(false);
      expect(heard, `the ${name} hears its own repeat`).toHaveBeenCalledTimes(1);
      expect(releaseIsCanceled(), `the ${name}'s own release`).toBe(false);
      expect(app.keyboard.commitCursor, `the ${name}'s own Space builds nothing`).not.toHaveBeenCalled();
      document.body.innerHTML = "";
    }
  });

  it("knows Space by its old key name and by its physical key when a control gets focus mid-press", () => {
    for (const [name, init] of [
      ["its old key name", { key: "Spacebar", code: "" }],
      ["its physical key", { key: "\u00a0", code: "Space" }],
    ] as const) {
      const app = makeApp();
      press(init.key, init);
      const control = document.body.appendChild(document.createElement("button"));
      control.focus();
      expect(repeatIsCanceled(init.key, control, init.code), `a repeat of Space known by ${name}`).toBe(true);
      expect(releaseIsCanceled(init), `the release of Space known by ${name}`).toBe(true);
      press(init.key, init); // pressed on the button: its own, even after focus leaves and comes back
      control.blur();
      control.focus();
      expect(repeatIsCanceled(init.key, control, init.code), `its own repeat of Space known by ${name}`).toBe(false);
      expect(releaseIsCanceled(init), `its own release of Space known by ${name}`).toBe(false);
      expect(app.keyboard.commitCursor, `Space known by ${name} builds nothing`).not.toHaveBeenCalled();
      document.body.innerHTML = "";
    }
  });

  it("a button clicked while a Space the game does not follow is down gets neither", () => {
    // A click during a hold the game follows makes the hold a pan. A Space
    // typed into a field or pressed as a chord has no hold, so the focus rule
    // alone keeps the clicked button out.
    const STARTS: Record<string, () => void> = {
      "typed into a field": () => {
        document.body.appendChild(Object.assign(document.createElement("input"), { type: "text" })).focus();
        press(" ");
      },
      "pressed as a chord": () => press(" ", { ctrlKey: true }),
    };
    for (const [name, start] of Object.entries(STARTS)) {
      const app = makeApp();
      start();
      const button = document.body.appendChild(document.createElement("button"));
      pointer("pointerdown", 1, button);
      button.focus(); // the click's focus
      pointer("pointerup", 1, button);
      expect(repeatIsCanceled(" ", button), `a Space ${name}: its repeat`).toBe(true);
      expect(releaseIsCanceled(), `a Space ${name}: its release`).toBe(true);
      expect(app.keyboard.commitCursor, `a Space ${name} builds nothing`).not.toHaveBeenCalled();
      document.body.innerHTML = "";
    }
  });

  it("a text field or dropdown that gets focus with nothing covering the world still gets Space's repeats", () => {
    const FIELDS: Record<string, () => HTMLElement> = {
      "text field": () => Object.assign(document.createElement("input"), { type: "text" }),
      dropdown: () => document.createElement("select"),
    };
    for (const [name, make] of Object.entries(FIELDS)) {
      for (const firstSeen of ["a press", "repeats"]) {
        makeApp();
        const field = document.body.appendChild(make());
        if (firstSeen === "a press") press(" ");
        field.focus();
        expect(repeatIsCanceled(" ", field), `the ${name}, Space first seen as ${firstSeen}`).toBe(false);
        document.body.innerHTML = "";
      }
    }
  });

  it("a control focused before a Space first seen as repeats gets neither", () => {
    const app = makeApp();
    const toggle = document.body.appendChild(document.createElement("button"));
    toggle.focus();
    expect(repeatIsCanceled(" ", toggle), "a repeat does not arm it").toBe(true);
    expect(releaseIsCanceled(), "the release does not press it").toBe(true);
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("a button that gets focus when a cover closes mid-press gets neither", () => {
    for (const firstSeen of ["a press", "repeats"]) {
      const app = makeApp();
      openDialog();
      const choice = document.getElementById("modal")!.appendChild(document.createElement("button"));
      choice.focus();
      if (firstSeen === "a press") press(" ");
      else expect(repeatIsCanceled(" ", choice), "a Space first seen as repeats is not the cover's").toBe(true);
      document.getElementById("modal")!.remove();
      const opener = document.body.appendChild(document.createElement("button"));
      opener.focus(); // the dialog hands focus back to what opened it
      expect(repeatIsCanceled(" ", opener), `Space first seen as ${firstSeen}: its repeat`).toBe(true);
      expect(releaseIsCanceled(), `Space first seen as ${firstSeen}: its release`).toBe(true);
      expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
      document.body.innerHTML = "";
    }
  });

  it("a button focused after Cmd's release ended the hold gets neither", () => {
    makeApp();
    press(" ");
    release("Meta"); // ends the hold with Space still down
    const toggle = document.body.appendChild(document.createElement("button"));
    toggle.focus();
    expect(repeatIsCanceled(" ", toggle), "its repeat").toBe(true);
    expect(releaseIsCanceled(), "its release").toBe(true);
  });

  it("leaves the release alone when focus moves to something that does not act on it", () => {
    const TARGETS: Record<string, () => HTMLElement> = {
      link: () => Object.assign(document.createElement("a"), { href: "#help" }),
      "Map canvas": () => {
        const map = document.createElement("canvas");
        map.tabIndex = 0;
        map.setAttribute("role", "application");
        return map;
      },
    };
    for (const [name, make] of Object.entries(TARGETS)) {
      const app = makeApp();
      press(" ");
      document.body.appendChild(make()).focus();
      expect(releaseIsCanceled(), `a ${name}`).toBe(false);
      // Only blocksGameKey's focused-control rule keeps this build out.
      expect(app.keyboard.commitCursor, `nor builds past the ${name}`).not.toHaveBeenCalled();
      document.body.innerHTML = "";
    }
  });

  it("tells Space apart by its physical key on a repeat and on a focused button", () => {
    const app = makeApp();
    press(" ");
    openDialog(); // a cover that came up mid-press
    expect(repeatIsCanceled("Spacebar"), "a repeat reported as Spacebar").toBe(true);
    expect(repeatIsCanceled("\u00a0", window, "Space"), "a no-break space known by its physical key").toBe(true);
    release(" ");
    document.body.innerHTML = "";
    tap("Spacebar"); // with nothing focused, each builds
    tap("\u00a0", { code: "Space" });
    expect(app.keyboard.commitCursor, "each is a Space").toHaveBeenCalledTimes(2);
    document.body.appendChild(document.createElement("button")).focus();
    tap("Spacebar");
    tap("\u00a0", { code: "Space" });
    expect(app.keyboard.commitCursor, "a focused button keeps its Space").toHaveBeenCalledTimes(2);
  });

  it("a context menu the page kept closed leaves the hold", () => {
    const app = makeApp();
    const panel = document.body.appendChild(document.createElement("div"));
    panel.addEventListener("contextmenu", (e) => e.preventDefault());
    press(" ");
    panel.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(app.spacePanKey!()).toBe(true);
  });

  it("forgets a key held with nothing covering the world at its release, or at a press under a cover", () => {
    makeApp();
    press("Enter");
    release("Enter");
    openDialog();
    expect(repeatIsCanceled("Enter"), "released before the cover came up").toBe(false);
    document.body.innerHTML = "";
    press("Backspace"); // its release is lost
    openDialog();
    press("Backspace"); // pressed again, on the cover
    expect(repeatIsCanceled("Backspace"), "pressed again under the cover").toBe(false);
  });
});
