import type { TowerEngine } from "./TowerEngine";

/**
 * Zoom-gated culling of the moving layer (CAP-1 of the mobile render-perf
 * spec, `_bmad-output/specs/spec-render-perf-mobile-zoom/`): people, ambient
 * walkers, elevator cars, the metro train, garbage trucks, and garage cars
 * stop being drawn AND their per-frame update loops are skipped once the
 * camera zooms out past the sub-legible threshold. Friend-module of
 * towerCrowd, which calls {@link applyCrowdCull} at the top of its per-frame
 * passes and {@link reassertCrowdCull} after a structural rebuild.
 */

/** Camera zoom below which the crowd/vehicle layer culls (CAP-1). A person
 *  figure is ~24 world px tall, so under this zoom it renders below ~3 screen
 *  px: sub-legible, pure per-frame cost. Rooms and structure stay drawn at
 *  every zoom; only the moving layer (people, walkers, elevator cars, train,
 *  trucks, garage cars) culls. */
export const CROWD_CULL_ZOOM = 0.125;
/** Re-show at a strictly higher zoom than the hide threshold (hysteresis), so
 *  a pinch sweeping across the boundary never strobes the crowd. */
export const CROWD_SHOW_ZOOM = 0.16;

/** Pure hysteresis step for the crowd cull: hide strictly below
 *  {@link CROWD_CULL_ZOOM}, stay hidden until the zoom climbs back to
 *  {@link CROWD_SHOW_ZOOM} or above (the re-show threshold is inclusive). */
export function crowdCullNext(zoom: number, wasCulled: boolean): boolean {
  return wasCulled ? zoom < CROWD_SHOW_ZOOM : zoom < CROWD_CULL_ZOOM;
}

/** One pass over every crowd/vehicle actor, setting graphics visibility. On
 *  cull it hides the whole moving layer; on re-show it restores the vehicle
 *  groups and the regular per-frame gates (walker rank, truck hour, garage
 *  rush) immediately re-refine on the next {@link updateMotion} pass. */
function setCrowdLayerVisible(engine: TowerEngine, visible: boolean): void {
  for (const c of engine.carActors) c.actor.graphics.visible = visible;
  for (const tr of engine.trainActors) tr.actor.graphics.visible = visible;
  for (const tk of engine.truckActors) tk.actor.graphics.visible = visible;
  for (const g of engine.garageCars) g.actor.graphics.visible = visible;
  for (const w of engine.walkers) w.actor.graphics.visible = visible;
  // The routed people are only ever force-hidden here. On re-show they stay
  // hidden for the moment: the same tick's reconcileCrowd (which runs before
  // the frame draws) shows every live non-rider via positionPerson, keeps
  // riders hidden, and reaps anyone who departed while culled, so a stale
  // figure never flashes at a minutes-old position.
  if (!visible) for (const rec of engine.crowdActors.values()) rec.actor.graphics.visible = false;
}

/** Apply the zoom cull for this frame. Returns true when the moving layer is
 *  culled and the caller should skip its per-frame work entirely. */
export function applyCrowdCull(engine: TowerEngine): boolean {
  const culled = crowdCullNext(engine.cam.zoom, engine.crowdCulled);
  if (culled !== engine.crowdCulled) {
    engine.crowdCulled = culled;
    setCrowdLayerVisible(engine, !culled);
  }
  return culled;
}

/** Re-assert the cull after a structural rebuild: {@link syncMotion} recreates
 *  car/walker/vehicle actors visible, so a rebuild while zoomed out must hide
 *  the fresh layer before it can flash for a frame. */
export function reassertCrowdCull(engine: TowerEngine): void {
  if (engine.crowdCulled) setCrowdLayerVisible(engine, false);
}
