import type { UnitView } from "../../../simport/view";
import { visibleOccupants } from "../../../engine/Crowd";
import { shade, type DrawCtx } from "../common";
import { FLOOR } from "../../scale";
import { personFigure, personSeated } from "../../pixelSprites/common";
import { layerBreak, layerEnd } from "../../pixelSprites/layers";

/**
 * The wedding hall: a sky garden that crowns a 5-star tower. The ground story
 * is the ceremony hall (floor 100); three stories of glass conservatories with
 * planted terraces and a pair of gold rings on the roof rise above it. The art
 * is religion neutral by design: no crosses, steeples, altars or other
 * religious symbols.
 */

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
 * The wedding hall's nave, the bottom story of the wedding hall (floor 100). Ported
 * from page-05's `wedding` build: an ivory-and-blush hall with a floral arch over
 * a white aisle runner, ribboned chairs seating guests, gold pilasters and
 * clear skyline windows, a flower stand, and the couple (a dark-suited figure and
 * a white-gowned figure) on the dais. Guests and the groom are seated occupants
 * (the 15px `seated` build); the bride is a hand-drawn gowned figure. Clear sky windows
 * and a flower stand keep the room religion neutral. Drawn
 * into the full `w x h` rect the caller gives, so it fills whatever story it is
 * handed. Integer coordinates throughout.
 *
 * Honest occupancy, the same contract the party hall keeps: figures fill in
 * order up to `visibleOccupants(u)`, so a hall with no wedding in it draws its
 * chairs, arch and flower stand with nobody in them (#552). The couple fills
 * first, because one attendee at a wedding reads as the couple rather than as a
 * lone guest in an empty hall. The room's live attendance arrives through the
 * `customersIn` -> `occupants` mirror, which is already a bake-signature input.
 */
function drawWeddingNave(d: DrawCtx, u: UnitView, x: number, y: number, w: number, h: number) {
  const ctx = d.ctx;
  const n = visibleOccupants(u);
  let filled = 0;
  /** Draws the next figure only while the hall still has attendees to seat. */
  const takeSeat = (): boolean => (filled < n ? (filled++, true) : false);
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

  // Gold pilasters down the side walls. The step is floored at 1px so a
  // degenerate (near-zero-width) rect can never stall the loop.
  const pilasterStep = Math.max(1, Math.round(ww * 0.36));
  for (let px = x0 + Math.round(ww * 0.32); px < x0 + ww * 0.7; px += pilasterStep) {
    ctx.fillStyle = "#C9A24B";
    ctx.fillRect(px, y0 + 4, 3, fy - y0 - 6);
    ctx.fillStyle = "#E8C860";
    ctx.fillRect(px, y0 + 4, 1, fy - y0 - 6);
    ctx.fillStyle = "#A0802E";
    ctx.fillRect(px + 2, y0 + 4, 1, fy - y0 - 6);
    ctx.fillStyle = "#D8B860";
    ctx.fillRect(px - 1, y0 + 4, 5, 2);
  }

  // Wall lamps, glowing warm.
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

  // Tall clear windows around the dais: sky and a far skyline behind a gold frame.
  for (let wx = x0 + Math.round(ww * 0.4); wx + 12 < x0 + ww * 0.6; wx += 16) {
    ctx.fillStyle = "#C9A24B";
    ctx.fillRect(wx - 1, y0 + 7, 14, fy - y0 - 14);
    ctx.fillStyle = "#BFE0F2";
    ctx.fillRect(wx, y0 + 8, 12, fy - y0 - 16);
    ctx.fillStyle = "#D8EEF8";
    ctx.fillRect(wx, y0 + 8, 12, 6);
    ctx.fillStyle = "#8FA8C0"; // a far skyline
    ctx.fillRect(wx + 1, fy - 17, 4, 9);
    ctx.fillRect(wx + 7, fy - 20, 4, 12);
  }

  // Floor + the white aisle runner with gold edges (the board's ivory runner
  // the couple walks down, not a red carpet).
  ctx.fillStyle = "#7A5A3A";
  ctx.fillRect(x0, fy, ww, y0 + hh - fy);
  ctx.fillStyle = "#8C6A44";
  ctx.fillRect(x0, fy, ww, 1);
  ctx.fillStyle = "#F4F0EC"; // white runner
  ctx.fillRect(acx - 12, fy, 24, y0 + hh - fy);
  ctx.fillStyle = "#FFFFFF"; // lit near edge
  ctx.fillRect(acx - 12, fy, 24, 1);
  ctx.fillStyle = "#C9A24B"; // gold edges
  ctx.fillRect(acx - 12, fy, 2, y0 + hh - fy);
  ctx.fillRect(acx + 10, fy, 2, y0 + hh - fy);
  layerBreak(ctx); // the shell ends; the arch, dais, chairs, planters and guests follow

  // Floral arch over the dais: two white post bases, a top lintel bar, and a
  // garland of blooms across the top and down the sides.
  const postBase = Math.max(2, y0 + hh - (fy - 2)); // white post rising from the floor
  ctx.fillStyle = "#E8DCC8";
  ctx.fillRect(acx - 16, fy - 2, 3, postBase);
  ctx.fillRect(acx + 13, fy - 2, 3, postBase);
  ctx.fillRect(acx - 16, y0 + 10, 32, 3);
  const garland = ["#E88AB0", "#F4D0A0", "#F0F0F0", "#E0A0C0"];
  for (let ax = acx - 16, gi = 0; ax < acx + 16; ax += 4, gi++) {
    bloom(ctx, ax, y0 + 8, garland[gi % garland.length]);
  }
  for (let ay = y0 + 12; ay < fy - 6; ay += 6) {
    bloom(ctx, acx - 16, ay, "#E88AB0");
    bloom(ctx, acx + 14, ay, "#F0F0F0");
  }

  // A flower stand on the dais.
  ctx.fillStyle = "#E8DCC8";
  ctx.fillRect(acx - 6, fy - 6, 12, 6);
  ctx.fillStyle = "#C9A24B";
  ctx.fillRect(acx - 1, fy - 9, 2, 3);
  bloom(ctx, acx - 5, fy - 11, "#E88AB0");
  bloom(ctx, acx - 1, fy - 12, "#F4D0A0");
  bloom(ctx, acx + 3, fy - 10, "#F0F0F0");

  // The couple on the dais: a dark-suited figure and a white-gowned figure.
  // They seat first, so the smallest real wedding still reads as a wedding.
  if (takeSeat()) personFigure(ctx, acx - 7, fy, "seated", "#2A2E38");
  if (takeSeat()) {
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
  }

  // Ribboned guest chairs, either side of the aisle. The chairs always draw
  // (they are furniture); only the guests in them are gated. Guest shirt colors
  // come from the seated build's seed, so a row reads varied.
  for (let sx = x0 + 8, i = 0; sx < acx - 20; sx += 12, i++) {
    ctx.fillStyle = "#F4F0EC";
    ctx.fillRect(sx, fy - 9, 6, 9);
    ctx.fillStyle = "#E88AB0"; // pink chair ribbon
    ctx.fillRect(sx, fy - 9, 6, 1);
    if (takeSeat()) personSeated(ctx, sx, fy - 2, i * 5 + 1);
  }
  for (let sx = acx + 22, i = 0; sx < x0 + ww - 8; sx += 12, i++) {
    ctx.fillStyle = "#F4F0EC";
    ctx.fillRect(sx, fy - 9, 6, 9);
    ctx.fillStyle = "#E88AB0";
    ctx.fillRect(sx, fy - 9, 6, 1);
    if (takeSeat()) personSeated(ctx, sx, fy - 2, i * 5 + 4);
  }

  // Topiary planters flanking the dais, with blooms.
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

  // The petal row draws along the top of the wall (y0 + 5), over the sconces,
  // so it belongs to the shell and follows the furniture's end.
  layerEnd(ctx);
  // A row of scattered petals along the top of the wall.
  ctx.fillStyle = "rgba(90,168,90,0.7)";
  for (let gx = x0 + 6; gx < x0 + ww - 6; gx += 8) ctx.fillRect(gx, y0 + 5, 4, 1);
}

const LEAF = ["#6FAF4E", "#4E8A3E", "#3C6E34"] as const;
const STONE = "#E9DFC9";
const STONE_SHADE = "#CFC2A6";
const FRAME = "#F4F6F2";
const GLASS = "#CBEAEA";
const GOLD = "#C9A24B";
const BLOOM_COLORS = ["#E88AB0", "#F4D060", "#F0F0F0"] as const;

/** The bloom color for a position along a hedge. Positions can be negative (a sprite is
 *  drawn relative to its own origin), so the index is taken from the absolute value. */
function bloomColor(pos: number): string {
  return BLOOM_COLORS[Math.abs(pos) % BLOOM_COLORS.length];
}

/** A filled disc in three green bands, lighter at the top. */
function leafBlob(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.round(Math.sqrt(r * r - dy * dy));
    ctx.fillStyle = LEAF[dy < -r / 3 ? 0 : 1];
    if (dy >= r / 3) ctx.fillStyle = LEAF[2];
    ctx.fillRect(cx - half, cy + dy, half * 2, 1);
  }
}

/** A tree standing on `base`: a trunk, then a canopy. */
function tree(ctx: CanvasRenderingContext2D, cx: number, base: number, r: number, trunk: number): void {
  ctx.fillStyle = "#6A4A30";
  ctx.fillRect(cx - 1, base - trunk, 2, trunk + 1);
  leafBlob(ctx, cx, base - trunk - r + 2, r);
}

/** A story's roof slab, drawn along its top edge: the floor the story above stands on. */
function roofSlab(ctx: CanvasRenderingContext2D, tx: number, ty: number, tw: number): void {
  ctx.fillStyle = STONE;
  ctx.fillRect(tx - 2, ty, tw + 4, 3);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillRect(tx - 2, ty, tw + 4, 1);
  ctx.fillStyle = STONE_SHADE;
  ctx.fillRect(tx - 2, ty + 2, tw + 4, 1);
}

/** Hedges and flowers along an exposed strip of roof, standing on the slab at `base`. */
function roofHedges(ctx: CanvasRenderingContext2D, x1: number, x2: number, base: number): void {
  for (let hx = x1; hx < x2; hx += 4) {
    ctx.fillStyle = (hx >> 2) % 2 ? LEAF[1] : LEAF[2];
    ctx.fillRect(hx, base - 5, Math.min(4, x2 - hx), 5);
  }
  for (let px = x1 + 1; px + 3 < x2; px += 7) bloom(ctx, px, base - 7, bloomColor(px >> 3));
}

/** How far a curved glass roof drops from its flat crown down to the wall. */
const WEDDING_SHOULDER_DROP = 14;

/** The y of a glass roof at column `px`: flat across `flatHalf` each side of the
 *  center, then curving down to `drop` px below the crown at the wall (a quarter
 *  ellipse, so it meets the wall straight). */
function shoulderTop(px: number, acx: number, flatHalf: number, wallHalf: number, ty: number, drop: number): number {
  const out = Math.abs(px + 0.5 - acx) - flatHalf;
  if (out <= 0) return ty;
  const t = Math.min(1, out / Math.max(1, wallHalf - flatHalf));
  return ty + Math.round(drop * (1 - Math.sqrt(1 - t * t)));
}

/**
 * One glass story: trees and flower beds inside, white frames, a pale sheen. With
 * `flatHalf` set the roof has curved shoulders: flat over the middle (where the
 * story above stands) and sweeping down to the walls on both sides.
 */
function glassStory(ctx: CanvasRenderingContext2D, tx: number, ty: number, tw: number, h: number, trees: number, flatHalf?: number): void {
  const acx = tx + tw / 2;
  const topAt = (px: number) => (flatHalf === undefined ? ty : shoulderTop(px, acx, flatHalf, tw / 2, ty, WEDDING_SHOULDER_DROP));
  for (let px = tx; px < tx + tw; px++) {
    const top = topAt(px);
    ctx.fillStyle = GLASS;
    ctx.fillRect(px, top, 1, ty + h - top);
  }
  for (let t = 0; t < trees; t++) tree(ctx, tx + 12 + t * Math.round((tw - 24) / Math.max(1, trees - 1)), ty + h, 7, 6);
  for (let px = tx + 4; px < tx + tw - 2; px += 6) bloom(ctx, px, ty + h - 4, bloomColor(px >> 1));
  for (let px = tx; px < tx + tw; px++) {
    const top = topAt(px);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(px, top, 1, ty + h - top);
    if ((px - tx) % 10 === 0 || px < tx + 2 || px >= tx + tw - 2) {
      ctx.fillStyle = FRAME;
      ctx.fillRect(px, top, 1, ty + h - top);
    }
    if (flatHalf !== undefined && top > ty) {
      ctx.fillStyle = FRAME; // the curved roof's frame, one pixel thick along the slope
      ctx.fillRect(px, top, 1, Math.max(2, topAt(px + 1) - top + 1));
    }
  }
  if (flatHalf === undefined) {
    ctx.fillStyle = FRAME;
    ctx.fillRect(tx, ty, tw, 2);
  }
}

/** Width share of each garden story, floor 101 first: the terraces step in as they rise. */
const WEDDING_GARDEN_STORIES = [0.92, 0.74, 0.56] as const;
/** The garden story (0 is floor 101) whose roof has curved shoulders: floor 102. */
const WEDDING_CURVED_STORY = 1;
/** Width share of the plinth that carries the rings on floor 104. */
const WEDDING_PLINTH_SHARE = 0.3;

/**
 * The wedding hall's upper four stories (floors 101 to 104): a sky garden that
 * steps in as it rises. Three glass conservatories, each roof a planted terrace
 * standing on the story below, and on the top roof two interlocked gold rings in
 * a flower-banked stone plinth. Every piece rests on the slab beneath it. Pure
 * shell, no figures, so it never reads occupancy. Everything outside the tiers
 * is left transparent, so the sky shows beside it.
 */
function drawWeddingGarden(d: DrawCtx, x: number, y: number, w: number, h: number, story: number) {
  const ctx = d.ctx;
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const ww = Math.max(1, Math.round(w));
  const hh = Math.max(1, Math.round(h));
  const acx = x0 + Math.round(ww / 2);
  const evenWidth = (share: number) => Math.max(8, Math.round((ww * share) / 2) * 2);
  const widths = WEDDING_GARDEN_STORIES.map(evenWidth);
  const plinthW = evenWidth(WEDDING_PLINTH_SHARE);

  widths.forEach((tw, i) => {
    const ty = y0 + hh - (i + 1) * story;
    const tx = acx - tw / 2;
    const above = i < widths.length - 1 ? widths[i + 1] : plinthW;
    const curved = i === WEDDING_CURVED_STORY;
    glassStory(ctx, tx, ty, tw, story, i === widths.length - 1 ? 3 : 4, curved ? above / 2 + 2 : undefined);
    if (curved) {
      // The roof sweeps down from a flat crown under the story above; flowers line the curve.
      roofSlab(ctx, acx - above / 2 - 2, ty, above);
      for (let px = tx + 1; px + 3 < acx - above / 2 - 2; px += 8) bloom(ctx, px, shoulderTop(px, acx, above / 2 + 2, tw / 2, ty, WEDDING_SHOULDER_DROP) - 3, bloomColor(px >> 3));
      for (let px = acx + above / 2 + 3; px + 3 < tx + tw; px += 8) bloom(ctx, px, shoulderTop(px, acx, above / 2 + 2, tw / 2, ty, WEDDING_SHOULDER_DROP) - 3, bloomColor(px >> 3));
    } else {
      roofSlab(ctx, tx, ty, tw);
      // The strip of this roof left outside the story above is a planted terrace.
      roofHedges(ctx, tx, acx - above / 2 - 1, ty);
      roofHedges(ctx, acx + above / 2 + 1, tx + tw, ty);
    }
    if (i === 0) {
      ctx.fillStyle = LEAF[1];
      for (let vx = tx; vx < tx + tw; vx += 7) ctx.fillRect(vx, ty + 3, 2, 3 + (Math.abs(vx >> 1) % 5)); // vines over the edge
    }
  });

  // The top story: a stone plinth on floor 103's roof, banked with flowers, with the rings in it.
  const base = y0 + hh - widths.length * story;
  ctx.fillStyle = STONE;
  ctx.fillRect(acx - plinthW / 2, base - 8, plinthW, 8);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillRect(acx - plinthW / 2, base - 8, plinthW, 1);
  ctx.fillStyle = STONE_SHADE;
  ctx.fillRect(acx - plinthW / 2, base - 2, plinthW, 2);
  const r = 13;
  const cy = base - 8 - r + 3;
  const ring = (cx: number) => {
    for (let deg = 0; deg < 360; deg += 2) {
      const rad = (deg * Math.PI) / 180;
      const px = cx + Math.cos(rad) * r;
      const py = cy + Math.sin(rad) * r;
      ctx.fillStyle = GOLD;
      ctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 3, 3);
      if (deg > 190 && deg < 270) {
        ctx.fillStyle = "#F4D878";
        ctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 2, 1);
      }
    }
  };
  ring(acx - 7);
  ring(acx + 7);
  ctx.fillStyle = "#DDF4FF"; // a small diamond glint on the right ring
  ctx.fillRect(acx + 6, cy - r - 4, 3, 3);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(acx + 7, cy - r - 6, 1, 2);
  ctx.fillStyle = LEAF[2]; // flowers bank the foot of the rings so they sit in the plinth
  ctx.fillRect(acx - plinthW / 2 + 1, base - 11, plinthW - 2, 3);
  for (let bx = acx - plinthW / 2 + 1; bx < acx + plinthW / 2 - 3; bx += 4) bloom(ctx, bx, base - 13, (bx >> 2) % 2 ? "#E88AB0" : "#F0F0F0");
}

/**
 * The grand wedding hall that crowns a 5-star tower (28 wide, five stories, floors
 * 100 to 104). The ceremony hall with the wedding sits on the bottom story, and
 * four stories of sky garden and a pair of gold rings rise above it. The rect is split into one equal
 * story per floor.
 */
export function drawWeddingHall(d: DrawCtx, u: UnitView, x: number, y: number, w: number, h: number) {
  // The TypeScript engine's catalog still holds the one-story hall: draw the nave alone.
  const stories = Math.round(h / FLOOR);
  if (stories < 2) return drawWeddingNave(d, u, x, y, w, h);
  const story = Math.max(1, Math.round(h / stories));
  const crownH = Math.max(1, Math.round(h) - story);
  drawWeddingGarden(d, x, y, w, crownH, story);
  drawWeddingNave(d, u, x, y + crownH, w, story);
}
