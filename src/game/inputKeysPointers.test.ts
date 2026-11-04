import { describe, it, expect, vi, afterEach } from "vitest";
import { makeApp, pointer, press, release, tap } from "./inputKeys.fixture";

/**
 * The pointers a Space hold counts as held down. A hold with a pointer down at
 * any moment is the world's pan key and builds nothing, so a press must count
 * however a handler lower down treats it, and a release the page never saw must
 * stop counting. The rest of the Space split is in `inputKeysSpace.test.ts`.
 */

vi.mock("./audioPrefs", () => ({ flushPrefsSave: vi.fn() }));

afterEach(() => {
  (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.innerHTML = "";
});

/** `PointerEvent.buttons` values: none held, or the primary button held. */
const BUTTONS = { none: 0, primary: 1 } as const;

describe("the pointers a Space hold counts", () => {
  it("counts a pointer press that a handler further down stops from bubbling", () => {
    const app = makeApp();
    const world = document.createElement("div");
    world.addEventListener("pointerdown", (e) => e.stopPropagation());
    document.body.appendChild(world);
    press(" ");
    pointer("pointerdown", 1, world);
    release(" ");
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("a pointer lost to the browser, or let go over another window, no longer counts as down", () => {
    const app = makeApp();
    pointer("pointerdown", 1);
    pointer("pointercancel", 1);
    pointer("pointerdown", 2);
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 2, buttons: BUTTONS.none }));
    tap(" ");
    expect(app.keyboard.commitCursor).toHaveBeenCalledTimes(1);
  });

  it("a new primary press of a kind forgets a pointer of that kind whose release was lost", () => {
    const app = makeApp();
    const touch = (type: "pointerdown" | "pointerup", id: number, isPrimary: boolean): void => {
      pointer(type, id, window, { pointerType: "touch", isPrimary });
    };
    touch("pointerdown", 5, true); // its release went to a system gesture
    touch("pointerdown", 6, true);
    touch("pointerup", 6, true);
    tap(" ");
    expect(app.keyboard.commitCursor, "the lost touch no longer counts").toHaveBeenCalledTimes(1);
    // A second finger is not primary: the first one is still down.
    touch("pointerdown", 7, true);
    touch("pointerdown", 8, false);
    touch("pointerup", 8, false);
    tap(" ");
    expect(app.keyboard.commitCursor, "the first finger still holds the pan").toHaveBeenCalledTimes(1);
  });

  it("a mouse press forgets a touch whose release was lost", () => {
    const app = makeApp();
    pointer("pointerdown", 5, window, { pointerType: "touch", isPrimary: true });
    pointer("pointerdown", 1, window, { pointerType: "mouse", isPrimary: true });
    pointer("pointerup", 1, window, { pointerType: "mouse", isPrimary: true });
    tap(" ");
    expect(app.keyboard.commitCursor).toHaveBeenCalledTimes(1);
  });

  it("a context menu the game keeps closed leaves the press it came in on record", () => {
    const app = makeApp();
    const world = document.createElement("div");
    world.addEventListener("contextmenu", (e) => e.preventDefault());
    document.body.appendChild(world);
    pointer("pointerdown", 1, world);
    world.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    tap(" ");
    expect(app.keyboard.commitCursor, "the press is still held, so the hold is a pan").not.toHaveBeenCalled();
  });

  it("a page hidden mid-hold drops the tap, so the first cursor key back does not build", () => {
    const app = makeApp();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    try {
      press(" ");
      document.dispatchEvent(new Event("visibilitychange"));
    } finally {
      hidden.mockRestore();
    }
    press("ArrowRight");
    release(" ");
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });

  it("a context menu or a hidden page forgets the pointers, and a held button's move restores one", () => {
    const app = makeApp();
    pointer("pointerdown");
    window.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    tap(" ");
    pointer("pointerdown", 2);
    document.dispatchEvent(new Event("visibilitychange"));
    tap(" ");
    expect(app.keyboard.commitCursor).toHaveBeenCalledTimes(2);
    pointer("pointermove", 2, window, { buttons: BUTTONS.primary });
    tap(" ");
    expect(app.keyboard.commitCursor, "the button still held is a pan again").toHaveBeenCalledTimes(2);
  });

  it("a button still held after focus left and came back keeps a Space hold a pan", () => {
    const app = makeApp();
    pointer("pointerdown");
    window.dispatchEvent(new Event("blur"));
    pointer("pointermove", 1, window, { buttons: BUTTONS.primary });
    tap(" ");
    expect(app.keyboard.commitCursor).not.toHaveBeenCalled();
  });
});
