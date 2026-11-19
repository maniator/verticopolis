/**
 * The 1994 desk's taskbar: the Verticopolis button and its menu at the left
 * (a Verticopolis icon, never an operating system's logo, owner 2026-11-15),
 * a button per open window in the middle (a right-click opens its window
 * menu, deskWindowMenu.ts), and the tray at the right with the sound and the
 * computer's clock. The menu's items run the game's own menu
 * items by id, so each does exactly what its menu twin does.
 *
 * Cost: the clock writes its text once a minute; the window buttons are
 * rebuilt only when a window opens, closes, minimizes or takes the focus.
 */

import type { DeskTrayIcon } from "./deskAnalytics";
import { WindowMenu, type WindowMenuHandlers } from "@verticopolis/components/windows/desk/deskWindowMenu";

/** A window's button on the taskbar. */
export interface TaskEntry {
  readonly id: string;
  readonly label: string;
  /** Pressed in: the window has the focus. */
  readonly active: boolean;
  readonly minimized: boolean;
}

/** The Verticopolis menu's Control Panel item, which the desk opens itself. */
export const CONTROL_PANEL_ITEM = "desk-control-panel";

/** The Verticopolis menu: its label and the game's menu item it runs. A null
 *  item is a separator. */
export const START_ITEMS: ReadonlyArray<readonly [label: string, itemId: string] | null> = [
  ["New…", "btn-new"],
  ["Open…", "mb-import"],
  null,
  ["Player's Manual", "btn-help"],
  ["Screen Saver…", "mb-screensaver"],
  ["Control Panel…", CONTROL_PANEL_ITEM],
  ["Settings…", "btn-settings"],
  ["About Verticopolis…", "btn-about"],
  null,
  ["Close Verticopolis", "mb-close"],
];

/** The clock's text for `now`, as the 1995 tray showed it: "4:34 PM". */
export function trayClock(now: Date): string {
  const h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, "0");
  return `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

export interface TaskbarHandlers {
  /** A window's taskbar button was pressed. */
  readonly task: (id: string) => void;
  /** A Verticopolis menu item was picked (its game menu item's id). */
  readonly start: (itemId: string) => void;
  /** Opens the Control Panel; without it the menu item and the tray's display
   *  icon are left out (the title screen has no Control Panel). */
  readonly controlPanel?: () => void;
  /** The window menu a right-click on a window's button opens; without it a
   *  right-click does nothing (the title screen's one window). */
  readonly windowMenu?: WindowMenuHandlers;
  /** The Verticopolis button opened its menu (for the analytics). */
  readonly opened?: () => void;
  /** A tray button was pressed (for the analytics). */
  readonly tray?: (icon: DeskTrayIcon) => void;
}

export class DeskTaskbar {
  readonly root: HTMLElement;
  private readonly tasks: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly clock: HTMLElement;
  private readonly sound: HTMLButtonElement;
  private readonly winMenu: WindowMenu | null;
  private clockTimer: number | null = null;
  private shown = "";

  constructor(
    private readonly doc: Document,
    private readonly handlers: TaskbarHandlers,
  ) {
    const root = doc.createElement("div");
    root.id = "desk-taskbar";
    root.className = "desk-taskbar";
    root.setAttribute("role", "toolbar");
    root.setAttribute("aria-label", "Taskbar");
    const start = doc.createElement("button");
    start.type = "button";
    start.className = "desk-start";
    start.setAttribute("aria-haspopup", "menu");
    start.setAttribute("aria-expanded", "false");
    start.setAttribute("aria-controls", "desk-start-menu");
    const logo = doc.createElement("img");
    logo.src = "./favicon.png";
    logo.alt = "";
    logo.width = 16;
    logo.height = 16;
    start.append(logo, "Verticopolis");
    const menu = doc.createElement("div");
    menu.id = "desk-start-menu";
    menu.className = "desk-start-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Verticopolis");
    menu.hidden = true;
    const stripe = doc.createElement("div");
    stripe.className = "desk-start-stripe";
    stripe.setAttribute("aria-hidden", "true");
    stripe.innerHTML = "VERTICO<b>POLIS</b>";
    const list = doc.createElement("div");
    list.className = "desk-start-list";
    for (const item of START_ITEMS) {
      if (!item) {
        const sep = doc.createElement("hr");
        sep.className = "mb-sep";
        list.appendChild(sep);
        continue;
      }
      const [label, itemId] = item;
      if (itemId === CONTROL_PANEL_ITEM && !handlers.controlPanel) continue;
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "mb-item";
      b.setAttribute("role", "menuitem");
      b.dataset.item = itemId;
      b.textContent = label;
      b.addEventListener("click", () => {
        this.closeMenu();
        if (itemId === CONTROL_PANEL_ITEM) handlers.controlPanel?.();
        handlers.start(itemId);
      });
      list.appendChild(b);
    }
    menu.append(stripe, list);
    const tasks = doc.createElement("div");
    tasks.className = "desk-tasks";
    const tray = doc.createElement("div");
    tray.className = "desk-tray";
    const sound = doc.createElement("button");
    sound.type = "button";
    sound.className = "desk-tray-sound";
    sound.addEventListener("click", () => {
      handlers.tray?.("sound");
      doc.getElementById("mb-sound")?.click();
    });
    const clock = doc.createElement("span");
    clock.className = "desk-tray-clock";
    if (handlers.controlPanel) {
      const display = doc.createElement("button");
      display.type = "button";
      display.className = "desk-tray-display";
      display.setAttribute("aria-label", "Control Panel");
      display.title = "Control Panel";
      display.addEventListener("click", () => {
        handlers.tray?.("display");
        handlers.controlPanel?.();
      });
      tray.append(display);
    }
    tray.append(sound, clock);
    root.append(start, menu, tasks, tray);
    this.winMenu = handlers.windowMenu ? new WindowMenu(doc, handlers.windowMenu) : null;
    if (this.winMenu) root.appendChild(this.winMenu.root);
    start.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu.hidden) this.openMenu();
      else this.closeMenu();
    });
    menu.addEventListener("keydown", (e) => this.menuKey(e));
    this.root = root;
    this.tasks = tasks;
    this.menu = menu;
    this.startButton = start;
    this.clock = clock;
    this.sound = sound;
  }

  /** Start the clock and listen for clicks off the menu; call when shown. */
  start(): void {
    this.tick();
    this.syncSound();
    this.doc.addEventListener("pointerdown", this.onOutside, true);
    this.doc.addEventListener("keydown", this.onEscape);
  }

  /** Stop the clock and the listeners; call when the desk goes away. */
  stop(): void {
    if (this.clockTimer !== null) clearTimeout(this.clockTimer);
    this.clockTimer = null;
    this.closeMenu();
    this.winMenu?.close();
    this.doc.removeEventListener("pointerdown", this.onOutside, true);
    this.doc.removeEventListener("keydown", this.onEscape);
  }

  /** Show one button per open window, in the order given. */
  render(entries: readonly TaskEntry[]): void {
    const key = entries.map((e) => `${e.id}:${e.label}:${e.active ? 1 : 0}${e.minimized ? 1 : 0}`).join("|");
    if (key === this.shown) return;
    this.shown = key;
    this.tasks.replaceChildren(
      ...entries.map((e) => {
        const b = this.doc.createElement("button");
        b.type = "button";
        b.className = "desk-task";
        b.dataset.win = e.id;
        b.classList.toggle("on", e.active && !e.minimized);
        b.setAttribute("aria-pressed", String(e.active && !e.minimized));
        b.title = e.label;
        const icon = this.doc.createElement("img");
        icon.src = "./favicon.png";
        icon.alt = "";
        icon.width = 16;
        icon.height = 16;
        const text = this.doc.createElement("span");
        text.textContent = e.label;
        b.append(icon, text);
        b.addEventListener("click", () => this.handlers.task(e.id));
        b.addEventListener("contextmenu", (ev) => {
          if (!this.winMenu) return;
          ev.preventDefault();
          this.openWindowMenu(e.id, ev.clientX, this.root.getBoundingClientRect().top, true, b);
        });
        b.addEventListener("keydown", (ev) => {
          if (!this.winMenu || !(ev.key === "ContextMenu" || (ev.key === "F10" && ev.shiftKey))) return;
          ev.preventDefault();
          const r = b.getBoundingClientRect();
          this.openWindowMenu(e.id, r.left, r.top, true, b);
        });
        return b;
      }),
    );
  }

  /** Open window `id`'s menu with its corner at (x, y), upward from y when
   *  `above` (from the taskbar). False when there is no window menu. */
  openWindowMenu(id: string, x: number, y: number, above = false, opener: HTMLElement | null = null): boolean {
    if (!this.winMenu) return false;
    this.closeMenu();
    return this.winMenu.show(id, x, y, above, opener);
  }

  /** Mirror Options > Sound on the tray's speaker. */
  syncSound(): void {
    const on = this.doc.getElementById("mb-sound")?.getAttribute("aria-checked") !== "false";
    this.sound.classList.toggle("muted", !on);
    const label = on ? "Sound is on. Click to turn it off." : "Sound is off. Click to turn it on.";
    this.sound.setAttribute("aria-label", label);
    this.sound.title = label;
  }

  private tick(): void {
    const now = new Date();
    const text = trayClock(now);
    if (this.clock.textContent !== text) this.clock.textContent = text;
    // Wake at the next minute, not every second.
    this.clockTimer = window.setTimeout(() => this.tick(), (60 - now.getSeconds()) * 1000 + 50);
  }

  private openMenu(): void {
    this.winMenu?.close();
    // An item whose game twin is hidden (Close on the title screen, which
    // needs a tower) is left out, as the menu bar leaves it out.
    for (const b of this.menu.querySelectorAll<HTMLElement>(".mb-item")) {
      const id = b.dataset.item;
      b.hidden = !!id && id !== CONTROL_PANEL_ITEM && this.doc.getElementById(id)?.hidden === true;
    }
    // A separator with no item shown after it would end the menu on a line.
    for (const sep of this.menu.querySelectorAll<HTMLElement>("hr")) {
      let next = sep.nextElementSibling as HTMLElement | null;
      while (next && next.hidden) next = next.nextElementSibling as HTMLElement | null;
      sep.hidden = !next || next.tagName === "HR";
    }
    this.menu.hidden = false;
    this.startButton.setAttribute("aria-expanded", "true");
    this.startButton.classList.add("on");
    this.handlers.opened?.();
    this.menu.querySelector<HTMLElement>(".mb-item:not([hidden])")?.focus();
  }

  private closeMenu(): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.startButton.setAttribute("aria-expanded", "false");
    this.startButton.classList.remove("on");
  }

  private menuKey(e: KeyboardEvent): void {
    const items = [...this.menu.querySelectorAll<HTMLElement>(".mb-item:not([hidden])")];
    const at = items.indexOf(this.doc.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    }
  }

  private readonly onOutside = (e: Event) => {
    const t = e.target as Node | null;
    if (this.winMenu && !(t && this.winMenu.root.contains(t))) this.winMenu.close();
    if (t && (this.menu.contains(t) || this.startButton.contains(t))) return;
    this.closeMenu();
  };

  private readonly onEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.winMenu?.close();
    if (e.key !== "Escape" || this.menu.hidden) return;
    this.closeMenu();
    this.startButton.focus();
  };
}
