import { shade } from "../common";

/**
 * Shared drawing idioms for the ported utilities-and-service looks.
 * {@link refMap} maps a sprite's reference composition onto the screen rect it
 * is handed.
 *
 * The Figma reference build scripts originally authored each tile against TILE
 * 11 by FLOOR 44. The world then moved to TILE 10 by FLOOR 45 to match the 1994
 * original's 4.5 tiles per floor, which knocked every caller off identity and
 * resampled every rect. The references were re-authored onto 10 by 45 (issue
 * #812), so each caller's `RW`/`RH` is now its true on-screen footprint and the
 * map is the identity again.
 *
 * Keep it that way. Resampling is fine for a surface and bad for a repeated
 * object: {@link Fill} derives a rect's size from its mapped EDGES, which keeps
 * tiling seams closed but makes two identically authored objects render at
 * different sizes depending on where their sub-pixel position lands. That is
 * what {@link refMap}'s second fill, `Fu`, exists to prevent, and it is still
 * the right fill for a repeated object because it holds one size for one
 * authored size at any scale.
 */

/** Paint one reference-space rectangle. Coordinates are in the reference tile
 *  space; the scaler maps them onto the screen rect. */
export type Fill = (rx: number, ry: number, rw: number, rh: number, color: string, alpha?: number) => void;

/** Build a {@link Fill} (plus point mappers for figure anchors) that scales a
 *  reference composition authored at `RW` by `RH` onto the screen rect. Edges
 *  snap to integers so adjacent rectangles tile without seams, and a 1px
 *  reference detail never collapses below 1px. At the canonical bake size
 *  (`w === RW`, `h === RH`) the map is the identity, so the port is pixel-exact.
 *
 *  Returns two fills, and which one a caller wants depends on what it is
 *  painting:
 *
 *  - `F` sizes a rect from its mapped edges, so it always meets its neighbor.
 *    Right for a SURFACE: wall paper, floor bands, backing rects.
 *  - `Fu` sizes a rect from its authored size, rounded once, so every instance
 *    of one authored size renders at one size wherever it sits. Right for a
 *    DISCRETE object: a monitor in a wall of monitors, a bottle in a row. It can
 *    leave a 1px gap against a neighbor, which is why it is not the default. */
export function refMap(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, RW: number, RH: number) {
  const sx = (rx: number): number => x + Math.round((rx * w) / RW);
  const sy = (ry: number): number => y + Math.round((ry * h) / RH);
  const paint = (x0: number, y0: number, pw: number, ph: number, color: string, alpha: number): void => {
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x0, y0, pw, ph);
    if (alpha !== prevAlpha) ctx.globalAlpha = prevAlpha;
  };
  const F: Fill = (rx, ry, rw, rh, color, alpha = 1) => {
    // A zero (or negative) reference-size rect paints nothing, matching the
    // pixel-exact reference F. Only a positive reference size that scales below
    // 1px is floored to 1px below, so seams stay closed without promoting an
    // intentional empty rect (an empty recycling gauge, a ramp foot where the
    // under-ramp void closes) into a stray pixel.
    if (rw <= 0 || rh <= 0) return;
    const x0 = sx(rx);
    const y0 = sy(ry);
    paint(x0, y0, Math.max(1, sx(rx + rw) - x0), Math.max(1, sy(ry + rh) - y0), color, alpha);
  };
  /** Uniform-size fill. Position maps exactly as `F` does; the SIZE comes from
   *  the authored size scaled and rounded on its own, so it cannot vary with the
   *  sub-pixel position of the rect. At identity this rounds to the authored
   *  size, so it is byte-identical to `F`. */
  const Fu: Fill = (rx, ry, rw, rh, color, alpha = 1) => {
    if (rw <= 0 || rh <= 0) return;
    paint(sx(rx), sy(ry), Math.max(1, Math.round((rw * w) / RW)), Math.max(1, Math.round((rh * h) / RH)), color, alpha);
  };
  return { F, Fu, sx, sy };
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
