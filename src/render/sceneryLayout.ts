import { viewWorld, type ViewWorld } from "../presentation/viewWorld";
import type { Unit } from "../engine/types";
import { FLOOR, TILE } from "./scale";

/**
 * Pure layout for the world outside the tower (the scenery pass): the skyline
 * silhouettes, the fountain-roundabout plaza at the left lot edge, the street
 * on the far side, the grass/apron split along the ground line, and the tree and bush
 * spots on the open lot. Everything here is a pure function of the tower's
 * founding seed (RNG.initialSeed, fixed for the tower's whole life; the live
 * RNG state mutates every roll and must never key visuals) and the built
 * ground floor, so the scenery is deterministic per tower and
 * unit-testable without a canvas; `towerScenery.ts` turns these numbers into
 * actors.
 *
 * Geometry contract (owner-approved mockups, 2026-07-21): the buildable lot
 * (the world's lotWidth tile columns, indices 0 through lotWidth - 1) is untouched
 * canon. All scenery lives OUTSIDE it or
 * on its ground line, and everything draws BEHIND the tower (z order), so no
 * scenery can ever cover a built room.
 */

/** Left edge, walking away from the lot: sidewalk, then the fountain
 *  roundabout (an elliptical drive around a grass island), then the road
 *  running to the dirt's far edge. All in tiles; negative = left of the lot. */
export const PLAZA_SIDEWALK_TILES = 4;
export const ROUNDABOUT_START = -36;
export const ROUNDABOUT_TILES = 32;
export const FOUNTAIN_TILE = -20;
export const PLAZA_LAMP_TILES = [-35, -5] as const;
/** Right-edge strip: paved forecourt, then sidewalk, then the road. */
export const FORECOURT_TILES = 3;
export const SIDEWALK_TILES = 4;
export const ROAD_TILES = 44;
/** The cement apron extends this far past the built ground-floor footprint. */
export const APRON_PAD_TILES = 3;
/** How far past each lot edge the skyline band runs: one full lot width, the
 *  same reach as the dirt ground, so the city ends exactly where the ground
 *  does even zoomed all the way out at a camera edge. */
export function skylineOverscanTiles(world: ViewWorld = viewWorld()): number {
  return world.lotWidth;
}

/** First sidewalk tile, first road tile (both beyond the lot's last column),
 *  from the view's world (the tower catalog's lot width). */
export function sidewalkStart(world: ViewWorld = viewWorld()): number {
  return world.lotWidth + FORECOURT_TILES;
}
export function roadStart(world: ViewWorld = viewWorld()): number {
  return sidewalkStart(world) + SIDEWALK_TILES;
}

/** Deterministic unit-interval hash. Integer bit-mixing only (no trig, no
 *  floating-point transcendentals), so every engine renders identical pixels:
 *  the pinned screenshot container's byte-compare determinism guard depends on
 *  it. Fractional input is truncated; callers pass integer keys. */
export function hash01(n: number): number {
  let h = Math.trunc(n) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface SkylineRect {
  /** Left edge in tiles (may be negative: the band runs past both lot edges). */
  tile: number;
  /** Width in tiles. */
  w: number;
  /** Height in floors. */
  hFloors: number;
  /** 0 = far band (lighter, taller), 1 = near band (darker, lower). */
  depth: 0 | 1;
}

/** One skyline band: a building every `step` tiles from `start` tiles past
 *  the lot's left edge (the overscan), each `base + hash01(seed + t * key) *
 *  span` wide (tiles) and tall (floors). Published in the atlas data so a
 *  frontend with the tower seed rebuilds the same city. */
export interface SkylineBand {
  depth: 0 | 1;
  start: number;
  step: number;
  w: { base: number; span: number; key: number };
  hFloors: { base: number; span: number; key: number };
}

/** Skyline fills, far band then near: translucent, so overlaps deepen. */
export const SKYLINE_FILLS = ["rgba(70, 86, 120, 0.55)", "rgba(52, 66, 96, 0.75)"] as const;

export const SKYLINE_BANDS: readonly SkylineBand[] = [
  { depth: 0, start: 0, step: 16, w: { base: 9, span: 8, key: 1 }, hFloors: { base: 10, span: 26, key: 3 } },
  { depth: 1, start: 5, step: 23, w: { base: 12, span: 10, key: 7 }, hFloors: { base: 5, span: 13, key: 13 } },
];

/** The two-depth skyline band. It runs CONTINUOUSLY across the whole scene,
 *  the tower included: it draws behind everything, so it shows wherever the
 *  built tower does not cover it (owner call: the city is always back there). */
export function skylineRects(seed: number, world: ViewWorld = viewWorld()): SkylineRect[] {
  const rects: SkylineRect[] = [];
  const from = -skylineOverscanTiles(world);
  const to = world.lotWidth + skylineOverscanTiles(world);
  for (const b of SKYLINE_BANDS) {
    for (let t = from + b.start; t < to; t += b.step) {
      const w = b.w.base + hash01(seed + t * b.w.key) * b.w.span;
      rects.push({ tile: t, w, hFloors: b.hFloors.base + hash01(seed + t * b.hFloors.key) * b.hFloors.span, depth: b.depth });
    }
  }
  return rects;
}

export interface PlantSpot {
  tile: number;
  scale: number;
  kind: "tree" | "bush";
}

/** The plant-spot rule, published in the atlas data. A candidate every
 *  `step` tiles from `margin` to `lotWidth - margin` (exclusive); with
 *  `r = hash01(seed * 3 + t)`, the spot is skipped below `skipBelow`, a bush
 *  below `bushBelow` and a tree otherwise. It sits at `t + floor(hash01(seed +
 *  t * jitter.key) * jitter.span) + jitter.min` and is scaled `scale.base +
 *  hash01(seed + t * scale.key) * scale.span`. */
export const PLANT_RULE = {
  margin: 6,
  step: 13,
  skipBelow: 0.42,
  bushBelow: 0.72,
  jitter: { span: 7, min: -3, key: 5 },
  scale: { base: 0.8, span: 0.4, key: 11 },
} as const;

/** Tree and bush spots on the open lot, deterministic per tower seed. Spots
 *  keep clear of both lot edges so nothing crowds the plaza sidewalk or the street. */
export function plantSpots(seed: number, world: ViewWorld = viewWorld()): PlantSpot[] {
  const R = PLANT_RULE;
  const spots: PlantSpot[] = [];
  for (let t = R.margin; t < world.lotWidth - R.margin; t += R.step) {
    const r = hash01(seed * 3 + t);
    if (r < R.skipBelow) continue; // gaps keep the lot from reading as an orchard
    const jitter = Math.floor(hash01(seed + t * R.jitter.key) * R.jitter.span) + R.jitter.min;
    spots.push({
      tile: t + jitter,
      scale: R.scale.base + hash01(seed + t * R.scale.key) * R.scale.span,
      kind: r < R.bushBelow ? "bush" : "tree",
    });
  }
  return spots;
}

/** The cement apron under and around the tower: the built ground-floor
 *  footprint padded by {@link APRON_PAD_TILES}, clamped to the lot. Null when
 *  nothing is built on the ground floor yet (a fresh lot is all grass). */
export function apronRange(units: readonly Unit[]): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const u of units) {
    if (u.floor !== 1) continue;
    if (u.x < min) min = u.x;
    if (u.x + u.width > max) max = u.x + u.width;
  }
  if (min === Infinity) return null;
  return {
    min: Math.max(0, min - APRON_PAD_TILES),
    max: Math.min(viewWorld().lotWidth, max + APRON_PAD_TILES),
  };
}

/** Half a plant's footprint in tiles, for {@link plantVisible}. */
export const PLANT_CLEAR_TILES = 2;

/** Whether a plant is still standing: construction (the apron) displaces it.
 *  A plant needs its whole little footprint outside the paved range. Two tiles
 *  of half-width covers the widest drawn canopy (a max-scale tree spans 3.6
 *  tiles, a max-scale bush 2.4), so no foliage ever overhangs fresh cement. */
export function plantVisible(spot: PlantSpot, apron: { min: number; max: number } | null): boolean {
  if (!apron) return true;
  const half = PLANT_CLEAR_TILES;
  return spot.tile + half <= apron.min || spot.tile - half >= apron.max;
}

/** The dirt under the scene: `lots` lot widths centered on the lot, from the
 *  ground line down {@link groundBelowFloors} floors, and the `lineH`-px
 *  ground line centered on y 0 across the same span. */
export const GROUND = { lots: 3, lineH: 6, dirt: "#3a3326", line: "#6f6a60" } as const;

/** How many floors the dirt runs below the ground line: past the lowest
 *  basement with room to spare. */
export function groundBelowFloors(world: ViewWorld = viewWorld()): number {
  return 2 - world.minFloor + 14;
}

/** Rows of the lot's ground strip above and below the ground line. */
export const STRIP_ABOVE = 7;
export const STRIP_BELOW = 4;

/** A scenery piece's canvas in world px: x from the lot's left edge, y from
 *  the ground line (negative is up), for its top-left corner. */
export interface PieceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PLAZA_LAMP_W = 84;
const PLAZA_LAMP_H = Math.round(FLOOR * 1.6) + 14;
const STREET_LAMP_W = 8 * TILE;
const STREET_LAMP_H = Math.round(FLOOR * 1.8);
const PLANTER_W = 2 * TILE;
const PLANTER_H = 18;

/** Where the game puts each fixed scenery piece in a world (`towerScenery.ts`
 *  builds its actors from these, and the sprite atlas publishes them). */
export function sceneryPieces(world: ViewWorld = viewWorld()) {
  const lot = world.lotWidth;
  const sidewalk = sidewalkStart(world);
  const road = roadStart(world);
  return {
    plazaSidewalk: { x: -PLAZA_SIDEWALK_TILES * TILE, y: -7, w: PLAZA_SIDEWALK_TILES * TILE, h: 11 },
    roundabout: { x: ROUNDABOUT_START * TILE, y: -30, w: ROUNDABOUT_TILES * TILE, h: 48 },
    fountain: { x: FOUNTAIN_TILE * TILE - 50, y: -102, w: 100, h: 112 },
    plazaLamps: PLAZA_LAMP_TILES.map((t) => ({ x: t * TILE - PLAZA_LAMP_W / 2, y: -PLAZA_LAMP_H + 4, w: PLAZA_LAMP_W, h: PLAZA_LAMP_H })),
    /** The road from the scene's left edge to the roundabout (the game cuts it
     *  into texture-safe segments, each 1 px wider to hide seams). */
    leftRoad: { x: -lot * TILE, y: -2, w: (ROUNDABOUT_START + lot) * TILE, h: 14 },
    forecourt: { x: lot * TILE, y: -6, w: FORECOURT_TILES * TILE, h: 10 },
    sidewalk: { x: sidewalk * TILE, y: -7, w: (road - sidewalk) * TILE, h: 11 },
    rightRoad: { x: road * TILE, y: -2, w: ROAD_TILES * TILE, h: 14 },
    streetLamp: { x: Math.round((sidewalk + 1) * TILE - STREET_LAMP_W / 2), y: -STREET_LAMP_H - 7, w: STREET_LAMP_W, h: STREET_LAMP_H },
    planter: { x: Math.round((lot + FORECOURT_TILES / 2) * TILE - PLANTER_W / 2), y: -PLANTER_H - 6, w: PLANTER_W, h: PLANTER_H },
  } satisfies Record<string, PieceRect | PieceRect[]>;
}

/** A plant's size before its spot's scale: tiles wide, floors tall. */
export const PLANT_SIZE = { tree: { tiles: 3, floors: 1.5 }, bush: { tiles: 2, floors: 0.5 } } as const;

/** A lot plant's canvas: a tree is 3 tiles by 1.5 floors and a bush 2 tiles
 *  by half a floor, both scaled by the spot, centered on its tile's left edge
 *  (x may land on a half pixel) and standing on the ground strip: its bottom
 *  edge two rows under the strip's top, so its last row is one row under it. */
export function plantRect(spot: PlantSpot): PieceRect {
  const size = PLANT_SIZE[spot.kind];
  const w = Math.round(size.tiles * TILE * spot.scale);
  const h = Math.round(FLOOR * size.floors * spot.scale);
  return { x: spot.tile * TILE - w / 2, y: -h - STRIP_ABOVE + 2, w, h };
}
