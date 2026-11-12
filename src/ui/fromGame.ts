/**
 * Standalone pages the game opens in a new tab (How to Play, the release notes,
 * the sprite gallery). The game is still running in the tab that opened them,
 * so their "Back to game" must not load `/`: that would start a second copy of
 * the game beside the first, both able to autosave the same tower. The game
 * marks its links with `?from=game` ({@link fromGameHref}); a page that sees the
 * marker closes its own tab on Back to game instead, and says so when the
 * browser keeps the tab open.
 */

/** The query the game adds to a link it opens in a new tab. */
export const FROM_GAME_PARAM = "from";
export const FROM_GAME_VALUE = "game";

/** Where a page remembers, for this tab only, that the game opened it, so a
 *  reload or a move to a sibling page still knows after the query is gone. */
export const FROM_GAME_STORAGE_KEY = "vc.page.fromGame";

/** `href` (a same-origin path, with or without a `#fragment`) marked as opened
 *  by the running game. */
export function fromGameHref(href: string): string {
  const hashAt = href.indexOf("#");
  const path = hashAt < 0 ? href : href.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : href.slice(hashAt);
  const marker = `${FROM_GAME_PARAM}=${FROM_GAME_VALUE}`;
  return `${path}${path.includes("?") ? "&" : "?"}${marker}${hash}`;
}

/** True when `search` carries the game's marker. */
export function openedFromGame(search: string): boolean {
  return new URLSearchParams(search).get(FROM_GAME_PARAM) === FROM_GAME_VALUE;
}

/**
 * Reads the game-opened flag once at load and takes `?from=game` out of the
 * address bar, so a bookmarked, copied or shared URL never carries it into a
 * tab with no game behind it. The flag lives on in this tab's sessionStorage
 * (when the browser allows it) so a reload, or a sibling page reached from
 * this one, keeps the closing behavior.
 */
export function takeFromGameFlag(
  loc: Pick<Location, "pathname" | "search" | "hash">,
  hist: Pick<History, "replaceState">,
  storage: () => Storage = () => sessionStorage,
): boolean {
  if (openedFromGame(loc.search)) {
    const rest = new URLSearchParams(loc.search);
    rest.delete(FROM_GAME_PARAM);
    const query = rest.toString();
    hist.replaceState(null, "", `${loc.pathname}${query ? `?${query}` : ""}${loc.hash}`);
    try {
      storage().setItem(FROM_GAME_STORAGE_KEY, FROM_GAME_VALUE);
    } catch {
      // Storage blocked: this load still knows; a reload falls back to the plain link.
    }
    return true;
  }
  try {
    return storage().getItem(FROM_GAME_STORAGE_KEY) === FROM_GAME_VALUE;
  } catch {
    return false;
  }
}

/** The id of the note "Back to game" fills when the browser keeps the tab open. */
export const BACK_NOTE_ID = "back-note";

/** What that note says. */
export const CLOSE_TAB_NOTE = "Your tower is still open in its own tab. Close this tab to get back to it.";

/** How long to wait for a `window.close()` to take effect before saying the
 *  browser refused it. */
const CLOSE_GRACE_MS = 250;

/**
 * "Back to game" on a page the game opened: the tab tries to close itself,
 * and if the browser refuses (it may once this tab has navigated), it says so
 * and moves focus to the note, which reads it out.
 */
export function backToOpenGame(e: MouseEvent, win: Window = window): void {
  e.preventDefault();
  win.close();
  win.setTimeout(() => {
    if (win.closed) return;
    const note = win.document.getElementById(BACK_NOTE_ID);
    if (!note) return;
    note.textContent = CLOSE_TAB_NOTE;
    note.hidden = false;
    note.focus();
  }, CLOSE_GRACE_MS);
}
