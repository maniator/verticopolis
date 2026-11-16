/**
 * What the game and a Help page it opened say to each other (#2035): the
 * page's Help bar asks for the tower's state and can keep it running or pause
 * it; the game answers about once a second with a mini HUD.
 *
 * They talk over one same-origin BroadcastChannel. Where the manual has its
 * own host (help.verticopolis.com), the page reaches the channel through a
 * small page of the game's host in a hidden frame (src/helpBridge.ts), which
 * passes messages both ways and checks each sender's origin. Both hosts are
 * the same site, so the browser gives the frame the game's own channel.
 *
 * Every message is checked against this shape before anyone acts on it, so a
 * stray or malformed post is dropped. Nothing personal travels: the HUD is
 * the five strings the game's status bar already shows.
 */

/** The channel the game and its Help bars share. */
export const HELP_BAR_CHANNEL = "vc-help-bar";

/** The page sends this every {@link HELLO_EVERY_MS}; the game answers while
 *  hellos keep coming. */
export const HELLO_EVERY_MS = 4000;

/** How long the game keeps answering after the last hello. */
export const ANSWER_FOR_MS = 10_000;

/** How often the game sends its state while a bar listens. */
export const STATUS_EVERY_MS = 1000;

/** How long a bar waits with no word from the game before it hides (the
 *  game tab closed, or a new game took its place). */
export const GONE_AFTER_MS = 3500;

/** What a Help bar asks of the game. */
export type BarRequest = "hello" | "run" | "pause";

const REQUESTS: ReadonlySet<string> = new Set<BarRequest>(["hello", "run", "pause"]);

/** A bar's message: `{ bar: <request> }`. */
export interface BarMessage {
  readonly bar: BarRequest;
}

/** The status bar's own words, as the game shows them. */
export interface HelpBarHud {
  readonly date: string;
  readonly time: string;
  readonly money: string;
  readonly population: string;
  readonly stars: string;
}

/** The game's answer. */
export interface GameStatus {
  readonly game: "status";
  /** The speed index: 0 paused, 1 to 3 running. */
  readonly speed: number;
  /** True while a Help action holds the pause. */
  readonly heldForHelp: boolean;
  /** True while the game's tab is on screen, so a running tower really runs
   *  (a hidden tab gets no animation frames). */
  readonly visible: boolean;
  readonly hud: HelpBarHud;
}

/** The HUD fields, in the order the bar shows them. */
export const HUD_FIELDS = ["date", "time", "money", "population", "stars"] as const satisfies readonly (keyof HelpBarHud)[];

/** The longest HUD string a status may carry; the game's are far shorter. */
const MAX_FIELD = 64;

export function isBarMessage(data: unknown): data is BarMessage {
  return typeof data === "object" && data !== null && REQUESTS.has((data as { bar?: unknown }).bar as string);
}

export function isGameStatus(data: unknown): data is GameStatus {
  if (typeof data !== "object" || data === null) return false;
  const s = data as Partial<Record<keyof GameStatus, unknown>>;
  if (s.game !== "status" || typeof s.heldForHelp !== "boolean" || typeof s.visible !== "boolean") return false;
  if (typeof s.speed !== "number" || !Number.isInteger(s.speed) || s.speed < 0 || s.speed > 3) return false;
  const hud = s.hud as Record<string, unknown> | null | undefined;
  if (typeof hud !== "object" || hud === null) return false;
  return HUD_FIELDS.every((f) => typeof hud[f] === "string" && (hud[f] as string).length <= MAX_FIELD);
}

/** The part of a BroadcastChannel both sides use, so tests can stand in. */
export type BarChannel = Pick<BroadcastChannel, "postMessage" | "close"> & {
  onmessage: ((ev: MessageEvent) => void) | null;
};

/** A fresh Help bar channel, or null where the browser has none. */
export function openBarChannel(): BarChannel | null {
  return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(HELP_BAR_CHANNEL);
}
