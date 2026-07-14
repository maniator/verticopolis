import { PAL, personFigure, personSeated, personStanding, shade } from "./common";
import type { ShopLook } from "./shop.looks";

/**
 * Per-trade retail interiors, split out of `shop.ts` so the eleven enriched
 * rooms clear the 500-line ceiling. Each draw function is a port of its board
 * tile in `page-04-retail.build.js` (the pixel-exact reference), scaled to the
 * screen rect and reading `look.goods` for its detail palette. `shop.ts` keeps
 * the shared shell, striped-awning prologue, and the byte-stable generic
 * fallback; this file owns only the subtyped enrichment.
 *
 * Occupant scale follows the finalized person family: behind-counter staff and
 * seated clients use the 15px seated build, open-floor clerks and browsing
 * customers use the 18px standing build. Staff draw during open hours as part
 * of the shop; a single browsing customer stays behind the occupancy gate
 * (`g.busy`) so no ghost shopper fills an idle store. Reserved state colors are
 * never used for decoration, and every rectangle rounds to integer pixels.
 */

/** The interior region plus the occupancy signals every trade needs. `railY` is
 *  the interior top just under the lit sign; `awningBottom` is the valance line
 *  under the stripe band; `floorY` is the hard floor line from `shell`. */
export interface ShopGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  floorY: number;
  railY: number;
  awningBottom: number;
  /** The single browsing-customer gate: real occupant, or the hash stand-in. */
  busy: boolean;
  /** Live occupant count, for trades that seat more than one client. */
  occupants: number;
  /** Deterministic per-unit seed base (the browsing customer's shirt seed). */
  seed: number;
  /** Evening/night flag, in the bake signature; keys the sign glow only. */
  lit: boolean;
}

/** A board-faithful pen bound to one context. `F` is the reference `F(...)`
 *  rectangle (integer, alpha-aware), `box` its beveled solid, `glow` its warm
 *  concentric halo. Ported 1:1 from `page-04-retail.build.js`. */
function pen(ctx: CanvasRenderingContext2D) {
  const F = (px: number, py: number, pw: number, ph: number, c: string, o = 1): void => {
    ctx.globalAlpha = o;
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(px), Math.round(py), Math.max(1, Math.round(pw)), Math.max(1, Math.round(ph)));
    ctx.globalAlpha = 1;
  };
  const box = (px: number, py: number, pw: number, ph: number, b: string): void => {
    F(px, py + ph, pw, 1, "#000000", 0.18); // contact shadow
    F(px, py, pw, ph, b);
    F(px, py, pw, 1, shade(b, 22)); // top highlight
    F(px, py, 1, ph, shade(b, 12)); // left highlight
    F(px + pw - 1, py, 1, ph, shade(b, -16)); // right edge
    F(px, py + ph - 1, pw, 1, shade(b, -22)); // bottom edge
  };
  const glow = (cx: number, cy: number, c: string): void => {
    for (const [s, o] of [[4, 0.1], [3, 0.16], [2, 0.3], [1, 0.6]] as const) F(cx - s, cy - s, s * 2, s * 2, c, o);
  };
  return { F, box, glow };
}

/** Cycle the trade's detail palette, guarding a short array. */
function good(look: ShopLook, i: number): string {
  return look.goods[((i % look.goods.length) + look.goods.length) % look.goods.length];
}

/**
 * The enriched awning trim and the lit sign board, drawn on the subtyped path
 * only (the generic shop keeps just the shared stripe loop). Board `awning()`
 * trim plus `signboard()`: a bright top line, a scalloped valance, an
 * `awningShadow` band, then a marquee in the trade's awning color with a warm
 * glow halo. The halo is the one element keyed on `lit` (static, no per-frame
 * animation); every other pixel here is constant.
 */
export function drawShopSignage(ctx: CanvasRenderingContext2D, g: ShopGeom, accent: string): void {
  const { F, glow } = pen(ctx);
  const { x, y, w } = g;
  const ab = g.awningBottom;
  F(x, y, w, 1, shade(accent, 20)); // awning top highlight
  for (let sx = x; sx < x + w; sx += 4) F(sx, ab, 2, 1, (sx - x) % 8 ? accent : "#FFFFFF"); // scalloped valance
  F(x, ab + 1, w, 1, PAL.awningShadow); // shaded band under the awning
  const signTop = ab + 2;
  F(x + 4, signTop, w - 8, 5, shade(accent, -30)); // sign backing
  F(x + 5, signTop + 1, w - 10, 3, accent); // sign face
  glow(x + w / 2, signTop + 2, g.lit ? PAL.glowLit : PAL.glowDim); // warm marquee halo, lit-keyed
}

// ---- Per-trade interiors ------------------------------------------------

/** Men's Clothing: two garment rails, a folded-shirt table, a suited mannequin,
 *  a tall fitting mirror, and a browsing customer. */
function racks(ctx: CanvasRenderingContext2D, look: ShopLook, g: ShopGeom): void {
  const { F, box } = pen(ctx);
  const { x, w, floorY: fy, railY } = g;
  const railW = Math.round(w * 0.5);
  for (const ry of [railY + 2, railY + 11]) {
    F(x + 10, ry, railW, 1, "#8A8A92"); // rail
    for (let gx = x + 13, k = 0; gx + 3 < x + 10 + railW; gx += 6, k++) {
      F(gx, ry + 1, 3, 7, good(look, k)); // hanging garment
      F(gx, ry + 1, 3, 1, "#F4F0E4", 0.2); // hanger sheen
    }
  }
  const fx = x + Math.round(w * 0.58);
  box(fx, fy - 4, 18, 4, "#8C6E50"); // folded-shirt table
  for (let k = 0; k < 3; k++) F(fx + 2 + k * 6, fy - 8, 4, 4, good(look, k)); // folded shirts
  const mx = x + w - 18;
  F(mx, fy - 2, 7, 2, "#C8C8C8"); // plinth
  F(mx + 1, fy - 13, 5, 11, good(look, 0)); // suited mannequin body
  F(mx + 2, fy - 16, 3, 3, "#E8C9A0"); // mannequin head
  box(x + w - 9, railY, 4, fy - railY, "#B8C8D4"); // tall fitting mirror
  if (g.busy) personStanding(ctx, fx - 7, fy, g.seed); // browsing customer
}

/** Pet Store: a stack of critter cages, a glowing aquarium, a supply shelf, and
 *  a customer. */
function pets(ctx: CanvasRenderingContext2D, look: ShopLook, g: ShopGeom): void {
  const { F, box } = pen(ctx);
  const { x, w, floorY: fy, railY } = g;
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++) {
      const cx = x + 10 + c * 12;
      const cy = railY + 1 + r * 10;
      box(cx, cy, 10, 9, "#B8A890"); // cage
      for (let bx = cx + 1; bx < cx + 10; bx += 2) F(bx, cy + 1, 1, 7, "#8A7A64"); // bars
      F(cx + 3, cy + 4, 4, 3, good(look, r * 3 + c)); // resident
    }
  const ax = x + Math.round(w * 0.5);
  box(ax, fy - 11, 20, 10, "#2A4A64"); // aquarium tank
  F(ax + 1, fy - 10, 18, 8, "#4FA0C8"); // water
  F(ax + 3, fy - 7, 3, 1, "#E88F4A"); // fish
  F(ax + 9, fy - 8, 3, 1, "#F4E4A0");
  F(ax + 14, fy - 6, 3, 1, "#E88F4A");
  for (let wv = ax + 1; wv < ax + 19; wv += 3) F(wv, fy - 10, 1, 1, "#8FD0E8", 0.6); // ripples
  box(x + w - 16, fy - 8, 12, 8, "#8A6E50"); // supply shelf
  for (let k = 0; k < 3; k++) F(x + w - 14 + k * 4, fy - 6, 3, 4, good(look, k)); // supplies
  if (g.busy) personStanding(ctx, ax - 8, fy, g.seed);
}

/** Flower Shop: a hanging fern, tiered flower stands, floor buckets, a wrap
 *  counter, and the florist standing at it. */
function florist(ctx: CanvasRenderingContext2D, look: ShopLook, g: ShopGeom): void {
  const { F, box } = pen(ctx);
  const { x, w, floorY: fy, railY } = g;
  F(x + w - 16, railY + 1, 10, 3, "#4E7A3E"); // hanging fern
  F(x + w - 14, railY + 4, 6, 3, "#3E6A2E");
  for (const [ty, txo, tw] of [
    [railY + 3, 10, Math.round(w * 0.5)],
    [railY + 11, 14, Math.round(w * 0.4)],
  ] as const) {
    const tx = x + txo;
    F(tx, ty + 4, tw, 1, "#A98A6A"); // stand shelf
    for (let gx = tx + 2, k = 0; gx + 3 < tx + tw; gx += 6, k++) {
      F(gx + 1, ty + 1, 1, 3, "#4A7A4A"); // stem
      F(gx, ty - 1, 3, 3, good(look, k)); // bloom
    }
  }
  for (let bx = x + Math.round(w * 0.56), k = 0; k < 4; bx += 9, k++) {
    box(bx, fy - 6, 7, 6, "#8A8A92"); // floor bucket
    F(bx + 1, fy - 8, 5, 2, good(look, k)); // bloom cluster
    F(bx + 3, fy - 10, 1, 3, "#4A7A4A"); // tall stem
  }
  box(x + 10, fy - 6, 16, 6, "#A9743C"); // wrap counter
  F(x + 12, fy - 8, 4, 2, "#F4E4C0"); // wrap paper
  personStanding(ctx, x + 28, fy, g.seed ^ 0x1f); // florist (staff)
}

/** Book Store: three bookcases of colored spines, a lit reading table, a
 *  rolling ladder, and a seated reader. */
function books(ctx: CanvasRenderingContext2D, look: ShopLook, g: ShopGeom): void {
  const { F, box, glow } = pen(ctx);
  const { x, w, floorY: fy, railY } = g;
  for (const cxo of [10, Math.round(w * 0.34), Math.round(w * 0.58)]) {
    const cx = x + cxo;
    const cw = Math.min(20, Math.round(w * 0.22));
    box(cx, railY, cw, fy - railY - 1, "#6A5240"); // bookcase
    for (let r = 0; r < 4; r++)
      for (let bx = cx + 2, k = 0; bx + 2 < cx + cw - 1; bx += 3, k++) F(bx, railY + 2 + r * 6, 2, 5, good(look, k + r)); // spines
  }
  const dx = x + w - 24;
  box(dx, fy - 6, 16, 3, "#8C6E50"); // reading table
  F(dx + 2, fy - 8, 4, 2, "#F4F0E4"); // open book
  F(dx + 7, fy - 9, 1, 3, "#7A6A50"); // lamp stem
  F(dx + 5, fy - 11, 5, 3, PAL.glowLit); // warm lamp shade
  glow(dx + 7, fy - 9, PAL.glowLit); // reading glow
  F(x + w - 6, railY, 1, fy - railY, "#8A6A4A"); // rolling-ladder rail
  for (let ly = railY + 3; ly < fy; ly += 4) F(x + w - 8, ly, 4, 1, "#8A6A4A"); // rungs
  if (g.busy) personSeated(ctx, dx - 8, fy, g.seed); // reader (seated)
}

/** Drug Store: a green-cross sign, a dispensing counter with a white-coated
 *  pharmacist, aisles of medicine bottles, a chilled fridge, and a customer. */
function pharmacy(ctx: CanvasRenderingContext2D, look: ShopLook, g: ShopGeom): void {
  const { F, box } = pen(ctx);
  const { x, w, floorY: fy, railY } = g;
  F(x + w - 16, railY + 1, 10, 3, "#FFFFFF"); // sign field
  F(x + w - 12, railY - 1, 2, 7, "#3A8A4A"); // cross, vertical
  F(x + w - 15, railY + 2, 8, 2, "#3A8A4A"); // cross, horizontal
  const cw = Math.round(w * 0.34);
  box(x + 8, fy - 8, cw, 8, "#F0F0EC"); // dispensing counter
  F(x + 8, fy - 8, cw, 1, "#FFFFFF");
  personFigure(ctx, x + 8 + Math.round(cw / 2), fy - 8, "seated", "#F4F0E4"); // pharmacist, white coat
  F(x + 14, fy - 12, 6, 4, "#DCE8DC"); // register
  const aisleX = x + cw + 14;
  const aisleW = Math.round(w * 0.4);
  for (let ay = railY + 2; ay < fy - 10; ay += 8) {
    F(aisleX, ay, aisleW, 1, "#A98A6A"); // aisle shelf
    for (let gx = aisleX + 2, k = 0; gx + 3 < aisleX + aisleW; gx += 6, k++) F(gx, ay - 4, 4, 4, good(look, k)); // bottles
  }
  box(x + w - 14, fy - 11, 10, 11, "#DCE8EC"); // chilled fridge
  F(x + w - 13, fy - 10, 8, 4, "#BFE0E8");
  F(x + w - 11, fy - 6, 4, 1, "#5db4e8");
  if (g.busy) personStanding(ctx, x + cw + 8, fy, g.seed);
}

/** Boutique: a small chandelier, a spotlit dress on a form, a short designer
 *  rail, a tall gilt mirror, a velvet bench, and a browsing customer. */
function boutique(ctx: CanvasRenderingContext2D, look: ShopLook, g: ShopGeom): void {
  const { F, box, glow } = pen(ctx);
  const { x, w, floorY: fy, railY } = g;
  const cc = x + Math.round(w / 2);
  F(cc - 1, railY, 2, 3, "#C9A24B"); // chandelier stem
  F(cc - 3, railY + 3, 5, 2, "#E8C860"); // chandelier arm
  glow(cc, railY + 3, PAL.glowLit);
  const dx = x + Math.round(w * 0.2);
  F(dx, fy - 4, 6, 2, "#C8C8C8"); // form base
  F(dx + 1, fy - 16, 4, 12, good(look, 1)); // spotlit dress
  F(dx + 1, fy - 16, 4, 1, "#E8D0F0"); // dress sheen
  F(dx + 2, fy - 18, 2, 2, "#E8C9A0"); // form head
  glow(dx + 3, fy - 11, "#F0E0F8"); // spotlight pool
  const railX = x + Math.round(w * 0.42);
  const railW = Math.round(w * 0.24);
  F(railX, railY + 3, railW, 1, "#B8A0C8"); // designer rail
  for (let gx = x + Math.round(w * 0.44), k = 0; k < 3; gx += 8, k++) F(gx, railY + 4, 4, 8, good(look, k)); // dresses
  F(x + w - 14, railY + 2, 5, fy - railY - 3, "#D0E0EC"); // tall gilt mirror
  F(x + w - 15, railY + 1, 7, 1, "#B8A0C8");
  box(x + w - 30, fy - 4, 12, 4, "#7C5A6A"); // velvet bench
  if (g.busy) personStanding(ctx, x + Math.round(w * 0.34), fy, g.seed);
}

/** Electronics: a dark front with a wall of glowing demo screens, a gadget
 *  counter of phones with a blue accent light, and a clerk. */
function screens(ctx: CanvasRenderingContext2D, look: ShopLook, g: ShopGeom): void {
  const { F, box, glow } = pen(ctx);
  const { x, w, floorY: fy, railY } = g;
  const cols = Math.floor((w - 16) / 12);
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < cols; c++) {
      const sx = x + 10 + c * 12;
      const sy = railY + 1 + r * 10;
      if (sx + 10 > x + w - 4) break;
      box(sx, sy, 10, 9, "#15151C"); // bezel
      F(sx + 1, sy + 1, 8, 6, good(look, r * 3 + c)); // demo screen
      F(sx + 1, sy + 1, 8, 1, "#FFFFFF", 0.3); // scanline
      glow(sx + 5, sy + 4, "#6FB0E0"); // screen glow
    }
  box(x + 8, fy - 6, w - 16, 4, "#2A2E38"); // gadget counter
  F(x + 8, fy - 6, w - 16, 1, "#3E4654");
  for (let gx = x + 14, k = 0; gx + 4 < x + w - 10; gx += 16, k++) {
    F(gx, fy - 9, 5, 3, good(look, k)); // phone on stand
    F(gx + 1, fy - 10, 3, 1, "#FFFFFF", 0.4);
  }
  personStanding(ctx, x + w - 16, fy, g.seed ^ 0x1f); // clerk (staff)
}

/** Bank: a big round vault door, a teller counter with divider windows and two
 *  seated tellers, a queue rope, a brass coin, and a customer. */
function bank(ctx: CanvasRenderingContext2D, look: ShopLook, g: ShopGeom): void {
  const { F, box } = pen(ctx);
  const { x, w, floorY: fy, railY } = g;
  const vx = x + w - 16;
  F(vx - 2, fy - 16, 16, 16, "#6A6E76"); // vault door
  F(vx - 2, fy - 16, 16, 1, "#8A8E96");
  F(vx + 5, fy - 8, 5, 5, "#3A3E44"); // vault hub
  for (let a = 0; a < 8; a++) {
    const ang = a * 0.785;
    F(vx + 7 + Math.round(Math.cos(ang) * 5), fy - 6 + Math.round(Math.sin(ang) * 5), 1, 1, "#8A8E96"); // bolt
  }
  const cw = Math.round(w * 0.5);
  box(x + 8, fy - 9, cw, 6, "#D8D4C8"); // teller counter
  F(x + 8, fy - 9, cw, 1, "#EAE6DA");
  const tellerSeeds = [g.seed ^ 0x51, g.seed ^ 0x77];
  let ti = 0;
  for (const wxo of [14, 14 + Math.round(cw / 2)]) {
    const wx = x + wxo;
    F(wx, fy - 15, 7, 6, "#6A5240"); // teller window
    F(wx + 1, fy - 14, 5, 4, "#E8E4DA");
    personSeated(ctx, wx, fy - 9, tellerSeeds[ti++]); // teller (staff, seated)
  }
  F(x + cw + 12, fy - 8, 1, 8, good(look, 1)); // queue rope posts
  F(x + cw + 18, fy - 8, 1, 8, good(look, 1));
  F(x + cw + 12, fy - 8, 7, 1, "#C8A040"); // rope
  F(x + cw + 8, railY + 3, 6, 6, good(look, 0)); // brass coin
  F(x + cw + 10, railY + 5, 2, 2, good(look, 1));
  if (g.busy) personStanding(ctx, x + cw + 16, fy, g.seed);
}

/** Hair Salon: two styling stations (mirror plus chair) with a stylist cutting
 *  a seated client, a red-white barber pole, a product shelf, and a wash basin. */
function salon(ctx: CanvasRenderingContext2D, look: ShopLook, g: ShopGeom): void {
  const { F, box } = pen(ctx);
  const { x, w, floorY: fy, railY } = g;
  const stationX = [12, Math.round(w * 0.4)];
  for (let i = 0; i < 2; i++) {
    const sx = x + stationX[i];
    F(sx, railY + 2, 7, 8, "#C8DCE8"); // mirror
    F(sx - 1, railY + 1, 9, 1, "#B8A0B0"); // mirror frame
    F(sx - 1, railY + 2, 1, 8, "#D8E4EC");
    F(sx + 1, fy - 8, 5, 5, "#3E4654"); // chair back
    F(sx + 2, fy - 3, 3, 3, "#2A2E38"); // chair base
    const hasClient = i === 0 ? g.busy : g.occupants >= 2;
    if (hasClient) personSeated(ctx, sx, fy - 1, g.seed ^ (i * 0x31 + 5)); // client (seated)
    personStanding(ctx, sx + 8, fy, g.seed ^ (i * 0x55 + 9)); // stylist (staff)
  }
  const px = x + w - 9;
  F(px, railY, 3, 12, "#F4F0E4"); // barber pole
  for (let py = 0; py < 12; py += 4) {
    F(px, railY + py, 3, 2, "#B84848"); // red band
    F(px, railY + py + 2, 3, 2, "#4F6EC8"); // blue band
  }
  box(x + w - 22, railY + 2, 10, 6, "#E8DCEC"); // product shelf
  for (let k = 0; k < 3; k++) F(x + w - 20 + k * 3, railY + 3, 2, 4, good(look, k)); // products
  F(x + Math.round(w * 0.66), fy - 6, 7, 3, "#C8DCE8"); // wash basin
  F(x + Math.round(w * 0.67), fy - 3, 5, 3, "#8A8E96");
}

/** Post Office: a wall of brass PO boxes, a service counter with a seated clerk
 *  and a scale, stacked parcels, a blue mail drop box, and a customer. */
function post(ctx: CanvasRenderingContext2D, look: ShopLook, g: ShopGeom): void {
  const { F, box } = pen(ctx);
  const { x, w, floorY: fy, railY } = g;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 6; c++) {
      const bx = x + 10 + c * 5;
      const by = railY + 1 + r * 5;
      F(bx, by, 4, 4, good(look, 3)); // brass PO box front
      F(bx, by, 4, 1, "#D8C8A0"); // box top
      F(bx + 1, by + 1, 1, 1, "#8A7A54"); // keyhole
    }
  const cw = Math.round(w * 0.3);
  const counterX = x + Math.round(w * 0.42);
  box(counterX, fy - 8, cw, 8, "#D8D4C8"); // service counter
  personSeated(ctx, counterX + Math.round(cw / 2), fy - 8, g.seed ^ 0x1f); // clerk (staff, seated)
  F(counterX + 3, fy - 11, 4, 3, "#8A8E96"); // scale
  const pxs = counterX + cw + 4;
  F(pxs, fy - 5, 7, 5, "#C8A87A"); // parcels
  F(pxs + 8, fy - 5, 5, 5, "#B8986A");
  F(pxs + 3, fy - 9, 6, 4, "#C8A87A");
  for (const [px2, py2] of [[pxs, fy - 5], [pxs + 8, fy - 5], [pxs + 3, fy - 9]] as const) F(px2 + 1, py2 + 1, 3, 1, "#8A6A44"); // tape
  F(x + w - 11, fy - 9, 6, 9, "#4F6EC8"); // mail drop box
  F(x + w - 11, fy - 9, 6, 1, "#6E8AD8");
  F(x + w - 10, fy - 7, 4, 1, "#2A3A6A"); // slot
  if (g.busy) personStanding(ctx, x + Math.round(w * 0.4) - 6, fy, g.seed);
}

/** Sports Gear: a jersey on the wall, a ball bin, a rack of bats and sticks, a
 *  shoe wall, a gear mannequin, and a browsing customer. */
function sports(ctx: CanvasRenderingContext2D, look: ShopLook, g: ShopGeom): void {
  const { F, box } = pen(ctx);
  const { x, w, floorY: fy, railY } = g;
  F(x + 12, railY + 1, 8, 9, good(look, 0)); // jersey body
  F(x + 11, railY, 10, 2, "#C84A4A"); // shoulders
  F(x + 10, railY + 2, 2, 3, good(look, 0)); // sleeve
  F(x + 20, railY + 2, 2, 3, good(look, 0)); // sleeve
  F(x + 15, railY + 3, 2, 2, "#FFFFFF"); // number
  box(x + 26, fy - 6, 14, 6, "#8A8A92"); // ball bin
  for (let k = 0; k < 3; k++) F(x + 29 + k * 4, fy - 8, 3, 3, good(look, k)); // balls
  for (let rx = x + Math.round(w * 0.42), k = 0; k < 5; rx += 3, k++) F(rx, fy - 13, 1, 13, k % 2 ? "#C8A87A" : "#A8845C"); // bats and sticks
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++) F(x + Math.round(w * 0.56) + c * 7, railY + 2 + r * 6, 6, 4, good(look, r * 3 + c)); // shoe wall
  const mx = x + w - 12;
  F(mx, fy - 2, 6, 2, "#C8C8C8"); // plinth
  F(mx + 1, fy - 14, 4, 12, look.awning); // gear mannequin in the trade's orange
  F(mx + 2, fy - 17, 3, 3, "#E8C9A0"); // head
  if (g.busy) personStanding(ctx, x + 26, fy, g.seed);
}

/** Dispatch to the trade interior. The union is closed and every case returns,
 *  so no default arm is needed. */
export function drawShopInterior(ctx: CanvasRenderingContext2D, look: ShopLook, g: ShopGeom): void {
  switch (look.interior) {
    case "racks":
      return racks(ctx, look, g);
    case "pets":
      return pets(ctx, look, g);
    case "florist":
      return florist(ctx, look, g);
    case "books":
      return books(ctx, look, g);
    case "pharmacy":
      return pharmacy(ctx, look, g);
    case "boutique":
      return boutique(ctx, look, g);
    case "screens":
      return screens(ctx, look, g);
    case "bank":
      return bank(ctx, look, g);
    case "salon":
      return salon(ctx, look, g);
    case "post":
      return post(ctx, look, g);
    case "sports":
      return sports(ctx, look, g);
  }
}
