import { trackEvent } from "./analyticsCore";
import type { MenuDismissHow, MenuOpenVia } from "./ui/menuBar";

/**
 * The menu bar's events (owner, 2026-11-14: "analytics for every single part
 * of the new file menus"). One trip into the menus is a `menu_open`, then
 * either a `menu_pick` or a `menu_dismiss`, so a funnel reads open to pick and
 * a path reads which item came after which. Every value is a code from a
 * closed list: an item's code, never its label, and never anything the player
 * typed (Rename reports that it was picked, never the name).
 *
 * Volume: at most one open and one pick or dismiss per trip. Pointing from
 * menu to menu inside a trip sends nothing; the trip's `browsed` counts the
 * menus it showed.
 */

/** The menus, by their title button's id (`mb-file` is `file`). The
 *  Window menu (`window`) was folded into Options in 4.3 and is back on the
 *  1994 desk only. */
export const MENU_NAMES = ["file", "edit", "tower", "window", "options", "help"] as const;
export type MenuName = (typeof MENU_NAMES)[number];

/** Each menu item's element id and the code its events carry. */
export const MENU_ITEM_CODES = {
  "btn-new": "new_tower",
  "mb-quick-save": "quick_save",
  "mb-close": "close",
  "mb-import": "import",
  "mb-recent-1": "recent_1",
  "mb-recent-2": "recent_2",
  "mb-recent-3": "recent_3",
  "mb-recent-4": "recent_4",
  "mb-recent-5": "recent_5",
  "mb-recent-none": "recent_none",
  "mb-export": "export",
  "btn-install-menu": "install_app",
  "mb-undo": "undo",
  "mb-redo": "redo",
  "mb-win-tower": "tower_info",
  "mb-win-map": "map",
  "btn-stats": "statistics",
  "mb-rename": "rename",
  "mb-fire-rescue": "fire_rescue",
  "mb-exterminator": "exterminator",
  "mb-rules": "rules",
  "mb-win-tools": "tools",
  "mb-dw-tools": "window_tools",
  "mb-dw-info": "window_info",
  "mb-dw-map": "window_map",
  "mb-dw-bulletin": "window_bulletin",
  "mb-dw-tower-info": "window_tower_info",
  "mb-win-bulletin": "bulletin",
  "mb-win-statusbar": "status_bar",
  "mb-fullscreen": "full_screen",
  "btn-settings": "settings",
  "mb-sound": "sound",
  "mb-screensaver": "screen_saver",
  "mb-appearance": "appearance",
  "btn-help": "manual",
  "mb-compare": "compare",
  "mb-replay": "replay",
  "mb-sponsor": "sponsor",
  "btn-about": "about",
} as const;

/** An item's code; `other` for an item this list does not know yet. */
export type MenuItemCode = (typeof MENU_ITEM_CODES)[keyof typeof MENU_ITEM_CODES] | "other";

/** How an item was picked: a pointer (mouse, pen or finger) or the keyboard. */
export type MenuPickVia = "pointer" | "keys";
/** Where the menus were used: over the title screen or over a tower. */
export type MenuScreen = "title" | "tower";

export interface MenuOpenProps {
  menu: MenuName;
  via: MenuOpenVia;
  screen: MenuScreen;
}

export interface MenuPickProps {
  /** The menu the item is in. */
  menu: MenuName;
  item: MenuItemCode;
  via: MenuPickVia;
  screen: MenuScreen;
  /** How many menus this trip showed, the one picked from included. */
  browsed: number;
  /** The item picked before this one in this page life, or `none`. */
  after: MenuItemCode | "none";
  /** The item was grayed out, so the click did nothing and the menu stayed
   *  open. A grayed click does not become the next pick's `after`. */
  grayed: boolean;
  /** A checkmark item's new state (Tower Info, Map, Tools, Bulletin, Status
   *  Bar, Full Screen, Sound); absent on the others and on a grayed click. */
  state?: "on" | "off";
}

export interface MenuDismissProps {
  /** The menu that was open when the trip ended. */
  menu: MenuName;
  how: MenuDismissHow;
  screen: MenuScreen;
  browsed: number;
}

/** The menu a title or popup id names, or null for one outside the list. */
export function menuNameOf(id: string): MenuName | null {
  const name = /^mb-([a-z]+)(?:-menu)?$/.exec(id)?.[1];
  return MENU_NAMES.find((m) => m === name) ?? null;
}

/** The code an item element id reports. */
export function menuItemCodeOf(id: string): MenuItemCode {
  return Object.prototype.hasOwnProperty.call(MENU_ITEM_CODES, id) ? MENU_ITEM_CODES[id as keyof typeof MENU_ITEM_CODES] : "other";
}

/** The last real pick this page life, for the next pick's `after`. */
let lastPick: MenuItemCode | "none" = "none";

export function trackMenuOpen(props: MenuOpenProps): void {
  trackEvent("menu_open", props);
}

/** Report a pick; `after` comes from the page life's last real pick. */
export function trackMenuPick(props: Omit<MenuPickProps, "after">): void {
  const sent: MenuPickProps = { ...props, after: lastPick };
  if (!props.grayed) lastPick = props.item;
  trackEvent("menu_pick", sent);
}

export function trackMenuDismiss(props: MenuDismissProps): void {
  trackEvent("menu_dismiss", props);
}

/** Forget the last pick (the test-only session reset). */
export function clearMenuPicks(): void {
  lastPick = "none";
}
