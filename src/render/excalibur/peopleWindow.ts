import type { TowerEngine } from "./TowerEngine";

/** How far past the screen the people window reaches: tiles past each side,
 *  floors past the top and the bottom, so a figure walking in is already in
 *  the frame when it shows. The engine adds its own pad on top, so every
 *  rider of a car on screen comes along (`view::PeopleWindow::padded`). */
export const WINDOW_MARGIN = { tiles: 2, floors: 1 } as const;

/** The floors and tiles the engine's frame sends people for. */
export interface PeopleWindow {
  floorLo: number;
  floorHi: number;
  xLo: number;
  xHi: number;
}

type Camera = Pick<TowerEngine, "screenToTile" | "screenToFloor" | "viewWidth" | "viewHeight">;

/** The part of the tower on screen, plus {@link WINDOW_MARGIN}. The 1994 game
 *  draws every person in its scrolling window and none outside it, so the
 *  frame carries the people the view shows and grows with the screen, not
 *  with the crowd. */
export function peopleWindow(camera: Camera): PeopleWindow {
  return {
    floorLo: camera.screenToFloor(camera.viewHeight) - WINDOW_MARGIN.floors,
    floorHi: camera.screenToFloor(0) + WINDOW_MARGIN.floors,
    xLo: camera.screenToTile(0) - WINDOW_MARGIN.tiles,
    xHi: camera.screenToTile(camera.viewWidth) + WINDOW_MARGIN.tiles,
  };
}
