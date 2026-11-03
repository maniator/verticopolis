/**
 * Pointer and keyboard rules for the overview MAP window (#343, CAP-3 and
 * CAP-5), with no DOM: the window hands in a pointer's client position or a
 * key, and gets back a map point or a camera center. Unit-tested on its own.
 */
import { FLOOR, TILE } from "../render/scale";
import type { MapCamera, MapCameraCenter, MapExtent, MapRect } from "../render/overviewMap/geometry";

/** An element's box on screen, as `getBoundingClientRect` gives it. */
export interface ClientBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A canvas's backing store, in map (device) pixels. */
export interface BackingSize {
  readonly width: number;
  readonly height: number;
}

/**
 * A pointer's position in map pixels: its offset in the canvas's box, scaled
 * from CSS pixels to the backing store. A box with no size reads as a scale
 * of 1, so a canvas mid-layout never yields NaN.
 */
export function clientToMap(box: ClientBox, backing: BackingSize, clientX: number, clientY: number): { x: number; y: number } {
  const sx = box.width > 0 && backing.width > 0 ? backing.width / box.width : 1;
  const sy = box.height > 0 && backing.height > 0 ? backing.height / box.height : 1;
  return { x: (clientX - box.left) * sx, y: (clientY - box.top) * sy };
}

/**
 * The area that grabs the camera rectangle: the rectangle grown about its
 * center to at least `minSide` map pixels each way, so a small rectangle (a
 * zoomed-in view) is still easy to drag with a finger. An empty or non-finite
 * rectangle stays as it is, so it grabs nothing.
 */
export function grabRect(rect: MapRect, minSide: number): MapRect {
  if (!(rect.w > 0) || !(rect.h > 0)) return rect;
  const side = Number.isFinite(minSide) && minSide > 0 ? minSide : 0;
  const w = Math.max(rect.w, side);
  const h = Math.max(rect.h, side);
  return { x: rect.x + rect.w / 2 - w / 2, y: rect.y + rect.h / 2 - h / 2, w, h };
}

/** A touch target's least side, in CSS pixels (CAP-5). */
export const MAP_TOUCH_TARGET_CSS = 44;

/** The least side a mouse grabs the view mark by, in CSS pixels. */
export const MAP_MOUSE_TARGET_CSS = 12;

/** How far a press may travel, in CSS pixels, and still count as a tap that
 *  centers the view. */
export const MAP_TAP_SLOP_CSS = 8;

/** The keys the map answers, by name. */
export const MAP_KEY = {
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  top: "Home",
  bottom: "End",
  close: "Escape",
} as const;

/** Game keys that still work with the map focused: zoom, the speed digits,
 *  Tab, and Space, which the world holds as its pan key (the game reads the
 *  map as a control, so Space never commits the build cursor from it).
 *  Everything else the game binds (building, bulldozing, the build cursor) is
 *  kept by the map, so nothing changes in the world behind it. */
export const MAP_PASS_KEYS: ReadonlySet<string> = new Set(["+", "=", "-", "_", "0", "1", "2", "3", "Tab", " ", "Spacebar"]);

/** Whether a key pressed on the focused map goes on to the game: a key the
 *  map lets through, or any shortcut held with Ctrl, Cmd or Alt (undo among
 *  them). */
export function passesMapKey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  return e.ctrlKey || e.metaKey || e.altKey || MAP_PASS_KEYS.has(e.key);
}

/** `PointerEvent.button` for the primary (left) button. */
const PRIMARY_BUTTON = 0;

/** Whether a press is with the primary (left) button. */
export function isPrimaryPress(e: Pick<PointerEvent, "button">): boolean {
  return e.button === PRIMARY_BUTTON;
}

/** Whether no button is held during a move (`buttons` is a set of held
 *  buttons; empty reads as 0). */
export function noButtonHeld(e: Pick<PointerEvent, "buttons">): boolean {
  return e.buttons === 0;
}

/** Whether a click came from the keyboard (Enter or Space on a button),
 *  which reports no click count. */
export function isKeyboardClick(e: Pick<MouseEvent, "detail">): boolean {
  return e.detail === 0;
}

/** How much of the visible span one arrow press moves the camera; Shift moves
 *  the whole span. */
export const MAP_KEY_STEP_SHARE = 0.25;

/** The camera's center in the units `applyView` takes. A position that is not
 *  finite reads as 0, as `viewportRect` reads it. */
export function cameraCenter(cam: MapCamera): MapCameraCenter {
  return {
    tile: Number.isFinite(cam.posX) ? cam.posX / TILE : 0,
    floor: Number.isFinite(cam.posY) ? -cam.posY / FLOOR : 0,
  };
}

/** The visible span in tiles and floors, at least one of each. */
function visibleSpan(cam: MapCamera): { tiles: number; floors: number } {
  const zoom = Number.isFinite(cam.zoom) && cam.zoom > 0 ? cam.zoom : 1;
  const w = Number.isFinite(cam.viewWidth) && cam.viewWidth > 0 ? cam.viewWidth : 0;
  const h = Number.isFinite(cam.viewHeight) && cam.viewHeight > 0 ? cam.viewHeight : 0;
  return { tiles: Math.max(1, w / zoom / TILE), floors: Math.max(1, h / zoom / FLOOR) };
}

/**
 * Where a key moves the camera, or null for a key the map does not answer.
 * An arrow moves it a quarter of the visible span (the whole span with
 * Shift), Home goes to the top of the map and End to the bottom. The result
 * is not clamped: the caller moves the camera through the renderer's clamp.
 */
export function keyTarget(key: string, shift: boolean, cam: MapCamera, extent: MapExtent): MapCameraCenter | null {
  const here = cameraCenter(cam);
  const span = visibleSpan(cam);
  const share = shift ? 1 : MAP_KEY_STEP_SHARE;
  const dx = Math.max(1, span.tiles * share);
  const dy = Math.max(1, span.floors * share);
  switch (key) {
    case MAP_KEY.left:
      return { tile: here.tile - dx, floor: here.floor };
    case MAP_KEY.right:
      return { tile: here.tile + dx, floor: here.floor };
    case MAP_KEY.up:
      return { tile: here.tile, floor: here.floor + dy };
    case MAP_KEY.down:
      return { tile: here.tile, floor: here.floor - dy };
    case MAP_KEY.top:
      return { tile: here.tile, floor: extent.topLine };
    case MAP_KEY.bottom:
      return { tile: here.tile, floor: extent.bottomLine };
    default:
      return null;
  }
}
