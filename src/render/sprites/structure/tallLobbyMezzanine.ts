import type { DrawCtx } from "../common";
import { hash } from "../../pixelSprites/common";

/**
 * The upper stories of a tall lobby (#308) share one piece: a mezzanine
 * gallery, a balcony slab with a railing at its foot, so each extra story
 * reads as a floor people could stand on, at the same scale as the lobby
 * below it. The ground lobby's railing is a cream balustrade with a gilded
 * rail; a sky lobby's is glass on a steel rail, with planter boxes and
 * pendants (`tallLobby.ts` picks which).
 */

/** Rows of a mezzanine story: the top of its railing and of its slab. */
export function mezzanineRows(y: number, h: number): { railTop: number; slabTop: number } {
  const slabTop = y + h - 3;
  return { railTop: slabTop - 9, slabTop };
}

/** The balcony slab at the foot of a mezzanine story, with its edge line. */
export function balconySlab(ctx: CanvasRenderingContext2D, x: number, w: number, slabTop: number, ground: boolean): void {
  ctx.fillStyle = ground ? "#DCD2B8" : "#CBC3B0";
  ctx.fillRect(x, slabTop, w, 3);
  ctx.fillStyle = ground ? "#D9B356" : "#9A9282";
  ctx.fillRect(x, slabTop, w, 1);
  ctx.fillStyle = ground ? "#8F7A48" : "#8A7E64";
  ctx.fillRect(x, slabTop + 2, w, 1);
}

/** The ground lobby's balustrade: a gilded handrail over cream balusters. */
export function balustrade(ctx: CanvasRenderingContext2D, x: number, w: number, railTop: number, slabTop: number): void {
  ctx.fillStyle = "#EDE3C6";
  for (let c = 0; c < w; c += 2) ctx.fillRect(x + c, railTop + 2, 1, slabTop - railTop - 3);
  ctx.fillStyle = "rgba(105,90,55,0.35)"; // each baluster's shaded side
  for (let c = 1; c < w; c += 2) ctx.fillRect(x + c, railTop + 3, 1, slabTop - railTop - 4);
  ctx.fillStyle = "#E8DDBC"; // bottom rail
  ctx.fillRect(x, slabTop - 1, w, 1);
  ctx.fillStyle = "#C9A24B"; // gilded handrail
  ctx.fillRect(x, railTop, w, 1);
  ctx.fillStyle = "#F1E8CE";
  ctx.fillRect(x, railTop + 1, w, 1);
}

/** A sky lobby's railing: a glass panel on a brushed steel rail. */
export function glassRail(d: DrawCtx, x: number, w: number, railTop: number, slabTop: number): void {
  const { ctx, lit } = d;
  ctx.fillStyle = lit ? "rgba(120,140,150,0.35)" : "rgba(214,230,238,0.5)";
  ctx.fillRect(x, railTop + 1, w, slabTop - railTop - 1);
  ctx.fillStyle = "rgba(255,255,255,0.35)"; // a glint across the glass
  ctx.fillRect(x, railTop + 3, w, 1);
  ctx.fillStyle = "#8E959C";
  ctx.fillRect(x, railTop, w, 1);
}

/** A planter box standing on the rail, with a low shrub and ivy trailing
 *  over the railing. `seed` varies the ivy from slice to slice. */
export function railPlanter(ctx: CanvasRenderingContext2D, x: number, w: number, railTop: number, seed: number): void {
  ctx.fillStyle = "#6B4A2B"; // the box
  ctx.fillRect(x, railTop - 2, w, 2);
  ctx.fillStyle = "#4E7A3E"; // shrub
  ctx.fillRect(x + 1, railTop - 4, w - 2, 2);
  ctx.fillStyle = "#5AA85A";
  for (let c = 1; c < w - 1; c += 3) ctx.fillRect(x + c, railTop - 5, 1, 1);
  const greens = ["#3E6A34", "#4E7A3E", "#5AA85A"];
  for (let c = 0; c < w; c++) {
    const r = hash(seed * 71 + c * 23);
    if (r < 0.45) continue;
    const len = 1 + Math.floor(r * 5); // short trails, so the rail still reads
    for (let k = 0; k < len; k++) {
      ctx.fillStyle = greens[(c + k) % greens.length];
      ctx.fillRect(x + c, railTop + 1 + k, 1, 1);
    }
  }
}

/** Three small globe pendants on cords of different lengths. */
export function globePendants(d: DrawCtx, cx: number, top: number, bottom: number): void {
  const { ctx, lit } = d;
  const span = bottom - top;
  if (span < 10) return;
  for (const [dx, drop] of [[-3, 0.5], [0, 0.8], [3, 0.65]] as const) {
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

/** A gilt-framed oil painting on the ground lobby's mezzanine wall. */
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
