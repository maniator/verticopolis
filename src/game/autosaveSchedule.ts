import type { SaveLoad } from "./saveLoad";
import { isEngineStopped, isSplashUp } from "./interactionState";

/**
 * When the game autosaves on its own: every 30 seconds, and when the tab goes to
 * the background. The timer never runs while the first-run splash is up, so an
 * idle first visit cannot persist the throwaway boot sim (which would flip
 * `hasSave()` true for a tower the player never started).
 */

/** The autosave period. */
export const AUTOSAVE_INTERVAL_MS = 30000;

/** Autosave now, unless the first-run splash is up, or the game stopped on its
 *  engine: the tower is no longer the engine's, and the save the message points
 *  back to must stay. The timer, the tab-hide save and every tower swap share
 *  these guards. */
export function autosaveIfLive(saveLoad: Pick<SaveLoad, "autosave">): void {
  if (!isSplashUp() && !isEngineStopped()) void saveLoad.autosave();
}

/** Save when the tab goes to the background, with the same guards as the timer.
 *  The write is synchronous: a hidden tab may be closed or killed before an
 *  asynchronous compression finishes, and the synchronous write also retires
 *  any timer save still in flight. A failure is already reported to analytics
 *  by the silent save, and the player is not toasted over a tab they cannot
 *  see; the next visible tick tells them. */
export function saveOnHide(saveLoad: Pick<SaveLoad, "save">): void {
  if (isSplashUp() || isEngineStopped()) return;
  try {
    saveLoad.save(true);
  } catch {
    /* reported as autosave_failed by the silent save; nothing more to do while hidden */
  }
}

/** Start the periodic autosave, and save once when the tab goes to the
 *  background (#1533): waiting for the next tick could lose up to 30 seconds of
 *  play from a tab that never comes back. */
export function startAutosave(saveLoad: Pick<SaveLoad, "autosave" | "save">): void {
  window.setInterval(() => autosaveIfLive(saveLoad), AUTOSAVE_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveOnHide(saveLoad);
  });
}
