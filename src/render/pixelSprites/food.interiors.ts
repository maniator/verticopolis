import { PAL, personSeated, shade } from "./common";
import type { FastFoodLook, RestaurantLook } from "./food.looks";

/**
 * Faithful pixel-art interiors for the food and entertainment rooms, ported
 * one rectangle at a time from the committed reference draw code
 * (`_bmad-output/implementation-artifacts/pixelart-figma/build-scripts/page-03-food-entertainment.build.js`)
 * via the `F(A, x, y, w, h, color, opacity)` to `ctx.fillRect` mapping. Each
 * fast-food subtype and each restaurant subtype furnishes its own DISTINCT
 * room under the shared kind anchor (the fast-food sign band, the restaurant's
 * textured dining room). Split out of `food.ts` for the 500-line ceiling; the
 * thin per-kind dispatchers stay in `food.ts`.
 *
 * Occupancy is honest: seated diners, behind-counter staff, and cinema audience
 * heads fill in seed order up to the room's occupant count (never a hash of the
 * unit id), so an empty venue reads empty and a full one reads full, and a TDT
 * import (which renumbers ids) does not reshuffle the crowd. Every figure is a
 * finalized `person()`-family build: food occupants are the seated 15px build
 * (the reference `person()` is legless), which is why the sushi and soba chefs
 * behind their counters are seated too, per the finalized geometry table.
 *
 * Integer coordinates only (`Math.round` before every `fillRect`) and no
 * reserved state color decorates (stress red, vacancy grays, notice amber,
 * dirty tray, ready lamp, closed sign). The one animation on this page is the
 * cinema marquee and screen; every other room is static.
 */

// ---- The `F` -> `fillRect` mapping and the ported build-script helpers -----

/** A rectangle fill bound to a room's screen origin: build-local `(bx, by)`
 *  plus the origin, rounded, min 1px, with a transient alpha for the rect. */
type Fill = (bx: number, by: number, bw: number, bh: number, c: string, o?: number) => void;

function mkFill(ctx: CanvasRenderingContext2D, ox: number, oy: number): Fill {
  return (bx, by, bw, bh, c, o = 1) => {
    ctx.fillStyle = c;
    if (o !== 1) ctx.globalAlpha = o;
    ctx.fillRect(Math.round(ox + bx), Math.round(oy + by), Math.max(1, Math.round(bw)), Math.max(1, Math.round(bh)));
    if (o !== 1) ctx.globalAlpha = 1;
  };
}

/** A soft four-step warm glow around a fixture bulb. */
function glow(f: Fill, cx: number, cy: number, c: string): void {
  for (const [s, a] of [[4, 0.1], [3, 0.16], [2, 0.3], [1, 0.6]] as const) f(cx - s, cy - s, s * 2, s * 2, c, a);
}

/** A framed prop box: contact shadow, fill, then top/left highlight and
 *  right/bottom shade so the block reads as lit from the upper left. */
function box(f: Fill, x: number, y: number, w: number, h: number, b: string): void {
  f(x, y + h, w, 1, "#000000", 0.18);
  f(x, y, w, h, b);
  f(x, y, w, 1, shade(b, 22));
  f(x, y, 1, h, shade(b, 12));
  f(x + w - 1, y, 1, h, shade(b, -16));
  f(x, y + h - 1, w, 1, shade(b, -22));
}

/** Textured wall: fill, an upper light band, then tile / plank / flat detail. */
function wtex(f: Fill, x: number, y: number, w: number, h: number, b: string, mode: "tile" | "plank" | "flat"): void {
  f(x, y, w, h, b);
  f(x, y, w, Math.round(h * 0.4), shade(b, 7));
  if (mode === "tile") {
    for (let py = y + 3; py < y + h; py += 4) {
      f(x, py, w, 1, shade(b, -10), 0.5);
      for (let px = x + ((((py - y) / 4) | 0) % 2 ? 4 : 0); px < x + w; px += 8) f(px, py - 3, 1, 3, shade(b, -8), 0.4);
    }
  } else if (mode === "plank") {
    for (let px = x; px < x + w; px += 13) f(px, y, 1, h, shade(b, -12), 0.5);
  } else {
    for (let py = y + 4; py < y + h; py += 6) f(x, py, w, 1, shade(b, -8), 0.4);
  }
}

/** Polished floor band: fill, a bright top edge and dark seam, plus a checker
 *  inlay or plain vertical seams. */
function pfloor(f: Fill, x: number, fy: number, w: number, h: number, b: string, checker = false): void {
  f(x, fy, w, h, b);
  f(x, fy, w, 1, shade(b, 18));
  f(x, fy + 1, w, 1, shade(b, -8));
  f(x, fy + h - 1, w, 1, shade(b, -24));
  if (checker) {
    for (let px = x; px < x + w; px += 6) f(px + ((((px - x) / 6) | 0) % 2 ? 3 : 0), fy + 2, 3, h - 3, shade(b, 14), 0.5);
  } else {
    for (let px = x + 7; px < x + w; px += 12) f(px, fy + 1, 1, h - 2, shade(b, -16));
  }
}

/** The fast-food sign band, the one shape every variety keeps. `signWarm` spills
 *  a warm sign glow onto the wall just below it (E1 palette) so lit signage
 *  brightens the band without recoloring its face. */
function signBand(f: Fill, w: number, bc: string, ac: string): void {
  f(0, 0, w, 7, bc);
  f(0, 0, w, 1, shade(bc, 34));
  f(0, 6, w, 1, shade(bc, -34));
  for (let sx = 3; sx < w - 2; sx += 8) f(sx, 2, 4, 3, ac);
  f(0, 7, w, 1, PAL.signWarm, 0.55);
}

/** A ceiling pendant lamp on a short cord, glowing warm. */
function pendant(f: Fill, x: number, c: string): void {
  f(x, 7, 1, 3, "#3A3E44");
  f(x - 2, 10, 5, 2, shade(c, -16));
  f(x - 1, 11, 3, 1, "#F8E2B4");
  glow(f, x, 12, "#F8E2B4");
}

/** A wall sconce, glowing warm when lit. */
function sconce(f: Fill, x: number, y: number, lamp: string): void {
  f(x, y, 1, 4, "#5A4632");
  f(x - 1, y - 2, 3, 3, lamp);
  glow(f, x, y - 1, lamp);
}

/** A framed picture: gilt frame, the pictured pane, and a top highlight. */
function artF(f: Fill, x: number, y: number, w: number, h: number, pic: string): void {
  box(f, x, y, w, h, "#7A5A38");
  f(x + 1, y + 1, w - 2, h - 2, pic);
  f(x + 1, y + 1, w - 2, 1, shade(pic, 18));
}

/** A boba cup with a straw and a domed lid, held by a cafe patron. */
function boba(f: Fill, x: number, y: number, cupc: string): void {
  f(x, y, 4, 6, cupc);
  f(x, y, 4, 1, "#FFFFFF", 0.4);
  f(x, y + 4, 4, 2, "#3A2A24");
  f(x + 1, y - 2, 2, 2, "#F4F0E4");
  f(x + 2, y - 3, 1, 2, "#E85D8A");
}

/** A textured back wall for the darker dining rooms. */
function twall(f: Fill, x: number, y: number, w: number, h: number, b: string): void {
  f(x, y, w, h, b);
  f(x, y, w, Math.round(h * 0.4), shade(b, 8));
  for (let py = y + 3; py < y + h; py += 6) f(x, py, w, 1, shade(b, -8), 0.5);
  for (let dx = x + 4, i = 0; dx < x + w; dx += 8, i++) for (let dy = y + 5 + (i % 2) * 3; dy < y + h - 2; dy += 6) f(dx, dy, 1, 1, shade(b, 13), 0.5);
}

/** A wainscot dado below the rail line, with panel seams and a wood rail. */
function wainscot(f: Fill, x: number, fy: number, w: number, railY: number, b: string): void {
  f(x, railY, w, fy - railY, shade(b, -13));
  for (let px = x + 10; px < x + w - 4; px += 16) f(px, railY + 3, 1, fy - railY - 5, shade(b, -22));
  f(x, railY - 1, w, 2, "#5A3E28");
  f(x, railY - 1, w, 1, "#7A5A38");
}

/** A green EXIT sign (EXIT green `#6bd47a` is not a reserved state color). */
function exitSign(f: Fill, x: number, y: number): void {
  f(x, y, 10, 4, "#0E3A1E");
  f(x, y, 10, 1, "#1A5A2E");
  for (let k = 0; k < 4; k++) f(x + 1 + k * 2, y + 1, 1, 2, "#6bd47a");
  glow(f, x + 5, y + 2, "#6bd47a");
}

// ---- Occupancy fill ---------------------------------------------------------

/** A seat filler tied to the room's real occupant count. Each call draws the
 *  next seated occupant only while fewer than `n` have been drawn, so exactly
 *  the first `n` seats fill in seed (draw) order and an empty venue draws none.
 *  The shirt seed is the room GEOGRAPHY plus the seat index, so it survives a
 *  TDT id renumber. Returns whether an occupant was actually drawn, so a
 *  person-implying prop (a held boba cup, a chef's hat, a laptop) can gate on
 *  the same count and never float over an empty seat. */
type Seat = (px: number, footY: number) => boolean;

function mkSeat(ctx: CanvasRenderingContext2D, ox: number, oy: number, geoSeed: number, n: number): Seat {
  let i = 0;
  return (px, footY) => {
    if (i >= n) return false;
    personSeated(ctx, ox + px, oy + footY, geoSeed + i++);
    return true;
  };
}

// ---- Fast food --------------------------------------------------------------

export function drawFastFood(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, look: FastFoodLook, n: number, geoSeed: number): void {
  const f = mkFill(ctx, x, y);
  const fy = h - 6;
  const seat = mkSeat(ctx, x, y, geoSeed, n);
  switch (look.interior) {
    case "counterBar":
      soba(f, w, h, fy, look, seat);
      break;
    case "teahouse":
      teahouse(f, w, h, fy, look, seat);
      break;
    case "parlor":
      parlor(f, w, h, fy, look, seat);
      break;
    case "cafe":
      cafe(f, w, h, fy, look, seat);
      break;
    default:
      burger(f, w, h, fy, look, seat);
  }
}

function burger(f: Fill, w: number, h: number, fy: number, look: FastFoodLook, seat: Seat): void {
  wtex(f, 0, 7, w, fy - 7, look.wall, "tile");
  pfloor(f, 0, fy, w, h - fy, look.floor, look.floorStyle === "checker");
  signBand(f, w, look.band, look.stripe);
  pendant(f, Math.round(w * 0.24), look.band);
  // Menu board (ketchup-red patty, non-reserved).
  box(f, 4, 10, 30, 12, "#22262E");
  f(7, 12, 10, 3, "#E0452C"); f(7, 15, 10, 1, "#E8C14A");
  f(19, 12, 12, 1, "#F8E2B4"); f(19, 15, 10, 1, "#DCE8C0"); f(19, 18, 8, 1, "#F4C0C0");
  glow(f, 20, 16, "#F8E2B4");
  // Service counter with grill, soda machine, and the cook (seated occupant).
  const cw = Math.round(w * 0.3);
  box(f, 4, fy - 10, cw, 10, "#C87A2E"); f(4, fy - 10, cw, 1, "#E09A4E"); f(cw - 6, fy - 13, 4, 3, "#2A2E38");
  seat(10, fy - 10);
  f(16, fy - 16, 10, 4, "#3A3E44"); f(18, fy - 17, 3, 1, "#8C3A32"); f(22, fy - 17, 3, 1, "#8C3A32");
  glow(f, 20, fy - 15, "#E8862A");
  f(28, fy - 16, 5, 6, "#8A8A92"); f(29, fy - 15, 3, 2, "#5db4e8");
  // Round pedestal two-tops with trays and seated couples.
  for (let tx = cw + 18; tx + 16 < w; tx += 32) {
    f(tx - 2, fy - 1, 16, 1, "#000000", 0.16);
    f(tx, fy - 5, 12, 3, "#E8E4DA"); f(tx, fy - 5, 12, 1, "#FFFFFF"); f(tx + 5, fy - 2, 2, 2, "#B0A99A");
    f(tx + 2, fy - 7, 2, 2, "#E0452C"); f(tx + 7, fy - 7, 2, 2, "#E8C14A");
    seat(tx - 5, fy); seat(tx + 12, fy);
  }
}

function soba(f: Fill, w: number, h: number, fy: number, look: FastFoodLook, seat: Seat): void {
  wtex(f, 0, 7, w, fy - 7, look.wall, "plank");
  pfloor(f, 0, fy, w, h - fy, look.floor);
  signBand(f, w, look.band, look.stripe);
  // Full-width indigo noren fringe under the sign.
  for (let nx = 2; nx < w - 2; nx += 7) { f(nx, 7, 6, 5, "#2E4A7A"); f(nx, 7, 6, 1, "#3E5A8C"); }
  f(0, 12, w, 1, "#1E3560");
  // Back shelf with stacked bowls.
  f(6, 15, w * 0.5, 2, "#8A6E48");
  for (let bx = 10; bx < w * 0.5; bx += 8) f(bx, 13, 4, 2, "#F4F0E4");
  // Broth pot with steam, and the chef behind it (seated occupant).
  const px = Math.round(w * 0.6);
  f(px, 13, 10, 6, "#8A8A92"); f(px + 2, 10, 2, 3, "#F4F0E4", 0.6); f(px + 6, 9, 2, 4, "#F4F0E4", 0.5);
  seat(Math.round(w * 0.78), fy - 13);
  // Noodle counter with steaming bowls.
  const cy2 = fy - 8;
  box(f, 4, cy2, w - 8, 4, "#8C6E48"); f(4, cy2, w - 8, 1, "#A8845C");
  for (let bx = 12; bx < w - 8; bx += 16) { f(bx, cy2 - 2, 4, 2, "#F4F0E4"); f(bx, cy2 - 3, 4, 1, "#FFFFFF", 0.5); }
  // Stools with seated diners along the counter.
  for (let sx = 10; sx + 6 < w - 6; sx += 16) { f(sx + 1, fy - 3, 3, 3, "#5A4632"); seat(sx, fy - 3); }
}

function teahouse(f: Fill, w: number, h: number, fy: number, look: FastFoodLook, seat: Seat): void {
  const railY = 24;
  wtex(f, 0, 7, w, railY - 7, look.wall, "flat");
  f(0, railY, w, fy - railY, "#3E7D5A"); f(0, railY - 1, w, 1, "#2E5E42"); f(0, railY, w, 1, "#4E9A6E"); // jade wainscot
  pfloor(f, 0, fy, w, h - fy, look.floor);
  signBand(f, w, look.band, look.stripe);
  // Hanging lantern.
  f(14, 7, 1, 3, "#6a5040"); f(11, 10, 7, 5, "#E0554A"); f(11, 12, 7, 1, "#E8C14A"); glow(f, 14, 12, "#E85D4A");
  // Drinks menu and a potted plant.
  box(f, 24, 9, 34, 12, "#204030");
  for (let r = 0; r < 3; r++) f(27, 11 + r * 3, 20, 1, ["#F4F0E4", "#E8C14A", "#DCE8C0"][r]);
  f(50, 11, 5, 7, "#C8A0D0"); f(51, 10, 3, 1, "#3A2A24"); glow(f, 52, 14, "#E8C0E8");
  // Tea and boba counter: stainless tea urn and colored boba dispensers.
  const cw = Math.round(w * 0.36);
  box(f, 4, fy - 11, cw, 11, "#8A6E48"); f(4, fy - 11, cw, 1, "#A8845C");
  f(8, fy - 19, 7, 8, "#B8BCC0"); f(9, fy - 12, 5, 1, "#8A8E92"); f(11, fy - 11, 3, 2, "#6A6E72"); f(8, fy - 19, 7, 2, "#D8DCE0");
  [18, 24, 30].forEach((dx, i) => { f(dx, fy - 17, 4, 6, ["#C8A0D0", "#E8C060", "#A8D0B0"][i]); f(dx, fy - 17, 4, 1, "#F4F0E4", 0.5); f(dx, fy - 11, 4, 1, "#6A5A48"); });
  f(cw - 8, fy - 14, 3, 3, "#F4F0E4"); f(cw - 8, fy - 17, 3, 3, "#F4F0E4"); f(cw - 4, fy - 14, 3, 2, "#2A2E38");
  // Tea server (seated occupant), then a window stool bar of patrons holding boba.
  seat(10, fy - 11);
  const bx = cw + 8;
  box(f, bx, fy - 6, w - bx - 4, 2, "#6A4A30");
  // The boba cup is held by the patron, so it draws only when the stool fills.
  for (let sx = bx + 3, i = 0; sx + 6 < w - 4; sx += 17, i++) {
    f(sx + 1, fy - 3, 3, 3, "#5A4632"); if (seat(sx, fy - 3)) boba(f, sx + 6, fy - 9, ["#C8A0D0", "#E8C060", "#D0A080"][i % 3]);
  }
  // Bamboo plant in the corner.
  f(w - 6, fy - 12, 1, 12, "#4E7A3E"); f(w - 8, fy - 14, 3, 2, "#5AA85A"); f(w - 5, fy - 16, 3, 2, "#5AA85A"); box(f, w - 8, fy - 4, 5, 4, "#8C5A3A");
}

function parlor(f: Fill, w: number, h: number, fy: number, look: FastFoodLook, seat: Seat): void {
  wtex(f, 0, 7, w, fy - 7, look.wall, "flat");
  pfloor(f, 0, fy, w, h - fy, look.floor, look.floorStyle === "checker");
  signBand(f, w, look.band, look.stripe);
  // A wall clock and a scalloped valance.
  f(Math.round(w * 0.5) - 2, 9, 4, 4, "#F4E4B0"); f(Math.round(w * 0.5) - 1, 13, 2, 3, "#E8A050"); glow(f, Math.round(w * 0.5), 11, "#FFF0C0");
  for (let vx = 0; vx < w; vx += 6) f(vx, 7, 3, 3, vx % 12 ? "#E07AA6" : "#FFFFFF");
  // Chrome display freezer with colored tubs and a cone rack.
  box(f, 5, fy - 13, 30, 13, "#F6F4F6"); f(5, fy - 13, 30, 3, "#BCD8E8");
  for (let k = 0; k < 5; k++) f(8 + k * 5, fy - 11, 4, 4, ["#E88AB0", "#F4E4B0", "#8C5A3A", "#A0D8C0", "#F0A0A0"][k]);
  f(7, fy - 17, 1, 4, "#E8B870"); f(7, fy - 19, 1, 2, "#F4C0D0"); f(11, fy - 16, 1, 3, "#E8B870"); f(11, fy - 18, 1, 2, "#F0E0B0");
  // Soda-fountain counter with tall stools and seated kids.
  const cw = Math.round(w * 0.32);
  box(f, cw + 8, fy - 6, w - cw - 14, 2, "#C8DCE8");
  for (let sx = cw + 12, i = 0; sx + 6 < w - 16; sx += 18, i++) { f(sx + 1, fy - 5, 3, 5, "#C87A8E"); f(sx, fy - 5, 5, 1, "#D88AA0"); seat(sx, fy - 5); }
  // Pink booth with a patron.
  f(w - 14, fy - 11, 3, 11, "#D87A9A"); box(f, w - 11, fy - 6, 8, 2, "#E8A0B8"); seat(w - 9, fy);
}

function cafe(f: Fill, w: number, h: number, fy: number, look: FastFoodLook, seat: Seat): void {
  wtex(f, 0, 7, w, fy - 7, look.wall, "flat");
  pfloor(f, 0, fy, w, h - fy, look.floor);
  signBand(f, w, look.band, look.stripe);
  // Chalkboard menu and a wall grinder shelf.
  box(f, Math.round(w * 0.4), 9, 26, 11, "#26302A");
  for (let r = 0; r < 3; r++) f(Math.round(w * 0.4) + 3, 12 + r * 3, 18, 1, ["#DCE8C0", "#F4F0E4", "#E8C0A0"][r]);
  f(Math.round(w * 0.72), 8, 1, 3, "#3A2E28"); box(f, Math.round(w * 0.72) - 6, 11, 13, 5, "#5A4632"); f(Math.round(w * 0.72) - 4, 12, 9, 3, "#E8DCC8");
  pendant(f, Math.round(w * 0.24), look.band);
  // Espresso bar with machine, grinder, and a pastry case.
  const cw = Math.round(w * 0.34);
  box(f, 4, fy - 9, cw, 9, "#5A4632"); f(4, fy - 9, cw, 1, "#7A6248");
  f(8, fy - 14, 7, 5, "#9AA0A8"); f(9, fy - 13, 2, 3, "#5A5E66"); f(10, fy - 16, 1, 2, "#F4F0E4", 0.6); glow(f, 10, fy - 15, "#F0F4F8");
  f(17, fy - 13, 4, 4, "#3A3E44"); box(f, cw - 14, fy - 13, 12, 4, "#EEE8DA");
  for (let k = 0; k < 3; k++) f(cw - 12 + k * 4, fy - 13, 2, 2, ["#C8905A", "#E8C060", "#B06040"][k]);
  // Barista (seated occupant) behind the bar.
  seat(10, fy - 9);
  // Window bench with seated patrons.
  const bx = cw + 8;
  box(f, bx, fy - 6, Math.round(w * 0.3), 2, "#8C6E48");
  // The takeaway cup belongs to a seated patron, so it gates on the stool fill.
  for (let sx = bx + 2, i = 0; sx + 6 < bx + w * 0.3; sx += 15, i++) { f(sx + 1, fy - 3, 3, 3, "#5A4632"); if (seat(sx, fy - 3)) f(sx, fy - 9, 3, 2, "#F4F0E4"); }
  // Lounge armchair (furniture, always drawn); the laptop appears only when a patron sits.
  box(f, w - 24, fy - 9, 10, 9, "#7C5A4A"); f(w - 24, fy - 11, 10, 3, "#8C6A5A");
  if (seat(w - 22, fy - 1)) { box(f, w - 13, fy - 5, 8, 2, "#6B4A2B"); f(w - 11, fy - 8, 4, 2, "#2A2E38"); }
}

// ---- Restaurants ------------------------------------------------------------

export function drawRestaurant(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, look: RestaurantLook, lit: boolean, n: number, geoSeed: number): void {
  const f = mkFill(ctx, x, y);
  const fy = h - 6;
  const railY = 24;
  const seat = mkSeat(ctx, x, y, geoSeed, n);
  // Shared dark dining shell: textured wall, wainscot dado, top trim, floor.
  twall(f, 0, 0, w, fy, look.wall);
  wainscot(f, 0, fy, w, railY, look.wall);
  f(0, 0, w, 2, shade(look.wall, -22)); f(0, 2, w, 1, shade(look.wall, 16));
  pfloor(f, 0, fy, w, h - fy, look.floor);
  // The warm fixture glow dims when the room is unlit (evening/night flag off).
  const lamp = lit ? "#F8E2B4" : "#8A7A5C";
  switch (look.interior) {
    case "pub":
      pub(f, w, fy, railY, lit, seat);
      break;
    case "banquet":
      banquet(f, w, fy, railY, lit, seat);
      break;
    case "sushi":
      sushi(f, w, fy, seat);
      break;
    case "booths":
      steak(f, w, fy, railY, lit, lamp, seat);
      break;
    default:
      french(f, w, fy, railY, lamp, seat);
  }
}

function french(f: Fill, w: number, fy: number, railY: number, lamp: string, seat: Seat): void {
  // Chandelier, flanking pendants, sconces, framed art, a gilt mirror.
  const cxx = Math.round(w / 2);
  f(cxx - 1, 2, 2, 4, "#6a5040"); f(cxx - 7, 6, 14, 2, "#C9A24B");
  [-6, -2, 2, 6].forEach((o) => { f(cxx + o, 8, 1, 2, lamp); glow(f, cxx + o, 9, lamp); });
  [Math.round(w * 0.2), Math.round(w * 0.8)].forEach((px) => { f(px, 2, 1, 4, "#6a5040"); f(px - 2, 6, 5, 2, "#C9A24B"); f(px - 1, 8, 3, 2, lamp); glow(f, px, 9, lamp); });
  artF(f, 16, 7, 16, 11, "#3E5A6E"); artF(f, w - 32, 7, 16, 11, "#6E4A3A");
  box(f, Math.round(w * 0.37), 6, 20, 13, "#C9A24B"); f(Math.round(w * 0.37) + 2, 8, 16, 9, "#8FB6C8", 0.7);
  sconce(f, 46, 13, lamp); sconce(f, w - 48, 13, lamp);
  // Wine rack.
  box(f, 6, railY + 1, 12, fy - railY - 1, "#3A2418");
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) f(8 + k * 3, railY + 3 + r * 4, 2, 3, ["#7A2A2A", "#3A5A3A", "#6A4A2A"][(k + r) % 3]);
  // Dressed white-cloth tables with candles and seated diners.
  for (let tx = 28; tx + 20 < w - 6; tx += 34) {
    f(tx - 5, fy - 13, 3, 13, "#5A3A2A"); f(tx + 18, fy - 13, 3, 13, "#5A3A2A");
    f(tx, fy - 8, 16, 8, "#F0ECE0"); f(tx, fy - 8, 16, 1, "#FFFFFF"); f(tx, fy - 3, 16, 3, "#DCD6C6");
    f(tx + 7, fy - 12, 1, 4, "#E8C14A"); glow(f, tx + 7, fy - 12, lamp); // candle gold + warm glow, never notice amber
    f(tx + 3, fy - 10, 1, 2, "#C0D8E8"); f(tx + 12, fy - 10, 1, 2, "#C0D8E8");
    seat(tx - 5, fy - 1); seat(tx + 16, fy - 1);
  }
}

function pub(f: Fill, w: number, fy: number, railY: number, lit: boolean, seat: Seat): void {
  const barW = Math.round(w * 0.3);
  // Back bar with a lit bottle wall.
  box(f, 5, 6, barW, railY - 6, "#2A1C10");
  for (let r = 0; r < 3; r++) for (let bx = 8, c = 0; bx < barW; bx += 4, c++) f(bx, 8 + r * 5, 2, 4, ["#4A7A4A", "#B08A3E", "#8C3A32", "#3A5A7A"][(c + r) % 4]);
  box(f, 4, fy - 9, barW + 2, 6, "#4A3220"); f(4, fy - 9, barW + 2, 1, "#6A4A30");
  [9, 14, 19].forEach((fx) => f(fx, fy - 12, 1, 3, "#D8B05A")); // brass taps
  // Seated regulars on bar stools.
  for (let sx = barW + 8; sx < barW + 40; sx += 10) { f(sx, fy - 4, 2, 4, "#3A2A1A"); seat(sx - 2, fy); }
  // Hanging pub lamps.
  [Math.round(w * 0.5), Math.round(w * 0.78)].forEach((fx) => { f(fx - 1, 6, 2, 3, "#2A1E14"); f(fx - 2, 9, 4, 3, lit ? "#F8E2B4" : "#8A7A5C"); glow(f, fx, 10, lit ? "#FFE69A" : "#8A7A5C"); });
  // A framed print.
  artF(f, Math.round(w * 0.62), 8, 14, 9, "#2A4A2A");
  // Wood tables with pints and seated couples.
  for (let tx = barW + 44; tx + 14 < w - 6; tx += 32) {
    f(tx - 3, fy - 10, 3, 10, "#3A2A1A"); f(tx + 13, fy - 10, 3, 10, "#3A2A1A");
    box(f, tx, fy - 6, 13, 2, "#6A4A30"); f(tx + 4, fy - 9, 3, 3, "#B08A3E"); f(tx + 4, fy - 9, 3, 1, "#D8B860");
    seat(tx - 3, fy); seat(tx + 13, fy);
  }
}

function banquet(f: Fill, w: number, fy: number, railY: number, lit: boolean, seat: Seat): void {
  // Red papered wall.
  for (let px = 0; px < w; px += 14) f(px, 4, 1, railY - 4, "#7A2A2A", 0.5);
  // Paired glowing lanterns.
  [Math.round(w * 0.28), Math.round(w * 0.72)].forEach((fx) => {
    f(fx, 2, 1, 4, "#6a5040");
    f(fx - 5, 6, 10, 9, lit ? "#E0554A" : "#8a3a34"); f(fx - 5, 10, 10, 1, "#E8C14A"); f(fx - 5, 6, 10, 1, lit ? "#F08070" : "#8a3a34");
    glow(f, fx, 10, lit ? "#E85D4A" : "#8a3a34"); f(fx - 1, 15, 2, 3, "#C8A040");
  });
  // A carved screen.
  box(f, Math.round(w * 0.44), 7, 26, 12, "#7A2A2A");
  for (let k = 0; k < 6; k++) f(Math.round(w * 0.44) + 3 + k * 4, 9, 2, 8, "#E8C14A");
  // Round banquet tables with a gold lazy-Susan and parties of seated diners.
  for (let tx = 16; tx + 24 < w - 6; tx += 46) {
    f(tx + 10, fy - 1, 3, 1, "#000000", 0.2);
    f(tx, fy - 7, 22, 5, "#E8D8C0"); f(tx, fy - 7, 22, 1, "#FFF6E8");
    f(tx + 8, fy - 9, 6, 3, "#E8C14A"); f(tx + 10, fy - 10, 2, 2, "#C0392B");
    seat(tx - 4, fy); seat(tx + 22, fy); seat(tx + 9, fy);
  }
}

function sushi(f: Fill, w: number, fy: number, seat: Seat): void {
  // A bottle shelf.
  f(6, 7, w - 12, 3, "#6A4A30");
  for (let k = 0; k < 7; k++) f(10 + k * ((w - 24) / 7), 8, 3, 2, ["#3A5A3A", "#7A2A2A", "#B08A3E"][k % 3]);
  // The long light-wood counter with a glass case and colored nigiri plates.
  box(f, 6, fy - 11, w - 14, 5, "#E8DCC8"); f(6, fy - 13, w - 14, 2, "#BCD8E8");
  for (let px = 12, i = 0; px + 3 < w - 12; px += 12, i++) { f(px, fy - 12, 4, 1, i % 2 ? "#F4F0E4" : "#E88AB0"); f(px, fy - 15, 3, 2, ["#E88AB0", "#3A5A7A", "#C0392B"][i % 3]); }
  // The chef in whites behind the bar (seated occupant per the finalized
  // geometry table; the people-system note that called this a standing chef is
  // superseded here). Drawn first, then diners seated along the front.
  const chef = Math.round(w * 0.5);
  if (seat(chef, fy - 11)) f(chef - 1, fy - 21, 6, 2, "#FFFFFF"); // chef's hat, only when the chef is present
  for (let tx = 14; tx + 6 < w - 12; tx += 19) { f(tx, fy - 3, 3, 3, "#5A4632"); seat(tx - 1, fy); }
}

function steak(f: Fill, w: number, fy: number, railY: number, lit: boolean, lamp: string, seat: Seat): void {
  // A hooded grill glowing orange (ember), framed art.
  box(f, 6, 8, 22, railY - 6, "#1E1614");
  f(8, 15, 18, 3, lit ? "#E8862A" : "#8a4a20"); f(8, 13, 18, 2, "#3A2A1A"); glow(f, 17, 16, lit ? "#E8862A" : "#8a4a20"); f(6, 7, 22, 2, "#2A2018");
  artF(f, Math.round(w * 0.5), 7, 18, 10, "#3A241A");
  // High-back leather booths with candlelit tables and seated diners.
  for (let tx = 36; tx + 20 < w - 6; tx += 34) {
    f(tx - 1, fy - 13, 4, 13, "#4A2E22"); f(tx - 1, fy - 13, 4, 1, "#5E3E2E");
    f(tx + 16, fy - 13, 4, 13, "#4A2E22"); f(tx + 16, fy - 13, 4, 1, "#5E3E2E");
    box(f, tx + 3, fy - 6, 13, 2, "#6A4A32"); f(tx + 7, fy - 8, 3, 2, "#F4F0E4"); f(tx + 7, fy - 10, 2, 2, "#E8C14A"); glow(f, tx + 8, fy - 10, lamp);
    seat(tx + 2, fy); seat(tx + 12, fy);
  }
}

// ---- Cinema -----------------------------------------------------------------

/** Frames the animated screen cycles through (the accepted per-frame exception,
 *  shared with `food.ts`). */
export const CINEMA_FRAMES = ["#9FC0FF", "#FFD9A0", "#C0FFD0", "#FFB0C0", "#D0C0FF"] as const;

/**
 * The two-floor auditorium: a maroon shell, an animated marquee, a
 * curtain-framed animated screen with a projector beam, a balcony rail, raked
 * seat rows with an occupancy-driven audience, aisle lights, and green EXIT
 * signs on BOTH floors. The marquee and screen are the one accepted `d.anim`
 * read; every other element is static. `geoAud` (geoVariant axis 4) varies the
 * audience seating; `geoMar` (geoVariant axis 5) seeds the marquee color phase.
 */
export function drawCinema(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, anim: number, n: number, geoAud: number, geoMar: number): void {
  const f = mkFill(ctx, x, y);
  const fy = h - 5;
  twall(f, 0, 0, w, h, "#241026");
  // Marquee bulbs: a slow chase, phase-offset per cinema (animated).
  const chase = Math.floor(anim * 4) + geoMar;
  for (let bx = 3, i = 0; bx < w - 2; bx += 7, i++) { f(bx, 2, 3, 3, (i + chase) % 2 ? "#FFD24A" : "#FF6B6B"); }
  f(0, 6, w, 1, "#3A1A3E");
  // Curtain-framed screen.
  const sx = Math.round(w * 0.24), sw = Math.round(w * 0.52), syt = 10, syb = 44;
  f(sx - 6, syt - 2, sw + 12, syb - syt + 4, "#5A1420");
  for (let cxN = sx - 6; cxN < sx + sw + 6; cxN += 5) f(cxN, syt - 2, 2, syb - syt + 4, "#7A1E2E");
  f(sx - 6, syt - 3, sw + 12, 3, "#8A2436"); f(sx - 6, syt - 3, sw + 12, 1, "#A83C4A"); // valance
  // The screen itself, cycling pastel frames (animated).
  box(f, sx, syt, sw, syb - syt, "#0A0E1A");
  const fr = Math.floor(anim * 2.5 + geoMar) % CINEMA_FRAMES.length;
  f(sx + 1, syt + 1, sw - 2, syb - syt - 2, CINEMA_FRAMES[fr]);
  f(sx + 1, syt + 1 + ((fr * 4) % Math.max(1, syb - syt - 2)), sw - 2, 1, "#FFFFFF", 0.4); // scan line
  f(sx + Math.round(sw * 0.6), syt + 3, 4, 4, "#FFF0B0"); glow(f, sx + Math.round(sw * 0.62), syt + 5, "#FFF0C0");
  glow(f, sx + sw / 2, syt + (syb - syt) / 2, "#9FC0E0");
  // Projector beam.
  f(Math.round(w * 0.5) - 1, syb, 2, fy - syb - 16, "#BFE0F4", 0.05); f(Math.round(w * 0.5) - 6, fy - 18, 12, 10, "#BFE0F4", 0.04);
  // Balcony rail.
  f(0, 46, w, 2, "#3A1A2E"); f(0, 46, w, 1, "#5A2A3E");
  for (let px = 6; px < w; px += 10) f(px, 44, 1, 4, "#4A2038");
  // Occupancy-driven audience: collect every seat-head slot while drawing the
  // seat boxes, then fill exactly the first min(n, seats) heads in seed order,
  // rotated by geoAud (axis 4) so two cinemas never share a crowd; n === 0 is
  // an empty house.
  const heads: Array<[number, number]> = [];
  for (let sxn = 6; sxn < w - 4; sxn += 7) { f(sxn, 40, 5, 4, "#2A1428"); f(sxn, 40, 5, 1, "#3E1E38"); heads.push([sxn + 1, 37]); } // balcony row
  for (let r = 0; r < 3; r++) { const ry = fy - 4 - r * 6; for (let sxn = 5; sxn < w - 4; sxn += 7) { f(sxn, ry, 5, 5, "#22101F"); f(sxn, ry, 5, 1, "#341830"); heads.push([sxn + 1, ry - 3]); } } // raked rows
  const seats = heads.length, filledHeads = Math.min(Math.max(0, n), seats);
  for (let j = 0; j < seats; j++) if ((j + geoAud) % seats < filledHeads) { const [hx, hy] = heads[j]; f(hx, hy, 3, 3, "#3A2E28"); f(hx, hy, 3, 1, "#5A4438"); }
  // Aisle lights.
  for (let px = 10; px < w; px += 30) f(px, fy - 1, 2, 1, "#E8C14A");
  // Green EXIT signs on BOTH floors (canon), static.
  exitSign(f, 4, 48); exitSign(f, w - 14, 48); exitSign(f, 4, fy - 14); exitSign(f, w - 14, fy - 14);
}
