/**
 * The game's menu bar on the page: drawn once into index.html's
 * `#menubar-host` (main.ts draws it before the UI is built), with each item's
 * action looked up here when it is picked.
 *
 * A module that owns an item says what it does with {@link onMenuItem}. The
 * item's `onPick` (menuModel.ts) runs every action registered for its id, so
 * no module adds a listener to an element the bar draws. A click on the item,
 * from the pointer, the keyboard or a script's `click()`, runs them alike.
 */
import { MenuBar, type MenuBarOptions } from "@verticopolis/components/windows/menuBar";
import { gameMenuModel } from "./menuModel";
import { SPONSOR_URL, sponsorOffered } from "../ui/splashTemplate";
import { trackAppAction } from "../analytics";

/** What an item does when it is picked. */
export type MenuAction = (event: MouseEvent) => void;

/** A drawn bar: the bar, the hooks {@link wireMenus} attaches, and each
 *  item's actions by id. */
export interface DrawnBar {
  readonly bar: MenuBar;
  hooks: Pick<MenuBarOptions, "onTrip" | "onDismiss" | "onOpen">;
  readonly actions: Map<string, MenuAction[]>;
}

/** The bar drawn into each host, so the boot flow wires the one main drew. */
const drawnBars = new WeakMap<HTMLElement, DrawnBar>();

/** The bar drawn on `doc`'s page, if any. */
export function drawnBar(doc: Document = document): DrawnBar | undefined {
  const host = doc.getElementById("menubar-host");
  return host ? drawnBars.get(host) : undefined;
}

/** Draw the menu bar into index.html's `#menubar-host`, once. The game draws
 *  it before the UI is built, since the UI and the boot flow register its
 *  items' actions; until {@link wireMenus} runs, a menu opens with nothing to
 *  refresh and reports nothing. A page without the host, or a second call,
 *  draws nothing. */
export function drawMenuBar(doc: Document = document): MenuBar | null {
  const host = doc.getElementById("menubar-host");
  if (!host || drawnBars.has(host)) return null;
  const actions = new Map<string, MenuAction[]>();
  const drawn: DrawnBar = {
    hooks: {},
    actions,
    bar: new MenuBar(
      host,
      gameMenuModel({
        sponsorUrl: sponsorOffered() ? SPONSOR_URL : null,
        onSponsor: () => trackAppAction("sponsor_click", "menu"),
        pick: (id) => (event) => {
          for (const run of actions.get(id) ?? []) run(event);
        },
      }),
      {
        onTrip: (title, via) => drawn.hooks.onTrip?.(title, via),
        onDismiss: (title, how, browsed) => drawn.hooks.onDismiss?.(title, how, browsed),
        onOpen: (menu) => drawn.hooks.onOpen?.(menu),
      },
    ),
  };
  drawnBars.set(host, drawn);
  return drawn.bar;
}

/** Run the actions registered for item `id` on `doc`'s bar, as a pick would,
 *  without a click on the item: a click while a menu is open would report a
 *  pick the player never made. */
export function runMenuItem(id: string, doc: Document = document): void {
  const actions = drawnBar(doc)?.actions.get(id);
  if (!actions) return;
  const View = doc.defaultView?.MouseEvent ?? MouseEvent;
  for (const run of [...actions]) run(new View("click"));
}

/** Run `run` when the item `id` is picked, on the bar drawn on `doc`'s page.
 *  A page without the bar runs nothing. */
export function onMenuItem(id: string, run: MenuAction, doc: Document = document): void {
  const actions = drawnBar(doc)?.actions;
  if (!actions) return;
  const list = actions.get(id);
  if (list) list.push(run);
  else actions.set(id, [run]);
}
