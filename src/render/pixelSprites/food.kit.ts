import { PAL, personSeated, shade } from "./common";

/**
 * The drawing kit the food and entertainment interiors share
 * (`food.interiors.ts`): the reference build script's `F` to `fillRect`
 * mapping, its prop helpers, and the occupancy seat filler. Split out of
 * `food.interiors.ts` for the 500-line ceiling.
 */

// ---- The `F` -> `fillRect` mapping and the ported build-script helpers -----

/** A rectangle fill bound to a room's screen origin: build-local `(bx, by)`
 *  plus the origin, rounded, min 1px, with a transient alpha for the rect.
 *  `ctx` is the target, for the depth-layer marks (`layers.ts`). */
export type Fill = ((bx: number, by: number, bw: number, bh: number, c: string, o?: number) => void) & { ctx: CanvasRenderingContext2D };

export function mkFill(ctx: CanvasRenderingContext2D, ox: number, oy: number): Fill {
  const fill = (bx: number, by: number, bw: number, bh: number, c: string, o = 1): void => {
    ctx.fillStyle = c;
    if (o !== 1) ctx.globalAlpha = o;
    ctx.fillRect(Math.round(ox + bx), Math.round(oy + by), Math.max(1, Math.round(bw)), Math.max(1, Math.round(bh)));
    if (o !== 1) ctx.globalAlpha = 1;
  };
  return Object.assign(fill, { ctx });
}

/** A soft four-step warm glow around a fixture bulb. */
export function glow(f: Fill, cx: number, cy: number, c: string): void {
  for (const [s, a] of [[4, 0.1], [3, 0.16], [2, 0.3], [1, 0.6]] as const) f(cx - s, cy - s, s * 2, s * 2, c, a);
}

/** A framed prop box: contact shadow, fill, then top/left highlight and
 *  right/bottom shade so the block reads as lit from the upper left. */
export function box(f: Fill, x: number, y: number, w: number, h: number, b: string): void {
  f(x, y + h, w, 1, "#000000", 0.18);
  f(x, y, w, h, b);
  f(x, y, w, 1, shade(b, 22));
  f(x, y, 1, h, shade(b, 12));
  f(x + w - 1, y, 1, h, shade(b, -16));
  f(x, y + h - 1, w, 1, shade(b, -22));
}

/** Textured wall: fill, an upper light band, then tile / plank / flat detail. */
export function wtex(f: Fill, x: number, y: number, w: number, h: number, b: string, mode: "tile" | "plank" | "flat"): void {
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
export function pfloor(f: Fill, x: number, fy: number, w: number, h: number, b: string, checker = false): void {
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
export function signBand(f: Fill, w: number, bc: string, ac: string): void {
  f(0, 0, w, 7, bc);
  f(0, 0, w, 1, shade(bc, 34));
  f(0, 6, w, 1, shade(bc, -34));
  for (let sx = 3; sx < w - 2; sx += 8) f(sx, 2, 4, 3, ac);
  f(0, 7, w, 1, PAL.signWarm, 0.55);
}

/** A ceiling pendant lamp on a short cord, glowing warm. */
export function pendant(f: Fill, x: number, c: string): void {
  f(x, 7, 1, 3, "#3A3E44");
  f(x - 2, 10, 5, 2, shade(c, -16));
  f(x - 1, 11, 3, 1, "#F8E2B4");
  glow(f, x, 12, "#F8E2B4");
}

/** A wall sconce, glowing warm when lit. */
export function sconce(f: Fill, x: number, y: number, lamp: string): void {
  f(x, y, 1, 4, "#5A4632");
  f(x - 1, y - 2, 3, 3, lamp);
  glow(f, x, y - 1, lamp);
}

/** A framed picture: gilt frame, the pictured pane, and a top highlight. */
export function artF(f: Fill, x: number, y: number, w: number, h: number, pic: string): void {
  box(f, x, y, w, h, "#7A5A38");
  f(x + 1, y + 1, w - 2, h - 2, pic);
  f(x + 1, y + 1, w - 2, 1, shade(pic, 18));
}

/** A boba cup with a straw and a domed lid, held by a cafe patron. */
export function boba(f: Fill, x: number, y: number, cupc: string): void {
  f(x, y, 4, 6, cupc);
  f(x, y, 4, 1, "#FFFFFF", 0.4);
  f(x, y + 4, 4, 2, "#3A2A24");
  f(x + 1, y - 2, 2, 2, "#F4F0E4");
  f(x + 2, y - 3, 1, 2, "#E85D8A");
}

/** A textured back wall for the darker dining rooms. */
export function twall(f: Fill, x: number, y: number, w: number, h: number, b: string): void {
  f(x, y, w, h, b);
  f(x, y, w, Math.round(h * 0.4), shade(b, 8));
  for (let py = y + 3; py < y + h; py += 6) f(x, py, w, 1, shade(b, -8), 0.5);
  for (let dx = x + 4, i = 0; dx < x + w; dx += 8, i++) for (let dy = y + 5 + (i % 2) * 3; dy < y + h - 2; dy += 6) f(dx, dy, 1, 1, shade(b, 13), 0.5);
}

/** A wainscot dado below the rail line, with panel seams and a wood rail. */
export function wainscot(f: Fill, x: number, fy: number, w: number, railY: number, b: string): void {
  f(x, railY, w, fy - railY, shade(b, -13));
  for (let px = x + 10; px < x + w - 4; px += 16) f(px, railY + 3, 1, fy - railY - 5, shade(b, -22));
  f(x, railY - 1, w, 2, "#5A3E28");
  f(x, railY - 1, w, 1, "#7A5A38");
}

/** A green EXIT sign (EXIT green `#6bd47a` is not a reserved state color). */
export function exitSign(f: Fill, x: number, y: number): void {
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
export type Seat = (px: number, footY: number) => boolean;

export function mkSeat(ctx: CanvasRenderingContext2D, ox: number, oy: number, geoSeed: number, n: number): Seat {
  let i = 0;
  return (px, footY) => {
    if (i >= n) return false;
    personSeated(ctx, ox + px, oy + footY, geoSeed + i++);
    return true;
  };
}
