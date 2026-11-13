import type { TowerEngine } from "./TowerEngine";
import { finishLongPress } from "./longPress";

/**
 * How a canvas press ends when the canvas never hears its release (#1014,
 * #824).
 *
 * Excalibur listens on the canvas alone and the game sets no pointer capture,
 * so a mouse let go over a panel, a dialog or another window sends its
 * pointer-up somewhere the tower never sees, and a browser can swallow one
 * outright. Without an end, an extend-arrow drag kept billing against its own
 * mark, a tool press kept its undo step open, and a mouse that came back with
 * the button up went on painting, bulldozing or sizing a shaft. Each of the
 * ways in below ends the press as a cancel: the drag or press closes the step
 * it built so far, and nothing is placed.
 */

/** `PointerEvent.buttons` when no button is held. */
const NO_BUTTONS_HELD = 0;

/** End a live extend-arrow drag, closing its step. Cleared first, so a step
 *  the end closes cannot find the drag still open. */
export function endArrowDrag(engine: TowerEngine): void {
  if (!engine.arrowDrag) return;
  engine.arrowDrag = null;
  engine.onExtendEnd?.();
}

/** End whatever press is open as a cancel: an extend drag closes its step, a
 *  tool press closes its step and places nothing, a pending or showing peek is
 *  dismissed, a pan just stops and never taps. A canvas with no press open is
 *  left as it is. The contacts stay tracked (a pinch reads them). */
export function endPress(engine: TowerEngine): void {
  endArrowDrag(engine);
  if (engine.gesture === "action") engine.onActionCancel?.();
  finishLongPress(engine);
  engine.gesture = null;
}

/** {@link endPress} for a press whose release was lost: every tracked contact
 *  is forgotten with it, since none of them is still down. */
export function cancelPress(engine: TowerEngine): void {
  endPress(engine);
  engine.tracker.reset();
}

/** The DOM event behind a pointer event, as far as these checks read it. */
interface NativePointer {
  pointerType?: unknown;
  buttons?: unknown;
  isPrimary?: unknown;
}

/** A mouse or pen moving with no button held: if it pressed here, its
 *  release went where the canvas never heard it. A touch cannot move without
 *  touching, so it never reads as let go. */
export function movesWithButtonUp(native: unknown): boolean {
  const ev = (native ?? {}) as NativePointer;
  return ev.pointerType !== "touch" && ev.buttons === NO_BUTTONS_HELD;
}

/** A primary press: no other pointer of its kind is down, so any contact
 *  still tracked lost its release (#1014). A second finger is not primary. */
export function isFirstContact(native: unknown): boolean {
  return (native as NativePointer | undefined)?.isPrimary === true;
}
