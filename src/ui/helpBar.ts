/**
 * The Help bar on a manual page the game opened (#2035): a slim status bar
 * along the bottom of the page with the tower's date, money, population and
 * stars, whether it is running, and buttons to keep it running, pause it or
 * go back to it. It shows only in a tab the game opened (?from=game,
 * src/ui/fromGame.ts) and only while the game answers, so it is gone when
 * the game tab closes; from a shared link or a search there is no bar.
 *
 * It never claims more than the browser allows: a tab out of sight gets no
 * animation frames, so a running tower whose tab is hidden reads "Your tower
 * will run when you can see it".
 *
 * The game's side is src/ui/helpBarHost.ts; the words they trade are
 * src/ui/helpBarProtocol.ts. Cost: a hello every four seconds, and a few text
 * writes a second while the game answers.
 */

import {
  GONE_AFTER_MS,
  HELLO_EVERY_MS,
  HUD_FIELDS,
  barMessage,
  isBarMessage,
  isGameStatus,
  openBarChannel,
  type BarChannel,
  type BarMessage,
  type BarRequest,
  type GameStatus,
} from "./helpBarProtocol";

/** The page's line to the game. */
export interface GameLink {
  /** Send a request, to the tab named or (a hello with no tab) to every tab. */
  send(request: BarRequest, tab?: string): void;
  /** Set by the bar: called with each status the game sends. */
  onStatus: ((status: GameStatus) => void) | null;
}

/** The path of the game's frame page that relays the channel (src/helpBridge.ts). */
export const BRIDGE_PATH = "/help-bridge.html";

/**
 * A line to the game on `gameOrigin`. On the page's own origin (a /help
 * build) that is the channel itself; on another origin (the manual's own
 * host) it is a hidden frame of the game's bridge page, which passes messages
 * through. Null where the browser has no channel.
 */
export function linkToGame(
  gameOrigin: string,
  win: Window = window,
  open: () => BarChannel | null = openBarChannel,
): GameLink | null {
  if (gameOrigin === win.location.origin) return channelLink(open);
  return bridgeLink(gameOrigin, win);
}

function channelLink(open: () => BarChannel | null): GameLink | null {
  const channel = open();
  if (!channel) return null;
  const link: GameLink = {
    send: (request, tab) => channel.postMessage(barMessage(request, tab)),
    onStatus: null,
  };
  channel.onmessage = (ev) => {
    if (isGameStatus(ev.data)) link.onStatus?.(ev.data);
  };
  return link;
}

function bridgeLink(gameOrigin: string, win: Window): GameLink {
  const doc = win.document;
  const frame = doc.createElement("iframe");
  frame.src = gameOrigin + BRIDGE_PATH;
  frame.hidden = true;
  frame.tabIndex = -1;
  frame.title = "Link to your tower";
  frame.setAttribute("aria-hidden", "true");
  let ready = false;
  const queued: BarMessage[] = [];
  const post = (message: BarMessage) => frame.contentWindow?.postMessage(message, gameOrigin);
  const link: GameLink = {
    send: (request, tab) => {
      const message = barMessage(request, tab);
      if (ready) post(message);
      else if (!queued.some((q) => q.bar === message.bar && q.tab === message.tab)) queued.push(message);
    },
    onStatus: null,
  };
  frame.addEventListener("load", () => {
    ready = true;
    for (const request of queued.splice(0)) post(request);
  });
  win.addEventListener("message", (ev) => {
    if (ev.origin !== gameOrigin || !frame.contentWindow || ev.source !== frame.contentWindow || !isGameStatus(ev.data))
      return;
    link.onStatus?.(ev.data);
  });
  doc.body.appendChild(frame);
  return link;
}

/**
 * The game host's frame page (help-bridge.html): pass a bar's requests from
 * the page that framed it to the channel, and the game's answers back. Only
 * the manual's own origin (`parentOrigin`) is heard or answered, and only
 * from the window that framed this one.
 */
export function bridgeHelpBar(win: Window, parentOrigin: string, open: () => BarChannel | null = openBarChannel): void {
  if (win.parent === win) return;
  const channel = open();
  if (!channel) return;
  win.addEventListener("message", (ev) => {
    if (ev.source !== win.parent || ev.origin !== parentOrigin || !isBarMessage(ev.data)) return;
    channel.postMessage(barMessage(ev.data.bar, ev.data.tab));
  });
  channel.onmessage = (ev) => {
    if (isGameStatus(ev.data)) win.parent.postMessage(ev.data, parentOrigin);
  };
}

/** What the bar says about the tower's state. */
export function stateText(status: Pick<GameStatus, "speed" | "heldForHelp" | "visible">): string {
  if (status.speed === 0) return status.heldForHelp ? "Paused while you read." : "Paused.";
  return status.visible ? "Running." : "Your tower will run when you can see it.";
}

/** What the bar needs from the page around it, so tests can stand in. */
export interface HelpBarDeps {
  readonly link: GameLink;
  /** Back to the game (src/ui/fromGame.ts backToOpenGame). */
  readonly backToGame: (e: MouseEvent) => void;
  /** Count a press: `help_bar_pick` with `run`, `pause` or `back`. */
  readonly track: (pick: "run" | "pause" | "back") => void;
  readonly setInterval?: (fn: () => void, ms: number) => unknown;
  readonly setTimeout?: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

/** The class the page's root takes while the bar shows, so the page's own
 *  end clears the bar (help.css). */
export const BAR_SHOWING_CLASS = "vc-help-bar-showing";

/**
 * Run the bar in `root` (help-site/src/components/HelpBar.astro): say hello
 * now and every few seconds, show the bar on the game's first answer, keep
 * it current, and hide it when the game goes quiet.
 *
 * The bar keeps to the first game tab that answers and names it in every
 * request, so a second tower open in another tab neither shows here nor
 * moves on a press. Once that tab goes quiet the bar hides and lets go, and
 * the next tab to answer (the same tower reloaded, say) takes its place.
 */
export function startHelpBar(root: HTMLElement, deps: HelpBarDeps): void {
  const every = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const later = deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel = deps.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const field = (name: string) => root.querySelector<HTMLElement>(`[data-hud="${name}"]`);
  const state = root.querySelector<HTMLElement>("[data-bar-state]");
  const run = root.querySelector<HTMLButtonElement>('button[data-bar="run"]');
  const pause = root.querySelector<HTMLButtonElement>('button[data-bar="pause"]');
  const back = root.querySelector<HTMLAnchorElement>('a[data-bar="back"]');
  const html = root.ownerDocument.documentElement;
  let gone: unknown = null;
  /** The game tab this bar keeps to, once one has answered. */
  let tab: string | undefined;

  const hide = () => {
    tab = undefined;
    root.hidden = true;
    html.classList.remove(BAR_SHOWING_CLASS);
  };
  const setText = (el: HTMLElement | null, text: string) => {
    // Only on a change, so the state line's live region speaks once per change.
    if (el && el.textContent !== text) el.textContent = text;
  };

  deps.link.onStatus = (status) => {
    if (tab !== undefined && status.tab !== tab) return;
    tab = status.tab;
    cancel(gone);
    gone = later(hide, GONE_AFTER_MS);
    root.hidden = false;
    html.classList.add(BAR_SHOWING_CLASS);
    for (const name of HUD_FIELDS) setText(field(name), status.hud[name]);
    setText(state, stateText(status));
    const running = status.speed > 0;
    // The pressed button goes away; move focus to the one that replaces it,
    // so a keyboard player is not dropped to the top of the page.
    const hadFocus = root.ownerDocument.activeElement;
    if (run) run.hidden = running;
    if (pause) pause.hidden = !running;
    if (hadFocus === run && running) pause?.focus();
    else if (hadFocus === pause && !running) run?.focus();
  };

  // The buttons show only once a tab has answered, so a press always has a
  // tab to name; without one it would be ignored anyway.
  run?.addEventListener("click", () => {
    if (tab === undefined) return;
    deps.track("run");
    deps.link.send("run", tab);
  });
  pause?.addEventListener("click", () => {
    if (tab === undefined) return;
    deps.track("pause");
    deps.link.send("pause", tab);
  });
  back?.addEventListener("click", (e) => {
    deps.track("back");
    deps.backToGame(e);
  });
  deps.link.send("hello");
  every(() => deps.link.send("hello", tab), HELLO_EVERY_MS);
}
