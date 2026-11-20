import { buildHelpWindow, type HelpWindow } from "@verticopolis/components/windows/desk/deskHelp";
import { helpUrl } from "../../helpAddress";
import { readPageMessage } from "../../manual/manualEmbed";
import { fromGameHref, type GameHelpSource } from "../fromGame";

/**
 * The Player's Manual in its own window on the desk (owner, 2026-11-20): the
 * window the components draw (buildHelpWindow), showing the manual's pages in
 * a frame. The manual's pages say which page they show
 * (src/manual/manualEmbed.ts); the window keeps its own Back and Forward from
 * those, and moves the frame with `location.replace`, so the game's own
 * browser history never fills with manual pages.
 *
 * Cost: nothing runs per frame; one message per manual page shown.
 */

/** The window's title, and the page title it falls back to. */
export const MANUAL_TITLE = "Player's Manual";

/** What the desk does when the window opens and closes. */
export interface ManualWindowHooks {
  /** Heard when the window's ✕ closes it. */
  readonly closed: () => void;
  /** Heard when Help shows a page in it, so the desk brings it up. */
  readonly shown: () => void;
}

/** The manual's own address for `path`, a page under the manual's base
 *  ("/rooms/hotels/"). */
const manualHref = (path: string): string => helpUrl(`/help${path}`);

export class ManualWindow {
  readonly frame: HelpWindow;
  /** The pages shown, oldest first, and which one shows now. */
  private pages: string[] = [];
  private at = -1;
  private readonly manualOrigin: string;
  /** Run once when the window next closes, by the player or the desk. */
  private closing: (() => void)[] = [];

  constructor(
    private readonly doc: Document,
    private readonly hooks: ManualWindowHooks,
  ) {
    const view = doc.defaultView;
    this.manualOrigin = new URL(manualHref("/"), (view ?? globalThis).location.href).origin;
    this.frame = buildHelpWindow(doc, MANUAL_TITLE, {
      contents: () => this.go("/"),
      back: () => this.step(-1),
      forward: () => this.step(1),
      openInBrowser: () => this.openInBrowser(),
      close: { label: "Close the Player's Manual", onClick: () => this.close() },
    });
    this.frame.root.hidden = true;
    view?.addEventListener("message", this.onMessage);
  }

  /** Whether the window is open on the desk. */
  isOpen(): boolean {
    return !this.frame.root.hidden;
  }

  /** Show the manual's page `path` (a game Help address, "/help/rooms/"),
   *  marked as opened from `source`, and open the window. */
  show(path: string, source: GameHelpSource): void {
    const href = fromGameHref(helpUrl(path), source);
    const frameWin = this.frame.page.contentWindow;
    if (this.isOpen() && frameWin && this.frame.page.getAttribute("src")) frameWin.location.replace(href);
    else this.frame.page.src = href;
    this.frame.root.hidden = false;
    this.hooks.shown();
  }

  /** Run `fn` once when the window next closes (the Help pause ends there). */
  whenClosed(fn: () => void): void {
    this.closing.push(fn);
  }

  /** Close the window (the player's ✕ or the window menu) and empty its
   *  frame, so a page's scripts stop; the next open starts a fresh history. */
  close(): void {
    if (!this.isOpen()) return;
    this.shut();
    this.hooks.closed();
  }

  /** Stop hearing the manual's pages; the desk is coming down. An open
   *  window closes without counting as the player's close. */
  dispose(): void {
    if (this.isOpen()) this.shut();
    this.doc.defaultView?.removeEventListener("message", this.onMessage);
  }

  private shut(): void {
    this.frame.root.hidden = true;
    this.frame.page.removeAttribute("src");
    this.pages = [];
    this.at = -1;
    this.frame.setNav({ back: false, forward: false });
    this.frame.setTitle(MANUAL_TITLE);
    const run = this.closing;
    this.closing = [];
    for (const fn of run) fn();
  }

  /** The address of the page showing now, under the manual's base. */
  current(): string | null {
    return this.pages[this.at] ?? null;
  }

  private readonly onMessage = (e: MessageEvent): void => {
    if (e.origin !== this.manualOrigin || e.source !== this.frame.page.contentWindow) return;
    const page = readPageMessage(e.data);
    if (!page) return;
    this.frame.setTitle(page.title === MANUAL_TITLE ? MANUAL_TITLE : `${page.title} - ${MANUAL_TITLE}`);
    if (this.pages[this.at] !== page.path) {
      this.pages = [...this.pages.slice(0, this.at + 1), page.path];
      this.at = this.pages.length - 1;
    }
    this.syncNav();
  };

  private go(path: string): void {
    this.frame.page.contentWindow?.location.replace(manualHref(path));
  }

  private step(by: -1 | 1): void {
    const to = this.at + by;
    if (to < 0 || to >= this.pages.length) return;
    this.at = to;
    this.syncNav();
    this.go(this.pages[to]);
  }

  private openInBrowser(): void {
    this.doc.defaultView?.open(manualHref(this.current() ?? "/"), "_blank", "noopener");
  }

  private syncNav(): void {
    this.frame.setNav({ back: this.at > 0, forward: this.at < this.pages.length - 1 });
  }
}

/** The desk's Player's Manual window while the desk is up, which the game's
 *  Help opens instead of a tab (src/ui/uiHelp.ts). */
let deskManualWindow: ManualWindow | null = null;

/** Set or clear the desk's manual window (the desk going up or down). */
export function setDeskManual(win: ManualWindow | null): void {
  deskManualWindow = win;
}

/** The desk's manual window, or null when the desk is down. */
export function deskManual(): ManualWindow | null {
  return deskManualWindow;
}
