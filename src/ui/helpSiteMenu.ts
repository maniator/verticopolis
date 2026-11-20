/**
 * The help site's Win95 menu bar (help-site/src/components/MenuBar.astro),
 * the same bar the game draws, with the manual's own commands: File (back to
 * the game, print), Edit (find, copy this page's link), Options (light, dark
 * or the system's look) and Help (what's new, report a problem, sponsor).
 *
 * The bar's markup and behavior (opening, pointing, the keys) are the
 * components' {@link MenuBar}, drawn from the model {@link helpMenuModel}
 * builds. This module only says what each item does. Every item carries
 * `data-help-item`, the code a pick reports to analytics (`help_menu_pick`),
 * so the item and its event can never disagree.
 *
 * Cost: the bar is drawn once, and again as Options opens (to check the
 * current look). Nothing else runs until someone picks an item.
 */

import { MenuBar } from "@verticopolis/components/windows/menuBar";
import type { MenuBarModel, MenuItemModel } from "@verticopolis/components/windows/menuBar";

/** The looks Starlight's theme switch offers. */
export type HelpTheme = "light" | "dark" | "auto";

/** The addresses the bar's links go to, from the site's own config. */
export interface HelpMenuLinks {
  /** The game (verticopolis.com, or this host in a /help build). */
  readonly game: string;
  readonly whatsNew: string;
  readonly report: string;
  readonly sponsor: string;
}

/** What the menu needs from the page around it, so tests can stand in. */
export interface HelpMenuDeps {
  readonly links: HelpMenuLinks;
  /** True in a tab the game opened, where the game item goes back to it. */
  readonly fromGame: boolean;
  /** Back to the game that opened this tab (src/ui/fromGame.ts). */
  readonly backToGame: (e: MouseEvent) => void;
  readonly print: () => void;
  /** Open the site's search box. */
  readonly openSearch: () => void;
  readonly copyLink: (url: string) => Promise<void>;
  /** This page's own address, the one Copy Link copies. */
  readonly pageUrl: () => string;
  readonly theme: () => HelpTheme;
  readonly setTheme: (theme: HelpTheme) => void;
  /** Report a pick: `help_menu_pick` with the item's code. */
  readonly track: (item: string) => void;
}

/** The game item's label: back to the game in a tab it opened, else start it. */
export const BACK_TO_GAME_LABEL = "Back to Game";
export const PLAY_LABEL = "Play Verticopolis";

/** The look each Options item picks, by its code. */
const THEME_ITEMS: readonly (readonly [code: string, theme: HelpTheme, label: string])[] = [
  ["theme_light", "light", "Light"],
  ["theme_dark", "dark", "Dark"],
  ["theme_auto", "auto", "Match My Device"],
];

/** A new tab's link attributes, for the pages off this site. */
const NEW_TAB = { target: "_blank", rel: "noopener noreferrer" } as const;

/** The bar for the current look: the Options item for `theme` is checked. */
export function helpMenuModel(deps: HelpMenuDeps, theme: HelpTheme): MenuBarModel {
  /** An item that reports its `code` when picked, then runs `run`. */
  const item = (code: string, label: string, rest: Partial<MenuItemModel> = {}, run?: (e: MouseEvent) => void) => ({
    label,
    data: { "help-item": code },
    onPick: (e: MouseEvent) => {
      deps.track(code);
      run?.(e);
    },
    ...rest,
  });
  return {
    id: "help-menubar",
    label: "Help menu",
    className: "help-menubar print:hidden",
    menus: [
      {
        id: "hm-file",
        label: "File",
        mnemonic: 0,
        items: [
          item(
            "game",
            deps.fromGame ? BACK_TO_GAME_LABEL : PLAY_LABEL,
            { href: deps.links.game },
            deps.fromGame ? (e) => deps.backToGame(e) : undefined,
          ),
          { kind: "separator" },
          item("print", "Print…", { shortcut: "Ctrl+P" }, () => deps.print()),
        ],
      },
      {
        id: "hm-edit",
        label: "Edit",
        mnemonic: 0,
        items: [
          item("find", "Find…", { shortcut: "Ctrl+K" }, () => deps.openSearch()),
          item("copy_link", "Copy Link to This Page", {}, () => void deps.copyLink(deps.pageUrl()).catch(() => {})),
        ],
      },
      {
        id: "hm-options",
        label: "Options",
        mnemonic: 0,
        items: THEME_ITEMS.map(([code, look, label]) =>
          item(code, label, { checked: look === theme, radio: true }, () => deps.setTheme(look)),
        ),
      },
      {
        id: "hm-help",
        label: "Help",
        mnemonic: 0,
        items: [
          item("whats_new", "What's New", { href: deps.links.whatsNew }),
          item("report", "Report a Problem…", { href: deps.links.report, ...NEW_TAB }),
          { kind: "separator" },
          item("sponsor", "Sponsor Verticopolis", { href: deps.links.sponsor, ...NEW_TAB }),
        ],
      },
    ],
  };
}

/** Draw the bar into `host` and return it. Options checks the current look
 *  each time it opens, since the theme switch can change it meanwhile. */
export function wireHelpMenu(host: HTMLElement, deps: HelpMenuDeps): MenuBar {
  const bar: MenuBar = new MenuBar(host, helpMenuModel(deps, deps.theme()), {
    onOpen: (menu) => {
      if (menu.id === "hm-options-menu") bar.render(helpMenuModel(deps, deps.theme()));
    },
  });
  return bar;
}
