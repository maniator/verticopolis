import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { SKY_HEADROOM_FLOORS } from "../render/cameraBounds";
import { bandedExtent } from "../render/overviewMap/extent";
import { FLOOR } from "../render/scale";
import { MAP_OPEN_STORAGE_KEY, MAP_OPEN_VALUE } from "./overviewMapPrefs";
import type { OverviewMapDeps } from "./overviewMapWindow";
import { MAP_DOM_ID } from "./overviewMapDom";
import { CROP, disposeRigs, pointer, rig, rootEl, silent2d, towerSource, viewCanvas } from "./overviewMapWindow.fixture";

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

  it("marks itself drawn once it has painted the tower, for the gallery runner, and unmarks a closed map", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(silent2d());
    const r = rig();
    expect(rootEl().dataset.mapDrawn).toBe("true");
    r.win.setOpen(false, false);
    expect(rootEl().dataset.mapDrawn).toBeUndefined();
    r.win.setOpen(true, false);
    expect(rootEl().dataset.mapDrawn).toBe("true");
  });

  it("unmarks itself when a new pixel ratio clears its canvases, until the same frame paints them again", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(silent2d());
    const r = rig();
    const seen = new MutationObserver(() => {});
    seen.observe(rootEl(), { attributes: true, attributeFilter: ["data-map-drawn"], attributeOldValue: true });
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);
    r.win.frame();
    // Each record holds the value it replaced: the mark was taken off, then set again once painted.
    const replaced = seen.takeRecords().map((m) => m.oldValue);
    seen.disconnect();
    expect(replaced).toEqual(["true", null]);
    expect(rootEl().dataset.mapDrawn).toBe("true");
  });

  it("unmarks itself while there is no tower, and when a canvas loses or regains its context", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(silent2d());
    const r = rig();
    const deps = (r.win as unknown as { deps: OverviewMapDeps }).deps;
    deps.source = () => null;
    r.win.frame();
    expect(rootEl().dataset.mapDrawn).toBeUndefined();
    // The next tower repaints from scratch, so the mark comes back with it.
    deps.source = () => r.source;
    r.win.frame();
    expect(rootEl().dataset.mapDrawn).toBe("true");
    const canvases = [...rootEl().querySelectorAll("canvas")];
    expect(canvases).toHaveLength(2);
    for (const canvas of canvases) {
      // Nothing painted into a lost context shows, so it stays unmarked
      // until the context is back and the next frame repaints in full.
      canvas.dispatchEvent(new Event("contextlost"));
      r.win.frame();
      expect(rootEl().dataset.mapDrawn).toBeUndefined();
      canvas.dispatchEvent(new Event("contextrestored"));
      expect(rootEl().dataset.mapDrawn).toBeUndefined();
      r.win.frame();
      expect(rootEl().dataset.mapDrawn).toBe("true");
    }
    // Both lost: the first restore alone does not mark the map drawn.
    for (const canvas of canvases) canvas.dispatchEvent(new Event("contextlost"));
    canvases[0].dispatchEvent(new Event("contextrestored"));
    r.win.frame();
    expect(rootEl().dataset.mapDrawn).toBeUndefined();
    canvases[1].dispatchEvent(new Event("contextrestored"));
    r.win.frame();
    expect(rootEl().dataset.mapDrawn).toBe("true");
  });

  it("clears a lost picture once, and after a restore starts its size, patterns and paint again", () => {
    let lost = false;
    const ctx = Object.assign(silent2d(), { fillRect: vi.fn(), clearRect: vi.fn(), isContextLost: () => lost });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    const r = rig();
    const held = r.win as unknown as { patterns: unknown; resize(): void };
    const resize = vi.spyOn(held, "resize");
    const summary = document.getElementById(MAP_DOM_ID.summary)!;
    expect(summary.textContent).not.toBe("");
    // A context lost without its event: the frame asks, then clears both
    // canvases and the summary once, and paints nothing into it.
    lost = true;
    ctx.fillRect.mockClear();
    ctx.clearRect.mockClear();
    r.win.frame();
    r.win.frame();
    expect(ctx.clearRect).toHaveBeenCalledTimes(2);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(summary.textContent).toBe("");
    expect(rootEl().dataset.mapDrawn).toBeUndefined();
    // Back: new pattern tiles, a fresh size and a full paint, then constant.
    const before = held.patterns;
    lost = false;
    r.win.frame();
    expect(held.patterns).not.toBe(before);
    expect(resize).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(rootEl().dataset.mapDrawn).toBe("true");
    expect(summary.textContent).not.toBe("");
    const painted = ctx.fillRect.mock.calls.length;
    r.win.frame();
    expect(ctx.fillRect).toHaveBeenCalledTimes(painted);
    // A loss and its restore both between two frames start over the same way.
    const canvas = rootEl().querySelector("canvas")!;
    canvas.dispatchEvent(new Event("contextlost"));
    canvas.dispatchEvent(new Event("contextrestored"));
    const restored = held.patterns;
    r.win.frame();
    expect(held.patterns).not.toBe(restored);
    expect(resize).toHaveBeenCalledTimes(2);
    expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(painted);
    expect(rootEl().dataset.mapDrawn).toBe("true");
    // A restore that lands on a frame with no tower still starts over.
    const deps = (r.win as unknown as { deps: OverviewMapDeps }).deps;
    lost = true;
    r.win.frame();
    deps.source = () => null;
    lost = false;
    const beforeNoTower = held.patterns;
    r.win.frame();
    expect(held.patterns).not.toBe(beforeNoTower);
    deps.source = () => r.source;
    r.win.frame();
    expect(resize).toHaveBeenCalledTimes(3);
    expect(rootEl().dataset.mapDrawn).toBe("true");
  });

  it("trusts isContextLost over a loss event that never gets its restore event", () => {
    let lost = false;
    const ctx = Object.assign(silent2d(), { isContextLost: () => lost });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    const r = rig();
    lost = true;
    rootEl().querySelector("canvas")!.dispatchEvent(new Event("contextlost"));
    r.win.frame();
    expect(rootEl().dataset.mapDrawn).toBeUndefined();
    // The browser gives the context back and fires no event.
    lost = false;
    r.win.frame();
    expect(rootEl().dataset.mapDrawn).toBe("true");
  });

  it("starts new pattern tiles each time it opens", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(silent2d());
    const r = rig();
    const held = r.win as unknown as { patterns: unknown };
    r.win.setOpen(false, false);
    const closed = held.patterns;
    r.win.setOpen(true, false);
    expect(held.patterns).not.toBe(closed);
  });

  it("never marks itself drawn without a 2D context to paint the tower with", () => {
    // happy-dom's canvases have no 2D context, as a browser that refuses one.
    expect(document.createElement("canvas").getContext("2d")).toBeNull();
    const r = rig();
    expect(r.win.isOpen()).toBe(true);
    expect(rootEl().dataset.mapDrawn).toBeUndefined();
    // A new tower rebuilds the draw list (the rebuild sets the body's backdrop
    // again), and still nothing is painted.
    const body = viewCanvas().parentElement!;
    body.style.background = "";
    r.source.view = { ...r.source.view, rooms: [] };
    r.win.frame();
    expect(body.style.background).not.toBe("");
    expect(rootEl().dataset.mapDrawn).toBeUndefined();
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
    expect(r.moves.map((m) => m.floor)).toEqual([CROP.topLine, CROP.bottomLine]);
    expect([CROP.topLine, CROP.bottomLine]).toEqual([30, -1]);
  });

  it("lays the rig's tower out on the crop its tests measure in", () => {
    const { world, view } = towerSource();
    expect(bandedExtent(world, view.tower, SKY_HEADROOM_FLOORS)).toEqual(CROP);
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
