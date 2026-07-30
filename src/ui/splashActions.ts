/**
 * The live title screen's own actions, reachable from outside the overlay.
 *
 * Why this exists: New Tower and Load Tower are the two things a player most
 * obviously wants from a title screen, so an affordance outside it (today the
 * desktop shell's application menu, through `src/game/hostCommands.ts`) has to be
 * able to offer them. But the splash's versions are NOT the in-game ones. Its Load
 * Tower opens the load-only picker and routes a founder through the welcome, and
 * its New Tower carries the dismiss callback that leaves the title screen standing
 * when the player backs out of the confirmation. Calling the in-game paths while
 * the splash is up would hand the player the wrong dialog, and the in-game New
 * Tower would warn about abandoning a tower that does not exist yet.
 *
 * Why a module rather than a method on `OnboardingController`: the controller is at
 * its size ceiling (`src/tests/fileSize.guard.test.ts`), and there is exactly one
 * title screen at a time, so a registry costs nothing in accuracy. The controller
 * publishes here when it mounts and clears when it tears down, both in the same
 * two places that own `splashEl`, so the registry cannot outlive the overlay.
 *
 * Nothing here reads the DOM. `runSplashAction` reports whether it took the
 * command, which is the one decision point callers need: false means no title
 * screen, so take the in-game path.
 */

/** The subset of `SplashHandlers` an outside affordance may run. Deliberately
 *  narrow: Continue and How to Play already have their own routes, and the mute
 *  and install buttons are splash-local chrome. */
export interface LiveSplashActions {
  onNewTower(): void;
  onLoadTower(): void;
}

let live: LiveSplashActions | null = null;

/** Publish (or clear, with null) the mounted title screen's bound handlers.
 *  Called only by `OnboardingController.showSplash` / `teardownSplash`. */
export function setLiveSplashActions(actions: LiveSplashActions | null): void {
  live = actions;
}

/**
 * Run one of the title screen's own actions, reporting whether it ran.
 *
 * False means no title screen is up, so the caller should take its in-game path.
 * A throw from a handler is left to the caller: these are the same functions the
 * splash buttons call, and swallowing here would hide a real failure that a click
 * would have surfaced.
 */
export function runSplashAction(action: "new" | "load"): boolean {
  if (!live) return false;
  if (action === "new") live.onNewTower();
  else live.onLoadTower();
  return true;
}

/** Whether a title screen has published its actions. Exported for tests and for
 *  any caller that needs the question without running anything. */
export function hasLiveSplash(): boolean {
  return live !== null;
}
