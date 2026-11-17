import { crowdCullNext } from "./crowdCull";
import { focusedPerson } from "./personFocus";
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
 *  frame carries the people the view shows: its size follows the screen and
 *  stays flat as the crowd grows. */
export function peopleWindow(camera: Camera): PeopleWindow {
  return {
    floorLo: camera.screenToFloor(camera.viewHeight) - WINDOW_MARGIN.floors,
    floorHi: camera.screenToFloor(0) + WINDOW_MARGIN.floors,
    xLo: camera.screenToTile(0) - WINDOW_MARGIN.tiles,
    xHi: camera.screenToTile(camera.viewWidth) + WINDOW_MARGIN.tiles,
  };
}

/** A window that holds nobody: floors far below any lot. The engine reads a
 *  window it cannot use as every person (`view::PeopleWindow::new`), so an
 *  empty frame needs a real window with nobody in it. */
export const NO_PEOPLE: PeopleWindow = { floorLo: -1e6, floorHi: -1e6, xLo: 0, xHi: 0 };

type FrameCamera = Camera & Pick<TowerEngine, "cam" | "crowdCulled">;

/** The window this frame's view sends people for. While the zoom cull hides
 *  the crowd (`crowdCull.ts`), nobody crosses from the engine, since no
 *  figure is drawn; the frame where the cull lifts already reads the screen,
 *  because the cull is judged from this frame's zoom without moving the
 *  latch. A followed person keeps the window, so the camera glides with
 *  their record at any zoom (#2151). */
export function frameWindow(engine: FrameCamera): PeopleWindow {
  const culled = crowdCullNext(engine.cam.zoom, engine.crowdCulled);
  const following = focusedPerson(engine as TowerEngine)?.follow === true;
  return culled && !following ? NO_PEOPLE : peopleWindow(engine);
}
