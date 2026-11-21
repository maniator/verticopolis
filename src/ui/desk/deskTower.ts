import { fitRect, type DeskRect, type DeskWindowId } from "@verticopolis/components/windows/desk/deskGeometry";
import type { DeskWindow } from "@verticopolis/components/windows/desk/deskWindow";

/**
 * The tower window's own rules on the desk (split out of deskController.ts):
 * its title, read from the status bar, and the small windows a maximized
 * tower pushes below its menu bar and lets back up on restore.
 */

/** Where a window the maximized tower pushed down came from, and where it went. */
export interface SteppedDown {
  readonly from: DeskRect;
  readonly to: DeskRect;
}

/** The tower's name from the status bar ("Tower One · Classic"). */
function towerName(doc: Document): string {
  const text = doc.getElementById("sb-tower")?.textContent ?? "";
  return text.split(" · ")[0]?.trim() || "Verticopolis";
}

/** The tower window's title, in the period's "Document - Program" form. */
export function towerTitleText(doc: Document): string {
  const name = towerName(doc);
  return name === "Verticopolis" ? name : `${name} - Verticopolis`;
}

/** A maximized tower keeps its title bar and menus in reach: a small window
 *  over them steps down below the menu bar, recorded in `stepped` so it can
 *  step back up on restore. */
export function clearTowerChrome(
  doc: Document,
  desk: HTMLElement,
  wins: ReadonlyMap<DeskWindowId, DeskWindow>,
  stepped: Map<DeskWindowId, SteppedDown>,
): void {
  const bar = doc.getElementById("menubar");
  if (!bar) return;
  const top = bar.getBoundingClientRect().bottom - desk.getBoundingClientRect().top + 2;
  for (const [id, win] of wins) {
    // A maximized window (Help) already fills the desk on its own.
    if (win.spec.layer !== "tool" || !win.spec.isOpen() || win.minimized || win.maximized) continue;
    const r = win.rect();
    if (r.y >= top) continue;
    const next = fitRect({ ...r, y: top }, desk.clientWidth, desk.clientHeight, win.spec.limits);
    win.place(next);
    stepped.set(id, { from: r, to: win.rect() });
  }
}

/** The tower is back to its size: the small windows it pushed go back up,
 *  unless the player has moved them since. */
export function restoreSteppedDown(
  wins: ReadonlyMap<DeskWindowId, DeskWindow>,
  stepped: Map<DeskWindowId, SteppedDown>,
): void {
  for (const [id, { from, to }] of stepped) {
    const win = wins.get(id);
    const now = win?.rect();
    if (win && now && now.x === to.x && now.y === to.y) win.place(from);
  }
  stepped.clear();
}
