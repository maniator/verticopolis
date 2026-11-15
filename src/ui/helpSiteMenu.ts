/**
 * The help site's Win95 menu bar (help-site/src/components/MenuBar.astro),
 * the same bar the game draws, with the manual's own commands: File (back to
 * the game, print), Edit (find, copy this page's link), Options (light, dark
 * or the system's look) and Help (what's new, report a problem, sponsor).
 *
 * The bar's behavior (opening, pointing, the keys) is the game's
 * {@link MenuBar}. This module only says what each item does. Every item
 * carries `data-help-item`, the code a pick reports to analytics
 * (`help_menu_pick`), so the item and its event can never disagree.
 *
 * Cost: nothing runs until someone opens a menu or picks an item.
 */

import { MenuBar } from "./menuBar";

/** The looks Starlight's theme switch offers. */
export type HelpTheme = "light" | "dark" | "auto";

/** What the menu needs from the page around it, so tests can stand in. */
export interface HelpMenuDeps {
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

/** The Options item for each look. */
const THEME_ITEMS: Record<HelpTheme, string> = {
  light: "theme_light",
  dark: "theme_dark",
  auto: "theme_auto",
};

/** Wire the bar under `root` and return it. */
export function wireHelpMenu(root: HTMLElement, deps: HelpMenuDeps): MenuBar {
  const item = (code: string) => root.querySelector<HTMLElement>(`[data-help-item="${code}"]`);

  const game = item("game");
  if (game) {
    game.textContent = deps.fromGame ? BACK_TO_GAME_LABEL : PLAY_LABEL;
    if (deps.fromGame) game.addEventListener("click", (e) => deps.backToGame(e));
  }

  const actions: Record<string, () => void> = {
    print: () => deps.print(),
    find: () => deps.openSearch(),
    copy_link: () => void deps.copyLink(deps.pageUrl()).catch(() => {}),
    theme_light: () => deps.setTheme("light"),
    theme_dark: () => deps.setTheme("dark"),
    theme_auto: () => deps.setTheme("auto"),
  };

  root.addEventListener("click", (e) => {
    const picked = (e.target as Element | null)?.closest<HTMLElement>("[data-help-item]");
    if (!picked || !root.contains(picked)) return;
    const code = picked.dataset.helpItem ?? "";
    deps.track(code);
    actions[code]?.();
  });

  return new MenuBar(root, {
    onOpen: (menu) => {
      const current = deps.theme();
      for (const [theme, code] of Object.entries(THEME_ITEMS) as Array<[HelpTheme, string]>) {
        const radio = menu.querySelector(`[data-help-item="${code}"]`);
        radio?.setAttribute("aria-checked", String(theme === current));
      }
    },
  });
}
