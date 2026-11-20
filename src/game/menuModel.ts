/**
 * The game's Win95 menu bar as a model the components' MenuBar draws
 * (menuWiring.ts mounts it into index.html's `#menubar-host`).
 *
 * Every game command that lived in the old right sidebar is an item here;
 * the ids the dialogs and tests know (btn-new, btn-settings, btn-stats,
 * btn-help, btn-about, btn-install-menu) moved with them. A menu stays
 * hidden until its title opens it. On a phone the bar takes the logo's row
 * and shows the logo as a compact badge at its left end. With no tower open
 * (the title screen) the bar shows only File, Options and Help, and they
 * leave out what needs a tower: the menus and items named in menuWiring.ts's
 * TOWER_ONLY lists (party 2026-11-15).
 *
 * The bar is drawn once. menuWiring.ts and the modules it calls then set the
 * items' check marks, grayed and hidden states on the drawn elements by id,
 * as a menu opens.
 */
import type { MenuBarModel, MenuItemModel, MenuSeparatorModel } from "@verticopolis/components/windows/menuBar";

const sep = (id?: string, className?: string, hidden?: boolean): MenuSeparatorModel => ({
  kind: "separator",
  ...(id ? { id } : {}),
  ...(className ? { className } : {}),
  ...(hidden ? { hidden } : {}),
});

/** One of Open Recent's five lines, filled in as the File menu opens. */
const recentLine = (n: number): MenuItemModel => ({
  id: `mb-recent-${n}`,
  label: "",
  className: "mb-recent",
  hidden: true,
});

/** A Window menu item: brings its desk window up, checked while it is open. */
const deskItem = (id: string, win: string, label: string, checked: boolean): MenuItemModel => ({
  id,
  label,
  checked,
  data: { "desk-win": win },
});

/** What the bar needs from the page: where Sponsor goes, if it is offered
 *  at all, and what its pick reports. */
export interface GameMenuOptions {
  /** GitHub Sponsors, or null where Sponsor is left out (the Android app). */
  readonly sponsorUrl: string | null;
  readonly onSponsor: () => void;
}

/** The bar as the page first draws it. */
export function gameMenuModel({ sponsorUrl, onSponsor }: GameMenuOptions): MenuBarModel {
  return {
    id: "menubar",
    label: "Game menu",
    brand: true,
    menus: [
      {
        id: "mb-file",
        label: "File",
        mnemonic: 0,
        items: [
          { id: "btn-new", label: "New…" },
          { id: "mb-import", label: "Open…", shortcut: "Ctrl+O" },
          // Open Recent: the last five towers opened or saved, newest first
          // and numbered, filled in as the File menu opens (recentMenu.ts).
          {
            kind: "submenu",
            id: "mb-recent",
            label: "Open Recent",
            items: [
              ...[1, 2, 3, 4, 5].map(recentLine),
              { id: "mb-recent-none", label: "No recent towers", disabled: true },
            ],
          },
          sep("mb-save-sep"),
          { id: "mb-quick-save", label: "Save", shortcut: "Ctrl+S" },
          { id: "mb-export", label: "Save As…", shortcut: "Ctrl+Shift+S" },
          // The passive home of the install offer: present only when the app
          // can be installed and is not already (the controller shows it).
          sep(undefined, "mb-install-sep", true),
          { id: "btn-install-menu", label: "Install app", hidden: true },
          // Close comes last, below its own line, as a program's Exit does.
          sep("mb-close-sep"),
          { id: "mb-close", label: "Close" },
        ],
      },
      {
        id: "mb-edit",
        label: "Edit",
        mnemonic: 0,
        items: [
          { id: "mb-undo", label: "Undo", shortcut: "Ctrl+Z" },
          { id: "mb-redo", label: "Redo", shortcut: "Ctrl+Y" },
        ],
      },
      {
        id: "mb-tower",
        label: "Tower",
        mnemonic: 0,
        items: [
          { id: "mb-win-tower", label: "Tower Info", checked: false },
          { id: "mb-win-map", label: "Map", checked: false },
          { id: "mb-win-bulletin", label: "Bulletin", checked: false },
          sep(),
          { id: "btn-stats", label: "Statistics…" },
          { id: "mb-rename", label: "Rename Tower…" },
          sep(),
          // Grayed unless a fire burns; the exterminator is Modern only,
          // grayed unless a hotel room is infested and no crew is booked
          // (towerCallItems.ts, read as the menu opens).
          { id: "mb-fire-rescue", label: "Call Fire Rescue…" },
          { id: "mb-exterminator", label: "Call Exterminator…", hidden: true },
          sep(),
          { id: "mb-rules", label: "This Tower's Rules…" },
        ],
      },
      // The 1994 desk's Window menu (src/ui/desk/, owner 2026-11-15): each
      // item brings its window up, closed or minimized, and is checked while
      // it is open. On the desk, Status Bar and Full Screen move in here from
      // Options below the separator; off the desk the menu is left out and
      // Options keeps them.
      {
        id: "mb-window",
        label: "Window",
        mnemonic: 0,
        className: "mb-desk-only",
        items: [
          deskItem("mb-dw-tools", "tools", "Tools", true),
          deskItem("mb-dw-info", "info", "Info", true),
          deskItem("mb-dw-map", "map", "Map", false),
          deskItem("mb-dw-bulletin", "bulletin", "Bulletin", false),
          deskItem("mb-dw-tower-info", "towerInfo", "Tower Info", false),
          sep(),
        ],
      },
      {
        id: "mb-options",
        label: "Options",
        mnemonic: 0,
        items: [
          { id: "btn-settings", label: "Settings…" },
          { id: "mb-sound", label: "Sound", checked: true },
          { id: "mb-screensaver", label: "Screen Saver…" },
          { id: "mb-appearance", label: "Appearance…" },
          sep("mb-display-sep"),
          // Tools and Status Bar exist on a computer's layout only; the Window
          // menu that held them was folded in here (owner, 2026-11-15). Full
          // Screen is left out of the installed app on a phone
          // (fullScreenItem.ts).
          { id: "mb-win-tools", label: "Tools", checked: true },
          { id: "mb-win-statusbar", label: "Status Bar", checked: true, className: "mb-desktop-only" },
          { id: "mb-fullscreen", label: "Full Screen", checked: false },
        ],
      },
      {
        id: "mb-help",
        label: "Help",
        mnemonic: 0,
        items: [
          // Player's Manual opens the Help site in a new tab.
          { id: "btn-help", label: "Player's Manual" },
          { id: "mb-compare", label: "Classic vs Modern" },
          { id: "mb-replay", label: "Replay Getting Started" },
          sep(),
          // Sponsor opens GitHub Sponsors in a new tab, everywhere but the
          // Android app.
          {
            id: "mb-sponsor",
            label: "Sponsor Verticopolis",
            ...(sponsorUrl === null ? { hidden: true } : { href: sponsorUrl, onPick: onSponsor }),
            target: "_blank",
            rel: "noopener noreferrer",
          },
          // About opens About this game: the version, the diagnostics,
          // Report a problem and the privacy link.
          { id: "btn-about", label: "About Verticopolis…" },
        ],
      },
    ],
  };
}
