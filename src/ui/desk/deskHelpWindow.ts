import { buildHelpWindow, type HelpWindow } from "@verticopolis/components/windows/desk/deskHelp";
import { helpUrl } from "../../helpAddress";
import { MANUAL_COMMAND_TYPE, readPageMessage, type ManualCommand, type ManualLook } from "../../manual/manualEmbed";
import { fromGameHref, type GameHelpSource } from "../fromGame";
import { SPONSOR_URL, sponsorOffered } from "../splashTemplate";
import { deskHelpMenuModel, type DeskHelpMenuDeps } from "./deskHelpMenu";

/**
 * The Player's Manual in its own window on the desk (owner, 2026-11-20): the
 * window the components draw (buildHelpWindow), showing the manual's pages in
 * a frame. The manual's pages say which page they show
 * (src/manual/manualEmbed.ts); the window keeps its own Back and Forward from
 * those, and moves the frame with `location.replace`, so the game's own
 * browser history never fills with manual pages. Its menu bar
 * (deskHelpMenu.ts) acts on the page through commands it posts to the frame.
 *
 * Cost: nothing runs per frame; one message per manual page shown, and the
 * menu bar redraws when the page's look changes.
 */

/** The window's title, and the page title it falls back to. */
export const MANUAL_TITLE = "Player's Manual";

/** What the desk does when the window opens and closes. */
export interface ManualWindowHooks {
  /** Heard when the window's ✕ closes it. */
  readonly closed: () => void;
  /** Heard when Help shows a page in it, so the desk brings it up. */
  readonly shown: () => void;
  /** Heard on a pick from the window's menu bar, with the item's code. */
  readonly menuPicked: (item: string) => void;
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
  /** The look the page shown last said it wears, which Options checks. */
  private look: ManualLook = "auto";
  private readonly menuDeps: DeskHelpMenuDeps;

  constructor(
    private readonly doc: Document,
    private readonly hooks: ManualWindowHooks,
  ) {
    const view = doc.defaultView;
    this.manualOrigin = new URL(manualHref("/"), (view ?? globalThis).location.href).origin;
    this.menuDeps = {
      openInBrowser: () => this.openInBrowser(),
      print: () => this.send({ type: MANUAL_COMMAND_TYPE, command: "print" }),
      exit: () => this.close(),
      find: () => {
        // The page's search box can take the focus only once its frame has it.
        this.frame.page.focus();
        this.send({ type: MANUAL_COMMAND_TYPE, command: "find" });
      },
      copyLink: () => {
        if (!view) return;
        const href = new URL(this.currentHref(), view.location.href).href;
        void view.navigator.clipboard?.writeText(href).catch(() => {});
      },
      setLook: (look) => {
        this.setLook(look);
        this.send({ type: MANUAL_COMMAND_TYPE, command: "look", look });
      },
      whatsNew: () => this.go("/changelog/"),
      sponsor: sponsorOffered() ? SPONSOR_URL : null,
      track: hooks.menuPicked,
    };
    this.frame = buildHelpWindow(
      doc,
      MANUAL_TITLE,
      {
        contents: () => this.go("/"),
        back: () => this.step(-1),
        forward: () => this.step(1),
        openInBrowser: () => this.openInBrowser(),
        close: { label: "Close the Player's Manual", onClick: () => this.close() },
      },
      { model: deskHelpMenuModel(this.menuDeps, this.look) },
    );
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
    // Only the frame's first page may come from `src`: once it has shown one,
    // a new `src` would add an entry to the game's history.
    if (frameWin && this.frame.page.getAttribute("src")) frameWin.location.replace(href);
    else this.frame.page.src = href;
    this.frame.root.hidden = false;
    this.hooks.shown();
  }

  /** Run `fn` once when the window next closes (the Help pause ends there). */
  whenClosed(fn: () => void): void {
    this.closing.push(fn);
  }

  /** Close the window (the player's ✕ or the window menu) and empty its
   *  frame, so a page's scripts stop; the next open starts a fresh history.
   *  The frame is emptied with `replace`: removing its `src` would navigate it
   *  to a blank page with a new entry in the game's history. */
  close(): void {
    if (!this.isOpen()) return;
    this.shut();
    this.hooks.closed();
  }

  /** Stop hearing the manual's pages and take the menu bar's listeners off
   *  the page; the desk is coming down, and the next desk builds its own
   *  window. An open window closes without counting as the player's close. */
  dispose(): void {
    if (this.isOpen()) this.shut();
    this.doc.defaultView?.removeEventListener("message", this.onMessage);
    this.frame.dispose();
  }

  private shut(): void {
    this.frame.root.hidden = true;
    this.frame.page.contentWindow?.location.replace("about:blank");
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
    // A closed window ignores the last words of the page it just emptied.
    if (!this.isOpen() || e.origin !== this.manualOrigin || e.source !== this.frame.page.contentWindow) return;
    const page = readPageMessage(e.data);
    if (!page) return;
    this.setLook(page.look);
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

  /** The manual's own address for the page showing now. */
  private currentHref(): string {
    return manualHref(this.current() ?? "/");
  }

  private openInBrowser(): void {
    this.doc.defaultView?.open(this.currentHref(), "_blank", "noopener");
  }

  /** Ask the page in the frame to do `command`; only the manual's origin
   *  hears it. */
  private send(command: ManualCommand): void {
    this.frame.page.contentWindow?.postMessage(command, this.manualOrigin);
  }

  /** Check `look` in Options, redrawing the bar only when it changes. */
  private setLook(look: ManualLook): void {
    if (look === this.look) return;
    this.look = look;
    this.frame.menus.render(deskHelpMenuModel(this.menuDeps, look));
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
