import { shade } from "../common";

/**
 * Shared drawing idioms for the ported utilities-and-service looks. The Figma
 * reference build scripts author each tile at the canonical footprint
 * (TILE 11 by FLOOR 44); {@link refMap} maps that reference space onto the
 * actual screen rect so a bake is pixel-exact (scale 1) and any other rect fills
 * gracefully. Every rectangle snaps to integer edges.
 */

/** Paint one reference-space rectangle. Coordinates are in the reference tile
 *  space; the scaler maps them onto the screen rect. */
export type Fill = (rx: number, ry: number, rw: number, rh: number, color: string, alpha?: number) => void;

/** Build a {@link Fill} (plus point mappers for figure anchors) that scales a
 *  reference composition authored at `RW` by `RH` onto the screen rect. Edges
 *  snap to integers so adjacent rectangles tile without seams, and a 1px
 *  reference detail never collapses below 1px. At the canonical bake size
 *  (`w === RW`, `h === RH`) the map is the identity, so the port is pixel-exact. */
export function refMap(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, RW: number, RH: number) {
  const sx = (rx: number): number => x + Math.round((rx * w) / RW);
  const sy = (ry: number): number => y + Math.round((ry * h) / RH);
  const F: Fill = (rx, ry, rw, rh, color, alpha = 1) => {
    // A zero (or negative) reference-size rect paints nothing, matching the
    // pixel-exact reference F. Only a positive reference size that scales below
    // 1px is floored to 1px below, so seams stay closed without promoting an
    // intentional empty rect (an empty recycling gauge, a ramp foot where the
    // under-ramp void closes) into a stray pixel.
    if (rw <= 0 || rh <= 0) return;
    const x0 = sx(rx);
    const y0 = sy(ry);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x0, y0, Math.max(1, sx(rx + rw) - x0), Math.max(1, sy(ry + rh) - y0));
    if (alpha !== 1) ctx.globalAlpha = 1;
  };
  return { F, sx, sy };
}

/** A beveled box: drop shadow, fill, lit top and left, shaded right and bottom. */
export function box(f: Fill, x: number, y: number, w: number, h: number, b: string): void {
  f(x, y + h, w, 1, "#000000", 0.18);
  f(x, y, w, h, b);
  f(x, y, w, 1, shade(b, 22));
  f(x, y, 1, h, shade(b, 12));
  f(x + w - 1, y, 1, h, shade(b, -16));
  f(x, y + h - 1, w, 1, shade(b, -22));
}

const GLOW_RINGS: ReadonlyArray<readonly [number, number]> = [
  [5, 0.08],
  [4, 0.12],
  [3, 0.18],
  [2, 0.3],
  [1, 0.6],
];

/** A soft radial lamp bloom, drawn as nested translucent squares. */
export function glow(f: Fill, cx: number, cy: number, color: string): void {
  for (const [s, a] of GLOW_RINGS) f(cx - s, cy - s, s * 2, s * 2, color, a);
}

/** A wall panel: base fill, lit top rail, shaded skirting, optional tile seams. */
export function wallp(f: Fill, x: number, y: number, w: number, h: number, b: string, seam: boolean): void {
  f(x, y, w, h, b);
  f(x, y, w, 1, shade(b, 14));
  f(x, y + h - 2, w, 2, shade(b, -12));
  if (seam) {
    for (let px = x + 8; px < x + w; px += 12) f(px, y + 2, 1, h - 4, shade(b, -10));
    for (let py = y + 8; py < y + h - 4; py += 8) f(x, py, w, 1, shade(b, -8));
  }
}

/** A floor band: base fill, polished top edge, seam, shaded base. */
export function floorb(f: Fill, x: number, fy: number, w: number, h: number, b: string): void {
  f(x, fy, w, h, b);
  f(x, fy, w, 1, shade(b, 18));
  f(x, fy + 1, w, 1, shade(b, -8));
  f(x, fy + h - 1, w, 1, shade(b, -24));
}

/** The white-coat overlay for medical staff: a coat panel over the lower torso
 *  of a standing figure, matching the finalized standing build's geometry
 *  (torso occupies footY-13..footY-4; the coat covers its lower 5px). `x` must
 *  be the same integer anchor passed to `personStanding`. */
export function whiteCoat(ctx: CanvasRenderingContext2D, x: number, footY: number): void {
  const x0 = Math.round(x);
  const f = Math.round(footY);
  ctx.fillStyle = "#F4F0EC";
  ctx.fillRect(x0, f - 9, 6, 5);
  ctx.fillStyle = "#D8D4CC";
  ctx.fillRect(x0, f - 9, 1, 5);
}
