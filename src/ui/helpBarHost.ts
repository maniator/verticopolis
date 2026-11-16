/**
 * The game's side of the Help bar (#2035, src/ui/helpBarProtocol.ts). It
 * listens on the Help bar channel for the whole session and does nothing
 * until a bar says hello. Then it sends the tower's state once a second for
 * as long as hellos keep coming, and stops ten seconds after the last one.
 *
 * "Keep my tower running" ends the Help pause, so the tower goes back to the
 * speed it had (or slow speed, when it was already paused before Help). "Pause
 * it" holds a Help pause again, which ends, like any Help pause in a new tab,
 * when the player is back on the game tab.
 *
 * Cost: one idle channel; while a bar listens, five reads of the status bar's
 * text and one post a second.
 */

import { ANSWER_FOR_MS, STATUS_EVERY_MS, isBarMessage, openBarChannel, type BarChannel, type GameStatus, type HelpBarHud } from "./helpBarProtocol";

/** What the host needs from the game, so tests can stand in. */
export interface HelpBarHostDeps {
  readonly open?: () => BarChannel | null;
  /** False while no tower is open (the title screen): the game stays quiet
   *  and the bar hides. */
  active(): boolean;
  /** The speed index, 0 paused. */
  getSpeed(): number;
  setSpeed(speed: number): void;
  /** Whether a Help action holds the pause. */
  heldForHelp(): boolean;
  /** End the Help pause, restoring the speed it took. */
  endHelpPause(): void;
  /** Hold a Help pause until the player is back on this tab. */
  pauseForHelp(): void;
  /** Whether this tab is on screen. */
  visible(): boolean;
  /** The status bar's words. */
  hud(): HelpBarHud;
  readonly now?: () => number;
  readonly setInterval?: (fn: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
}

/** The speed "Keep my tower running" starts a tower Help did not pause. */
const SLOW = 1;

export function hostHelpBar(deps: HelpBarHostDeps): void {
  const channel = (deps.open ?? openBarChannel)();
  if (!channel) return;
  const now = deps.now ?? (() => Date.now());
  const every = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const stop = deps.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  let lastHello = 0;
  let ticker: unknown = null;

  const status = (): GameStatus => ({
    game: "status",
    speed: deps.getSpeed(),
    heldForHelp: deps.heldForHelp(),
    visible: deps.visible(),
    hud: deps.hud(),
  });
  const send = (): void => {
    if (now() - lastHello > ANSWER_FOR_MS || !deps.active()) {
      stop(ticker);
      ticker = null;
      return;
    }
    channel.postMessage(status());
  };

  channel.onmessage = (ev) => {
    if (!isBarMessage(ev.data) || !deps.active()) return;
    lastHello = now();
    if (ev.data.bar === "run") {
      deps.endHelpPause();
      if (deps.getSpeed() === 0) deps.setSpeed(SLOW);
    } else if (ev.data.bar === "pause") {
      deps.pauseForHelp();
    }
    // Answer at once, so a press shows its result without waiting a tick.
    channel.postMessage(status());
    if (ticker === null) ticker = every(send, STATUS_EVERY_MS);
  };
}
