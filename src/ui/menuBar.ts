/**
 * The Win95 menu bar's behavior (index.html `#menubar`): a title opens its
 * menu, and while one is open, pointing at another title switches to it, the
 * way a 1995 desktop menu bar works. The keyboard follows the WAI-ARIA
 * menubar keys (the markup is a row of menu buttons, each with its menu):
 * Left and Right move between titles, Down (or Enter or Space) on a title
 * opens it, Up and Down move inside a menu, Home and End jump to its ends,
 * Escape closes it and gives the focus back to its title, and Tab closes it.
 * Alt with a title's underlined letter opens that menu.
 *
 * What an item does is not this module's business: each item is a real
 * button whose click the game wires (`game/menuWiring.ts`). A click on an
 * item that is not grayed out closes the menu after its own handlers run.
 *
 * Cost: nothing runs per frame. Opening a menu calls `onOpen` once, so the
 * wiring can refresh check marks and grayed items only when someone looks.
 */

/** How long a press that closed a menu keeps swallowing its own pointerup and
 *  click, in milliseconds: long enough for a slow tap, short enough that the
 *  next real press always lands. */
const SWALLOW_MS = 1000;

/** Slide an open menu left by as much as it overflows the window's right
 *  edge (a middle menu on a phone), never past the left edge. One layout read
 *  per open. */
function keepOnScreen(menu: HTMLElement): void {
  menu.style.translate = "";
  const r = menu.getBoundingClientRect();
  const over = r.right - menu.ownerDocument.documentElement.clientWidth;
  if (over > 0) menu.style.translate = `${-Math.min(over, Math.max(0, r.left))}px 0`;
}

/** An item the player can pick: shown and not grayed out. */
const PICKABLE = ".mb-item:not([hidden]):not([aria-disabled='true'])";

export interface MenuBarOptions {
  /** Runs as a menu opens, before it shows, with the menu's popup. */
  readonly onOpen?: (menu: HTMLElement) => void;
}

export class MenuBar {
  private readonly titles: HTMLButtonElement[];
  private openTitle: HTMLButtonElement | null = null;
  /** Until when a press that closed a menu still swallows its pointerup and click. */
  private swallowUntil = -Infinity;

  constructor(
    private readonly root: HTMLElement,
    private readonly opts: MenuBarOptions = {},
  ) {
    this.titles = [...root.querySelectorAll<HTMLButtonElement>(".mb-title")];
    for (const title of this.titles) {
      title.addEventListener("click", () => (this.openTitle === title ? this.close() : this.open(title, false)));
      // A mouse switches menus by pointing. A finger's tap also fires
      // pointerenter just before its click, which would open the menu and
      // then close it again, so a tap switches by its click alone.
      title.addEventListener("pointerenter", (e) => {
        if (e.pointerType !== "mouse") return;
        if (this.openTitle && this.openTitle !== title) this.open(title, false);
      });
      title.addEventListener("keydown", (e) => this.titleKey(e, title));
      const menu = this.menuOf(title);
      menu?.addEventListener("keydown", (e) => this.menuKey(e, title));
      // After the item's own click handlers (they were added at wiring time,
      // before this bubbling listener on the popup runs).
      menu?.addEventListener("click", (e) => {
        const item = e.target instanceof Element ? e.target.closest(".mb-item") : null;
        if (item && item.getAttribute("aria-disabled") !== "true") this.close();
      });
    }
    const doc = root.ownerDocument;
    const win = doc.defaultView;
    // A press outside the bar only closes the open menu, as a 1995 menu does:
    // caught on the way down (capture, on the window, before the tower's own
    // listeners), it never reaches what is under it, and neither do its
    // pointerup and click, so closing a menu cannot also build on the tower.
    const outside = (e: Event) => !(e.target instanceof Node && root.contains(e.target));
    win?.addEventListener(
      "pointerdown",
      (e) => {
        if (!this.openTitle || !outside(e)) return;
        this.close();
        this.swallowUntil = e.timeStamp + SWALLOW_MS;
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );
    const swallow = (e: Event) => {
      if (e.timeStamp > this.swallowUntil || !outside(e)) return;
      if (e.type === "click") this.swallowUntil = -Infinity;
      e.preventDefault();
      e.stopPropagation();
    };
    win?.addEventListener("pointerup", swallow, true);
    win?.addEventListener("click", swallow, true);
    doc.addEventListener("keydown", (e) => this.accelerator(e));
    win?.addEventListener("blur", () => this.close());
  }

  /** The title whose menu is open, or null. */
  current(): HTMLButtonElement | null {
    return this.openTitle;
  }

  /** Open `title`'s menu, closing any other; `focusItem` focuses its first item. */
  open(title: HTMLButtonElement, focusItem: boolean): void {
    if (this.openTitle && this.openTitle !== title) this.close(false);
    const menu = this.menuOf(title);
    if (!menu) return;
    this.opts.onOpen?.(menu);
    menu.hidden = false;
    keepOnScreen(menu);
    title.setAttribute("aria-expanded", "true");
    this.openTitle = title;
    if (focusItem) this.items(menu)[0]?.focus();
  }

  /** Close the open menu. `refocus` gives the focus back to its title when
   *  the focus was inside the menu, so the keyboard is not dropped. */
  close(refocus = true): void {
    const title = this.openTitle;
    if (!title) return;
    const menu = this.menuOf(title);
    const hadFocus = !!menu && menu.contains(this.root.ownerDocument.activeElement);
    if (menu) menu.hidden = true;
    title.setAttribute("aria-expanded", "false");
    this.openTitle = null;
    if (refocus && hadFocus) title.focus();
  }

  private menuOf(title: HTMLButtonElement): HTMLElement | null {
    const id = title.getAttribute("aria-controls");
    return id ? this.root.ownerDocument.getElementById(id) : null;
  }

  private items(menu: HTMLElement): HTMLElement[] {
    return [...menu.querySelectorAll<HTMLElement>(PICKABLE)];
  }

  private neighbor(title: HTMLButtonElement, step: 1 | -1): HTMLButtonElement {
    const shown = this.titles.filter((t) => !t.closest("[hidden]"));
    const at = shown.indexOf(title);
    return shown[(at + step + shown.length) % shown.length] ?? title;
  }

  private titleKey(e: KeyboardEvent, title: HTMLButtonElement): void {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const next = this.neighbor(title, e.key === "ArrowRight" ? 1 : -1);
      next.focus();
      if (this.openTitle) this.open(next, false);
    } else if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      this.open(title, true);
    } else if (e.key === "Escape" && this.openTitle) {
      this.close();
      title.focus();
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  private menuKey(e: KeyboardEvent, title: HTMLButtonElement): void {
    const menu = this.menuOf(title);
    if (!menu) return;
    const items = this.items(menu);
    const at = items.indexOf(this.root.ownerDocument.activeElement as HTMLElement);
    const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus();
    switch (e.key) {
      case "ArrowDown": focusAt(at + 1); break;
      case "ArrowUp": focusAt(at < 0 ? -1 : at - 1); break;
      case "Home": focusAt(0); break;
      case "End": focusAt(-1); break;
      case "ArrowRight":
      case "ArrowLeft": {
        const next = this.neighbor(title, e.key === "ArrowRight" ? 1 : -1);
        this.open(next, true);
        break;
      }
      case "Escape":
        this.close();
        title.focus();
        break;
      case "Tab":
        this.close(false);
        return; // let the focus move on
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  /** Alt with a title's underlined letter opens that menu, unless a dialog is
   *  open: the menus act on the tower, and a dialog holds the screen. */
  private accelerator(e: KeyboardEvent): void {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key.length !== 1) return;
    if (this.root.ownerDocument.querySelector("dialog[open]")) return;
    const letter = e.key.toLowerCase();
    const title = this.titles.find((t) => !t.closest("[hidden]") && t.querySelector("u")?.textContent?.toLowerCase() === letter);
    if (!title) return;
    e.preventDefault();
    this.open(title, true);
  }
}
