import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { FLOOR } from "../render/scale";
import { MAP_OPEN_STORAGE_KEY, MAP_OPEN_VALUE } from "./overviewMapPrefs";
import type { OverviewMapDeps } from "./overviewMapWindow";
import { MAP_DOM_ID } from "./overviewMapDom";
import { disposeRigs, pointer, rig, rootEl, viewCanvas } from "./overviewMapWindow.fixture";

beforeEach(() => vi.restoreAllMocks());
afterEach(() => disposeRigs());

describe("overview map window: opening and closing (CAP-1)", () => {
  it("opens by default on desktop and stays closed on a phone, behind a Map button", () => {
    const desktop = rig();
    expect(desktop.win.isOpen()).toBe(true);
    expect(document.getElementById(MAP_DOM_ID.toggle)!.hidden).toBe(true);
    const phone = rig({ phone: true });
    expect(phone.win.isOpen()).toBe(false);
    const toggle = document.getElementById(MAP_DOM_ID.toggle)!;
    expect(toggle.hidden).toBe(false);
    expect(toggle.getAttribute("aria-controls")).toBe(MAP_DOM_ID.window);
  });

  it("follows a stored choice over the default, and stores only an explicit one", () => {
    const r = rig({ stored: MAP_OPEN_VALUE.closed });
    expect(r.win.isOpen()).toBe(false);
    expect(r.storage.map.get(MAP_OPEN_STORAGE_KEY.desktop)).toBe(MAP_OPEN_VALUE.closed);
    const fresh = rig();
    expect(fresh.storage.map.size).toBe(0);
  });

  it("opens from the button and closes from the window's button, giving focus back", () => {
    const r = rig({ phone: true });
    const toggle = document.getElementById(MAP_DOM_ID.toggle) as HTMLButtonElement;
    toggle.click();
    expect(r.win.isOpen()).toBe(true);
    expect(r.storage.map.get(MAP_OPEN_STORAGE_KEY.phone)).toBe(MAP_OPEN_VALUE.open);
    (document.querySelector(".overview-map-close") as HTMLButtonElement).click();
    expect(r.win.isOpen()).toBe(false);
    expect(document.activeElement).toBe(toggle);
    expect(r.storage.map.get(MAP_OPEN_STORAGE_KEY.phone)).toBe(MAP_OPEN_VALUE.closed);
  });

  it("leaves focus with the page after a mouse close, so Space or Enter never reopens the map", () => {
    const r = rig();
    const close = document.querySelector(".overview-map-close") as HTMLButtonElement;
    close.focus();
    close.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true }));
    expect(r.win.isOpen()).toBe(false);
    expect(document.activeElement).not.toBe(document.getElementById(MAP_DOM_ID.toggle));
  });

  it("gives focus to the Map button after a keyboard press on the close button", () => {
    rig();
    const close = document.querySelector(".overview-map-close") as HTMLButtonElement;
    close.focus();
    close.dispatchEvent(new MouseEvent("click", { detail: 0, bubbles: true }));
    expect(document.activeElement).toBe(document.getElementById(MAP_DOM_ID.toggle));
  });

  it("keeps a mouse press from focusing the window, and a pinch over it from zooming the page", () => {
    rig();
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    viewCanvas().dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    const pinch = new WheelEvent("wheel", { bubbles: true, cancelable: true });
    // happy-dom's WheelEvent drops the modifier flags; a browser pinch reports Ctrl.
    Object.defineProperty(pinch, "ctrlKey", { value: true });
    viewCanvas().dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);
    const scroll = new WheelEvent("wheel", { bubbles: true, cancelable: true });
    viewCanvas().dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);
  });

  it("moves focus onto the map when a breakpoint change opens it under the focused button", () => {
    const r = rig({ phone: true, stored: MAP_OPEN_VALUE.closed });
    r.storage.setItem(MAP_OPEN_STORAGE_KEY.desktop, MAP_OPEN_VALUE.open);
    const toggle = document.getElementById(MAP_DOM_ID.toggle) as HTMLButtonElement;
    toggle.focus();
    r.phone.value = false;
    r.win.layoutChanged();
    expect(r.win.isOpen()).toBe(true);
    expect(document.activeElement).toBe(viewCanvas());
  });

  it("leaves focus off the map after a mouse click on the Map button, even one that focused the button", () => {
    rig({ phone: true });
    const toggle = document.getElementById(MAP_DOM_ID.toggle) as HTMLButtonElement;
    toggle.focus();
    toggle.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true }));
    expect(document.activeElement).not.toBe(viewCanvas());
  });

  it("never reopens the map on a held Enter's repeat after a keyboard close", () => {
    rig();
    const close = document.querySelector(".overview-map-close") as HTMLButtonElement;
    close.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    close.dispatchEvent(new MouseEvent("click", { detail: 0, bubbles: true }));
    const repeat = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", repeat: true, bubbles: true, cancelable: true });
    document.getElementById(MAP_DOM_ID.toggle)!.dispatchEvent(repeat);
    expect(repeat.defaultPrevented).toBe(true);
  });

  it("lets a held Tab move on past the Map button", () => {
    rig({ phone: true });
    const tab = new KeyboardEvent("keydown", { key: "Tab", code: "Tab", repeat: true, bubbles: true, cancelable: true });
    document.getElementById(MAP_DOM_ID.toggle)!.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });

  it("takes focus off the close button after a mouse press that slid off it, and only then", () => {
    rig();
    const close = document.querySelector(".overview-map-close") as HTMLButtonElement;
    close.focus();
    // A keyboard user on the close button clicks the title bar: focus stays.
    document.querySelector(".win-title")!.dispatchEvent(pointer("pointerdown", 5, 5));
    document.dispatchEvent(pointer("pointerup", 5, 5));
    expect(document.activeElement).toBe(close);
    close.dispatchEvent(pointer("pointerdown", 5, 5));
    document.dispatchEvent(pointer("pointerup", 400, 400));
    expect(document.activeElement).not.toBe(close);
  });

  it("lets a mouse press on the close button keep its default, so its pressed look shows", () => {
    rig();
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    document.querySelector(".overview-map-close")!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
  });

  it("is a region named by its title", () => {
    rig();
    expect(rootEl().getAttribute("role")).toBe("region");
    expect(document.getElementById(rootEl().getAttribute("aria-labelledby")!)!.textContent).toBe("Map");
  });

  it("closes on Escape without letting the key reach the game", () => {
    const r = rig();
    const game = vi.fn();
    window.addEventListener("keydown", game);
    viewCanvas().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    window.removeEventListener("keydown", game);
    expect(r.win.isOpen()).toBe(false);
    expect(game).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.getElementById(MAP_DOM_ID.toggle));
  });

  it("takes the other layout's choice when the breakpoint is crossed", () => {
    const r = rig();
    expect(r.win.isOpen()).toBe(true);
    r.phone.value = true;
    r.win.layoutChanged();
    expect(r.win.isOpen()).toBe(false);
    r.storage.setItem(MAP_OPEN_STORAGE_KEY.desktop, MAP_OPEN_VALUE.closed);
    r.phone.value = false;
    r.win.layoutChanged();
    expect(r.win.isOpen()).toBe(false);
  });

  it("goes in the stage ahead of the world canvas, so the cards after it paint over it", () => {
    rig();
    const stage = document.getElementById("stage")!;
    expect(stage.firstElementChild!.id).toBe(MAP_DOM_ID.window);
  });
});

describe("overview map window: frames (CAP-6)", () => {
  it("sizes the canvases to the body and writes the summary", () => {
    rig();
    expect(viewCanvas().width).toBe(200);
    expect(viewCanvas().height).toBe(288);
    expect(document.getElementById(MAP_DOM_ID.summary)!.textContent).toBe("Tower map: 10 floors above ground. The view is above the top floor, 10.");
  });

  it("reads the tower and the camera only, and does no work on an unchanged frame", () => {
    const r = rig();
    const summary = document.getElementById(MAP_DOM_ID.summary)!;
    const write = vi.spyOn(summary, "textContent", "set");
    const source = vi.fn(() => r.source);
    (r.win as unknown as { deps: OverviewMapDeps }).deps.source = source;
    const model = (r.win as unknown as { model: { sync(...a: unknown[]): boolean } }).model;
    const sync = vi.spyOn(model, "sync");
    r.win.frame();
    r.win.frame();
    expect(source).toHaveBeenCalledTimes(2);
    expect(sync.mock.results.map((x) => x.value)).toEqual([false, false]);
    expect(write).not.toHaveBeenCalled();
    // The same spy sees a real change: a new floor rewrites the summary once.
    r.cam.posY = -5 * FLOOR;
    r.win.frame();
    r.win.frame();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the tower when the view hands over new arrays, and not before", () => {
    const r = rig();
    const model = (r.win as unknown as { model: { sync(...a: unknown[]): boolean } }).model;
    const sync = vi.spyOn(model, "sync");
    r.win.frame();
    r.source.view = { ...r.source.view, rooms: [] };
    r.win.frame();
    expect(sync.mock.results.map((x) => x.value)).toEqual([false, true]);
  });

  it("does nothing at all while closed", () => {
    const r = rig({ phone: true });
    const source = vi.fn(() => r.source);
    (r.win as unknown as { deps: OverviewMapDeps }).deps.source = source;
    r.win.frame();
    expect(source).not.toHaveBeenCalled();
  });

  it("updates the summary when the camera moves to another floor", () => {
    const r = rig();
    r.cam.posY = -5 * FLOOR;
    r.win.frame();
    expect(document.getElementById(MAP_DOM_ID.summary)!.textContent).toBe("Tower map: 10 floors above ground. The view is at floor 5.");
  });
});

describe("overview map window: focus and keys (CAP-5)", () => {
  it("gives keyboard focus back to the page when the world is pressed", () => {
    rig();
    viewCanvas().focus();
    document.getElementById("view")!.dispatchEvent(pointer("pointerdown", 10, 10, "touch"));
    expect(document.activeElement).not.toBe(viewCanvas());
  });

  it("moves focus onto the map when the button is pressed from the keyboard", () => {
    rig({ phone: true });
    const toggle = document.getElementById(MAP_DOM_ID.toggle) as HTMLButtonElement;
    toggle.focus();
    toggle.dispatchEvent(new MouseEvent("click", { detail: 0, bubbles: true }));
    expect(document.activeElement).toBe(viewCanvas());
  });

  it("gives focus to the button when a breakpoint change closes the focused map", () => {
    const r = rig();
    viewCanvas().focus();
    r.phone.value = true;
    r.win.layoutChanged();
    expect(r.win.isOpen()).toBe(false);
    expect(document.activeElement).toBe(document.getElementById(MAP_DOM_ID.toggle));
  });

  it("moves the view with the arrow keys and keeps the game's building keys from the world", () => {
    const r = rig();
    const game = vi.fn();
    window.addEventListener("keydown", game);
    for (const key of ["ArrowUp", "Enter", "Delete", "x", "w"]) viewCanvas().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    window.removeEventListener("keydown", game);
    expect(game).not.toHaveBeenCalled();
    expect(r.moves).toEqual([{ tile: 100, floor: 24 }]);
  });

  it("keeps the building keys from the world on the close button too, and never cancels its press", () => {
    rig();
    const close = document.querySelector(".overview-map-close") as HTMLButtonElement;
    const game = vi.fn();
    window.addEventListener("keydown", game);
    const keys = ["Enter", "x", "Delete"].map((key) => new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    for (const k of keys) close.dispatchEvent(k);
    window.removeEventListener("keydown", game);
    expect(game).not.toHaveBeenCalled();
    expect(keys.some((k) => k.defaultPrevented)).toBe(false);
  });

  it("speaks the summary only while the map has focus", () => {
    rig();
    const summary = document.getElementById(MAP_DOM_ID.summary)!;
    expect(summary.getAttribute("aria-live")).toBe("off");
    viewCanvas().focus();
    expect(summary.getAttribute("aria-live")).toBe("polite");
    viewCanvas().blur();
    expect(summary.getAttribute("aria-live")).toBe("off");
  });

  it("marks the theme for the Classic pen", () => {
    rig();
    expect(rootEl().dataset.mapTheme).toBe("classic");
  });

  it("keeps the keyup of a kept key from the game too, and lets a passed key's keyup through", () => {
    rig();
    const game = vi.fn();
    window.addEventListener("keyup", game);
    viewCanvas().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    viewCanvas().dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp", bubbles: true }));
    viewCanvas().dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
    window.removeEventListener("keyup", game);
    expect(game).toHaveBeenCalledTimes(1);
    expect((game.mock.calls[0][0] as KeyboardEvent).key).toBe(" ");
  });

  it("goes to the top and the bottom of the map with Home and End", () => {
    const r = rig();
    viewCanvas().dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    viewCanvas().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    expect(r.moves.map((m) => m.floor)).toEqual([107, -11]);
  });

  it("lets zoom, speed, the Space pan key and shortcuts through to the game", () => {
    rig();
    const game = vi.fn();
    window.addEventListener("keydown", game);
    viewCanvas().dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
    viewCanvas().dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true }));
    viewCanvas().dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    viewCanvas().dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    window.removeEventListener("keydown", game);
    expect(game).toHaveBeenCalledTimes(4);
  });
});
