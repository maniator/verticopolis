import { GRID } from "../engine/facilities";
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
 * (GRID.width tile columns, indices 0 through GRID.width - 1) is untouched
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
const SKYLINE_OVERSCAN_TILES = GRID.width;

/** First sidewalk tile, first road tile (both beyond the lot's last column). */
export const SIDEWALK_START = GRID.width + FORECOURT_TILES;
export const ROAD_START = SIDEWALK_START + SIDEWALK_TILES;

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

/** The two-depth skyline band. It runs CONTINUOUSLY across the whole scene,
 *  the tower included: it draws behind everything, so it shows wherever the
 *  built tower does not cover it (owner call: the city is always back there). */
export function skylineRects(seed: number): SkylineRect[] {
  const rects: SkylineRect[] = [];
  const from = -SKYLINE_OVERSCAN_TILES;
  const to = GRID.width + SKYLINE_OVERSCAN_TILES;
  for (let t = from; t < to; t += 16) {
    const w = 9 + hash01(seed + t) * 8;
    rects.push({ tile: t, w, hFloors: 10 + hash01(seed + t * 3) * 26, depth: 0 });
  }
  for (let t = from + 5; t < to; t += 23) {
    const w = 12 + hash01(seed + t * 7) * 10;
    rects.push({ tile: t, w, hFloors: 5 + hash01(seed + t * 13) * 13, depth: 1 });
  }
  return rects;
}

export interface PlantSpot {
  tile: number;
  scale: number;
  kind: "tree" | "bush";
}

/** Tree and bush spots on the open lot, deterministic per tower seed. Spots
 *  keep clear of both lot edges so nothing crowds the plaza sidewalk or the street. */
export function plantSpots(seed: number): PlantSpot[] {
  const spots: PlantSpot[] = [];
  for (let t = 6; t < GRID.width - 6; t += 13) {
    const r = hash01(seed * 3 + t);
    if (r < 0.42) continue; // gaps keep the lot from reading as an orchard
    const jitter = Math.floor(hash01(seed + t * 5) * 7) - 3;
    spots.push({
      tile: t + jitter,
      scale: 0.8 + hash01(seed + t * 11) * 0.4,
      kind: r < 0.72 ? "bush" : "tree",
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
    max: Math.min(GRID.width, max + APRON_PAD_TILES),
  };
}

/** Whether a plant is still standing: construction (the apron) displaces it.
 *  A plant needs its whole little footprint outside the paved range. Two tiles
 *  of half-width covers the widest drawn canopy (a max-scale tree spans 3.6
 *  tiles, a max-scale bush 2.4), so no foliage ever overhangs fresh cement. */
export function plantVisible(spot: PlantSpot, apron: { min: number; max: number } | null): boolean {
  if (!apron) return true;
  const half = 2;
  return spot.tile + half <= apron.min || spot.tile - half >= apron.max;
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

/** Where the game puts each fixed scenery piece (`towerScenery.ts` builds its
 *  actors from these, and the sprite atlas publishes them). */
export const SCENERY = {
  plazaSidewalk: { x: -PLAZA_SIDEWALK_TILES * TILE, y: -7, w: PLAZA_SIDEWALK_TILES * TILE, h: 11 },
  roundabout: { x: ROUNDABOUT_START * TILE, y: -30, w: ROUNDABOUT_TILES * TILE, h: 48 },
  fountain: { x: FOUNTAIN_TILE * TILE - 50, y: -102, w: 100, h: 112 },
  plazaLamps: PLAZA_LAMP_TILES.map((t) => ({ x: t * TILE - PLAZA_LAMP_W / 2, y: -PLAZA_LAMP_H + 4, w: PLAZA_LAMP_W, h: PLAZA_LAMP_H })),
  /** The road from the scene's left edge to the roundabout (the game cuts it
   *  into texture-safe segments, each 1 px wider to hide seams). */
  leftRoad: { x: -GRID.width * TILE, y: -2, w: (ROUNDABOUT_START + GRID.width) * TILE, h: 14 },
  forecourt: { x: GRID.width * TILE, y: -6, w: FORECOURT_TILES * TILE, h: 10 },
  sidewalk: { x: SIDEWALK_START * TILE, y: -7, w: (ROAD_START - SIDEWALK_START) * TILE, h: 11 },
  rightRoad: { x: ROAD_START * TILE, y: -2, w: ROAD_TILES * TILE, h: 14 },
  streetLamp: { x: Math.round((SIDEWALK_START + 1) * TILE - STREET_LAMP_W / 2), y: -STREET_LAMP_H - 7, w: STREET_LAMP_W, h: STREET_LAMP_H },
  planter: { x: Math.round((GRID.width + FORECOURT_TILES / 2) * TILE - PLANTER_W / 2), y: -PLANTER_H - 6, w: PLANTER_W, h: PLANTER_H },
} satisfies Record<string, PieceRect | PieceRect[]>;

/** A lot plant's canvas: a tree is 3 tiles by 1.5 floors and a bush 2 tiles
 *  by half a floor, both scaled by the spot, centered on its tile and standing
 *  on the ground strip. */
export function plantRect(spot: PlantSpot): PieceRect {
  const tree = spot.kind === "tree";
  const w = Math.round((tree ? 3 : 2) * TILE * spot.scale);
  const h = Math.round((tree ? FLOOR * 1.5 : FLOOR * 0.5) * spot.scale);
  return { x: spot.tile * TILE - w / 2, y: -h - STRIP_ABOVE + 2, w, h };
}
