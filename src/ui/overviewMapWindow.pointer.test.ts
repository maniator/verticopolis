import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { MAP_DOM_ID } from "./overviewMapDom";
import { MAP_POINTER_FOCUS_MS } from "./overviewMapKeys";
import { MAP_OPEN_STORAGE_KEY, MAP_OPEN_VALUE } from "./overviewMapPrefs";
import { WORLD_PRESS_CLASS } from "./overviewMapWindow";
import { CROP, disposeRigs, mapX, mapY, pointer, rig, viewCanvas, worldPressed } from "./overviewMapWindow.fixture";

beforeEach(() => vi.restoreAllMocks());
afterEach(() => disposeRigs());

describe("overview map window: camera binding (CAP-3)", () => {
  it("centers the view on a tap on the view mark too", () => {
    const r = rig();
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(110), mapY(22)));
    viewCanvas().dispatchEvent(pointer("pointermove", mapX(110) + 2, mapY(22)));
    expect(r.moves).toHaveLength(0);
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(110) + 2, mapY(22)));
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0].floor).toBeCloseTo(22);
  });

  it("centers the view where a click away from the view mark lifts", () => {
    const r = rig();
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26)));
    expect(r.moves).toHaveLength(0);
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(300) + 2, mapY(26)));
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0].tile).toBeCloseTo(300 + (2 * CROP.width) / 200);
    expect(r.moves[0].floor).toBeCloseTo(26);
  });

  it("aims a click or tap in the margin left of the lot at a tile below 0, for the camera clamp to hold", () => {
    // The map's left edge is 15 tiles of margin out from tile 0. The rig's camera takes the move as asked;
    // in the game `applyView` runs `clamp` in `towerInputCamera.ts`, which keeps the center between tile 0 and
    // the lot's width, so the view's center stops on the lot's left edge.
    expect(CROP.leftTile).toBe(-15);
    expect(mapX(-15)).toBe(0);
    const r = rig();
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(-10), mapY(20)));
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(-10), mapY(20)));
    viewCanvas().dispatchEvent(pointer("pointerdown", 0, mapY(20), "touch", 2));
    viewCanvas().dispatchEvent(pointer("pointerup", 0, mapY(20), "touch", 2));
    expect(r.moves).toHaveLength(2);
    expect(r.moves[0].tile).toBeCloseTo(-10);
    expect(r.moves[0].floor).toBeCloseTo(20);
    expect(r.moves[1].tile).toBeCloseTo(-15);
  });

  it("does not center on the release of a press that traveled there, or on a cancel", () => {
    const r = rig();
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26)));
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(300) + 20, mapY(26)));
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch"));
    viewCanvas().dispatchEvent(pointer("pointercancel", mapX(300), mapY(26), "touch"));
    expect(r.moves).toHaveLength(0);
  });

  it("brings the view under a drag that starts off the view mark and follows it (#343 follow-up)", () => {
    // A finger that lands anywhere on the map and slides takes the view with
    // it, on the first move past the tap slop; the release adds no move.
    const r = rig();
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch"));
    viewCanvas().dispatchEvent(pointer("pointermove", mapX(300) + 2, mapY(26), "touch"));
    expect(r.moves).toHaveLength(0);
    viewCanvas().dispatchEvent(pointer("pointermove", mapX(300) + 20, mapY(26), "touch"));
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0].tile).toBeCloseTo(300 + (20 * CROP.width) / 200);
    expect(r.moves[0].floor).toBeCloseTo(26);
    viewCanvas().dispatchEvent(pointer("pointermove", mapX(250), mapY(14), "touch"));
    expect(r.moves).toHaveLength(2);
    expect(r.moves[1].tile).toBeCloseTo(250);
    expect(r.moves[1].floor).toBeCloseTo(14);
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(250), mapY(14), "touch"));
    expect(r.moves).toHaveLength(2);
  });

  it("brings the view under a mouse drag that starts off the view mark too", () => {
    const r = rig();
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26)));
    viewCanvas().dispatchEvent(pointer("pointermove", mapX(320), mapY(26)));
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0].tile).toBeCloseTo(320);
  });

  it("drags the view mark by the pointer's travel, without jumping to the pointer", () => {
    const r = rig();
    const grab = { x: mapX(110), y: mapY(22) };
    viewCanvas().dispatchEvent(pointer("pointerdown", grab.x, grab.y));
    expect(r.moves).toHaveLength(0);
    viewCanvas().dispatchEvent(pointer("pointermove", grab.x + (mapX(30) - mapX(0)), grab.y - (mapY(0) - mapY(5))));
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0].tile).toBeCloseTo(130);
    expect(r.moves[0].floor).toBeCloseTo(25);
    viewCanvas().dispatchEvent(pointer("pointerup", grab.x, grab.y));
    viewCanvas().dispatchEvent(pointer("pointermove", 10, 10));
    expect(r.moves).toHaveLength(1);
  });

  it("follows only the pointer that pressed, and ignores a second finger", () => {
    const r = rig();
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(100), mapY(20), "touch", 1));
    viewCanvas().dispatchEvent(pointer("pointermove", 5, 5, "touch", 2));
    viewCanvas().dispatchEvent(pointer("pointerdown", 5, 5, "touch", 2));
    viewCanvas().dispatchEvent(pointer("pointerup", 5, 5, "touch", 2));
    expect(r.moves).toHaveLength(0);
  });

  it("stops dragging a mouse that moves with no button held", () => {
    const r = rig();
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(110), mapY(22)));
    viewCanvas().dispatchEvent(new PointerEvent("pointermove", { clientX: 150, clientY: 10, pointerType: "mouse", pointerId: 1, buttons: 0, bubbles: true }));
    viewCanvas().dispatchEvent(pointer("pointermove", 160, 10));
    expect(r.moves).toHaveLength(0);
  });

  it("keeps the browser's menu off the map", () => {
    rig();
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    viewCanvas().dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });

  it("lets pointers through the window and its button while a left mouse or pen press on the world is held", () => {
    rig();
    const world = document.getElementById("view")!;
    world.dispatchEvent(pointer("pointerdown", 10, 10));
    expect(worldPressed()).toBe(true);
    expect(document.getElementById(MAP_DOM_ID.toggle)!.classList.contains(WORLD_PRESS_CLASS)).toBe(true);
    // A touch lifting elsewhere (a hybrid device) does not end the mouse press.
    document.dispatchEvent(pointer("pointerup", 10, 10, "touch", 7));
    expect(worldPressed()).toBe(true);
    document.dispatchEvent(pointer("pointerup", 10, 10));
    expect(worldPressed()).toBe(false);
    world.dispatchEvent(pointer("pointerdown", 10, 10, "pen"));
    expect(worldPressed()).toBe(true);
    document.dispatchEvent(pointer("pointercancel", 10, 10, "pen"));
    expect(worldPressed()).toBe(false);
  });

  it("lets pointers through for a middle or right world press (both pan), never for a touch or a press on the Map button", () => {
    rig({ phone: true });
    const world = document.getElementById("view")!;
    world.dispatchEvent(pointer("pointerdown", 10, 10, "touch", 3));
    document.getElementById(MAP_DOM_ID.toggle)!.dispatchEvent(pointer("pointerdown", 10, 10));
    expect(worldPressed()).toBe(false);
    // The middle button reports `buttons` 4 and the right button 2.
    world.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", pointerId: 1, button: 1, buttons: 4, bubbles: true }));
    expect(worldPressed()).toBe(true);
    document.dispatchEvent(pointer("pointerup", 10, 10));
    world.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", pointerId: 1, button: 2, buttons: 2, bubbles: true }));
    expect(worldPressed()).toBe(true);
  });

  it("keeps a mouse drag of the view mark going when a touch lands", () => {
    const r = rig();
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(110), mapY(22)));
    const palm = new PointerEvent("pointerdown", { pointerType: "touch", pointerId: 9, isPrimary: true, button: 0, buttons: 1, bubbles: true, cancelable: true });
    viewCanvas().dispatchEvent(palm);
    viewCanvas().dispatchEvent(pointer("pointermove", mapX(140), mapY(22)));
    expect(r.moves).toHaveLength(1);
  });

  it("ignores a pen's barrel or eraser button, and drops a pen press whose release was lost", () => {
    const r = rig();
    const pen = (type: string, id: number, button: number, buttons: number) =>
      new PointerEvent(type, { clientX: mapX(300), clientY: mapY(26), pointerType: "pen", pointerId: id, isPrimary: true, button, buttons, bubbles: true, cancelable: true });
    viewCanvas().dispatchEvent(pen("pointerdown", 1, 2, 2));
    viewCanvas().dispatchEvent(pen("pointerup", 1, 2, 0));
    expect(r.moves).toHaveLength(0);
    // Contact 2 never lifts; contact 3 is a new primary pen and taps.
    viewCanvas().dispatchEvent(pen("pointerdown", 2, 0, 1));
    viewCanvas().dispatchEvent(pen("pointerdown", 3, 0, 1));
    viewCanvas().dispatchEvent(pen("pointerup", 3, 0, 0));
    expect(r.moves).toHaveLength(1);
  });

  it("forgets a map press when the page loses focus", () => {
    const r = rig();
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(110), mapY(22)));
    window.dispatchEvent(new Event("blur"));
    viewCanvas().dispatchEvent(pointer("pointermove", mapX(140), mapY(22)));
    expect(r.moves).toHaveLength(0);
  });

  it("still takes a Tab onto the map while a pointer press is held", () => {
    rig();
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", bubbles: true }));
    viewCanvas().focus();
    expect(document.activeElement).toBe(viewCanvas());
  });

  it("lets keyboard focus onto the map after a pinch half on it, or after the page regains focus", () => {
    rig();
    document.getElementById("view")!.dispatchEvent(pointer("pointerdown", 10, 10, "touch", 1));
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch", 2));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    viewCanvas().focus();
    expect(document.activeElement).toBe(viewCanvas());
    viewCanvas().blur();
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26)));
    window.dispatchEvent(new Event("blur"));
    viewCanvas().focus();
    expect(document.activeElement).toBe(viewCanvas());
  });

  it("ends a pen press whose release was lost when the pen hovers back with a new id", () => {
    const r = rig();
    viewCanvas().dispatchEvent(new PointerEvent("pointerdown", { clientX: mapX(110), clientY: mapY(22), pointerType: "pen", pointerId: 4, isPrimary: true, button: 0, buttons: 1, bubbles: true, cancelable: true }));
    viewCanvas().dispatchEvent(new PointerEvent("pointermove", { pointerType: "pen", pointerId: 5, buttons: 0, bubbles: true }));
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26)));
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(300), mapY(26)));
    expect(r.moves).toHaveLength(1);
  });

  it("never lets a pointer press focus the map", () => {
    rig();
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26)));
    viewCanvas().focus();
    expect(document.activeElement).not.toBe(viewCanvas());
  });

  it("takes focus that follows a tap's release as the tap's, for a short while only", () => {
    rig();
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch"));
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(300), mapY(26), "touch"));
    now.mockReturnValue(1000 + MAP_POINTER_FOCUS_MS);
    viewCanvas().focus();
    expect(document.activeElement).not.toBe(viewCanvas());
    // Later focus (a dialog giving it back, assistive tech) is not the tap's.
    now.mockReturnValue(1001 + MAP_POINTER_FOCUS_MS);
    viewCanvas().focus();
    expect(document.activeElement).toBe(viewCanvas());
  });

  it("lets focus onto the map after a tap when a key is pressed, a press lands elsewhere, or the window gives it", () => {
    const r = rig({ phone: true, stored: MAP_OPEN_VALUE.open });
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch"));
    // A key held from before (panning the world) repeats: still the tap's.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp", repeat: true, bubbles: true }));
    viewCanvas().focus();
    expect(document.activeElement).not.toBe(viewCanvas());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", bubbles: true }));
    viewCanvas().focus();
    expect(document.activeElement).toBe(viewCanvas());
    viewCanvas().blur();
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch"));
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(300), mapY(26), "touch"));
    document.getElementById("view")!.dispatchEvent(pointer("pointerdown", 10, 10));
    viewCanvas().focus();
    expect(document.activeElement).toBe(viewCanvas());
    viewCanvas().blur();
    // The Map button pressed by assistive tech (a click with no key) right
    // after a tap on the map, then closed.
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch"));
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(300), mapY(26), "touch"));
    r.win.setOpen(false, true);
    const toggle = document.getElementById(MAP_DOM_ID.toggle) as HTMLButtonElement;
    toggle.dispatchEvent(new MouseEvent("click", { detail: 0, bubbles: true }));
    expect(document.activeElement).toBe(viewCanvas());
    // A breakpoint round trip with the button focused, right after a tap.
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch"));
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(300), mapY(26), "touch"));
    r.storage.setItem(MAP_OPEN_STORAGE_KEY.desktop, MAP_OPEN_VALUE.closed);
    r.phone.value = false;
    r.win.layoutChanged();
    expect(document.activeElement).toBe(toggle);
    r.phone.value = true;
    r.win.layoutChanged();
    expect(document.activeElement).toBe(viewCanvas());
  });

  it("keeps the claim until the last finger on the map lifts", () => {
    rig();
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch", 1));
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(200), mapY(14), "touch", 2));
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(200), mapY(14), "touch", 2));
    now.mockReturnValue(5000);
    // Finger 2's time ran out; finger 1 still down holds the claim.
    viewCanvas().focus();
    expect(document.activeElement).not.toBe(viewCanvas());
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(300), mapY(26), "touch", 1));
    now.mockReturnValue(5000 + MAP_POINTER_FOCUS_MS);
    viewCanvas().focus();
    expect(document.activeElement).not.toBe(viewCanvas());
  });

  it("drops a finger whose release was lost from the claim when a new primary touch lands", () => {
    rig();
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch", 1));
    const down = new PointerEvent("pointerdown", { clientX: mapX(200), clientY: mapY(14), pointerType: "touch", pointerId: 2, isPrimary: true, button: 0, buttons: 1, bubbles: true, cancelable: true });
    viewCanvas().dispatchEvent(down);
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(200), mapY(14), "touch", 2));
    now.mockReturnValue(1001 + MAP_POINTER_FOCUS_MS);
    viewCanvas().focus();
    expect(document.activeElement).toBe(viewCanvas());
  });

  it("keeps a finger's claim when a mouse clicks the map while it is down", () => {
    rig();
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch", 1));
    viewCanvas().dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", pointerId: 9, isPrimary: true, button: 0, buttons: 1, bubbles: true, cancelable: true }));
    viewCanvas().dispatchEvent(pointer("pointerup", 0, 0, "mouse", 9));
    now.mockReturnValue(5000);
    viewCanvas().focus();
    expect(document.activeElement).not.toBe(viewCanvas());
  });

  it("never lets a press with another button focus the map", () => {
    rig();
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "mouse", 1, 2));
    viewCanvas().focus();
    expect(document.activeElement).not.toBe(viewCanvas());
  });

  it("drops a map touch whose release was lost when a new primary touch lands", () => {
    const r = rig();
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch", 1));
    const down = new PointerEvent("pointerdown", { clientX: mapX(200), clientY: mapY(14), pointerType: "touch", pointerId: 2, isPrimary: true, button: 0, buttons: 1, bubbles: true, cancelable: true });
    viewCanvas().dispatchEvent(down);
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(200), mapY(14), "touch", 2));
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0].floor).toBeCloseTo(14);
  });

  it("forgets a world touch whose release was lost when a new gesture starts", () => {
    const r = rig();
    // Finger 1 lands on the world and its release never reaches the page.
    document.getElementById("view")!.dispatchEvent(pointer("pointerdown", 10, 10, "touch", 1));
    const tap = (id: number) => {
      viewCanvas().dispatchEvent(new PointerEvent("pointerdown", { clientX: mapX(300), clientY: mapY(26), pointerType: "touch", pointerId: id, isPrimary: true, button: 0, buttons: 1, bubbles: true, cancelable: true }));
      viewCanvas().dispatchEvent(pointer("pointerup", mapX(300), mapY(26), "touch", id));
    };
    tap(2);
    expect(r.moves).toHaveLength(1);
  });

  it("ends a world press whose release was lost, on a buttonless move or when the page loses focus", () => {
    rig();
    const world = document.getElementById("view")!;
    world.dispatchEvent(pointer("pointerdown", 10, 10));
    document.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", pointerId: 1, buttons: 1, bubbles: true }));
    expect(worldPressed()).toBe(true);
    document.dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", pointerId: 1, buttons: 0, bubbles: true }));
    expect(worldPressed()).toBe(false);
    world.dispatchEvent(pointer("pointerdown", 10, 10));
    window.dispatchEvent(new Event("blur"));
    expect(worldPressed()).toBe(false);
  });

  it("leaves a touch on the map alone while another finger is down on the world (a pinch)", () => {
    const r = rig();
    const world = document.getElementById("view")!;
    world.dispatchEvent(pointer("pointerdown", 10, 10, "touch", 1));
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch", 2));
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(300), mapY(26), "touch", 2));
    document.dispatchEvent(pointer("pointerup", 10, 10, "touch", 1));
    expect(r.moves).toHaveLength(0);
    // A map touch first, then a world finger: the map press is dropped.
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch", 3));
    world.dispatchEvent(pointer("pointerdown", 10, 10, "touch", 4));
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(300), mapY(26), "touch", 3));
    expect(r.moves).toHaveLength(0);
    // With the world fingers gone, a tap centers again.
    document.dispatchEvent(pointer("pointerup", 10, 10, "touch", 4));
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch", 5));
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(300), mapY(26), "touch", 5));
    expect(r.moves).toHaveLength(1);
  });

  it("ignores a right click", () => {
    const r = rig();
    viewCanvas().dispatchEvent(new PointerEvent("pointerdown", { clientX: 10, clientY: 10, pointerType: "mouse", button: 2, bubbles: true }));
    expect(r.moves).toHaveLength(0);
  });

});
