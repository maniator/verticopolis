import { TILE } from "../scale";
import { hash01 } from "../sceneryLayout";

/**
 * Pure canvas painters for the outside-world scenery: the plaza's roundabout,
 * fountain, and lamps, the right-edge street lamp and planter, and the lot's
 * trees and bushes, and the ground pieces (sidewalk, road, forecourt and the
 * lot's grass or cement strip). Split from towerScenery.ts (the actor/lifecycle half) at
 * the file-size ceiling; everything here draws into a plain 2D context and
 * holds no state, so the scenery tests drive each painter with a recording
 * spy context.
 */

export function drawRoundabout(ctx: CanvasRenderingContext2D, w: number): void {
  const cx = w / 2;
  const cy = 26;
  // Cement shelf under the whole plaza so no dirt peeks through.
  ctx.fillStyle = "#b0b0a8";
  ctx.fillRect(0, 18, w, 30);
  // Road stub blending the left road into the ring at road height.
  ctx.fillStyle = "#34343c";
  ctx.fillRect(0, 28, 24, 14);
  // The drive: a flattened asphalt ellipse with curbs.
  ctx.fillStyle = "#34343c";
  ctx.beginPath();
  ctx.ellipse(cx, cy, cx - 3, 19, 0, 0, Math.PI * 2);
  ctx.fill();
  // Grass center island.
  ctx.fillStyle = "#5b8a3c";
  ctx.beginPath();
  ctx.ellipse(cx, cy, cx * 0.52, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#d8d8d0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(cx, cy, cx - 3, 19, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, cy, cx * 0.52, 10, 0, 0, Math.PI * 2);
  ctx.stroke();
}

export function drawFountain(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const WATER = "#3fa8e0";
  const WATER_HI = "#9adcf6";
  const STONE = "#a8a8a0";
  const STONE_D = "#82827a";
  // Center jet, pulsing gently, with spray arcs blooming outward on a loop.
  const pulse = Math.sin(t * 2.6) * 3;
  ctx.fillStyle = WATER_HI;
  ctx.fillRect(cx - 2, 6 - pulse, 4, 32 + pulse);
  ctx.lineWidth = 2;
  const cycle = (t * 0.9) % 1;
  for (const k of [0, 0.5]) {
    const ph = (cycle + k) % 1;
    ctx.strokeStyle = "rgba(154, 220, 246, " + (0.9 - ph * 0.8).toFixed(2) + ")";
    ctx.beginPath();
    ctx.ellipse(cx, 38, 8 + ph * 14, 6 + ph * 8, 0, Math.PI, 0);
    ctx.stroke();
  }
  // Upper bowl.
  ctx.fillStyle = STONE;
  ctx.beginPath();
  ctx.ellipse(cx, 42, 18, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = WATER;
  ctx.beginPath();
  ctx.ellipse(cx, 41, 14, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Spill from the upper bowl into the basin, shimmering as it falls.
  const drop = (t * 46) % 8;
  ctx.fillStyle = WATER_HI;
  for (const sx of [cx - 16, cx + 13]) {
    ctx.fillRect(sx, 44, 3, 40);
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.fillRect(sx, 44 + drop, 3, 3);
    ctx.fillRect(sx, 44 + ((drop + 4) % 8) + 16, 3, 3);
    ctx.fillStyle = WATER_HI;
  }
  // Pedestal.
  ctx.fillStyle = STONE_D;
  ctx.fillRect(cx - 5, 44, 10, 44);
  // Basin: a proud stone rim standing off the island, bright water inside.
  ctx.fillStyle = STONE;
  ctx.beginPath();
  ctx.ellipse(cx, h - 20, 44, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = WATER;
  ctx.beginPath();
  ctx.ellipse(cx, h - 22, 38, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  // Sparkle: light dashes drifting across the water, clipped to the basin.
  ctx.fillStyle = WATER_HI;
  const slide = (t * 9) % 22;
  for (let i = -4; i <= 3; i++) {
    const sx = cx - 8 + i * 11 + slide - 11;
    if (sx < cx - 33 || sx + 5 > cx + 33) continue;
    ctx.fillRect(sx, h - 24 + ((i + 4) % 3), 5, 2);
  }
  // Rim front face.
  ctx.fillStyle = STONE_D;
  ctx.beginPath();
  ctx.ellipse(cx, h - 12, 44, 9, 0, Math.PI, 0, true);
  ctx.fill();
}

/** 0 by day, 1 by night, ramping through dusk (18:00-20:00) and dawn
 *  (5:00-7:00). Fed from the sim clock's fractional hour. */
export function lampAlpha(hour: number): number {
  if (hour >= 20 || hour < 5) return 1;
  if (hour >= 18) return (hour - 18) / 2;
  if (hour < 7) return 1 - (hour - 5) / 2;
  return 0;
}

export function drawPlazaLamp(ctx: CanvasRenderingContext2D, w: number, h: number, a: number): void {
  ctx.clearRect(0, 0, w, h);
  const cx = Math.round(w / 2);
  const poleH = h - 14;
  if (a > 0) {
    // Pool of light on the pavement, then the halo around the head.
    ctx.fillStyle = "rgba(255, 214, 140, " + (0.16 * a).toFixed(3) + ")";
    ctx.beginPath();
    ctx.ellipse(cx, h - 7, 38, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 214, 140, " + (0.35 * a).toFixed(3) + ")";
    ctx.beginPath();
    ctx.ellipse(cx, 9, 11, 9, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Pole on a small base.
  ctx.fillStyle = "#3a3a42";
  ctx.fillRect(cx - 1, 10, 2, poleH - 16);
  ctx.fillRect(cx - 4, poleH - 6, 8, 6);
  // The head: warm when lit, a dark fixture by day.
  ctx.fillStyle = a > 0 ? "#ffd890" : "#55555e";
  ctx.fillRect(cx - 3, 4, 6, 8);
  ctx.fillStyle = "#3a3a42";
  ctx.fillRect(cx - 4, 2, 8, 2);
}

export function drawStreetLamp(ctx: CanvasRenderingContext2D, w: number, h: number, a: number): void {
  ctx.clearRect(0, 0, w, h);
  const poleX = Math.round(w * 0.4);
  if (a > 0) {
    ctx.fillStyle = "rgba(255, 214, 140, " + (0.3 * a).toFixed(3) + ")";
    ctx.beginPath();
    ctx.ellipse(poleX + Math.round(TILE * 1.5) + 3, 6, 10, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#3a3a42";
  ctx.fillRect(poleX, 0, 2, h);
  ctx.fillRect(poleX, 0, Math.round(TILE * 1.8), 3);
  ctx.fillStyle = a > 0 ? "#ffd890" : "#55555e";
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

export function drawPlanter(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#6a6a62";
  ctx.fillRect(0, h - 6, w, 6);
  ctx.fillStyle = "#4a7c36";
  ctx.fillRect(1, h - 12, w - 2, 6);
  ctx.fillStyle = "#568c3e";
  ctx.fillRect(Math.round(w * 0.2), h - 16, Math.round(w * 0.6), 5);
}

export function drawTree(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
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

export function drawBush(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#4a7c36";
  ctx.fillRect(0, Math.round(h * 0.4), w, Math.ceil(h * 0.6));
  ctx.fillStyle = "#568c3e";
  ctx.fillRect(Math.round(w * 0.16), 0, Math.round(w * 0.68), Math.round(h * 0.5));
}

/** Cement paving and its joint lines (the forecourt and the tower's apron). */
export const PAVE = "#b0b0a8";
export const PAVE_JOINT = "#8a8a82";

/** A sidewalk run `w` px wide (11 px tall) with an expansion joint every tile. */
export function drawSidewalk(ctx: CanvasRenderingContext2D, w: number): void {
  ctx.fillStyle = "#b4b4aa";
  ctx.fillRect(0, 0, w, 11);
  ctx.fillStyle = "#8e8e86";
  for (let x = 0; x < w; x += TILE) ctx.fillRect(x, 0, 1, 7);
}

/** A road run `w` px wide (14 px tall) with lane dashes every four tiles,
 *  the first starting `phase` px in (a dash may start off the left edge). */
export function drawRoad(ctx: CanvasRenderingContext2D, w: number, phase: number): void {
  const period = TILE * 4;
  ctx.fillStyle = "#34343c";
  ctx.fillRect(0, 0, w, 14);
  ctx.fillStyle = "#c8b040";
  for (let x = phase - period; x < w; x += period) ctx.fillRect(x, 6, TILE, 2);
}

/** The forecourt's cement run `w` px wide (10 px tall), a joint every two tiles. */
export function drawForecourt(ctx: CanvasRenderingContext2D, w: number): void {
  ctx.fillStyle = PAVE;
  ctx.fillRect(0, 0, w, 10);
  ctx.fillStyle = PAVE_JOINT;
  for (let x = 0; x < w; x += TILE * 2) ctx.fillRect(x, 0, 1, 6);
}

/** Rows of the lot's ground strip above and below the ground line. */
export const STRIP_ABOVE = 7;
export const STRIP_BELOW = 4;

/** One tile of the lot's ground strip at `px`: cement (with a joint on every
 *  fourth lot tile) where the tower has paved it, else grass whose shade and
 *  tuft come from the lot tile index. Fills one column past the tile, which
 *  the next tile paints over, so a run of tiles has no seam. */
export function drawStripTile(ctx: CanvasRenderingContext2D, px: number, tile: number, paved: boolean): void {
  if (paved) {
    ctx.fillStyle = PAVE;
    ctx.fillRect(px, STRIP_ABOVE - 5, TILE + 1, 5 + STRIP_BELOW);
    if (tile % 4 === 0) {
      ctx.fillStyle = PAVE_JOINT;
      ctx.fillRect(px, STRIP_ABOVE - 5, 1, 5);
    }
    return;
  }
  const gh = 4; // grass blade height
  const shade = hash01(tile * 17);
  let grass = "#446c2e";
  if (shade < 0.33) grass = "#4e7a34";
  else if (shade < 0.66) grass = "#5b8a3c";
  ctx.fillStyle = grass;
  const wob = hash01(tile * 29) < 0.2 ? 1 : 0;
  ctx.fillRect(px, STRIP_ABOVE - gh - wob, TILE + 1, gh + wob + STRIP_BELOW);
  ctx.fillStyle = "#3c5c28";
  ctx.fillRect(px, STRIP_ABOVE, TILE + 1, STRIP_BELOW);
}
