import type { DrawCtx } from "../common";
import { hash } from "../../pixelSprites/common";

/**
 * The tall sky lobby's art (#308, Modern): a glass atrium high above the city.
 * The curtain wall runs unbroken from slice to slice and shows the skyline it
 * looks out on (pale towers under a day sky, dark towers with lit windows at
 * night), behind warm stone piers that carry the same gold capitals as the
 * ground lobby. A glass-railed gallery crosses the hall at each story line,
 * with vines trailing from it; a fig tree grows up past it, and a cluster of
 * globe pendants hangs over the framed prints.
 */

/** The curtain wall: sky, a skyline below it, and slim transoms at each
 *  story line. `lines` are the story lines' pixel rows. */
export function skylineGlass(d: DrawCtx, x: number, y: number, w: number, h: number, seed: number, lines: readonly number[]): void {
  const { ctx, lit } = d;
  if (w < 2 || h < 8) return;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, lit ? "#151B2B" : "#9DBAD2");
  g.addColorStop(1, lit ? "#2C2A3A" : "#D6E2E8");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  if (!lit && hash(seed * 7) > 0.4) {
    ctx.fillStyle = "rgba(255,255,255,0.55)"; // a wisp of cloud
    const cy = y + 4 + Math.floor(hash(seed * 11) * Math.max(1, h * 0.3));
    ctx.fillRect(x + 1, cy, Math.min(w - 2, 4), 1);
  }
  // Two layers of towers in two-pixel columns, the far one paler and taller.
  const layers = [
    { layer: 0, reach: 0.5, far: true, night: "#20232F", day: "#B3C3CF" },
    { layer: 1, reach: 0.3, far: false, night: "#181A23", day: "#8EA1B0" },
  ] as const;
  for (const { layer, reach, far, night, day } of layers) {
    for (let c = 0; c < w; c += 2) {
      const r = hash(seed * 53 + layer * 977 + c * 31);
      const bh = Math.round(h * reach * (0.35 + 0.65 * r));
      const by = y + h - bh;
      const cw = Math.min(2, w - c);
      ctx.fillStyle = lit ? night : day;
      ctx.fillRect(x + c, by, cw, bh);
      if (lit) {
        ctx.fillStyle = far ? "#9C8558" : "#D9B36A"; // lit windows
        for (let wy = by + 2; wy < y + h - 1; wy += 3) {
          if (hash(seed * 13 + layer * 7 + c * 17 + wy * 3) > 0.62) ctx.fillRect(x + c, wy, 1, 1);
        }
      }
    }
  }
  ctx.fillStyle = lit ? "rgba(120,110,90,0.55)" : "rgba(255,255,255,0.35)"; // glass sheen
  ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = "rgba(60,64,80,0.3)"; // one slim mullion per slice
  ctx.fillRect(x + w - 1, y, 1, h);
  for (const yl of lines) gallery(ctx, x, w, yl);
}

/** A gallery walkway across the hall at story line `yl`: a stone slab under
 *  a glass balustrade with a gold rail. */
function gallery(ctx: CanvasRenderingContext2D, x: number, w: number, yl: number): void {
  ctx.fillStyle = "rgba(225,238,246,0.3)"; // glass balustrade
  ctx.fillRect(x, yl - 4, w, 4);
  ctx.fillStyle = "#C9A24B";
  ctx.fillRect(x, yl - 5, w, 1);
  ctx.fillStyle = "#D6CDB6";
  ctx.fillRect(x, yl, w, 2);
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillRect(x, yl, w, 1);
  ctx.fillStyle = "rgba(40,36,30,0.3)";
  ctx.fillRect(x, yl + 2, w, 1);
}

/** Vines trailing from the gallery at story line `yl`. */
export function vines(ctx: CanvasRenderingContext2D, x: number, w: number, yl: number, seed: number): void {
  const greens = ["#3E6A34", "#4E7A3E", "#5AA85A"];
  for (let c = 0; c < w; c++) {
    const r = hash(seed * 71 + c * 23);
    if (r < 0.35) continue;
    const len = 2 + Math.floor(r * 9);
    for (let k = 0; k < len; k++) {
      ctx.fillStyle = greens[(c + k) % greens.length];
      ctx.fillRect(x + c, yl + 3 + k, 1, 1);
    }
  }
  ctx.fillStyle = "#3E6A34"; // the planter's spill over the rail
  ctx.fillRect(x, yl - 6, w, 1);
}

/** A warm stone pier from floor to cornice, with a gold capital, base and a
 *  ring at each story line. */
export function stonePier(ctx: CanvasRenderingContext2D, cx: number, y0: number, hh: number, lines: readonly number[]): void {
  ctx.fillStyle = "#D6CDB6";
  ctx.fillRect(cx - 1, y0 + 4, 3, hh - 9);
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fillRect(cx - 1, y0 + 4, 1, hh - 9);
  ctx.fillStyle = "rgba(90,78,52,0.4)";
  ctx.fillRect(cx + 1, y0 + 4, 1, hh - 9);
  ctx.fillStyle = "#C9A24B";
  ctx.fillRect(cx - 2, y0 + 3, 5, 2);
  ctx.fillRect(cx - 2, y0 + hh - 7, 5, 2);
  for (const yl of lines) ctx.fillRect(cx - 1, yl - 1, 3, 1);
}

/** A fig tree in a large planter, its crown high in the hall. */
export function figTree(ctx: CanvasRenderingContext2D, cx: number, floorTop: number, crownY: number): void {
  ctx.fillStyle = "#6B4A2B"; // trunk and two branches
  ctx.fillRect(cx, crownY + 2, 2, floorTop - crownY - 7);
  ctx.fillRect(cx - 2, crownY + 6, 2, 1);
  ctx.fillRect(cx + 2, crownY + 9, 2, 1);
  const crown: [number, number, number, string][] = [
    [cx - 2, crownY + 7, 4.5, "#35592D"],
    [cx + 4, crownY + 8, 4, "#35592D"],
    [cx + 1, crownY + 2, 5, "#3E6A34"],
    [cx - 2.5, crownY + 3, 3.5, "#4E7A3E"],
    [cx + 4, crownY + 4, 3, "#4E7A3E"],
  ];
  for (const [ax, ay, r, color] of crown) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ax, ay, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#6FBF5F"; // sunlit leaves
  ctx.fillRect(cx, crownY - 1, 2, 1);
  ctx.fillRect(cx - 3, crownY + 2, 1, 1);
  ctx.fillRect(cx + 4, crownY + 4, 1, 1);
  ctx.fillStyle = "#8C5A3A"; // planter
  ctx.fillRect(cx - 3, floorTop - 5, 8, 5);
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillRect(cx - 3, floorTop - 5, 8, 1);
  ctx.fillStyle = "#4E3620";
  ctx.fillRect(cx - 3, floorTop - 1, 8, 1);
}

/** Three globe pendants at staggered heights, warm after dark. */
export function globePendants(d: DrawCtx, cx: number, top: number, bottom: number): void {
  const { ctx, lit } = d;
  const span = bottom - top;
  if (span < 10) return;
  for (const [dx, drop] of [[-3, 0.55], [0, 0.85], [3, 0.7]] as const) {
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
