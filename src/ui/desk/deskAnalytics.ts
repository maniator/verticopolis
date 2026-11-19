import { trackAppAction } from "../../analyticsActions";
import type { DeskWindowId } from "@verticopolis/components/windows/desk/deskGeometry";
import type { DeskChange } from "@verticopolis/components/windows/desk/deskWindow";
import type { WindowMenuFrom } from "@verticopolis/components/windows/desk/deskWindowMenu";

/**
 * The 1994 desk's analytics codes (docs/ui/desk-windows.md and the data map's
 * "The 1994 desk" section). Each is an `app_action` with a code in `detail`,
 * never a tower's name or a window's place.
 *
 * Cost: one call per press; nothing per frame.
 */

/** Analytics names for the windows (the first half of a window's detail). */
export const DESK_WINDOW_NAME: Readonly<Record<DeskWindowId, string>> = {
  tower: "tower",
  info: "info",
  tools: "tools",
  map: "map",
  bulletin: "bulletin",
  towerInfo: "tower_info",
  control: "control_panel",
};

/** The title screen's one window, on its taskbar. */
export const DESK_TITLE_WINDOW = "title";

/** What a press on a window's taskbar button did: brought it to the front,
 *  minimized the front window, or brought a minimized one back. */
export type DeskTaskResult = "front" | "min" | "restore";

/** What a taskbar button press does to its window: a minimized one comes
 *  back, the front one minimizes, any other comes to the front. */
export function deskTaskResult(minimized: boolean, inFront: boolean): DeskTaskResult {
  if (minimized) return "restore";
  return inFront ? "min" : "front";
}

/** Where the Verticopolis menu was opened: over the title screen or a tower. */
export type DeskScreen = "title" | "tower";

/** The tray's buttons: the monitor (the Control Panel) and the speaker. */
export type DeskTrayIcon = "display" | "sound";

/** The analytics name of a window id, or the title screen's window. */
function windowName(id: string): string {
  return Object.prototype.hasOwnProperty.call(DESK_WINDOW_NAME, id) ? DESK_WINDOW_NAME[id as DeskWindowId] : DESK_TITLE_WINDOW;
}

/** A taskbar window button pressed: `desk_task`, `<window>_<result>`. */
export function trackDeskTask(id: string, result: DeskTaskResult): void {
  trackAppAction("desk_task", `${windowName(id)}_${result}`);
}

/** The Verticopolis button opened its menu: `desk_start_open`, the screen. */
export function trackDeskStartOpen(screen: DeskScreen): void {
  trackAppAction("desk_start_open", screen);
}

/** A tray button pressed: `desk_tray`, `display` or `sound`. */
export function trackDeskTray(icon: DeskTrayIcon): void {
  trackAppAction("desk_tray", icon);
}

/** A window menu opened: `desk_win_menu_open`, where from. */
export function trackWindowMenuOpen(from: WindowMenuFrom): void {
  trackAppAction("desk_win_menu_open", from);
}

/** A window menu pick: `desk_win_menu`, `<window>_<command>`. */
export function trackWindowMenuPick(id: string, command: string): void {
  trackAppAction("desk_win_menu", `${windowName(id)}_${command}`);
}

/** A window's title-bar button, size grip, double-click, taskbar press or
 *  window menu pick that changed it, or its first move in a page life:
 *  `desk_window`, `<window>_<verb>`. */
export function trackDeskWindow(id: DeskWindowId, verb: DeskChange): void {
  trackAppAction("desk_window", `${DESK_WINDOW_NAME[id]}_${verb}`);
}

/** A window's ✕ on the desk that the game's own window events do not count
 *  (the tower's, which runs File > Close, and the Control Panel's):
 *  `desk_window`, `<window>_close`. */
export function trackDeskClose(id: DeskWindowId): void {
  trackAppAction("desk_window", `${DESK_WINDOW_NAME[id]}_close`);
}
