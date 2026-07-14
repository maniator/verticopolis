import { ACCENTS, scatterPeople, shade } from "../common";
import { personFigure, personSeated } from "../../pixelSprites/common";

/**
 * The event venues: the party hall and the wedding hall. Extracted verbatim
 * from `facilities.ts`; `drawWeddingHall` is enriched to the page-05 `wedding`
 * board composition.
 */

export function drawPartyHall(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#2a1f3a";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#3a2f4a"; // dance floor
  ctx.fillRect(x, y + h - 5, w, 5);
  // Colored spotlights washing the floor.
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = ACCENTS[i % ACCENTS.length];
    ctx.globalAlpha = 0.4;
    ctx.fillRect(x + 6 + i * (w / 6), y + 3, 3, h - 8);
  }
  ctx.globalAlpha = 1;
  // Mirror ball.
  ctx.fillStyle = "#cdd6e6";
  ctx.beginPath();
  ctx.arc(x + w / 2, y + 7, 3, 0, Math.PI * 2);
  ctx.fill();
  // Dancers.
  scatterPeople(ctx, x + 8, x + w - 5, 11, y + h - 3, 1.3);
}

/** One 3x3 pixel flower for the arch garland and topiary, ported from the
 *  board's `bloom` helper: a colored bloom with a lighter top row and a white
 *  center highlight. Integer coordinates. */
function bloom(ctx: CanvasRenderingContext2D, x: number, y: number, c: string): void {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  ctx.fillStyle = c;
  ctx.fillRect(x0, y0, 3, 3);
  ctx.fillStyle = shade(c, 24);
  ctx.fillRect(x0, y0, 3, 1);
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillRect(x0 + 1, y0 + 1, 1, 1);
}

/**
 * The grand wedding hall atop a 5-star tower (floor 100), ported from page-05's
 * `wedding` build: an ivory-and-blush hall with a floral arch over a white
 * aisle runner, ribboned chairs seating guests, gold pilasters and stained-
 * glass windows, a candelabra, and the couple (a dark-suited figure and a
 * white-gowned figure) at the altar. Guests and the groom are seated occupants
 * (the 15px `seated` build); the bride is a hand-drawn gowned figure. Drawn
 * into the full `w x h` rect the caller gives, so it fills whatever the venue's
 * footprint is. Integer coordinates throughout.
 */
export function drawWeddingHall(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const ww = Math.max(1, Math.round(w));
  const hh = Math.max(1, Math.round(h));
  const fy = y0 + Math.round(hh * 0.86); // floor line: ivory hall above, runner below
  const acx = x0 + Math.round(ww / 2); // aisle center

  // Ivory hall walls, brighter across the top, with faint horizontal courses.
  ctx.fillStyle = "#F5EAD6";
  ctx.fillRect(x0, y0, ww, fy - y0);
  ctx.fillStyle = "#F8EEDC";
  ctx.fillRect(x0, y0, ww, Math.round((fy - y0) * 0.4));
  ctx.fillStyle = "rgba(230,216,190,0.4)";
  for (let py = y0 + 6; py < fy; py += 7) ctx.fillRect(x0, py, ww, 1);
  // Cornice with a row of pennants.
  ctx.fillStyle = "#E2D4B8";
  ctx.fillRect(x0, y0, ww, 3);
  ctx.fillStyle = "#D8C8A8";
  for (let px = x0 + 4; px < x0 + ww; px += 16) ctx.fillRect(px, y0, 8, 3);
  ctx.fillStyle = "#C8B896";
  ctx.fillRect(x0, y0 + 3, ww, 1);

  // Gold pilasters down the side walls.
  for (let px = x0 + Math.round(ww * 0.32); px < x0 + ww * 0.7; px += Math.round(ww * 0.36)) {
    ctx.fillStyle = "#C9A24B";
    ctx.fillRect(px, y0 + 4, 3, fy - y0 - 6);
    ctx.fillStyle = "#E8C860";
    ctx.fillRect(px, y0 + 4, 1, fy - y0 - 6);
    ctx.fillStyle = "#A0802E";
    ctx.fillRect(px + 2, y0 + 4, 1, fy - y0 - 6);
    ctx.fillStyle = "#D8B860";
    ctx.fillRect(px - 1, y0 + 4, 5, 2);
  }

  // Wall candelabra sconces, glowing warm.
  for (const scx of [x0 + Math.round(ww * 0.16), acx, x0 + Math.round(ww * 0.84)]) {
    ctx.fillStyle = "#C9A24B";
    ctx.fillRect(scx - 1, y0 + 3, 2, 3);
    ctx.fillRect(scx - 6, y0 + 6, 12, 2);
    ctx.fillRect(scx - 4, y0 + 9, 8, 1);
    ctx.fillStyle = "#F8E2B4";
    for (const o of [-5, -2, 1, 4]) ctx.fillRect(scx + o, y0 + 7, 1, 2);
    for (const o of [-3, 0, 3]) ctx.fillRect(scx + o, y0 + 10, 1, 1);
    ctx.fillStyle = "rgba(255,230,154,0.28)";
    ctx.fillRect(scx - 5, y0 + 6, 11, 5);
  }

  // Stained-glass windows around the altar.
  for (let wx = x0 + Math.round(ww * 0.4); wx + 12 < x0 + ww * 0.6; wx += 16) {
    ctx.fillStyle = "#3A2A44";
    ctx.fillRect(wx, y0 + 8, 12, fy - y0 - 16);
    ctx.fillStyle = "#E88AB0";
    ctx.fillRect(wx + 1, y0 + 9, 10, 3);
    ctx.fillStyle = "#7FB0E8";
    ctx.fillRect(wx + 1, y0 + 12, 10, 3);
    ctx.fillStyle = "#F4D060";
    ctx.fillRect(wx + 1, y0 + 15, 10, 3);
    ctx.fillStyle = "#8FA0D0";
    ctx.fillRect(wx + 1, y0 + 18, 10, fy - y0 - 27);
    ctx.fillStyle = "#2A1E34"; // mullions
    ctx.fillRect(wx + 5, y0 + 9, 1, fy - y0 - 18);
    ctx.fillRect(wx + 1, y0 + 12, 10, 1);
  }

  // Floor + the red aisle runner with gold edges.
  ctx.fillStyle = "#7A5A3A";
  ctx.fillRect(x0, fy, ww, y0 + hh - fy);
  ctx.fillStyle = "#8C6A44";
  ctx.fillRect(x0, fy, ww, 1);
  ctx.fillStyle = "#9A2E38";
  ctx.fillRect(acx - 12, fy, 24, y0 + hh - fy);
  ctx.fillStyle = "#B84450";
  ctx.fillRect(acx - 12, fy, 24, 1);
  ctx.fillStyle = "#C9A24B";
  ctx.fillRect(acx - 12, fy, 2, y0 + hh - fy);
  ctx.fillRect(acx + 10, fy, 2, y0 + hh - fy);

  // Floral arch over the altar: two white post bases, a top lintel bar, and a
  // garland of blooms across the top and down the sides.
  const postBase = Math.max(2, y0 + hh - (fy - 2)); // white post rising from the floor
  ctx.fillStyle = "#E8DCC8";
  ctx.fillRect(acx - 16, fy - 2, 3, postBase);
  ctx.fillRect(acx + 13, fy - 2, 3, postBase);
  ctx.fillRect(acx - 16, y0 + 10, 32, 3);
  for (let ax = acx - 16; ax < acx + 16; ax += 4) {
    bloom(ctx, ax, y0 + 8, ["#E88AB0", "#F4D0A0", "#F0F0F0", "#E0A0C0"][Math.abs(ax) % 4]);
  }
  for (let ay = y0 + 12; ay < fy - 6; ay += 6) {
    bloom(ctx, acx - 16, ay, "#E88AB0");
    bloom(ctx, acx + 14, ay, "#F0F0F0");
  }

  // Altar candelabra with two lit candles.
  ctx.fillStyle = "#E8DCC8";
  ctx.fillRect(acx - 6, fy - 6, 12, 6);
  ctx.fillStyle = "#E8C14A";
  ctx.fillRect(acx - 4, fy - 9, 1, 3);
  ctx.fillRect(acx + 2, fy - 9, 1, 3);
  ctx.fillStyle = "rgba(248,226,180,0.4)";
  ctx.fillRect(acx - 6, fy - 10, 12, 4);

  // The couple at the altar: a dark-suited figure and a white-gowned figure.
  personFigure(ctx, acx - 7, fy, "seated", "#2A2E38");
  ctx.fillStyle = "#F4F0EC"; // gown
  ctx.fillRect(acx + 2, fy - 9, 5, 9);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(acx + 2, fy - 9, 5, 1);
  ctx.fillStyle = "#E8C9A0"; // head
  ctx.fillRect(acx + 2, fy - 14, 4, 5);
  ctx.fillStyle = "#5A4A3A";
  ctx.fillRect(acx + 2, fy - 14, 4, 1);
  ctx.fillStyle = "#F0F0F0"; // veil
  ctx.fillRect(acx + 1, fy - 15, 6, 2);

  // Ribboned guest chairs seating guests, either side of the aisle. Guest
  // shirt colors come from the seated build's seed, so a row reads varied.
  for (let sx = x0 + 8, i = 0; sx < acx - 20; sx += 12, i++) {
    ctx.fillStyle = "#F4F0EC";
    ctx.fillRect(sx, fy - 9, 6, 9);
    ctx.fillStyle = "#E88AB0"; // pink chair ribbon
    ctx.fillRect(sx, fy - 9, 6, 1);
    personSeated(ctx, sx, fy - 2, i * 5 + 1);
  }
  for (let sx = acx + 22, i = 0; sx < x0 + ww - 8; sx += 12, i++) {
    ctx.fillStyle = "#F4F0EC";
    ctx.fillRect(sx, fy - 9, 6, 9);
    ctx.fillStyle = "#E88AB0";
    ctx.fillRect(sx, fy - 9, 6, 1);
    personSeated(ctx, sx, fy - 2, i * 5 + 4);
  }

  // Topiary planters flanking the altar, with blooms.
  ctx.fillStyle = "#C9A24B";
  ctx.fillRect(acx - 26, fy - 4, 4, 4);
  ctx.fillStyle = "#4E7A3E";
  ctx.fillRect(acx - 30, fy - 16, 8, 12);
  bloom(ctx, acx - 30, fy - 18, "#E88AB0");
  bloom(ctx, acx - 26, fy - 19, "#F0F0F0");
  ctx.fillStyle = "#C9A24B";
  ctx.fillRect(acx + 22, fy - 4, 4, 4);
  ctx.fillStyle = "#4E7A3E";
  ctx.fillRect(acx + 22, fy - 16, 8, 12);
  bloom(ctx, acx + 22, fy - 18, "#F0F0F0");
  bloom(ctx, acx + 26, fy - 19, "#E88AB0");

  // Scattered petals down the aisle.
  ctx.fillStyle = "rgba(90,168,90,0.7)";
  for (let gx = x0 + 6; gx < x0 + ww - 6; gx += 8) ctx.fillRect(gx, y0 + 5, 4, 1);
}
