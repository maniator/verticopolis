/**
 * The hotel cockroach decal (owner-approved redesign, 2026-07-16), split out of
 * `residential.ts` so the room-draw code has room under the 500-line ceiling
 * without touching this art (mirrors the `residential.looks.ts` pattern).
 * A pure move: the palettes and the three draw helpers are unchanged.
 */

/** Cockroach decal palettes. Chestnut for a full infestation (dark and obvious,
 *  but clearly a roach); warmer amber for the single dirty-room warning. The
 *  pale `rim` keeps them legible over any wall tint. */
export const ROACH_CHESTNUT = { dark: "#2A1A0E", head: "#1E1208", collar: "#6A4A28", rim: "#EFE7D2", sheen: "#7A5230", seam: "#140C05", leg: "#160E05" };
export const ROACH_AMBER = { dark: "#4A331A", head: "#341F0E", collar: "#7A5A30", rim: "#EFE7D2", sheen: "#8A6A3A", seam: "#241608", leg: "#241608" };
export type RoachPalette = typeof ROACH_CHESTNUT;

/** A crisp filled pixel ellipse (integer scanlines, no anti-aliasing). Radii are
 *  floored to 1 so a degenerate call (`ry <= 0`) can never divide by zero into a
 *  NaN rect; every current caller already passes `rx, ry >= 2`. */
function roachOval(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string, alpha = 1): void {
  rx = Math.max(1, rx);
  ry = Math.max(1, ry);
  const prevAlpha = ctx.globalAlpha; // restore the caller's alpha, don't assume 1
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let iy = -ry; iy <= ry; iy++) {
    const t = 1 - (iy * iy) / (ry * ry);
    if (t < 0) continue;
    const hw = Math.round(rx * Math.sqrt(t));
    ctx.fillRect(Math.round(cx - hw), Math.round(cy + iy), hw * 2 + 1, 1);
  }
  ctx.globalAlpha = prevAlpha;
}

/** A crisp pixel line (Bresenham) for legs and antennae. */
function roachLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string): void {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let e = dx - dy;
  ctx.fillStyle = color;
  for (;;) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 > -dy) { e -= dy; x0 += sx; }
    if (e2 < dx) { e += dx; y0 += sy; }
  }
}

/** One cockroach decal, big and unmistakable, drawn crisp and axis-aligned so it
 *  stays pixel art. `fx`/`fy` (each +/-1) flip it for scatter variety; `L` is the
 *  body length in pixels. Ported from the owner-approved redesign preview. */
export function drawRoach(ctx: CanvasRenderingContext2D, cx: number, cy: number, L: number, fx: number, fy: number, pal: RoachPalette): void {
  cx = Math.round(cx);
  cy = Math.round(cy);
  const rx = Math.round(L * 0.34);
  const ry = Math.round(L * 0.5);
  const X = (dx: number): number => cx + fx * dx;
  const Y = (dy: number): number => cy + fy * dy;
  // six legs, splayed out and back
  for (const s of [-1, 1]) for (const ay of [-0.16, 0.08, 0.3]) {
    roachLine(ctx, X(s * rx * 0.65), Y(ay * L), X(s * (rx + L * 0.34)), Y(ay * L + L * 0.16), pal.leg);
  }
  // two antennae sweeping forward from the head
  for (const s of [-1, 1]) roachLine(ctx, X(s), Y(-ry * 0.9), X(s * (rx + L * 0.18)), Y(-ry - L * 0.34), pal.leg);
  // pale rim, then the body, so it separates from any wall color
  roachOval(ctx, cx, Y(ry * 0.06), rx + 1, ry + 1, pal.rim, 0.95);
  roachOval(ctx, cx, Y(ry * 0.06), rx, ry, pal.dark);
  // head shield + a pale collar edge, a domed sheen, and a center wing seam
  roachOval(ctx, cx, Y(-ry * 0.6), Math.round(rx * 0.85), Math.round(ry * 0.34), pal.head);
  ctx.fillStyle = pal.collar;
  ctx.fillRect(cx - Math.round(rx * 0.6), Math.round(Y(-ry * 0.86)), Math.round(rx * 1.2), 1);
  roachOval(ctx, cx, Y(ry * 0.05), Math.max(1, Math.round(rx * 0.3)), Math.round(ry * 0.6), pal.sheen, 0.85);
  ctx.fillStyle = pal.seam;
  ctx.fillRect(cx, cy - Math.round(ry * 0.2), 1, Math.round(ry * 0.95));
}
