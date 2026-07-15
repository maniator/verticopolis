import { syncScene, syncFacade } from "./towerReconcile";
import { syncMotion } from "./towerCrowd";
import type { TowerEngine } from "./TowerEngine";

/**
 * Scene-sync scheduling for {@link TowerEngine.tick} (CAP-3 of the mobile
 * render-perf spec, `_bmad-output/specs/spec-render-perf-mobile-zoom/`). The
 * goal: the engine's `onHour` scans (satisfaction, traffic income) and the
 * render's full `syncScene` reconcile never share a frame. They used to meet
 * two ways: the meal-overlay trigger ran the full reconcile walk in the very
 * frame whose onUpdate crossed an hour (top-speed meal windows bump it every
 * sim minute), and the hour-triggered reconcile landed in the frame right
 * after the scans, back to back under throttle. Now hour-driven repaints (the
 * hour bucket and the hour-derived lighting flip) defer one frame and drain
 * at the START of the next, before its sim advance, and meal repaints dodge
 * hour-crossing frames the same way. A pending deferral always drains on the
 * very next frame, so no reconcile is ever skipped, and the sync repaints
 * from live state, so the one-frame-later pass renders the same pixels. The
 * residual: when EVERY frame crosses an hour (deep catch-up), scans run every
 * frame and the drain halves the sync cadence instead of separating them;
 * separating those needs the engine-side onHour amortization, a recorded
 * spec non-goal.
 */

/** The display-lighting flag, shared by tick() and the boot bake in start()
 *  so the two derivations can never drift (a drift shows one wrong-lighting
 *  frame at boot now that the hour resync defers). */
export function displayLit(clock: { isNight(): boolean; isEvening(): boolean }): boolean {
  return clock.isNight() || clock.isEvening();
}

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
  /** The live sim clock crossed an hour inside THIS frame's onUpdate (its
   *  onHour scans just ran; the displayed hour still lags the live clock). */
  simCrossedHour: boolean;
}

/** Pure one-step scheduler: decides whether this frame syncs and whether a
 *  deferral carries to the next. Structural changes and a pending deferral
 *  sync now and absorb any other trigger arriving in the same frame, because
 *  the sync reads live state and covers everything at once. A meal-overlay
 *  bump syncs now too, UNLESS this frame's sim advance crossed an hour: the
 *  hourly scans just ran, so the repaint books for the next frame's drain
 *  instead of stacking with them. Hour-driven triggers alone always book. */
export function planSceneSync(t: SyncTriggers): { syncNow: boolean; nextPending: boolean } {
  if (t.structural || t.pending || (t.mealOverlay && !t.simCrossedHour)) {
    return { syncNow: true, nextPending: false };
  }
  if (t.litChanged || t.hourChanged || t.mealOverlay) return { syncNow: false, nextPending: true };
  return { syncNow: false, nextPending: false };
}

/** The sync itself plus the bookkeeping that marks it done, shared by the
 *  frame-start drain and the post-update evaluation. */
function applySceneSync(engine: TowerEngine): void {
  engine.litState = engine.d.lit;
  engine.lastSyncHour = engine.d.hour;
  syncScene(engine);
  engine.mealOverlayRev = engine.sim.tower.mealOverlayRevision;
}

/** Frame-start drain, called from tick() BEFORE the controller advances the
 *  sim (onUpdate). A deferral booked last frame must repaint before this
 *  frame's sim advance: a throttled catch-up frame can cross the NEXT hour
 *  inside onUpdate, and draining afterward would re-stack the deferred
 *  reconcile with that hour's engine scans, the exact pileup the deferral
 *  exists to prevent. */
export function drainSceneSync(engine: TowerEngine): void {
  if (!engine.hourSyncPending) return;
  engine.hourSyncPending = false;
  applySceneSync(engine);
}

/** Post-update sync step, called from tick() after the sim advanced:
 *  evaluates the triggers, applies the plan, and keeps the engine's sync
 *  bookkeeping (litState, lastSyncHour, builtRev, mealOverlayRev) exactly
 *  where the old inline block kept it. The pending branch normally never
 *  fires here (drainSceneSync ran at frame start); it stays so a drain that
 *  could not run, whatever the reason, still syncs rather than skips. */
export function runSceneSync(engine: TowerEngine): void {
  const structural = engine.sim.tower.revision !== engine.builtRev;
  const plan = planSceneSync({
    structural,
    mealOverlay: engine.sim.tower.mealOverlayRevision !== engine.mealOverlayRev,
    litChanged: engine.d.lit !== engine.litState,
    hourChanged: engine.d.hour !== engine.lastSyncHour,
    pending: engine.hourSyncPending,
    // d.hour was sampled before onUpdate advanced the sim, so a mismatch with
    // the live clock means the hourly scans ran inside THIS frame.
    simCrossedHour: engine.sim.clock.hour !== engine.d.hour,
  });
  engine.hourSyncPending = plan.nextPending;
  if (plan.syncNow) applySceneSync(engine);
  // Motion actors and the exterior facade (escape stairs, roof crane) only
  // need reconciling when the layout itself changes, and never defer: the
  // player just placed or demolished something.
  if (structural) {
    syncMotion(engine);
    syncFacade(engine);
    engine.builtRev = engine.sim.tower.revision;
  }
}
