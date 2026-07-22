import * as ex from "excalibur";
import { GRID } from "../../engine/facilities";
import { FLOOR, TILE } from "../scale";
import {
  FORECOURT_TILES,
  FOUNTAIN_TILE,
  PLAZA_LAMP_TILES,
  PLAZA_SIDEWALK_TILES,
  ROUNDABOUT_START,
  ROUNDABOUT_TILES,
  ROAD_START,
  ROAD_TILES,
  SIDEWALK_START,
  apronRange,
  hash01,
  plantSpots,
  plantVisible,
  skylineRects,
  type PlantSpot,
} from "../sceneryLayout";
import { drawBush, drawFountain, drawPlanter, drawPlazaLamp, drawRoundabout, drawStreetLamp, drawTree, lampAlpha } from "./towerSceneryDraw";
import type { Simulation } from "../../engine/Simulation";
import type { TowerEngine } from "./TowerEngine";

/**
 * The world outside the tower (owner-approved scenery pass, 2026-07-21): a
 * continuous two-depth skyline of city-scale towers behind everything, a
 * fountain-roundabout arrival plaza with lamps at the left lot line, a paved
 * forecourt, sidewalk, street lamp, "375 ST" sign and road at the right one,
 * and a living ground line on the lot
 * itself: grass that yields to a cement apron as the tower's ground floor
 * grows, with trees and bushes that stand until construction paves them over.
 *
 * Layering contract: every actor here draws BEHIND the tower (negative z, at
 * or under the ground-line strip), so scenery can never cover a built room.
 * The skyline runs continuously across the whole scene, tower included; it
 * simply shows wherever the building does not.
 *
 * Lifecycle: `syncScenery` rides every scene sync (towerReconcile), building
 * the static world lazily on its first call (engine start runs a sync, so the
 * scenery is up before the first frame) and after that only re-deriving what
 * changed (it is cheap: the apron split, the thin ground-strip repaint, plant
 * visibility). The seed-derived pieces key off `sim.rng.initialSeed`, the
 * founding seed (NOT the live RNG state, which mutates every roll), so each
 * tower gets its own skyline and greenery and keeps it for life: across
 * sessions, saves, and undo. A sim swap (adoptSim, load, undo) is detected by
 * object identity and re-derives the apron even when the incoming tower's
 * revision counter happens to match. Lazy-on-first-sync keeps TowerEngine
 * itself untouched: this module plugs in entirely through the reconcile pass.
 */

interface SceneryRec {
  /** The sim these records were derived from (adoptSim swaps the instance). */
  sim: Simulation | null;
  seed: number;
  /** Seed-derived actors, killed and rebuilt when the founding seed changes. */
  seeded: ex.Actor[];
  plants: { spot: PlantSpot; actor: ex.Actor }[];
  /** The lot's ground strip (grass/apron), repainted in place on build. */
  stripCanvases: ex.Canvas[];
  apron: { min: number; max: number } | null;
  lastRevision: number;
}

const recs = new WeakMap<TowerEngine, SceneryRec>();

// Z order, back to front (sky sits at -60, dirt at -50, ground line at -49):
const Z_SKY_FAR = -56;
const Z_SKY_NEAR = -55;
const Z_STRIP = -48;
const Z_EDGE = -47;
const Z_PLANT = -46;

// Ground strip canvas geometry (world px). The strip straddles the ground
// line: blades rise above it, a soil lip hangs just below.
const STRIP_ABOVE = 7;
const STRIP_BELOW = 4;
const STRIP_MAX_SEG = 1800; // stay under the 2048 mobile texture cap

const PAVE = "#b0b0a8";
const PAVE_JOINT = "#8a8a82";

function makeScenery(engine: TowerEngine): SceneryRec {
  const rec: SceneryRec = {
    sim: null,
    seed: NaN,
    seeded: [],
    plants: [],
    stripCanvases: [],
    apron: null,
    lastRevision: -1,
  };
  recs.set(engine, rec);

  // ---- static pieces (identical for every tower) --------------------------

  // Left edge: sidewalk off the lot line, then a fountain roundabout where
  // arriving traffic turns around, then the road off the scene's left side.
  {
    const w = PLAZA_SIDEWALK_TILES * TILE;
    const cv = new ex.Canvas({
      width: w,
      height: 11,
      cache: true,
      draw: (ctx) => {
        ctx.fillStyle = "#b4b4aa";
        ctx.fillRect(0, 0, w, 11);
        ctx.fillStyle = "#8e8e86";
        for (let x = 0; x < w; x += TILE) ctx.fillRect(x, 0, 1, 7);
      },
    });
    const a = new ex.Actor({ pos: ex.vec(-PLAZA_SIDEWALK_TILES * TILE, -7), width: w, height: 11, anchor: ex.vec(0, 0), z: Z_EDGE });
    a.graphics.use(cv);
    engine.engine.add(a);
  }
  {
    // Roundabout: an elliptical drive around a grassy center island.
    const w = ROUNDABOUT_TILES * TILE;
    const h = 48;
    const cv = new ex.Canvas({ width: w, height: h, cache: true, draw: (ctx) => drawRoundabout(ctx, w) });
    const a = new ex.Actor({ pos: ex.vec(ROUNDABOUT_START * TILE, -30), width: w, height: h, anchor: ex.vec(0, 0), z: Z_EDGE });
    a.graphics.use(cv);
    engine.engine.add(a);
  }
  {
    // The fountain on the island, in front of the ring's back edge. LIVE:
    // cache:false (the sky's pattern) so the water re-rasters each frame from
    // the decorative clock; it freezes with pause and reduced motion, and the
    // stepped clock keeps screenshots deterministic. The canvas is tiny, so
    // the per-frame cost is noise.
    const w = 100;
    const h = 112;
    const cv = new ex.Canvas({ width: w, height: h, cache: false, draw: (ctx) => drawFountain(ctx, w, h, engine.d.anim) });
    const a = new ex.Actor({ pos: ex.vec(FOUNTAIN_TILE * TILE - w / 2, -102), width: w, height: h, anchor: ex.vec(0, 0), z: Z_PLANT });
    a.graphics.use(cv);
    engine.engine.add(a);
  }
  {
    // Plaza lamps flanking the drive. Live like the fountain (cache:false):
    // dark fixtures by day, fading in through dusk to a warm glow with a pool
    // of light on the pavement, keyed to the sim clock so pause and the
    // stepped screenshot clock behave.
    for (const tile of PLAZA_LAMP_TILES) {
      const w = 84;
      const h = Math.round(FLOOR * 1.6) + 14;
      const cv = new ex.Canvas({
        width: w,
        height: h,
        cache: false,
        draw: (ctx) => drawPlazaLamp(ctx, w, h, lampAlpha(engine.sim.clock.minuteOfDay / 60)),
      });
      const a = new ex.Actor({ pos: ex.vec(tile * TILE - w / 2, -h + 4), width: w, height: h, anchor: ex.vec(0, 0), z: Z_PLANT });
      a.graphics.use(cv);
      engine.engine.add(a);
    }
  }
  {
    // Road running from the roundabout to the dirt's left edge, in
    // texture-safe segments (the full run is far past the 2048 cap).
    const from = -GRID.width;
    const to = ROUNDABOUT_START;
    const total = (to - from) * TILE;
    const segments = Math.ceil(total / STRIP_MAX_SEG);
    const segW = Math.ceil(total / segments / TILE) * TILE;
    for (let i = 0; i < segments; i++) {
      const x0 = from * TILE + i * segW;
      const w = Math.min(segW, to * TILE - x0) + 1; // 1px overlap hides seams
      const cv = new ex.Canvas({
        width: w,
        height: 14,
        cache: true,
        draw: (ctx) => {
          ctx.fillStyle = "#34343c";
          ctx.fillRect(0, 0, w, 14);
          ctx.fillStyle = "#c8b040";
          for (let x = 4; x < w; x += TILE * 4) ctx.fillRect(x, 6, TILE, 2);
        },
      });
      const a = new ex.Actor({ pos: ex.vec(x0, -2), width: w, height: 14, anchor: ex.vec(0, 0), z: Z_EDGE });
      a.graphics.use(cv);
      engine.engine.add(a);
    }
  }

  // Forecourt (cement, same finish as the tower apron so it reads as yours).
  {
    const w = FORECOURT_TILES * TILE;
    const cv = new ex.Canvas({
      width: w,
      height: 10,
      cache: true,
      draw: (ctx) => {
        ctx.fillStyle = PAVE;
        ctx.fillRect(0, 0, w, 10);
        ctx.fillStyle = PAVE_JOINT;
        for (let x = 0; x < w; x += TILE * 2) ctx.fillRect(x, 0, 1, 6);
      },
    });
    const a = new ex.Actor({ pos: ex.vec(GRID.width * TILE, -6), width: w, height: 10, anchor: ex.vec(0, 0), z: Z_EDGE });
    a.graphics.use(cv);
    engine.engine.add(a);
  }

  // Sidewalk with expansion joints.
  {
    const w = (ROAD_START - SIDEWALK_START) * TILE;
    const cv = new ex.Canvas({
      width: w,
      height: 11,
      cache: true,
      draw: (ctx) => {
        ctx.fillStyle = "#b4b4aa";
        ctx.fillRect(0, 0, w, 11);
        ctx.fillStyle = "#8e8e86";
        for (let x = 0; x < w; x += TILE) ctx.fillRect(x, 0, 1, 7);
      },
    });
    const a = new ex.Actor({ pos: ex.vec(SIDEWALK_START * TILE, -7), width: w, height: 11, anchor: ex.vec(0, 0), z: Z_EDGE });
    a.graphics.use(cv);
    engine.engine.add(a);
  }

  // The road: asphalt a curb-step below the sidewalk, with lane dashes.
  {
    const w = ROAD_TILES * TILE;
    const cv = new ex.Canvas({
      width: w,
      height: 14,
      cache: true,
      draw: (ctx) => {
        ctx.fillStyle = "#34343c";
        ctx.fillRect(0, 0, w, 14);
        ctx.fillStyle = "#c8b040";
        for (let x = 4; x < w; x += TILE * 4) ctx.fillRect(x, 6, TILE, 2);
      },
    });
    const a = new ex.Actor({ pos: ex.vec(ROAD_START * TILE, -2), width: w, height: 14, anchor: ex.vec(0, 0), z: Z_EDGE });
    a.graphics.use(cv);
    engine.engine.add(a);
  }

  // Street lamp with the 375 ST sign, on the sidewalk. Same live day/night
  // head as the plaza lamps; the sign reads at any hour.
  {
    const w = 8 * TILE;
    const h = Math.round(FLOOR * 1.8);
    const cv = new ex.Canvas({
      width: w,
      height: h,
      cache: false,
      draw: (ctx) => drawStreetLamp(ctx, w, h, lampAlpha(engine.sim.clock.minuteOfDay / 60)),
    });
    const a = new ex.Actor({
      pos: ex.vec(Math.round((SIDEWALK_START + 1) * TILE - w / 2), -h - 7),
      width: w,
      height: h,
      anchor: ex.vec(0, 0),
      z: Z_PLANT,
    });
    a.graphics.use(cv);
    engine.engine.add(a);
  }

  // Planter on the forecourt: a touch of green that survives a full-width lot.
  {
    const w = 2 * TILE;
    const h = 18;
    const cv = new ex.Canvas({ width: w, height: h, cache: true, draw: (ctx) => drawPlanter(ctx, w, h) });
    const a = new ex.Actor({
      pos: ex.vec(Math.round((GRID.width + FORECOURT_TILES / 2) * TILE - w / 2), -h - 6),
      width: w,
      height: h,
      anchor: ex.vec(0, 0),
      z: Z_PLANT,
    });
    a.graphics.use(cv);
    engine.engine.add(a);
  }

  // ---- the lot's ground strip (grass/apron), repainted on build -----------
  {
    const lotW = GRID.width * TILE;
    const segments = Math.ceil(lotW / STRIP_MAX_SEG);
    // Round each segment up to a whole-tile width so the per-tile draw loop
    // never splits a tile across two canvases.
    const segW = Math.ceil(lotW / segments / TILE) * TILE;
    for (let i = 0; i < segments; i++) {
      const x0 = i * segW;
      const w = Math.min(segW, lotW - x0);
      // One extra pixel of width overlaps the next segment (same trick as
      // makeGround) so no hairline seam shows at fractional zoom.
      const cv = new ex.Canvas({
        width: w + 1,
        height: STRIP_ABOVE + STRIP_BELOW,
        cache: true,
        draw: (ctx) => drawStrip(ctx, rec, x0, w),
      });
      const a = new ex.Actor({
        pos: ex.vec(x0, -STRIP_ABOVE),
        width: w + 1,
        height: STRIP_ABOVE + STRIP_BELOW,
        anchor: ex.vec(0, 0),
        z: Z_STRIP,
      });
      a.graphics.use(cv);
      engine.engine.add(a);
      rec.stripCanvases.push(cv);
    }
  }
  return rec;
}

/** Re-derive everything the built tower or the sim identity changes: the
 *  seed-derived skyline and plants (on a founding-seed change), the apron
 *  split, and which plants are still standing. Cheap; rides every scene sync,
 *  and the first call builds the static world (see the lifecycle note above). */
export function syncScenery(engine: TowerEngine): void {
  const rec = recs.get(engine) ?? makeScenery(engine);
  const sim = engine.sim;
  if (sim !== rec.sim) {
    // A swapped sim (adoptSim: new game, load, undo) must re-derive the apron
    // below even when its revision counter happens to equal the old tower's,
    // so the cache-buster mirrors towerScene.setSim's builtRev = -1 pattern.
    rec.sim = sim;
    rec.lastRevision = -1;
    if (sim.rng.initialSeed !== rec.seed) rebuildSeeded(engine, rec, sim.rng.initialSeed);
  }
  if (sim.tower.revision === rec.lastRevision) return;
  rec.lastRevision = sim.tower.revision;
  const apron = apronRange(sim.tower.units);
  const changed = apron?.min !== rec.apron?.min || apron?.max !== rec.apron?.max;
  rec.apron = apron;
  if (changed) {
    for (const cv of rec.stripCanvases) cv.flagDirty();
    for (const p of rec.plants) p.actor.graphics.opacity = plantVisible(p.spot, apron) ? 1 : 0;
  }
}

function rebuildSeeded(engine: TowerEngine, rec: SceneryRec, seed: number): void {
  rec.seed = seed;
  for (const a of rec.seeded) a.kill();
  rec.seeded = [];
  rec.plants = [];

  // Skyline: continuous behind everything, two depths.
  for (const r of skylineRects(seed)) {
    const h = r.hFloors * FLOOR;
    const a = new ex.Actor({
      pos: ex.vec(r.tile * TILE, -h),
      width: r.w * TILE,
      height: h,
      anchor: ex.vec(0, 0),
      z: r.depth === 0 ? Z_SKY_FAR : Z_SKY_NEAR,
      color: r.depth === 0 ? ex.Color.fromRGB(70, 86, 120, 0.55) : ex.Color.fromRGB(52, 66, 96, 0.75),
    });
    engine.engine.add(a);
    rec.seeded.push(a);
  }

  // Plants: one small canvas actor per spot; visibility follows the apron.
  for (const spot of plantSpots(seed)) {
    const tree = spot.kind === "tree";
    const w = Math.round((tree ? 3 : 2) * TILE * spot.scale);
    const h = Math.round((tree ? FLOOR * 1.5 : FLOOR * 0.5) * spot.scale);
    const cv = new ex.Canvas({
      width: w,
      height: h,
      cache: true,
      draw: (ctx) => (tree ? drawTree(ctx, w, h, seed + spot.tile) : drawBush(ctx, w, h)),
    });
    const a = new ex.Actor({
      pos: ex.vec(spot.tile * TILE - w / 2, -h - STRIP_ABOVE + 2),
      width: w,
      height: h,
      anchor: ex.vec(0, 0),
      z: Z_PLANT,
    });
    a.graphics.use(cv);
    engine.engine.add(a);
    rec.seeded.push(a);
    rec.plants.push({ spot, actor: a });
  }
  // A fresh rec must re-apply visibility even if the revision has not moved.
  for (const p of rec.plants) p.actor.graphics.opacity = plantVisible(p.spot, rec.apron) ? 1 : 0;
}

// ---- draw helpers (plain 2D canvas, pixel-crisp fills) ----------------------

function drawStrip(ctx: CanvasRenderingContext2D, rec: SceneryRec, x0: number, w: number): void {
  // The canvas is w+1 wide (segment overlap); clear it all so a repaint from
  // grass to cement leaves no stale blade pixels above the pave line.
  ctx.clearRect(0, 0, w + 1, STRIP_ABOVE + STRIP_BELOW);
  const apron = rec.apron;
  const gh = 4; // grass blade height
  for (let px = 0; px < w; px += TILE) {
    const tile = Math.floor((x0 + px) / TILE);
    const paved = apron !== null && tile >= apron.min && tile < apron.max;
    if (paved) {
      ctx.fillStyle = PAVE;
      ctx.fillRect(px, STRIP_ABOVE - 5, TILE + 1, 5 + STRIP_BELOW);
      if (tile % 4 === 0) {
        ctx.fillStyle = PAVE_JOINT;
        ctx.fillRect(px, STRIP_ABOVE - 5, 1, 5);
      }
    } else {
      const shade = hash01(tile * 17);
      ctx.fillStyle = shade < 0.33 ? "#4e7a34" : shade < 0.66 ? "#5b8a3c" : "#446c2e";
      const wob = hash01(tile * 29) < 0.2 ? 1 : 0;
      ctx.fillRect(px, STRIP_ABOVE - gh - wob, TILE + 1, gh + wob + STRIP_BELOW);
      ctx.fillStyle = "#3c5c28";
      ctx.fillRect(px, STRIP_ABOVE, TILE + 1, STRIP_BELOW);
    }
  }
}
