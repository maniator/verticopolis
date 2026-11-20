/**
 * The Player's Manual shown inside the game's Help window on the desk
 * (owner, 2026-11-20), on both sides of the frame.
 *
 * The manual's host lets only the game frame it (`frame-ancestors` in
 * vercel.json), so a manual page inside a frame is inside the game. There it
 * wears {@link EMBEDDED_CLASS}, which hides the parts the window already has
 * (the menu bar, the game button, the Help bar), follows its own links with
 * `location.replace` so the game's browser history never fills with manual
 * pages, and tells the game each page it shows ({@link ManualPageMessage}).
 * The game keeps the window's Back and Forward from those messages.
 *
 * Messages go to one origin and are read from one origin: the game's
 * ({@link gameOriginFor}) and the manual's (the game's `helpUrl`).
 */

import { HELP_ADDRESS } from "../helpAddress";

/** The class a manual page wears inside the game's Help window. */
export const EMBEDDED_CLASS = "vc-embedded";

/** The `type` of the message a manual page sends the game. */
export const MANUAL_PAGE_TYPE = "vc-manual-page";

/** What a manual page tells the game it shows. */
export interface ManualPageMessage {
  readonly type: typeof MANUAL_PAGE_TYPE;
  /** The page's address under the manual's base, with its query and hash,
   *  starting with "/" ("/rooms/hotels/"). */
  readonly path: string;
  /** The page's title, for the window's title bar. */
  readonly title: string;
}

/** The game's origin, the only one a manual page on `host` posts to: the
 *  production game for the manual's own host, else the page's own origin
 *  (a build that keeps the manual under /help on the game's host). */
export function gameOriginFor(host: string, ownOrigin: string): string {
  return host === HELP_ADDRESS ? "https://verticopolis.com" : ownOrigin;
}

/** The message for the page at `pathname + search + hash`, under `base` ("" or
 *  "/help"), titled `title`. The " | Verticopolis™ Help" suffix is dropped. */
export function pageMessage(
  location: Pick<Location, "pathname" | "search" | "hash">,
  base: string,
  title: string,
): ManualPageMessage {
  const inside = location.pathname.startsWith(`${base}/`) ? location.pathname.slice(base.length) : location.pathname;
  return {
    type: MANUAL_PAGE_TYPE,
    path: inside + location.search + location.hash,
    title: title.replace(/\s*\|\s*Verticopolis™? Help$/, "").trim() || "Player's Manual",
  };
}

/** The data of a message from the manual when it is a page message, else
 *  null. The caller has already checked who sent it. */
export function readPageMessage(data: unknown): ManualPageMessage | null {
  if (!data || typeof data !== "object") return null;
  const { type, path, title } = data as Record<string, unknown>;
  if (type !== MANUAL_PAGE_TYPE || typeof path !== "string" || typeof title !== "string") return null;
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return { type, path, title: title.slice(0, 200) };
}

/** The click a manual page inside the window follows itself: the address it
 *  replaces the page with, or null for a click the browser keeps (a modified
 *  or middle click, a link to another site or out of the manual, a new tab or
 *  a download). A link to a spot on the same page is replaced too, which
 *  scrolls there without a history entry. */
export function replacedBy(
  event: Pick<MouseEvent, "button" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "defaultPrevented">,
  link: Pick<HTMLAnchorElement, "href" | "target" | "hasAttribute"> | null,
  here: string,
  base: string,
): string | null {
  if (!link || event.defaultPrevented || event.button !== 0) return null;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return null;
  if ((link.target && link.target !== "_self") || link.hasAttribute("download")) return null;
  let to: URL;
  try {
    to = new URL(link.href, here);
  } catch {
    return null;
  }
  if (to.origin !== new URL(here).origin || !to.pathname.startsWith(`${base}/`)) return null;
  return to.href;
}
