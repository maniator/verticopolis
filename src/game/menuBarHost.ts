/**
 * The game's menu bar on the page: drawn once into index.html's
 * `#menubar-host` (main.ts draws it before the UI is built), with each item's
 * action looked up here when it is picked.
 *
 * A module that owns an item says what it does with {@link onMenuItem}. The
 * item's `onPick` (menuModel.ts) runs every action registered for its id, so
 * no module adds a listener to an element the bar draws. A click on the item,
 * from the pointer, the keyboard or a script's `click()`, runs them alike.
 *
 * A module that checks, grays or hides an entry says so with
 * {@link setMenuState}, which draws the bar again from its model with that
 * state, so nothing writes to an element the bar draws.
 */
import {
  MenuBar,
  type MenuBarModel,
  type MenuBarOptions,
  type MenuEntryModel,
} from "@verticopolis/components/windows/menuBar";
import type { TemplateResult } from "lit-html";
import { gameMenuModel } from "./menuModel";
import { SPONSOR_URL, sponsorOffered } from "../ui/splashTemplate";
import { trackAppAction } from "../analytics";

/** What an item does when it is picked. */
export type MenuAction = (event: MouseEvent) => void;

/** What a page changes on a drawn entry: an item's check mark, tooltip and
 *  content, an item's or submenu's gray, and whether an entry, or a whole
 *  menu by its title's id, shows. A field left out keeps what the model or an
 *  earlier state said. */
export interface MenuEntryState {
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly hidden?: boolean;
  readonly title?: string;
  readonly content?: TemplateResult;
}

const sameState = (a: MenuEntryState, b: MenuEntryState): boolean =>
  a.checked === b.checked &&
  a.disabled === b.disabled &&
  a.hidden === b.hidden &&
  a.title === b.title &&
  a.content === b.content;

/** A drawn bar: the bar, the model it was drawn from, the entries' states,
 *  the hooks {@link wireMenus} attaches, and each item's actions by id. */
export interface DrawnBar {
  readonly bar: MenuBar;
  readonly model: MenuBarModel;
  readonly states: Map<string, MenuEntryState>;
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
  const model = gameMenuModel({
    sponsorUrl: sponsorOffered() ? SPONSOR_URL : null,
    onSponsor: () => trackAppAction("sponsor_click", "menu"),
    pick: (id) => (event) => {
      for (const run of actions.get(id) ?? []) run(event);
    },
  });
  const drawn: DrawnBar = {
    hooks: {},
    actions,
    model,
    states: new Map(),
    bar: new MenuBar(host, model, {
      onTrip: (title, via) => drawn.hooks.onTrip?.(title, via),
      onDismiss: (title, how, browsed) => drawn.hooks.onDismiss?.(title, how, browsed),
      onOpen: (menu) => drawn.hooks.onOpen?.(menu),
    }),
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

/** Check, gray or show the entries `changes` names, on the bar drawn on
 *  `doc`'s page, and draw the bar again once if any of them changed. A page
 *  without the bar changes nothing. */
export function setMenuState(changes: Readonly<Record<string, MenuEntryState>>, doc: Document = document): void {
  const drawn = drawnBar(doc);
  if (!drawn) return;
  let changed = false;
  for (const [id, change] of Object.entries(changes)) {
    const was = drawn.states.get(id) ?? {};
    const next = { ...was, ...change };
    if (sameState(was, next)) continue;
    drawn.states.set(id, next);
    changed = true;
  }
  if (changed) drawn.bar.render(withStates(drawn.model, drawn.states));
}

/** `model` with each entry's state laid over it, a menu's by its title's id. */
export function withStates(model: MenuBarModel, states: ReadonlyMap<string, MenuEntryState>): MenuBarModel {
  return {
    ...model,
    menus: model.menus.map((menu) => {
      const hidden = states.get(menu.id)?.hidden;
      return { ...menu, ...(hidden === undefined ? {} : { hidden }), items: entriesWith(menu.items, states) };
    }),
  };
}

function entriesWith<E extends MenuEntryModel>(
  entries: readonly E[],
  states: ReadonlyMap<string, MenuEntryState>,
): E[] {
  return entries.map((entry) => {
    const state = entry.id === undefined ? undefined : states.get(entry.id);
    const own = entry.kind === "submenu" ? { ...entry, items: entriesWith(entry.items, states) } : entry;
    if (!state) return own;
    if (own.kind === "separator") return state.hidden === undefined ? own : { ...own, hidden: state.hidden };
    if (own.kind === "submenu") {
      const { disabled, hidden } = state;
      return { ...own, ...(disabled === undefined ? {} : { disabled }), ...(hidden === undefined ? {} : { hidden }) };
    }
    return { ...own, ...state };
  });
}
