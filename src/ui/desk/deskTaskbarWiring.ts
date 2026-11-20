import type { DeskWindowId } from "@verticopolis/components/windows/desk/deskGeometry";
import type { DeskWindow } from "@verticopolis/components/windows/desk/deskWindow";
import { runWindowCommand, windowMenuState } from "@verticopolis/components/windows/desk/deskWindowMenu";
import { trackAppAction } from "../../analyticsActions";
import { trackDeskStartOpen, trackDeskTray, trackWindowMenuOpen, trackWindowMenuPick } from "./deskAnalytics";
import { DeskTaskbar } from "./deskTaskbar";

/**
 * The desk's taskbar over a tower, wired to the desk's windows (split out of
 * deskController.ts): the Verticopolis menu, a button per window, the tray,
 * and the window menu from a button or a window's title bar.
 *
 * Cost: nothing per frame; one call per press.
 */

/** What the taskbar asks of the desk. */
export interface DeskTaskbarHooks {
  readonly taskPressed: (id: DeskWindowId) => void;
  readonly controlPanel: () => void;
  readonly bringUp: (id: DeskWindowId) => void;
  readonly focus: (win: DeskWindow) => void;
  /** The window that has the focus. */
  readonly active: () => DeskWindow | null;
}

/** Build the taskbar into `app`, hear right-clicks on `desk`'s title bars,
 *  and start it. */
export function startDeskTaskbar(
  doc: Document,
  app: HTMLElement,
  desk: HTMLElement,
  wins: ReadonlyMap<DeskWindowId, DeskWindow>,
  hooks: DeskTaskbarHooks,
): DeskTaskbar {
  const taskbar = new DeskTaskbar(doc, {
    task: (id) => hooks.taskPressed(id as DeskWindowId),
    start: (itemId) => {
      trackAppAction("desk_start", itemId);
      doc.getElementById(itemId)?.click();
    },
    controlPanel: hooks.controlPanel,
    opened: () => trackDeskStartOpen("tower"),
    tray: trackDeskTray,
    windowMenu: {
      state: (id) => windowMenuState(wins.get(id as DeskWindowId), hooks.active()),
      run: (id, command) => {
        trackWindowMenuPick(id, command);
        runWindowCommand(wins.get(id as DeskWindowId), command, (w) =>
          w.minimized ? hooks.bringUp(w.spec.id) : hooks.focus(w),
        );
      },
      opened: (_id, from) => trackWindowMenuOpen(from),
    },
  });
  app.appendChild(taskbar.root);
  // A right-click on a window's title bar opens its window menu, as 1995's did.
  desk.addEventListener("contextmenu", (e) => {
    const el = (e.target as Element | null)?.closest?.(".win-title")?.parentElement;
    const id = el ? [...wins].find(([, w]) => w.spec.el === el)?.[0] : undefined;
    if (id && taskbar.openWindowMenu(id, e.clientX, e.clientY)) e.preventDefault();
  });
  taskbar.start();
  return taskbar;
}
