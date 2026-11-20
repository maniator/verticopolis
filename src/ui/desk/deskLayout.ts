import {
  defaultLayout,
  fitRect,
  parseLayout,
  type DeskRect,
  type DeskWindowId,
} from "@verticopolis/components/windows/desk/deskGeometry";
import type { DeskWindow } from "@verticopolis/components/windows/desk/deskWindow";
import { read, write, type Store } from "./deskStore";

/**
 * Where the desk's windows sit (split out of deskController.ts): each window
 * placed at its saved place or its first one, pulled back onto a desk that
 * got smaller, and the places saved for the next visit.
 *
 * Cost: one pass over the eight desk windows, when the desk comes up, once
 * per frame at most while the browser window resizes, and after a move or a
 * resize.
 */

/** The storage key of the saved places. */
export const DESK_LAYOUT_KEY = "vc-desk-places";

/** Place every window at its saved place, or where it opens the first time,
 *  kept on the desk. Info's strip takes the width between Tools and the
 *  column first, so the tower opens under it at the height it really has. */
export function placeWindows(
  desk: HTMLElement,
  store: Store | null,
  wins: ReadonlyMap<DeskWindowId, DeskWindow>,
  infoFrame: HTMLElement | null,
): void {
  const w = desk.clientWidth;
  const h = desk.clientHeight;
  const saved = parseLayout(read(store, DESK_LAYOUT_KEY));
  if (infoFrame) infoFrame.style.width = `${defaultLayout(w, h).info.w}px`;
  const first = defaultLayout(
    w,
    h,
    infoFrame?.offsetHeight || undefined,
    wins.get("map")?.spec.el.offsetHeight || undefined,
  );
  for (const [id, win] of wins) win.place(fitRect(saved[id] ?? first[id], w, h, win.spec.limits));
}

/** Pull every open window back onto the desk; a maximized one already fills it. */
export function pullOntoDesk(desk: HTMLElement, wins: ReadonlyMap<DeskWindowId, DeskWindow>): void {
  for (const win of wins.values()) {
    if (win.maximized || !win.spec.isOpen()) continue;
    const now = win.rect();
    const fit = fitRect(now, desk.clientWidth, desk.clientHeight, win.spec.limits);
    if (fit.x !== now.x || fit.y !== now.y || fit.w !== now.w || fit.h !== now.h) win.place(fit);
  }
}

/** Save the places of the open windows, keeping the saved places of the rest. */
export function saveLayout(store: Store | null, wins: ReadonlyMap<DeskWindowId, DeskWindow>): void {
  const out: Partial<Record<DeskWindowId, DeskRect>> = {};
  for (const [id, win] of wins) if (win.spec.isOpen() && !win.minimized) out[id] = win.rect();
  const old = parseLayout(read(store, DESK_LAYOUT_KEY));
  write(store, DESK_LAYOUT_KEY, JSON.stringify({ ...old, ...out }));
}
