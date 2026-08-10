import * as ex from "excalibur";
import { ACTOR_NAMES } from "./actorNames";
import { facilityFloors } from "../../engine/facilities";
import { drawUnit } from "../sprites";
import { FLOOR, TILE } from "../scale";
import { regionRect, regionsOf } from "../regionGrid";
import type { Unit } from "../../engine/types";
import type { TowerEngine } from "./TowerEngine";

/**
 * Region composition for settled room units (CAP-2 of the mobile render-perf
 * spec; design and invariants in `region-design.md`). One cached canvas per
 * occupied region draws every settled unit whose footprint intersects it,
 * clipped to the unit rect at integer world offsets, so the room layer costs
 * the GPU a few dozen textures instead of one per unit. Animated rooms (fire,
 * construction) stay private per-unit actors owned by towerReconcile; their
 * region leaves the footprint unpainted, so nothing bakes under the flames.
 *
 * The load-bearing laws (I1-I4): a materialized region repaints in place
 * forever (never reallocates) until it empties or the scene is disposed;
 * repaints drain through a budgeted visible-first queue so no frame ever
 * rasterizes the whole tower (except a fresh canvas's first raster, which is
 * the load path); the draw closure reads live tower state at raster time, so
 * dirty marks coalesce and a drained queue always renders current state.
 * One honesty note on the budget: it bounds repaint FLAGS per frame, not
 * rasterizations. A flagged off-screen region defers its actual raster until
 * it scrolls into view, so a fast pan can raster several at once; per-unit
 * canvases behaved the same way, so this is no worse than what it replaced.
 */

/** Regions repainted per frame from the dirty queue. The upload micro-bench
 *  (spec memlog) showed budget 4 is free at this region size on the software
 *  venue; 2 keeps half that headroom for phone-class GPUs while the 17:00
 *  full-tower flip (~30-70 live regions) still settles in well under two
 *  top-speed sim-minutes. Same-frame exceptions bypass the queue: animated
 *  state transitions (no ghost, no hole) flag their regions directly. */
export const REGION_DRAIN_BUDGET = 2;

export interface RegionRec {
  actor: ex.Actor;
  cv: ex.Canvas;
  /** Settled unit ids whose footprint intersects this region. */
  units: Set<number>;
}

/** The dead-parking "red X" (canon: an unchained space draws no relief), the
 *  same strokes the per-unit bake drew, at the unit's region-relative rect. */
function drawDeadParkingX(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  // Dark under-stroke so the X reads as a SHAPE independent of hue
  // (color-blind cue), then the red X on top.
  for (const [style, wd] of [["#111", 4] as const, ["#C24A3A", 2] as const]) {
    ctx.strokeStyle = style;
    ctx.lineWidth = wd;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 2);
    ctx.lineTo(x + w - 2, y + h - 2);
    ctx.moveTo(x + w - 2, y + 2);
    ctx.lineTo(x + 2, y + h - 2);
    ctx.stroke();
  }
}

/** Materialize a region: an anchor actor at the region's world rect and a
 *  cached canvas whose draw walks the member units LIVE (I3). Fresh canvases
 *  raster once on their first draw, which is how initial load fills the
 *  tower without touching the drain budget. */
function materialize(engine: TowerEngine, key: number): RegionRec {
  const r = regionRect(key);
  const units = new Set<number>();
  const cv = new ex.Canvas({
    width: r.w,
    height: r.h,
    cache: true,
    draw: (ctx) => {
      engine.d.ctx = ctx;
      ctx.clearRect(0, 0, r.w, r.h);
      for (const id of units) {
        const u = engine.sim.tower.getUnit(id);
        if (!u) continue;
        const hgt = facilityFloors(u.kind);
        const w = u.width * TILE;
        const h = hgt * FLOOR;
        const dx = engine.worldX(u.x) - r.x;
        const dy = engine.worldYTop(u.floor, hgt) - r.y;
        // The clip is mandatory, not defensive: private canvases clipped any
        // per-unit overdraw implicitly, a shared canvas does not, and one
        // sprite painting a pixel past its rect would bleed onto a neighbor.
        ctx.save();
        ctx.beginPath();
        ctx.rect(dx, dy, w, h);
        ctx.clip();
        engine.d.parkingDead = engine.deadParking.has(id);
        drawUnit(engine.d, u, dx, dy, w, h);
        if (engine.d.parkingDead) drawDeadParkingX(ctx, dx, dy, w, h);
        ctx.restore();
      }
    },
  });
  const actor = new ex.Actor({ name: ACTOR_NAMES.region, pos: ex.vec(r.x, r.y), width: r.w, height: r.h, anchor: ex.vec(0, 0), z: 0 });
  actor.graphics.use(cv);
  engine.engine.add(actor);
  const rec: RegionRec = { actor, cv, units };
  engine.regions.set(key, rec);
  return rec;
}

/** Ensure the unit is a member of its footprint's regions (idempotent) and
 *  schedule a repaint: queued by default, immediate when `sameFrame` (an
 *  extinguished fire must not leave a one-frame hole). Membership recomputes
 *  from the live footprint on every call: no engine path moves or resizes a
 *  placed unit today, but a footprint that silently outgrew its cached
 *  regions would render a permanent hole, so the four divisions are cheap
 *  insurance (the old per-unit bake kept a width guard for the same reason). */
export function markRegionUnit(engine: TowerEngine, u: Unit, sameFrame = false): void {
  const fresh = regionsOf(u.floor, u.x, u.width, facilityFloors(u.kind));
  const cached = engine.regionUnits.get(u.id);
  let keys = cached;
  if (!keys || keys.length !== fresh.length || keys.some((k, i) => k !== fresh[i])) {
    if (cached) dropRegionUnit(engine, u.id, sameFrame);
    keys = fresh;
    engine.regionUnits.set(u.id, keys);
    for (const k of keys) (engine.regions.get(k) ?? materialize(engine, k)).units.add(u.id);
  }
  for (const k of keys) {
    if (sameFrame) {
      engine.regions.get(k)?.cv.flagDirty();
      engine.regionDirty.delete(k);
    } else engine.regionDirty.add(k);
  }
}

/** Remove a unit from its regions: an emptied region evicts (actor killed,
 *  texture freed); a survivor repaints, immediately when `sameFrame` (a room
 *  catching fire must not keep its baked ghost under the flames). */
export function dropRegionUnit(engine: TowerEngine, id: number, sameFrame = false): void {
  const keys = engine.regionUnits.get(id);
  if (!keys) return;
  engine.regionUnits.delete(id);
  for (const k of keys) {
    const rec = engine.regions.get(k);
    if (!rec) continue;
    rec.units.delete(id);
    if (rec.units.size === 0) {
      rec.actor.kill();
      engine.regions.delete(k);
      engine.regionDirty.delete(k);
    } else if (sameFrame) {
      rec.cv.flagDirty();
      engine.regionDirty.delete(k);
    } else engine.regionDirty.add(k);
  }
}

/** Per-frame drain (I2): repaint at most {@link REGION_DRAIN_BUDGET} dirty
 *  regions, on-screen ones first, so a full-tower invalidation (the 17:00
 *  lit flip) spreads over frames instead of stacking into one. */
export function drainRegions(engine: TowerEngine): void {
  if (engine.regionDirty.size === 0) return;
  const z = engine.cam.zoom;
  const cx = engine.cam.pos.x;
  const cy = engine.cam.pos.y;
  const hw = engine.viewWidth / 2 / z;
  const hh = engine.viewHeight / 2 / z;
  const visible = (k: number): boolean => {
    const r = regionRect(k);
    return r.x < cx + hw && r.x + r.w > cx - hw && r.y < cy + hh && r.y + r.h > cy - hh;
  };
  // Single pass, no sort: take visible regions first, remember the first few
  // offscreen ones as fallback so the budget is always spent when work exists.
  const picks: number[] = [];
  const offscreen: number[] = [];
  for (const k of engine.regionDirty) {
    if (visible(k)) {
      picks.push(k);
      if (picks.length === REGION_DRAIN_BUDGET) break;
    } else if (offscreen.length < REGION_DRAIN_BUDGET) offscreen.push(k);
  }
  for (const k of offscreen) {
    if (picks.length === REGION_DRAIN_BUDGET) break;
    picks.push(k);
  }
  for (const k of picks) {
    engine.regionDirty.delete(k);
    engine.regions.get(k)?.cv.flagDirty();
  }
}

/** Repaint every dirty region NOW: the initial-load exception to I2, called
 *  by runSceneSync right after the boot / save-load bake. Every region there
 *  is freshly materialized and rasters on its first draw regardless, so this
 *  is really a queue clear: it stops the budgeted drain from re-uploading
 *  ~20 frames of already-correct regions after every load. */
export function drainAllRegions(engine: TowerEngine): void {
  for (const k of engine.regionDirty) engine.regions.get(k)?.cv.flagDirty();
  engine.regionDirty.clear();
}

/** Scene teardown (setSim / dispose): kill the region actors and clear every
 *  map, so nothing can repaint against a swapped-out tower. */
export function disposeRegions(engine: TowerEngine): void {
  for (const rec of engine.regions.values()) rec.actor.kill();
  engine.regions.clear();
  engine.regionUnits.clear();
  engine.regionDirty.clear();
  engine.deadParking.clear();
}
