/**
 * The Player's Manual shown inside the game's Help window on the desk
 * (owner, 2026-11-20), on both sides of the frame.
 *
 * The manual's host lets only the game frame it (`frame-ancestors` in
 * vercel.json), so a manual page inside a frame is inside the game. There it
 * wears {@link EMBEDDED_CLASS}, which hides the parts the window already has
 * (the menu bar, the game button, the Help bar), follows its own links with
 * `location.replace` so the game's browser history never fills with manual
 * pages, opens links out of the manual in a browser tab, and tells the game
 * each page it shows ({@link ManualPageMessage}).
 * The game keeps the window's Back and Forward from those messages.
 *
 * The window's menus act on the page through {@link ManualCommand}s the game
 * sends it (Print Topic, Find, a look from Options), and the page names its
 * look in every page message so Options can check it.
 *
 * Messages go to one origin and are read from one origin: the game's
 * ({@link gameOriginFor}) and the manual's (the game's `helpUrl`).
 */

import { HELP_ADDRESS } from "../helpAddress";

/** The class a manual page wears inside the game's Help window. */
export const EMBEDDED_CLASS = "vc-embedded";

/** How long a manual page inside the window waits for an idle moment before
 *  running an idle callback anyway (see {@link boundIdle}). */
export const IDLE_LIMIT_MS = 1000;

/**
 * Give every idle callback on `win` a `timeout` of `ms` unless it names its
 * own. Inside the game's window the manual shares a thread with the game,
 * whose frame loop leaves no idle moment, so Starlight's search (loaded from
 * an idle callback) would never load. The head's boot script runs this, as
 * source, before any other script; it uses nothing from outside itself.
 */
export function boundIdle(win: Pick<Window, "requestIdleCallback">, ms: number): void {
  const idle = win.requestIdleCallback;
  if (typeof idle !== "function") return;
  win.requestIdleCallback = (cb, options) => idle.call(win, cb, { timeout: ms, ...options });
}

/** The `type` of the message a manual page sends the game. */
export const MANUAL_PAGE_TYPE = "vc-manual-page";

/** The `type` of a message the game sends a manual page. */
export const MANUAL_COMMAND_TYPE = "vc-manual-command";

/** The manual's looks, as its Options menu names them. */
export type ManualLook = "light" | "dark" | "auto";
const LOOKS: readonly ManualLook[] = ["light", "dark", "auto"];

/** What a manual page tells the game it shows. */
export interface ManualPageMessage {
  readonly type: typeof MANUAL_PAGE_TYPE;
  /** The page's address under the manual's base, with its query and hash,
   *  starting with "/" ("/rooms/hotels/"). */
  readonly path: string;
  /** The page's title, for the window's title bar. */
  readonly title: string;
  /** The page's look, for the window's Options menu. */
  readonly look: ManualLook;
}

/** What the game asks a manual page to do: print itself, open its search,
 *  or wear a look. */
export type ManualCommand =
  | { readonly type: typeof MANUAL_COMMAND_TYPE; readonly command: "print" | "find" }
  | { readonly type: typeof MANUAL_COMMAND_TYPE; readonly command: "look"; readonly look: ManualLook };

/** The command in a message from the game, else null. The caller has already
 *  checked who sent it. */
export function readManualCommand(data: unknown): ManualCommand | null {
  if (!data || typeof data !== "object") return null;
  const { type, command, look } = data as Record<string, unknown>;
  if (type !== MANUAL_COMMAND_TYPE) return null;
  if (command === "print" || command === "find") return { type, command };
  if (command === "look" && LOOKS.includes(look as ManualLook)) return { type, command, look: look as ManualLook };
  return null;
}

/** The game's origin, the only one a manual page on `host` posts to: the
 *  production game for the manual's own host, else the page's own origin
 *  (a build that keeps the manual under /help on the game's host). */
export function gameOriginFor(host: string, ownOrigin: string): string {
  return host === HELP_ADDRESS ? "https://verticopolis.com" : ownOrigin;
}

/** The message for the page at `pathname + search + hash`, under `base` ("" or
 *  "/help"), titled `title` and wearing `look`. The " | Verticopolis™ Help"
 *  suffix is dropped. */
export function pageMessage(
  location: Pick<Location, "pathname" | "search" | "hash">,
  base: string,
  title: string,
  look: ManualLook,
): ManualPageMessage {
  const inside = location.pathname.startsWith(`${base}/`) ? location.pathname.slice(base.length) : location.pathname;
  return {
    type: MANUAL_PAGE_TYPE,
    path: inside + location.search + location.hash,
    title: title.replace(/\s*\|\s*Verticopolis™? Help$/, "").trim() || "Player's Manual",
    look,
  };
}

/** The data of a message from the manual when it is a page message, else
 *  null. The caller has already checked who sent it. */
export function readPageMessage(data: unknown): ManualPageMessage | null {
  if (!data || typeof data !== "object") return null;
  const { type, path, title, look } = data as Record<string, unknown>;
  if (type !== MANUAL_PAGE_TYPE || typeof path !== "string" || typeof title !== "string") return null;
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return {
    type,
    path,
    title: title.slice(0, 200),
    look: LOOKS.includes(look as ManualLook) ? (look as ManualLook) : "auto",
  };
}

/** What a manual page inside the window does with a click on a link. */
export type EmbeddedClick =
  /** Another manual page: replace this one, so the game's history stays clean. */
  | { readonly replace: string }
  /** A page outside the manual: open it in a browser tab, so the window keeps
   *  showing the manual and its Back and Forward stay the manual's. */
  | { readonly open: string };

/** The click a manual page inside the window handles itself, or null for a
 *  click the browser keeps (a modified or middle click, a link that already
 *  names a new tab, a download, a link to something that is no web page). A
 *  link to a spot on the same page is replaced too, which scrolls there
 *  without a history entry. */
export function embeddedClick(
  event: Pick<MouseEvent, "button" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "defaultPrevented">,
  link: Pick<HTMLAnchorElement, "href" | "target" | "hasAttribute"> | null,
  here: string,
  base: string,
): EmbeddedClick | null {
  if (!link || event.defaultPrevented || event.button !== 0) return null;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return null;
  if ((link.target && link.target !== "_self") || link.hasAttribute("download")) return null;
  let to: URL;
  try {
    to = new URL(link.href, here);
  } catch {
    return null;
  }
  if (to.protocol !== "https:" && to.protocol !== "http:") return null;
  if (to.origin === new URL(here).origin && to.pathname.startsWith(`${base}/`)) return { replace: to.href };
  return { open: to.href };
}
