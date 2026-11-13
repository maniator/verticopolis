import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";
import { editorPlacedByPlayer, forgetEditorPlacement, wireMovableWindows } from "./movableWindows";

/**
 * The facility card's and the dialog's movers: wired once, the card's spot
 * read and forgotten through the per-frame helpers, and given back to its
 * layout when the page switches between the phone and desktop layouts.
 * happy-dom lays nothing out, so the stage and the card boxes are stubbed.
 */

function makeApp() {
  const stage = document.createElement("div");
  stage.id = "stage";
  const editor = document.createElement("div");
  editor.id = "editor";
  editor.className = "win win-closable";
  editor.innerHTML = `<div class="win-title"><span>Office</span><button type="button">✕</button></div>`;
  stage.append(editor);
  const modal = document.createElement("dialog");
  document.body.append(stage, modal);
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 600));
  Object.defineProperty(stage, "clientWidth", { value: 800 });
  Object.defineProperty(stage, "clientHeight", { value: 600 });
  vi.spyOn(editor, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 400, 250, 190));
  const title = editor.querySelector<HTMLElement>(".win-title")!;
  title.setPointerCapture = vi.fn();
  const mq = new EventTarget() as EventTarget & { matches: boolean };
  mq.matches = false;
  const app = { mobileMq: mq, ui: { el: { editor, modal } } } as unknown as GameApp;
  return { app, editor, title, mq };
}

function dragTitle(title: HTMLElement): void {
  const at = (type: string, x: number, buttons: number) =>
    title.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", button: 0, buttons, clientX: x, clientY: 410 }));
  at("pointerdown", 30, 1);
  at("pointermove", 130, 1);
  at("pointerup", 130, 0);
}

describe("wireMovableWindows", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("does nothing on a page without the tower view", () => {
    const { app, editor } = makeApp();
    document.getElementById("stage")!.id = "";
    wireMovableWindows(app);
    expect(editor.classList.contains("win-movable")).toBe(false);
    expect(editorPlacedByPlayer(app)).toBe(false);
  });

  it("reports a card the player dragged, and forgets it on request", () => {
    const { app, editor, title } = makeApp();
    wireMovableWindows(app);
    dragTitle(title);
    expect(editorPlacedByPlayer(app)).toBe(true);
    expect(editor.style.left).toBe("110px");
    forgetEditorPlacement(app);
    expect(editorPlacedByPlayer(app)).toBe(false);
    expect(editor.style.left).toBe("");
  });

  it("counts a press on the title bar that has not moved yet, so the next frame does not dock the card under it", () => {
    const { app, title } = makeApp();
    wireMovableWindows(app);
    title.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", button: 0, buttons: 1, clientX: 30, clientY: 410 }));
    expect(editorPlacedByPlayer(app)).toBe(true);
    title.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", button: 0, buttons: 0, clientX: 30, clientY: 410 }));
    expect(editorPlacedByPlayer(app)).toBe(false);
  });

  it("moves the card on a phone too, and gives it back to its layout when the layout switches", () => {
    const { app, editor, title, mq } = makeApp();
    mq.matches = true;
    wireMovableWindows(app);
    dragTitle(title);
    expect(editorPlacedByPlayer(app)).toBe(true);
    mq.matches = false;
    mq.dispatchEvent(new Event("change"));
    expect(editorPlacedByPlayer(app)).toBe(false);
    expect(editor.style.top).toBe("");
  });
});
