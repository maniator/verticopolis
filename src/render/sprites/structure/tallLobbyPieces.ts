import type { DrawCtx } from "../common";
import { hash } from "../../pixelSprites/common";
import { skyGlass } from "./lobby";

/**
 * The tall pieces of a tall lobby's open hall (#308): a glazed arched window,
 * a sky lobby's curtain wall of glass, a gilt-framed painting, and globe
 * pendants on long cords. Each is drawn at its real height in the lobby's
 * pixel scale, so the hall gets taller without anything in it stretching.
 */

/** A glazed opening with a gold frame and, when `head` is set, a round
 *  head: dark warm glass with a few city lights after dark, pale sky by day.
 *  A transom bar every story-ish keeps a tall window reading as glazing. */
export function archedWindow(d: DrawCtx, x: number, y: number, w: number, h: number, head: boolean, seed: number): void {
  const { ctx, lit } = d;
  if (w < 3 || h < 6) return;
  ctx.fillStyle = "#C9A24B";
  ctx.fillRect(x, y + (head ? 2 : 0), w, h - (head ? 2 : 0));
  if (head) {
    ctx.fillRect(x + 1, y + 1, w - 2, 1);
    ctx.fillRect(x + 2, y, Math.max(1, w - 4), 1);
  }
  const gx = x + 1;
  const gy = y + (head ? 2 : 1);
  const gw = w - 2;
  const gh = h - (head ? 3 : 2);
  const g = ctx.createLinearGradient(0, gy, 0, gy + gh);
  g.addColorStop(0, lit ? "#2E2C34" : "#B7CCDA");
  g.addColorStop(1, lit ? "#26242C" : "#D3E0E8");
  ctx.fillStyle = g;
  ctx.fillRect(gx, gy, gw, gh);
  if (head) ctx.fillRect(x + 2, y + 1, Math.max(1, w - 4), 1);
  if (lit) {
    ctx.fillStyle = "#B89A62";
    for (let yy = 3; yy < gh - 1; yy += 4) {
      for (let xx = 0; xx < gw; xx += 2) {
        if (hash(seed * 97 + xx * 13 + yy * 5) > 0.8) ctx.fillRect(gx + xx, gy + yy, 1, 1);
      }
    }
  }
  ctx.fillStyle = "rgba(138,116,48,0.8)"; // mullion and transom bars
  if (gw >= 4) ctx.fillRect(gx + (gw >> 1), gy, 1, gh);
  for (let ty = 12; ty < gh - 4; ty += 12) ctx.fillRect(gx, gy + ty, gw, 1);
}

/** A sky lobby's curtain wall: the one-story skyline glass run the hall's
 *  full height, with a transom every fifteen rows so it reads as one tall
 *  pane of glazing, not a stack of windows. */
export function hallGlass(d: DrawCtx, x: number, y: number, w: number, h: number, seed: number): void {
  const { ctx, lit } = d;
  skyGlass(ctx, x, y, w, h, lit, seed);
  ctx.fillStyle = "rgba(70,74,92,0.5)";
  for (let ty = 15; ty < h - 4; ty += 15) ctx.fillRect(x, y + ty, w, 1);
}

/** A gilt-framed oil painting hung high on the ground lobby's wall. */
export function painting(ctx: CanvasRenderingContext2D, cx: number, y: number): void {
  ctx.fillStyle = "#C9A24B";
  ctx.fillRect(cx - 3, y, 7, 9);
  ctx.fillStyle = "#6E8A6A"; // a landscape: sky, hills, a field
  ctx.fillRect(cx - 2, y + 1, 5, 7);
  ctx.fillStyle = "#A9BFC8";
  ctx.fillRect(cx - 2, y + 1, 5, 3);
  ctx.fillStyle = "#8E7A4E";
  ctx.fillRect(cx - 2, y + 6, 5, 2);
}

/** Three small globe pendants on cords of different lengths, hung from the
 *  hall's ceiling at `top` down toward `bottom`. */
export function globePendants(d: DrawCtx, cx: number, top: number, bottom: number): void {
  const { ctx, lit } = d;
  const span = bottom - top;
  if (span < 10) return;
  for (const [dx, drop] of [[-3, 0.6], [0, 0.85], [3, 0.7]] as const) {
    const gy = top + Math.round(span * drop);
    ctx.fillStyle = "#5A5448";
    ctx.fillRect(cx + dx, top, 1, gy - top);
    ctx.fillStyle = lit ? "#FBE7B8" : "#E8E2D2";
    ctx.fillRect(cx + dx - 1, gy, 3, 2);
    ctx.fillStyle = lit ? "#FFF4D6" : "#FFFFFF";
    ctx.fillRect(cx + dx, gy, 1, 1);
    if (lit) {
      ctx.fillStyle = "rgba(248,226,180,0.22)";
      ctx.fillRect(cx + dx - 2, gy - 1, 5, 4);
    }
  }
}
