import type { GameApp } from "../main";
import { stablePointerId } from "../render/pinchTracker";
import { cancelPress } from "../render/excalibur/pressLifecycle";

/**
 * End a tower press whose release lands off the canvas (#1014, #824).
 *
 * Excalibur hears only the canvas, so a mouse let go over a panel, a dialog,
 * the Map or the page around the game never ends the press it began there,
 * and a window that loses focus mid-press hears no release at all. The page
 * hears both: a release elsewhere from a pointer the canvas still tracks, or
 * a blur, ends that press as a cancel (`cancelPress`). The engine is read at
 * the event, so a renderer rebuilt after a lost context is the one ended.
 */
export function watchLostRelease(app: GameApp, signal?: AbortSignal): void {
  const capture = { capture: true, signal };
  const releasedElsewhere = (e: PointerEvent): void => {
    // A release on the canvas reaches Excalibur, which ends the press itself.
    if (e.target === app.canvas) return;
    const engine = app.engine;
    if (engine?.tracker.tracks(stablePointerId(e.pointerId, e))) cancelPress(engine);
  };
  window.addEventListener("pointerup", releasedElsewhere, capture);
  window.addEventListener("pointercancel", releasedElsewhere, capture);
  window.addEventListener("blur", () => {
    if (app.engine) cancelPress(app.engine);
  }, { signal });
}
