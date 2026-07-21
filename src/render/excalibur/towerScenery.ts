import * as ex from "excalibur";
import { GRID } from "../../engine/facilities";
import { FLOOR, TILE } from "../scale";
import {
  ALLEY_TILES,
  FORECOURT_TILES,
  NEIGHBOR_FLOORS,
  NEIGHBOR_TILES,
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
import type { Simulation } from "../../engine/Simulation";
import type { TowerEngine } from "./TowerEngine";

/**
 * The world outside the tower (owner-approved scenery pass, 2026-07-21): a
 * continuous two-depth skyline behind everything, a neighbor building across a
 * narrow alley at the left lot line, a paved forecourt, sidewalk, street lamp,
 * "375 ST" sign and road at the right one, and a living ground line on the lot
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

  // Alley paving between the neighbor's wall and the lot line. Its top edge
  // matches the gray ground line's (y -3), so no sliver of line peeks above.
  addRect(engine, -ALLEY_TILES * TILE, -3, ALLEY_TILES * TILE, 11, Z_EDGE, "#5c5c56");

  // Neighbor building, wall flush against the alley. Height rounds to whole
  // pixels so the canvas raster and the actor's footprint agree exactly.
  {
    const w = NEIGHBOR_TILES * TILE;
    const h = Math.round(NEIGHBOR_FLOORS * FLOOR);
    const parapet = 5;
    const cv = new ex.Canvas({
      width: w,
      height: h + parapet,
      cache: true,
      draw: (ctx) => drawNeighbor(ctx, w, h, parapet),
    });
    const a = new ex.Actor({
      pos: ex.vec((-ALLEY_TILES - NEIGHBOR_TILES) * TILE, -h - parapet),
      width: w,
      height: h + parapet,
      anchor: ex.vec(0, 0),
      z: Z_EDGE,
    });
    a.graphics.use(cv);
    engine.engine.add(a);
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

  // Street lamp with the 375 ST sign, on the sidewalk.
  {
    const w = 8 * TILE;
    const h = Math.round(FLOOR * 1.8);
    const cv = new ex.Canvas({ width: w, height: h, cache: true, draw: (ctx) => drawStreetLamp(ctx, w, h) });
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

function addRect(engine: TowerEngine, x: number, yTop: number, w: number, h: number, z: number, hex: string): void {
  const a = new ex.Actor({ pos: ex.vec(x + w / 2, yTop + h / 2), width: w, height: h, anchor: ex.vec(0.5, 0.5), z, color: ex.Color.fromHex(hex) });
  engine.engine.add(a);
}

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

function drawNeighbor(ctx: CanvasRenderingContext2D, w: number, h: number, parapet: number): void {
  ctx.fillStyle = "#7d7268";
  ctx.fillRect(0, parapet, w, h);
  ctx.fillStyle = "#8d8278";
  ctx.fillRect(0, 0, w, parapet);
  // Corner shading on the alley-facing wall.
  ctx.fillStyle = "#665c52";
  ctx.fillRect(w - 3, parapet, 3, h);
  // Window grid; a deterministic scatter of lit panes reads at any hour.
  const cols = Math.floor(w / (TILE * 2));
  const rows = Math.floor(h / (FLOOR * 0.98));
  for (let f = 0; f < rows; f++) {
    for (let c = 0; c < cols; c++) {
      const wx = TILE * (1 + c * 2);
      const wy = parapet + FLOOR * (0.4 + f * 0.98);
      if (wx + TILE > w - 4) continue;
      ctx.fillStyle = hash01(f * 31 + c * 7) < 0.25 ? "#c8b878" : "#4e463e";
      ctx.fillRect(wx, wy, TILE, FLOOR * 0.4);
    }
  }
}

function drawStreetLamp(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const poleX = Math.round(w * 0.4);
  ctx.fillStyle = "#3a3a42";
  ctx.fillRect(poleX, 0, 2, h);
  ctx.fillRect(poleX, 0, Math.round(TILE * 1.8), 3);
  ctx.fillStyle = "#ffd890";
  ctx.fillRect(poleX + Math.round(TILE * 1.5), 3, 6, 4);
  // The street-name sign: the lot is 375 tiles wide, and the road knows it.
  const sw = Math.round(TILE * 3.4);
  const sh = 10;
  const sy = Math.round(h * 0.42);
  const sx = Math.round(poleX + 1 - sw / 2); // whole-pixel plate, crisp fills
  ctx.fillStyle = "#1e6e3c";
  ctx.fillRect(sx, sy, sw, sh);
  ctx.strokeStyle = "#e8e8e0";
  ctx.lineWidth = 1;
  ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
  ctx.fillStyle = "#f0f0e8";
  ctx.font = "bold 7px monospace";
  ctx.textAlign = "center";
  ctx.fillText("375 ST", poleX + 1, sy + 8);
  ctx.textAlign = "left";
}

function drawPlanter(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#6a6a62";
  ctx.fillRect(0, h - 6, w, 6);
  ctx.fillStyle = "#4a7c36";
  ctx.fillRect(1, h - 12, w - 2, 6);
  ctx.fillStyle = "#568c3e";
  ctx.fillRect(Math.round(w * 0.2), h - 16, Math.round(w * 0.6), 5);
}

function drawTree(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
  const trunkW = Math.max(2, Math.round(w * 0.12));
  const trunkH = Math.round(h * 0.3);
  ctx.fillStyle = "#6d4c2a";
  ctx.fillRect(Math.round(w / 2 - trunkW / 2), h - trunkH, trunkW, trunkH);
  const layers: [number, number, string][] = [
    [1.0, 0.32, "#3e6b2e"],
    [0.78, 0.52, "#4a7c36"],
    [0.5, 0.72, "#568c3e"],
  ];
  layers.forEach(([lw, ly, col], li) => {
    // Integer hash key (hash01 truncates): the layer index, not the fractional
    // layer offset, carries the per-layer variation.
    const jitter = Math.round((hash01(seed + li * 97) - 0.5) * 2);
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(w * (1 - lw) / 2) + jitter, Math.round(h - trunkH - h * ly), Math.round(w * lw), Math.round(h * 0.26));
  });
}

function drawBush(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#4a7c36";
  ctx.fillRect(0, Math.round(h * 0.4), w, Math.ceil(h * 0.6));
  ctx.fillStyle = "#568c3e";
  ctx.fillRect(Math.round(w * 0.16), 0, Math.round(w * 0.68), Math.round(h * 0.5));
}

