/**
 * Standalone pages the game opens in a new tab (How to Play, the release notes,
 * the sprite gallery). The game is still running in the tab that opened them,
 * so their "Back to game" must not load `/`: that would start a second copy of
 * the game beside the first, both able to autosave the same tower. The game
 * marks its links with `?from=game` ({@link fromGameHref}); a page that sees the
 * marker closes its own tab on Back to game instead, and says so when the
 * browser keeps the tab open.
 */

import { isInstalledStandalone } from "./standalone";

/** The query the game adds to a link it opens in a new tab. */
export const FROM_GAME_PARAM = "from";
export const FROM_GAME_VALUE = "game";

/** Where a page remembers, for this tab only, that the game opened it, so a
 *  reload or a move to a sibling page still knows after the query is gone. */
export const FROM_GAME_STORAGE_KEY = "vc.page.fromGame";

/** The key the release notes page used before the pages shared one (#2030),
 *  still read so a tab opened by that build keeps its flag across a reload. */
export const LEGACY_FROM_GAME_STORAGE_KEY = "vc.releaseNotes.fromGame";

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
    const store = storage();
    return [FROM_GAME_STORAGE_KEY, LEGACY_FROM_GAME_STORAGE_KEY].some((key) => store.getItem(key) === FROM_GAME_VALUE);
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

/** The channel a running game answers on, so a page it opened can tell
 *  whether the game is still open anywhere on this origin. */
export const GAME_PRESENCE_CHANNEL = "vc-game-presence";

/** What a page asks on {@link GAME_PRESENCE_CHANNEL}, and what the game says back. */
export const PRESENCE_ASK = "ask";
export const PRESENCE_HERE = "here";

/** How long a page waits for the game to answer before deciding it is gone. */
export const PRESENCE_WAIT_MS = 300;

/** The part of a `BroadcastChannel` the presence check uses. */
export type PresenceChannel = Pick<BroadcastChannel, "postMessage" | "close"> & {
  onmessage: ((ev: MessageEvent) => void) | null;
};

/** A fresh presence channel, or null where the browser has no BroadcastChannel. */
function openPresenceChannel(): PresenceChannel | null {
  return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(GAME_PRESENCE_CHANNEL);
}

/**
 * The game's side of the presence check: answer every ask for as long as this
 * page lives. It costs one idle channel and runs nothing until a page asks.
 */
export function answerGamePresence(open: () => PresenceChannel | null = openPresenceChannel): void {
  const channel = open();
  if (!channel) return;
  channel.onmessage = (ev) => {
    if (ev.data === PRESENCE_ASK) channel.postMessage(PRESENCE_HERE);
  };
}

/**
 * Whether a running game answers within {@link PRESENCE_WAIT_MS}. With no
 * BroadcastChannel there is no way to ask, so the answer is "still open",
 * which keeps the old close-the-tab behavior.
 */
export function gameStillOpen(
  open: () => PresenceChannel | null = openPresenceChannel,
  setTimer: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
): Promise<boolean> {
  const channel = open();
  if (!channel) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer: boolean): void => {
      if (settled) return;
      settled = true;
      channel.onmessage = null;
      channel.close();
      resolve(answer);
    };
    channel.onmessage = (ev) => {
      if (ev.data === PRESENCE_HERE) finish(true);
    };
    setTimer(() => finish(false), PRESENCE_WAIT_MS);
    channel.postMessage(PRESENCE_ASK);
  });
}

/** What "Back to game" needs from the page around it, so tests can stand in. */
export interface BackToGameDeps {
  /** True in an installed app window (the home-screen app on a phone). */
  installed: () => boolean;
  /** Whether the game still answers from another window or tab. */
  stillOpen: () => Promise<boolean>;
}

const liveDeps: BackToGameDeps = { installed: isInstalledStandalone, stillOpen: () => gameStillOpen() };

/**
 * "Back to game" on a page the game opened.
 *
 * In a browser tab the tab tries to close itself, and if the browser refuses
 * (it may once this tab has navigated), it says so and moves focus to the
 * note, which reads it out.
 *
 * In an installed app the page first asks whether the game is still running.
 * An installed app on Android opens the manual in the app's own window, in
 * place of the game, so closing that window closed the whole app, and once
 * the player had moved to another manual page the close was refused and the
 * note wrongly said the game was open elsewhere. When nothing answers, the
 * button loads the game here instead (its tower was saved when the page went
 * away, so the title screen offers Continue). When the game does answer, it
 * is in another window and this one closes as in a browser tab.
 *
 * When the game lives on another host than this page (the manual at
 * help.verticopolis.com), this window is never the app's own: the app opens
 * an address outside its scope in a browser view over itself, and the
 * presence check cannot reach a game on another origin. Loading the game here
 * would start a second copy inside that view, so the page closes it instead,
 * which brings back the app with its game.
 */
export function backToOpenGame(e: MouseEvent, win: Window = window, deps: BackToGameDeps = liveDeps): void {
  e.preventDefault();
  const link = e.currentTarget as HTMLAnchorElement | null;
  const gameHref = link?.href || "/";
  if (!deps.installed() || gameOnAnotherHost(gameHref, win)) {
    closeOrSay(win);
    return;
  }
  void deps.stillOpen().then((open) => {
    if (open) closeOrSay(win);
    else win.location.replace(gameHref);
  });
}

/** True when `gameHref` points at another origin than this page. */
function gameOnAnotherHost(gameHref: string, win: Window): boolean {
  return new URL(gameHref, win.location.href).origin !== win.location.origin;
}

/** Close this tab, or say why it stayed open. */
function closeOrSay(win: Window): void {
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
