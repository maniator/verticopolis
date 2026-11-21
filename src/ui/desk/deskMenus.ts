import { setMenuState, type MenuEntryState } from "../../game/menuBarHost";

/** Tower's window items and their separator: the desk's Window menu brings those windows up (owner, 2026-11-21). */
const TOWER_WINDOW_ITEMS = ["mb-win-tower", "mb-win-map", "mb-win-bulletin", "mb-tower-win-sep"];
/** Info and Tools: always in the pocket tower window, so its Window menu leaves them out. */
const POCKET_LEFT_OUT = ["mb-dw-info", "mb-dw-tools"];

/**
 * Show or hide the menu items the desk leaves out, through the menu bar's
 * model. `pocket` is the desk that came up (true for the pocket desk), or
 * `null` when the desk goes down and every item comes back.
 */
export function setDeskMenus(doc: Document, pocket: boolean | null): void {
  const changes: Record<string, MenuEntryState> = {};
  for (const id of TOWER_WINDOW_ITEMS) changes[id] = { hidden: pocket !== null };
  for (const id of POCKET_LEFT_OUT) changes[id] = { hidden: pocket === true };
  setMenuState(changes, doc);
}
