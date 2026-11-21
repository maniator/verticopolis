/**
 * The Player's Manual window's own menu bar on the desk (owner, 2026-11-21):
 * the manual's File, Edit, Options and Help menus, the same ones the help
 * site's bar has (src/ui/helpSiteMenu.ts), drawn under the window's title
 * bar. File > Exit closes the window where the site's bar goes back to the
 * game, and Open in Browser shows the page in a tab.
 *
 * This module builds the bar's model and says what each item reports
 * (`desk_help_menu` with the item's code); the window (deskHelpWindow.ts)
 * does the work. Print Topic, Find and the looks act on the page inside the
 * frame, so the window sends the page a command for them
 * (src/manual/manualEmbed.ts).
 *
 * The items show no shortcuts: Ctrl+P and Ctrl+K reach the manual only while
 * it has the focus, and the game's own keys otherwise.
 *
 * Cost: the bar is drawn when the window is built, again as a menu opens (to
 * check the page's look) and when the look changes.
 */

import type { MenuBarModel, MenuItemModel } from "@verticopolis/components/windows/menuBar";
import type { ManualLook } from "../../manual/manualEmbed";

/** Where Report a Problem goes: the game's new-issue chooser. */
export const REPORT_URL = "https://github.com/Verticopolis/web/issues/new/choose";

/** What the menu's items do, so tests can stand in. */
export interface DeskHelpMenuDeps {
  readonly openInBrowser: () => void;
  readonly print: () => void;
  readonly exit: () => void;
  readonly find: () => void;
  readonly copyLink: () => void;
  readonly setLook: (look: ManualLook) => void;
  readonly whatsNew: () => void;
  /** Where Sponsor Verticopolis goes, or null where the game offers no
   *  sponsor link (the Android app; see `sponsorOffered`). */
  readonly sponsor: string | null;
  /** Report a pick: `desk_help_menu` with the item's code. */
  readonly track: (item: string) => void;
}

/** The Options items: each look's code and label. */
const LOOK_ITEMS: readonly (readonly [code: string, look: ManualLook, label: string])[] = [
  ["theme_light", "light", "Light"],
  ["theme_dark", "dark", "Dark"],
  ["theme_auto", "auto", "Match My Device"],
];

/** A new tab's link attributes, for the pages off the manual. */
const NEW_TAB = { target: "_blank", rel: "noopener noreferrer" } as const;

/** The window's bar while the page wears `look`: that Options item is
 *  checked. */
export function deskHelpMenuModel(deps: DeskHelpMenuDeps, look: ManualLook): MenuBarModel {
  /** An item that reports `code` when picked, then runs `run`. */
  const item = (code: string, label: string, run?: () => void, rest: Partial<MenuItemModel> = {}): MenuItemModel => ({
    label,
    data: { "help-item": code },
    onPick: () => {
      deps.track(code);
      run?.();
    },
    ...rest,
  });
  const sponsor = deps.sponsor;
  return {
    id: "desk-help-menubar",
    label: "Player's Manual menu",
    menus: [
      {
        id: "dhm-file",
        label: "File",
        mnemonic: 0,
        items: [
          item("open_browser", "Open in Browser", deps.openInBrowser),
          item("print", "Print Topic…", deps.print),
          { kind: "separator" },
          item("exit", "Exit", deps.exit),
        ],
      },
      {
        id: "dhm-edit",
        label: "Edit",
        mnemonic: 0,
        items: [item("find", "Find…", deps.find), item("copy_link", "Copy Link to This Page", deps.copyLink)],
      },
      {
        id: "dhm-options",
        label: "Options",
        mnemonic: 0,
        items: LOOK_ITEMS.map(([code, to, label]) =>
          item(code, label, () => deps.setLook(to), { checked: to === look, radio: true }),
        ),
      },
      {
        id: "dhm-help",
        label: "Help",
        mnemonic: 0,
        items: [
          item("whats_new", "What's New", deps.whatsNew),
          item("report", "Report a Problem…", undefined, { href: REPORT_URL, ...NEW_TAB }),
          ...(sponsor
            ? [
                { kind: "separator" } as const,
                item("sponsor", "Sponsor Verticopolis", undefined, { href: sponsor, ...NEW_TAB }),
              ]
            : []),
        ],
      },
    ],
  };
}
