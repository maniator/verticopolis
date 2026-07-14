import { PAL, shade } from "./common";

/**
 * Dollhouse composition primitives, ported one-to-one from the ratified page-02
 * build script (`pixelart-figma/build-scripts/page-02-offices-residential.build.js`),
 * where each `F(A,x,y,w,h,c,o)` rectangle maps directly to a Canvas 2D fill.
 * These are the pieces the shared `common.ts` set does not already cover
 * (`windowView`, `dado`, `ceilingFixture`, `roomGlow`, `castShadow` live there);
 * the tenant-room routines compose from both. Later food, retail, and lobby
 * specs can reuse these too.
 *
 * Every helper keys only on bake-signature inputs (lit, occupancy), never on
 * per-frame animation, so a static room stays cacheable. Integer pixel
 * coordinates only.
 */

/** One integer-aligned rectangle at an optional alpha, the port of the build
 *  `F`: rounds x and y, clamps width and height to at least 1px, and always
 *  restores `globalAlpha` to 1 so a translucent fill never bleeds into the next
 *  opaque draw (the shared and per-kind helpers assume alpha 1). */
export function fill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  ctx.globalAlpha = 1;
}

/** A beveled furniture box: drop shadow, base fill, lit top and left edges,
 *  shaded bottom and right (build `box`). The shared prop primitive for desks,
 *  tables, sofas, headboards, and cabinets. */
export function bevelBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string): void {
  const x0 = Math.round(x), y0 = Math.round(y), ww = Math.max(1, Math.round(w)), hh = Math.max(1, Math.round(h));
  fill(ctx, x0, y0 + hh, ww, 1, "#000000", 0.18);
  fill(ctx, x0, y0, ww, hh, base);
  fill(ctx, x0, y0, ww, 1, shade(base, 22));
  fill(ctx, x0, y0, 1, hh, shade(base, 12));
  fill(ctx, x0 + ww - 1, y0, 1, hh, shade(base, -16));
  fill(ctx, x0, y0 + hh - 1, ww, 1, shade(base, -22));
}

/** Nested translucent squares: a soft warm lamp glow (build `glow`). Pass
 *  `PAL.glowLit` when the source is active, `PAL.glowDim` when it is not. Never
 *  place a `glowLit` glow adjacent to a `#FFD86A` ready lamp (legibility rule:
 *  the ready lamp keeps its own ink socket ring so it reads as a state cue). */
export function glow(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
  const x = Math.round(cx), y = Math.round(cy);
  const rings: [number, number][] = [[4, 0.1], [3, 0.16], [2, 0.3], [1, 0.6]];
  for (const [s, a] of rings) fill(ctx, x - s, y - s, s * 2, s * 2, color, a);
}

/** Interior wall band: base fill, an upper-wall highlight, faint horizontal
 *  courses, and an optional pinstripe / paper speckle (build `iwall`). */
export function interiorWall(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string, patterned: boolean): void {
  const x0 = Math.round(x), y0 = Math.round(y), ww = Math.max(1, Math.round(w)), hh = Math.max(1, Math.round(h));
  fill(ctx, x0, y0, ww, hh, base);
  fill(ctx, x0, y0, ww, Math.round(hh * 0.45), shade(base, 7));
  for (let py = y0 + 4; py < y0 + hh; py += 6) fill(ctx, x0, py, ww, 1, shade(base, -7), 0.4);
  if (patterned) {
    for (let dx = x0 + 4, i = 0; dx < x0 + ww; dx += 8, i++) {
      for (let dy = y0 + 4 + (i % 2) * 3; dy < y0 + hh - 2; dy += 6) fill(ctx, dx, dy, 1, 1, shade(base, 13), 0.5);
    }
  }
}

/** Crown-molding ceiling cap: a shaded band with a lit lower lip (build `ceil`). */
export function ceilingCap(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, base: string): void {
  const x0 = Math.round(x), y0 = Math.round(y), ww = Math.max(1, Math.round(w));
  fill(ctx, x0, y0, ww, 2, shade(base, -24));
  fill(ctx, x0, y0 + 2, ww, 1, shade(base, 16));
}

/** A row of evenly spaced ceiling downlights that glow warm when `lit`, dim when
 *  not (build `lights`). `lit` is an occupancy or lighting flag from the bake
 *  signature, never animation. */
export function downlights(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, lit: boolean): void {
  const x0 = Math.round(x), y0 = Math.round(y), ww = Math.max(1, Math.round(w));
  const n = Math.max(2, Math.round(ww / 24));
  for (let i = 0; i < n; i++) {
    const lx = Math.round(x0 + (ww * (i + 0.5)) / n);
    fill(ctx, lx - 1, y0, 3, 1, lit ? PAL.glowLit : "#C8BCA0");
    if (lit) glow(ctx, lx, y0 + 2, PAL.glowLit);
  }
}

/** A plank floor: base fill, polished top edge, a shaded seam, a dark base line,
 *  and vertical plank seams (build `pfloor`). `floorY` is the floor line and `h`
 *  the floor-band height. Office passes `PAL.carpetGreen`. */
export function plankFloor(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, h: number, base: string): void {
  const x0 = Math.round(x), fy = Math.round(floorY), ww = Math.max(1, Math.round(w)), hh = Math.max(1, Math.round(h));
  fill(ctx, x0, fy, ww, hh, base);
  fill(ctx, x0, fy, ww, 1, shade(base, 18));
  fill(ctx, x0, fy + 1, ww, 1, shade(base, -8));
  fill(ctx, x0, fy + hh - 1, ww, 1, shade(base, -24));
  for (let px = x0 + 8; px < x0 + ww; px += 14) fill(ctx, px, fy + 1, 1, hh - 2, shade(base, -14));
}

/** A drawn-back curtain down one side of a window (build `curtain`). */
export function curtain(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string): void {
  const x0 = Math.round(x), y0 = Math.round(y), hh = Math.max(1, Math.round(h));
  fill(ctx, x0 - 2, y0 - 1, 3, hh + 2, color);
  fill(ctx, x0 - 2, y0 - 1, 1, hh + 2, shade(color, 18));
}

/** A framed picture on the wall: a beveled walnut frame around a muted subject
 *  with a lit top edge (build `art`). */
export function framedArt(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, pic: string): void {
  const x0 = Math.round(x), y0 = Math.round(y), ww = Math.max(1, Math.round(w)), hh = Math.max(1, Math.round(h));
  bevelBox(ctx, x0, y0, ww, hh, "#7A5A38");
  fill(ctx, x0 + 1, y0 + 1, ww - 2, hh - 2, pic);
  fill(ctx, x0 + 1, y0 + 1, ww - 2, 1, shade(pic, 18));
}
