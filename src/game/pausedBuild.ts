import type { CatalogRules } from "../catalog/catalogTypes";
import type { GameApp } from "../main";
import type { LogEntry } from "../shared/types";
import { SPEEDS } from "./frameLoop";
import { catalogOf } from "./portAccess";

/**
 * Building while paused (#1936). The 1994 game refuses new construction while
 * its clock is stopped, so Classic does too; Modern lets the player lay out a
 * block at speed 0, a deliberate divergence (PARITY.md). The engine states the
 * rule in its catalog (`rules.buildsWhilePaused`) and has no paused state of
 * its own: pause belongs to the host, so the host's build tools (pointer,
 * touch, keyboard) ask here before they place anything. The engine command
 * path is left alone, so a scene that pauses and builds through the port
 * (`window.game.enginePort`) still runs.
 *
 * Only new placement is refused. Bulldozing, the inspector, elevator and rent
 * edits stay open while paused until evidence from the original says
 * otherwise (#1936, "Scope by evidence").
 */

/** What a refused placement says, as a toast and to a screen reader. */
export const UNPAUSE_TO_BUILD = "Unpause to build.";

/** How long the Play button is highlighted after a refused placement. */
const PLAY_NUDGE_MS = 1800;

/** The class that highlights the Play button (styles.css). */
const PLAY_NUDGE_CLASS = "play-nudge";

/** The Play control: the normal-speed button of the speed bar. */
const PLAY_BUTTON = '#speed button[data-speed="1"]';

/** Whether the mode's rules refuse a new placement now: the game is paused
 *  and the catalog says this mode does not build while paused. */
export function placementRefusedWhilePaused(rules: Pick<CatalogRules, "buildsWhilePaused">, paused: boolean): boolean {
  return paused && !rules.buildsWhilePaused;
}

/** What the refusal reads and does, each read per call. */
export interface PausedBuildDeps {
  /** The live tower's catalog rules (`catalogOf(app).rules`). */
  rules(): Pick<CatalogRules, "buildsWhilePaused">;
  /** Whether the host's clock is stopped (speed 0). */
  paused(): boolean;
  toast(text: string, kind: LogEntry["kind"]): void;
  sfx(name: "error"): void;
  /** Draw the eye to the Play control. */
  nudgePlay(): void;
}

/** Refuse a new placement while paused where the mode says so: play the
 *  error sound, show (and, as an alert toast, announce) {@link UNPAUSE_TO_BUILD},
 *  and highlight Play. Answers true when the placement is refused, so the
 *  caller places nothing. */
export function refusePausedPlacement(deps: PausedBuildDeps): boolean {
  if (!placementRefusedWhilePaused(deps.rules(), deps.paused())) return false;
  deps.sfx("error");
  deps.toast(UNPAUSE_TO_BUILD, "bad");
  deps.nudgePlay();
  return true;
}

let nudgeTimer: number | undefined;

/** Highlight the Play button for a moment. A second refusal while it is lit
 *  restarts the highlight instead of stacking timers. */
export function nudgePlayButton(doc: Document = document): void {
  const play = doc.querySelector<HTMLElement>(PLAY_BUTTON);
  if (!play) return;
  window.clearTimeout(nudgeTimer);
  play.classList.remove(PLAY_NUDGE_CLASS);
  // Reading layout restarts the CSS animation on a repeated refusal.
  void play.offsetWidth;
  play.classList.add(PLAY_NUDGE_CLASS);
  nudgeTimer = window.setTimeout(() => play.classList.remove(PLAY_NUDGE_CLASS), PLAY_NUDGE_MS);
}

type PausedBuildApp = Pick<GameApp, "enginePort" | "reader" | "speed" | "ui" | "audio">;

/** The app's own rule reads: its catalog rules and its speed. */
function appRules(app: PausedBuildApp): Pick<PausedBuildDeps, "rules" | "paused"> {
  return { rules: () => catalogOf(app).rules, paused: () => SPEEDS[app.speed] === 0 };
}

/** Whether the app refuses a new placement now, with no feedback: for a drag
 *  begun while the clock ran whose moves continue after a pause. */
export function appPlacementPaused(app: PausedBuildApp): boolean {
  const r = appRules(app);
  return placementRefusedWhilePaused(r.rules(), r.paused());
}

/** The app's own refusal: its catalog rules, its speed, its toast and sound. */
export function refuseAppPlacementWhilePaused(app: PausedBuildApp): boolean {
  return refusePausedPlacement({
    ...appRules(app),
    toast: (text, kind) => app.ui.toast(text, kind),
    sfx: (name) => app.audio.sfx(name),
    nudgePlay: () => nudgePlayButton(),
  });
}
