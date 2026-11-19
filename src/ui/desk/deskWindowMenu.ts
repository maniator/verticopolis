/**
 * The 1994 desk's window menu: a right-click on a window's taskbar button or
 * its title bar opens Restore, Minimize, Maximize and Close, each grayed when
 * it does not apply, as the 1995 window menu did. Shift+F10 or the context
 * menu key opens it from a focused taskbar button; the arrow keys move through
 * it and Esc or a press outside closes it.
 *
 * Cost: one menu built once with the taskbar; each opening sets four items.
 */

import type { DeskWindow } from "./deskWindow";

/** Where a window menu was opened: a right-click (or Shift+F10) on a taskbar
 *  button, or a right-click on a window's title bar. */
export type WindowMenuFrom = "taskbar" | "title_bar";

/** A window menu command. */
export type WindowCommand = "restore" | "minimize" | "maximize" | "close";

/** Which commands apply to a window now. */
export type WindowMenuState = Readonly<Record<WindowCommand, boolean>>;

/** The menu's items in order: a label and its command, a null a separator. */
export const WINDOW_MENU_ITEMS: ReadonlyArray<readonly [label: string, command: WindowCommand] | null> = [
  ["Restore", "restore"],
  ["Minimize", "minimize"],
  ["Maximize", "maximize"],
  null,
  ["Close", "close"],
];

/** What the window menu offers for `w` now, `active` being the window with
 *  the focus: Restore unless it is in front at its own size, Minimize unless
 *  minimized, Maximize for the tower when not maximized, Close when the game
 *  can close it (Info and Tools never close on the desk). */
export function windowMenuState(w: DeskWindow | undefined, active: DeskWindow | null): WindowMenuState | null {
  if (!w) return null;
  const inFront = w === active && !w.minimized && !w.maximized;
  return { restore: !inFront, minimize: !w.minimized, maximize: w.spec.canMax && !w.maximized, close: !!w.spec.close };
}

/** Run `command` on `w`; `bringUp` puts it in front, back from the taskbar
 *  when minimized. Restore and Maximize bring it up first, as 1995 did. */
export function runWindowCommand(w: DeskWindow | undefined, command: WindowCommand, bringUp: (w: DeskWindow) => void): void {
  if (!w) return;
  if (command === "minimize") w.minimize();
  else if (command === "close") w.spec.close?.();
  else {
    bringUp(w);
    if (w.maximized === (command === "restore")) w.toggleMax();
  }
}

export interface WindowMenuHandlers {
  /** What applies to window `id` now; null leaves the menu shut. */
  readonly state: (id: string) => WindowMenuState | null;
  /** Run `command` on window `id`. */
  readonly run: (id: string, command: WindowCommand) => void;
  /** The menu opened for window `id` (for the analytics): from a taskbar
   *  button (`above`) or a window's title bar. */
  readonly opened?: (id: string, from: WindowMenuFrom) => void;
}

export class WindowMenu {
  readonly root: HTMLElement;
  private readonly items = new Map<WindowCommand, HTMLButtonElement>();
  private target: string | null = null;
  /** Where focus goes back to when the menu closes from the keyboard. */
  private opener: HTMLElement | null = null;

  constructor(
    private readonly doc: Document,
    private readonly handlers: WindowMenuHandlers,
  ) {
    const root = doc.createElement("div");
    root.className = "desk-win-menu";
    root.setAttribute("role", "menu");
    root.setAttribute("aria-label", "Window");
    root.hidden = true;
    for (const item of WINDOW_MENU_ITEMS) {
      if (!item) {
        const sep = doc.createElement("hr");
        sep.className = "mb-sep";
        root.appendChild(sep);
        continue;
      }
      const [label, command] = item;
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "mb-item";
      b.setAttribute("role", "menuitem");
      b.dataset.command = command;
      b.textContent = label;
      b.addEventListener("click", () => {
        const id = this.target;
        this.close(true);
        if (id && !b.disabled) handlers.run(id, command);
      });
      this.items.set(command, b);
      root.appendChild(b);
    }
    root.addEventListener("keydown", (e) => this.key(e));
    this.root = root;
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** Open the menu for window `id` with its corner at (x, y) in the page;
   *  `above` opens it upward from y (from the taskbar). Kept on the screen. */
  show(id: string, x: number, y: number, above: boolean, opener: HTMLElement | null): boolean {
    const state = this.handlers.state(id);
    if (!state) return false;
    for (const [command, b] of this.items) b.disabled = !state[command];
    this.target = id;
    this.opener = opener;
    const root = this.root;
    root.hidden = false;
    const view = this.doc.defaultView;
    const w = root.offsetWidth;
    const h = root.offsetHeight;
    const maxX = (view?.innerWidth ?? x + w) - w;
    const top = above ? y - h : y;
    const maxY = (view?.innerHeight ?? top + h) - h;
    root.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
    root.style.top = `${Math.max(0, Math.min(top, maxY))}px`;
    this.first()?.focus();
    this.handlers.opened?.(id, above ? "taskbar" : "title_bar");
    return true;
  }

  /** Close the menu; `refocus` gives the focus back to what opened it. */
  close(refocus = false): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.target = null;
    if (refocus) this.opener?.focus();
    this.opener = null;
  }

  private enabled(): HTMLButtonElement[] {
    return [...this.items.values()].filter((b) => !b.disabled);
  }

  private first(): HTMLButtonElement | undefined {
    return this.enabled()[0];
  }

  private key(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close(true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = this.enabled();
    const at = items.indexOf(this.doc.activeElement as HTMLButtonElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  }
}
