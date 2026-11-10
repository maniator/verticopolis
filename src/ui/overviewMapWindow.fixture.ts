/**
 * The overview MAP window's test rig: a window in a fake stage with a fake
 * tower, camera and storage, plus pointer helpers. Shared by the window's
 * test files.
 */
import { vi } from "vitest";
import { FLOOR, TILE } from "../render/scale";
import type { MapCameraCenter, MapExtent } from "../render/overviewMap/geometry";
import { MAP_OPEN_STORAGE_KEY } from "./overviewMapPrefs";
import { MAP_DOM_ID, OverviewMapWindow, WORLD_PRESS_CLASS, type MutableMapCamera, type OverviewMapDeps, type OverviewMapSource } from "./overviewMapWindow";
import type { OverviewMapViews } from "./overviewMapViews";
import type { MapViewId } from "../render/overviewMap/views";
import { MAP_PICKER_DOM } from "./overviewMapPicker";

/** A fake world: a 375-tile lot, floors -9 to 100, a ten-floor tower. */
export function towerSource(): OverviewMapSource & { view: { tower: { transports: unknown[] } } } {
  return {
    view: {
      structure: [{ kind: "lobby", floor: 1, x: 100, width: 1, count: 50 }],
      rooms: [],
      tower: { lowestFloor: 1, highestFloor: 10, transports: [] },
    },
    world: { lotWidth: 375, minFloor: -9, maxFloor: 100 },
  };
}

export class MemoryStore {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

export interface Rig {
  win: OverviewMapWindow;
  moves: MapCameraCenter[];
  cam: MutableMapCamera;
  storage: MemoryStore;
  phone: { value: boolean };
  source: ReturnType<typeof towerSource>;
}

/** A window in a 200 by 288 CSS px body at a pixel ratio of 1, so map pixels
 *  are CSS pixels and the layout is `CROP`. */
export function rig(opts: { phone?: boolean; stored?: string; views?: OverviewMapViews } = {}): Rig {
  document.body.innerHTML = '<section id="stage"><canvas id="view"></canvas></section>';
  const stage = document.getElementById("stage")!;
  const storage = new MemoryStore();
  if (opts.stored) storage.setItem(MAP_OPEN_STORAGE_KEY[opts.phone ? "phone" : "desktop"], opts.stored);
  const phone = { value: opts.phone ?? false };
  const moves: MapCameraCenter[] = [];
  // The camera sees 80 tiles by 16 floors, centered on tile 100, floor 20.
  const cam: MutableMapCamera = { posX: 100 * TILE, posY: -20 * FLOOR, zoom: 1, viewWidth: 80 * TILE, viewHeight: 16 * FLOOR };
  const source = towerSource();
  const deps: OverviewMapDeps = {
    stage,
    source: () => source,
    readCamera: (out) => {
      out.posX = cam.posX;
      out.posY = cam.posY;
      out.zoom = cam.zoom;
      out.viewWidth = cam.viewWidth;
      out.viewHeight = cam.viewHeight;
    },
    moveCamera: (c) => {
      moves.push(c);
      cam.posX = c.tile * TILE;
      cam.posY = -c.floor * FLOOR;
    },
    floorsOf: () => 1,
    isPhone: () => phone.value,
    storage: storage as unknown as Storage,
    views: opts.views ?? null,
  };
  // happy-dom lays nothing out: give the body and the view canvas a box.
  const proto = HTMLElement.prototype;
  vi.spyOn(proto, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("overview-map-body") ? 200 : 0;
  });
  vi.spyOn(proto, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("overview-map-body") ? 288 : 0;
  });
  vi.spyOn(proto, "getBoundingClientRect").mockImplementation(() => ({ left: 0, top: 0, width: 200, height: 288, right: 200, bottom: 288, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
  const win = new OverviewMapWindow(deps);
  built.push(win);
  return { win, moves, cam, storage, phone, source };
}

/** Every window a test built, disposed after it so no page listener leaks
 *  into the next test. */
const built: OverviewMapWindow[] = [];

/** Dispose every window the tests built; call from `afterEach`. */
export function disposeRigs(): void {
  for (const win of built.splice(0)) win.dispose();
}

/** A 2D context that draws nothing, for the tests that need the window to
 *  paint (happy-dom's canvases have none). Build the rig after installing it:
 *  `vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(silent2d())`. */
export function silent2d(): CanvasRenderingContext2D {
  const none = () => {};
  const ctx = { fillStyle: "", strokeStyle: "", lineWidth: 1, fillRect: none, clearRect: none, strokeRect: none, beginPath: none, moveTo: none, lineTo: none, closePath: none, fill: none, createPattern: () => null };
  return ctx as unknown as CanvasRenderingContext2D;
}

export function viewCanvas(): HTMLCanvasElement {
  return document.querySelector(".overview-map-view") as HTMLCanvasElement;
}

export function pointer(type: string, x: number, y: number, pointerType = "mouse", pointerId = 1, button = 0): PointerEvent {
  // A mouse move with the button held reports it in `buttons`.
  const buttons = type === "pointerup" ? 0 : 1;
  return new PointerEvent(type, { clientX: x, clientY: y, pointerType, pointerId, button, buttons, bubbles: true, cancelable: true });
}

export function rootEl(): HTMLElement {
  return document.getElementById(MAP_DOM_ID.window)!;
}

export function worldPressed(): boolean {
  return rootEl().classList.contains(WORLD_PRESS_CLASS);
}

/** The crop the rig's ten-floor tower gets, written out so a wrong margin or
 *  band fails a test: floor lines -1 to 30 (one floor of ground under floor 1,
 *  the 30-floor minimum on top), and the 375-tile lot with 15 tiles of margin
 *  on each side. A window test checks `bandedExtent` gives exactly this. */
export const CROP: MapExtent = { leftTile: -15, width: 405, topLine: 30, bottomLine: -1 };

/** The map x and y of a tile and floor line in the rig's layout. */
export const mapX = (tile: number) => ((tile - CROP.leftTile) * 200) / CROP.width;
export const mapY = (line: number) => ((CROP.topLine - line) * 288) / (CROP.topLine - CROP.bottomLine);

/** Choose a view in the mounted View dropdown, as a key or a screen reader
 *  does (no pointer press). */
export function pickView(view: MapViewId): void {
  const select = document.getElementById(MAP_PICKER_DOM.select) as HTMLSelectElement;
  select.value = view;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
