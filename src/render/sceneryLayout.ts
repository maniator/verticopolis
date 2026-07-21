import { GRID } from "../engine/facilities";
import type { Unit } from "../engine/types";

/**
 * Pure layout for the world outside the tower (the scenery pass): the skyline
 * silhouettes, the neighbor building across the alley, the street on the far
 * side, the grass/apron split along the ground line, and the tree and bush
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

/** Tiles of breathing room between the lot line and the neighbor's wall. */
export const ALLEY_TILES = 3;
/** The neighbor building's facade width and height, in tiles and floors. */
export const NEIGHBOR_TILES = 26;
export const NEIGHBOR_FLOORS = 6.4;
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
  for (let t = from; t < to; t += 7) {
    const w = 4 + hash01(seed + t) * 5;
    rects.push({ tile: t, w, hFloors: 2.6 * (0.5 + hash01(seed + t * 3) * 0.5), depth: 0 });
  }
  for (let t = from + 3; t < to; t += 11) {
    const w = 5 + hash01(seed + t * 7) * 6;
    rects.push({ tile: t, w, hFloors: 1.55 * (0.5 + hash01(seed + t * 13) * 0.5), depth: 1 });
  }
  return rects;
}

export interface PlantSpot {
  tile: number;
  scale: number;
  kind: "tree" | "bush";
}

/** Tree and bush spots on the open lot, deterministic per tower seed. Spots
 *  keep clear of both lot edges so nothing crowds the alley or the sidewalk. */
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
