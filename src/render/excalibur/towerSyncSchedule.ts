import { syncScene, syncFacade } from "./towerReconcile";
import { syncMotion } from "./towerCrowd";
import type { TowerEngine } from "./TowerEngine";

/**
 * Scene-sync scheduling for {@link TowerEngine.tick} (CAP-3 of the mobile
 * render-perf spec, `_bmad-output/specs/spec-render-perf-mobile-zoom/`).
 * The engine's `onHour` scans (satisfaction, traffic income) and the render's
 * full `syncScene` reconcile used to land in the SAME frame whenever the
 * displayed hour changed, stacking into the on-the-hour mega-frame the player
 * feels as a freeze. Hour-driven reconciles (the hour bucket itself and the
 * lighting flip, which is derived from the hour) now defer exactly one frame;
 * structural and meal-overlay reconciles stay same-frame because the player
 * just acted or the sim mid-hour state moved. A pending deferral always drains
 * on the very next call, so no reconcile is ever skipped, and the closures the
 * sync repaints read live state, making the one-frame-later pass render the
 * same pixels it would have.
 */

export interface SyncTriggers {
  /** Tower layout changed (revision moved): rebuild rooms AND motion actors. */
  structural: boolean;
  /** Meal-overlay repaint requested by the sim (mid-hour occupancy dips). */
  mealOverlay: boolean;
  /** The evening/night lighting flag flipped (hour-derived). */
  litChanged: boolean;
  /** The displayed hour bucket changed (shutters, asleep looks, live bits). */
  hourChanged: boolean;
  /** A deferral from the previous frame is waiting to drain. */
  pending: boolean;
}

/** Pure one-step scheduler: decides whether this frame syncs and whether a
 *  deferral carries to the next. Immediate causes (structural, meal overlay,
 *  a pending deferral) win and absorb any hour-driven trigger arriving in the
 *  same frame, because the sync reads live state and covers everything at
 *  once. Hour-driven triggers alone book the sync for the NEXT frame. */
export function planSceneSync(t: SyncTriggers): { syncNow: boolean; nextPending: boolean } {
  if (t.structural || t.mealOverlay || t.pending) return { syncNow: true, nextPending: false };
  if (t.litChanged || t.hourChanged) return { syncNow: false, nextPending: true };
  return { syncNow: false, nextPending: false };
}

/** Per-frame sync step, called from tick(): evaluates the triggers, applies
 *  the plan, and keeps the engine's sync bookkeeping (litState, lastSyncHour,
 *  builtRev, mealOverlayRev) exactly where the inline block kept it. */
export function runSceneSync(engine: TowerEngine): void {
  const structural = engine.sim.tower.revision !== engine.builtRev;
  const plan = planSceneSync({
    structural,
    mealOverlay: engine.sim.tower.mealOverlayRevision !== engine.mealOverlayRev,
    litChanged: engine.d.lit !== engine.litState,
    hourChanged: engine.d.hour !== engine.lastSyncHour,
    pending: engine.hourSyncPending,
  });
  engine.hourSyncPending = plan.nextPending;
  if (plan.syncNow) {
    engine.litState = engine.d.lit;
    engine.lastSyncHour = engine.d.hour;
    syncScene(engine);
    engine.mealOverlayRev = engine.sim.tower.mealOverlayRevision;
  }
  // Motion actors and the exterior facade (escape stairs, roof crane) only
  // need reconciling when the layout itself changes, and never defer: the
  // player just placed or demolished something.
  if (structural) {
    syncMotion(engine);
    syncFacade(engine);
    engine.builtRev = engine.sim.tower.revision;
  }
}
