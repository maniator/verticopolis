import type { Picked, TowerEngine } from "./TowerEngine";

/**
 * Touch long-press ("peek"): the hold timer and its lifecycle, as friend
 * functions taking the engine. A stationary finger held on a facility past
 * {@link LONG_PRESS_MS} raises the inspector card (the touch equivalent of a
 * desktop hover), then the release dismisses it. Split out of towerInputCamera
 * so the pointer file stays focused on gesture routing; the call sites there
 * are one-liners. All state lives on the engine (longPressTimer / longPressFired
 * / downSx / downSy).
 */

/** How long a touch must hold still on a facility before it peeks. Long enough
 *  that a normal tap (well under 200ms) never crosses it, short enough that the
 *  glance feels responsive. Tunable feel. */
const LONG_PRESS_MS = 450;
/** Travel (screen px, Manhattan) from the press origin that cancels a pending
 *  peek: past this the gesture is a drag/pan, not a hold. Matches the touch tap
 *  slop, so the motion that turns a tap into a drag also cancels the peek. */
const LONG_PRESS_SLOP = 14;

/** Arm the hold for a touch press over the given cell/entity. The captured
 *  values are used when the timer fires, so a peek reports the press point, not
 *  wherever a late event lands. No-op off touch or with no peek hook installed. */
export function armLongPress(engine: TowerEngine, tile: number, floor: number, picked: Picked | null, touch: boolean): void {
  clearLongPress(engine);
  if (!touch || !engine.onLongPress) return;
  // Only a real facility peeks. Empty space and bare floor/lobby tiles raise no
  // card, so arming there would latch the peek and swallow the release for no
  // gain (stealing a slow tap-place or tap-bulldoze). Mirrors pickedAt's rule.
  if (!picked || picked.kind === "floor" || picked.kind === "lobby") return;
  engine.longPressTimer = setTimeout(() => {
    engine.longPressTimer = null;
    engine.longPressFired = true;
    // A fired peek owns the gesture to release: drop the classified gesture so a
    // later move neither pans nor re-drives the tool (pointerMove also guards on
    // longPressFired, this keeps the two consistent).
    engine.gesture = null;
    engine.onLongPress?.(tile, floor, picked);
  }, LONG_PRESS_MS);
}

/** Cancel a pending peek timer (a second finger, a drag past slop, or a release
 *  before the knee). Leaves longPressFired alone: a fired peek is torn down by
 *  {@link finishLongPress}, not here. */
export function clearLongPress(engine: TowerEngine): void {
  if (engine.longPressTimer !== null) {
    clearTimeout(engine.longPressTimer);
    engine.longPressTimer = null;
  }
}

/** On a move, cancel a pending peek once the finger travels past the tap slop
 *  from where it landed: it is aiming a tool or panning, not holding to read. */
export function cancelLongPressOnMove(engine: TowerEngine, sx: number, sy: number): void {
  if (engine.longPressTimer === null) return;
  if (Math.abs(sx - engine.downSx) + Math.abs(sy - engine.downSy) >= LONG_PRESS_SLOP) clearLongPress(engine);
}

/** On a release, cancel any pending peek. If a peek already fired, dismiss it
 *  and return true so the caller swallows the tap/action (a glance never places
 *  or opens the editor); onLongPress already cleared the anchors it fired over. */
export function finishLongPress(engine: TowerEngine): boolean {
  clearLongPress(engine);
  if (!engine.longPressFired) return false;
  engine.longPressFired = false;
  engine.onLongPressEnd?.();
  engine.gesture = null;
  return true;
}
