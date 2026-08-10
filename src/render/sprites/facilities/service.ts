import type { Unit } from "../../../engine/types";
import { ceilingFixture, personHiVis, personSeated, personStanding, roomGlow, SKIN } from "../../pixelSprites/common";
import { rand, serviceLabel, type DrawCtx } from "../common";
import { box, floorb, glow, refMap, wallp, whiteCoat, type Fill } from "./serviceKit";

/**
 * In-tower service and utility facilities: security, the clinic, housekeeping,
 * the recycling center, and the metro station. (The basement garage lives in
 * `garage.ts`; the moving actors in `vehicles.ts`.)
 *
 * Each look is ported from its pixel-exact Figma reference build script
 * (`_bmad-output/implementation-artifacts/pixelart-figma/build-scripts/`,
 * page 01) through the shared `refMap` scaler, so the tower cross-section reads
 * as the warm, lived-in dollhouse the art direction calls for. Figures are the
 * shared finalized `person()` builds, never hand-rolled. Reserved state colors
 * are never reused for decoration. These are staffed amenities: they always
 * draw their interior, never a lease or vacancy card.
 */

// ---- Security ---------------------------------------------------------------

export function drawSecurity(d: DrawCtx, x: number, y: number, w: number, h: number): void {
  const ctx = d.ctx;
  const RW = 88;
  const RH = 44;
  const { F, Fu, sx, sy } = refMap(ctx, x, y, w, h, RW, RH);
  const W = RW;
  const fy = RH - 6;
  wallp(F, 0, 0, W, fy, "#2C3A5A", false);
  floorb(F, 0, fy, W, 6, "#242A38");
  // Two-by-five wall of green-dot camera monitors. These are ten copies of one
  // object, so they take the uniform fill: sized from mapped edges instead, the
  // bodies came out 8,7,7,7,7 across a row and the grid read broken.
  for (let r = 0; r < 2; r++) {
    for (let cN = 0; cN < 5; cN++) {
      const mx = 6 + cN * 10;
      const my = 6 + r * 11;
      box(Fu, mx, my, 8, 9, "#0E1420");
      Fu(mx + 1, my + 1, 6, 5, "#1A3A2A");
      Fu(mx + 1 + ((r + cN) % 3), my + 2, 1, 3, "#6bd47a", 0.8);
      Fu(mx + 1, my + 1, 6, 1, "#2A4A3A");
    }
  }
  // Console desk with a seated guard behind it.
  box(F, 58, fy - 8, 26, 8, "#2A3550");
  F(58, fy - 8, 26, 1, "#3E4A66");
  personSeated(ctx, sx(66), sy(fy - 8), (Math.round(x) * 3 + 5) | 0);
  // Brass badge shield, key rack, and the red alarm light.
  F(60, fy - 14, 6, 6, "#D8B05A");
  F(62, fy - 13, 2, 4, "#8A6A2A");
  F(78, 8, 8, 5, "#5A4A36");
  for (let k = 0; k < 4; k++) Fu(79 + k * 2, 13, 1, 2, "#D8B05A"); // key rack pins, one object repeated
  F(W - 8, 7, 4, 4, "#E85D5D");
  glow(F, W - 6, 9, "#FF6B6B");
  // A warm ceiling light over the console keys on the lit (evening) state.
  ceilingFixture(ctx, x, y, w, d.lit);
}

// ---- Medical ----------------------------------------------------------------

export function drawMedical(d: DrawCtx, x: number, y: number, w: number, h: number): void {
  const ctx = d.ctx;
  const RW = 176;
  const RH = 44;
  const { F, sx, sy } = refMap(ctx, x, y, w, h, RW, RH);
  const W = RW;
  const fy = RH - 6;
  const lamp = roomGlow(d.lit);
  wallp(F, 0, 0, W, fy, "#EDE9E2", true);
  floorb(F, 0, fy, W, 6, "#CFD6D2");
  for (let lx = 24; lx < W; lx += 44) {
    F(lx, 2, 10, 2, lamp);
    glow(F, lx + 5, 5, lamp);
  }
  // Red cross sign.
  F(6, 8, 14, 14, "#F4F0EC");
  F(10, 10, 6, 10, "#D6342F");
  F(7, 13, 12, 4, "#D6342F");
  // First curtained exam bed with a resting patient head, blanket, and rail.
  box(F, 28, fy - 9, 26, 9, "#DCE2E8");
  F(28, fy - 9, 26, 1, "#F0F4F8");
  F(30, fy - 12, 6, 3, SKIN[0]);
  F(30, fy - 13, 6, 1, "#3A2E28");
  F(36, fy - 10, 16, 3, "#BFD0DE");
  F(26, 10, 1, fy - 16, "#B8BCC0");
  F(26, 10, 28, 1, "#B8BCC0");
  F(54, 12, 4, fy - 18, "#9FC0C8", 0.6);
  // Heart monitor with a green trace.
  box(F, 64, fy - 16, 14, 10, "#20242C");
  F(66, fy - 14, 10, 6, "#0E241A");
  F(66, fy - 11, 2, 1, "#6bd47a");
  F(68, fy - 12, 1, 3, "#6bd47a");
  F(69, fy - 10, 2, 1, "#6bd47a");
  F(71, fy - 13, 1, 5, "#6bd47a");
  F(72, fy - 11, 4, 1, "#6bd47a");
  glow(F, 71, fy - 11, "#3ADF6A");
  // IV stand.
  F(60, fy - 16, 1, 16, "#B8BCC0");
  F(58, fy - 18, 5, 3, "#CFE0FF", 0.8);
  // Nurse and doctor: shared standing figures with the white-coat overlay.
  const nurseX = sx(84);
  const doctorX = sx(92);
  const foot = sy(fy);
  personStanding(ctx, nurseX, foot, (Math.round(x) * 2 + 1) | 0);
  whiteCoat(ctx, nurseX, foot);
  personStanding(ctx, doctorX, foot, (Math.round(x) * 2 + 7) | 0);
  whiteCoat(ctx, doctorX, foot);
  // Stocked supply cabinet.
  box(F, 104, fy - 16, 22, 16, "#F4F4F0");
  const bottles = ["#9FD0C8", "#E8C9A0", "#5db4e8", "#F4A0A0", "#DcE8C0"];
  for (let r = 0; r < 2; r++) for (let k = 0; k < 5; k++) F(107 + k * 4, fy - 14 + r * 7, 3, 4, bottles[k]);
  F(104, fy - 16, 22, 1, "#D8D8D0");
  // Wheelchair.
  F(132, fy - 8, 6, 5, "#3A4250");
  F(132, fy - 11, 5, 4, "#4A5464");
  F(132, fy - 2, 3, 3, "#1A1D24");
  F(137, fy - 3, 2, 2, "#1A1D24");
  // Second exam bed.
  box(F, 144, fy - 9, 26, 9, "#DCE2E8");
  F(146, fy - 12, 6, 3, SKIN[1]);
  F(146, fy - 13, 6, 1, "#3A2E28");
  F(152, fy - 10, 16, 3, "#BFD0DE");
}

// ---- Housekeeping -----------------------------------------------------------

export function drawHousekeeping(d: DrawCtx, x: number, y: number, w: number, h: number): void {
  const ctx = d.ctx;
  const RW = 88;
  const RH = 44;
  const { F, sx, sy } = refMap(ctx, x, y, w, h, RW, RH);
  const W = RW;
  const fy = RH - 6;
  wallp(F, 0, 0, W, fy, "#D8D0BE", false);
  floorb(F, 0, fy, W, 6, "#B7AE98");
  // Linen shelf with folded white and blue linens.
  box(F, 4, 6, 30, fy - 8, "#9A8468");
  const linens = ["#F4F0EC", "#CFE0FF", "#F4F0EC", "#E8D8C0"];
  for (let r = 0; r < 3; r++) {
    F(6, 9 + r * 8, 26, 1, "#7A664C");
    for (let k = 0; k < 4; k++) F(7 + k * 7, 10 + r * 8, 6, 5, linens[(k + r) % 4]);
  }
  // Teal supply cart with towels and spray bottles, plus its wheels.
  box(F, 44, fy - 10, 20, 8, "#3E8E8E");
  F(46, fy - 14, 6, 4, "#F4F0EC");
  F(53, fy - 14, 6, 4, "#CFE0FF");
  F(58, fy - 13, 2, 3, "#E85D5D");
  F(61, fy - 13, 2, 3, "#5db4e8");
  F(44, fy - 2, 2, 2, "#1A1D24");
  F(62, fy - 2, 2, 2, "#1A1D24");
  // Mop and bucket.
  F(68, fy - 14, 1, 12, "#8A5A30");
  F(66, fy - 16, 5, 3, "#E8E0B0");
  box(F, 66, fy - 6, 7, 6, "#F4C020");
  F(66, fy - 6, 7, 2, "#CFE0FF", 0.6);
  // Towel rack on the far wall.
  box(F, W - 22, fy - 9, 16, 9, "#B8A47E");
  for (let k = 0; k < 4; k++) F(W - 20 + k * 4, fy - 9, 1, 9, "#9A8460");
  F(W - 20, fy - 11, 12, 3, "#F4F0EC");
  // Standing housekeeper by the cart (the teal cart carries the uniform read).
  personStanding(ctx, sx(38), sy(fy), (Math.round(x) * 3 + 3) | 0);
  ceilingFixture(ctx, x, y, w, d.lit);
}

// ---- Recycling --------------------------------------------------------------

export function drawRecycling(d: DrawCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const ctx = d.ctx;
  const RW = 220;
  const RH = 88;
  const { F, Fu, sx, sy } = refMap(ctx, x, y, w, h, RW, RH);
  const W = RW;
  const H = RH;
  const deck = H - 7;
  // Concrete hall: walls, roof ribs, girders, and a service pipe. The full-width
  // bands stay on the edge-derived fill so they meet without a seam; the ribs,
  // studs and pipe brackets are repeated objects and take the uniform one.
  F(0, 0, W, H, "#6C6C64");
  F(0, 0, W, Math.round(H * 0.5), "#75756B");
  for (let px = 0; px < W; px += 22) Fu(px, 2, 1, deck - 2, "#5A5A52");
  for (let py = 10; py < deck; py += 11) F(0, py, W, 1, "#616159");
  for (let px = 6; px < W; px += 22) Fu(px, 12, 1, 1, "#8A8A80");
  F(0, 3, W, 2, "#7A8088");
  F(0, 3, W, 1, "#9AA0A8");
  for (let px = 6; px < W; px += 16) Fu(px, 2, 2, 4, "#5A6068");
  F(0, 7, W, 3, "#565C64");
  F(0, 7, W, 1, "#6A727A");
  // Compactor housing with a peek of sorted waste.
  F(8, 10, 15, 22, "#4A4E54");
  F(8, 10, 2, 22, "#5E636A");
  F(21, 10, 2, 22, "#3A3E44");
  F(10, 32, 11, 3, "#33373D");
  F(12, 34, 3, 3, "#3A4232");
  F(16, 34, 3, 3, "#4A5A3A");
  // Warm hooded work lamps over the line.
  for (const lx of [46, 150]) {
    F(lx, 10, 1, 3, "#3A3E44");
    F(lx - 3, 13, 7, 3, "#2A2E34");
    F(lx - 2, 15, 5, 1, "#F8E2B4");
    glow(F, lx, 18, "#F8E2B4");
  }
  // Overhead sorting sign.
  box(F, 92, 5, 70, 10, "#2A6E3A");
  for (let i = 0; i < 11; i++) Fu(96 + i * 6, 8, 3, 4, "#DCE8C0"); // sign letters
  // Conveyor belt carrying baled recyclables (no reserved red bale).
  const by = deck - 24;
  F(26, by, 120, 6, "#3A3E44");
  F(26, by, 120, 1, "#4E545C");
  F(26, by + 5, 120, 1, "#242830");
  for (let bx = 28; bx < 144; bx += 6) Fu(bx, by + 1, 3, 4, "#2E323A"); // baled recyclables
  F(24, by - 1, 4, 8, "#4A4E54");
  F(144, by - 1, 4, 8, "#4A4E54");
  const items = ["#4E7A4A", "#3E6A9E", "#C8A24A", "#C87A32", "#DCDCE0", "#8C5A3A"];
  for (let ix = 30, k = 0; ix < 140; ix += 13, k++) {
    Fu(ix, by - 4, 5, 4, items[k % items.length]);
    Fu(ix, by - 4, 5, 1, "#FFFFFF", 0.22);
  }
  // Baler machine with control panel and status lamps.
  const cx = W - 52;
  box(F, cx, by - 18, 46, deck - (by - 18), "#7E828A");
  F(cx + 2, by - 16, 20, 14, "#5A5E66");
  F(cx + 2, by - 16, 20, 1, "#3A3E44");
  F(cx + 3, by - 10, 6, 4, "#3A3E44");
  F(cx + 11, by - 10, 6, 4, "#3A3E44");
  box(F, cx + 26, by - 15, 16, 20, "#565C64");
  F(cx + 29, by - 12, 4, 4, "#3ADF6A");
  F(cx + 34, by - 12, 4, 4, "#E85D5D");
  F(cx + 29, by - 6, 10, 4, "#1A1D24");
  F(cx + 30, by - 5, 8, 2, "#5FB0DC");
  // Three sorting bins.
  const bins: ReadonlyArray<readonly [string, string]> = [
    ["#3A8A4A", "#2A6E3A"],
    ["#3E6AAE", "#2A4E86"],
    ["#D8B23A", "#B08A2A"],
  ];
  bins.forEach((c, i) => {
    const bx = 30 + i * 20;
    // One bin repeated along the deck, arrow glyph and all, so the whole
    // motif takes the uniform fill or the arrows fray bin to bin.
    box(Fu, bx, deck - 16, 16, 16, c[0]);
    Fu(bx, deck - 16, 16, 2, c[1]);
    Fu(bx + 5, deck - 19, 6, 3, c[1]);
    Fu(bx + 4, deck - 11, 4, 1, "#FFFFFF", 0.85);
    Fu(bx + 7, deck - 12, 1, 3, "#FFFFFF", 0.85);
    Fu(bx + 8, deck - 8, 4, 1, "#FFFFFF", 0.85);
    Fu(bx + 8, deck - 9, 1, 2, "#FFFFFF", 0.85);
  });
  // Stacked cardboard bales.
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2; c++) {
      const bx2 = 98 + c * 19;
      const by2 = deck - 14 + r * 7;
      box(F, bx2, by2, 18, 7, "#B08A5A");
      F(bx2, by2 + 3, 18, 1, "#8A6A44");
      F(bx2 + 8, by2, 1, 7, "#7A5A38");
    }
  }
  // Compacted cubes waiting by the baler.
  for (let i = 0; i < 5; i++) {
    const gx2 = cx - 4 - i * 6;
    Fu(gx2, deck - 5, 6, 5, i % 2 ? "#3A4232" : "#2F3628");
    Fu(gx2 + 2, deck - 6, 2, 2, "#FFFFFF", 0.28);
  }
  // Painted deck curb with hazard stripes.
  F(0, deck, W, 7, "#4A4A44");
  F(0, deck, W, 1, "#5E5E56");
  for (let i = 0; i < W; i += 6) {
    Fu(i, deck + 1, 3, 2, "#D8B23A");
    Fu(i + 3, deck + 1, 3, 2, "#2A2418");
  }
  F(20, deck + 3, W - 40, 1, "#000000", 0.2);
  // Live behavior: the day's waste piles up until the morning truck. The pile
  // grows rightward and stacks a second row past half full. `d.recycleFill` is
  // a prepared input, so no scan runs here.
  const rawFill = d.recycleFill ?? 0;
  const fill = Number.isFinite(rawFill) ? Math.max(0, Math.min(1, rawFill)) : 0;
  const pileX0 = 28;
  const pileMax = W - 70;
  const slots = Math.floor((pileMax - pileX0) / 7);
  const bags = Math.round(fill * slots);
  for (let i = 0; i < bags; i++) {
    const bx = pileX0 + i * 7;
    const jit = Math.floor(rand((u.id * 31 + i) | 0) * 3);
    F(bx, deck - 6 - jit, 6, 6 + jit, i % 3 === 2 ? "#4a5a3a" : "#3a4232");
    Fu(bx + 2, deck - 7 - jit, 2, 2, "#FFFFFF", 0.35);
    if (fill > 0.5 && i % 2 === 0 && i < bags - 1) F(bx + 3, deck - 11 - jit, 6, 5, "#2f3628");
  }
  // Live wall gauge: green, then amber past 0.7, then red with the FULL cue at
  // capacity. The FULL red is a deliberate state cue, not decoration.
  const gY = 14;
  const gH = deck - 18;
  F(W - 6, gY, 4, gH, "#1B2A14");
  let gauge = "#6bd47a";
  if (fill >= 1) gauge = "#d6342f";
  else if (fill > 0.7) gauge = "#e0a94e";
  const gaugeH = Math.round(gH * fill);
  F(W - 5, gY + gH - gaugeH, 2, gaugeH, gauge);
  if (fill >= 1) serviceLabel(ctx, "FULL", sx(W - 34), y, "#ffd2c8", 44, w);
  // The vested plant hand (shared hi-vis build with a hardhat), drawn last so
  // the worker stands in front of the pile.
  personHiVis(ctx, sx(84), sy(deck), (u.id * 7 + 3) | 0);
}

// ---- Metro ------------------------------------------------------------------

export function drawMetro(d: DrawCtx, x: number, y: number, w: number, h: number): void {
  const ctx = d.ctx;
  // The metro spans the whole lot, so the station is width-responsive: the
  // ceiling, wall tiles, pillars, posters, benches, and deck tile across the
  // real width while the signage stays centered. The composition is the
  // party-ratified high platform: a double-height concourse over a one-story
  // track trough, with the platform deck on the MIDDLE story's floor line,
  // exactly where the crowd system stands routed commuters (their platform
  // floor is the unit's middle story). The train (drawMetroTrain, its own
  // actor) rides the trough and slides in front of the far-platform scene;
  // waiting commuters draw in front of it on the near edge. The platform
  // itself draws EMPTY: real routed commuters are the crowd, so an empty
  // tower honestly shows an empty platform (no ghost crowd).
  const W = Math.max(1, w);
  const H = Math.max(1, h);
  const f: Fill = (px, py, pw, ph, color, alpha = 1) => {
    // Clip every rect to the unit box. In-game the bake canvas is exactly
    // W x H so this changes nothing, but the gallery paints entries onto one
    // shared canvas, where the fixed-y furniture on its (deliberately
    // squished) metro cell would otherwise bleed into the neighboring cells.
    // A clipped-to-zero (or negative) size paints nothing, matching refMap's
    // zero-size guard, rather than promoting an empty rect into a stray pixel.
    const x0 = Math.max(0, Math.round(px));
    const y0 = Math.max(0, Math.round(py));
    const x1 = Math.min(W, Math.round(px + pw));
    const y1 = Math.min(H, Math.round(py + ph));
    if (x1 <= x0 || y1 <= y0) return;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x) + x0, Math.round(y) + y0, x1 - x0, y1 - y0);
    if (alpha !== prevAlpha) ctx.globalAlpha = prevAlpha;
  };
  const deckY = Math.round(H * (2 / 3)); // platform deck = middle story's floor line
  const lamp = roomGlow(d.lit);
  // Warm ivory tiled back wall across the double-height concourse.
  f(0, 0, W, deckY, "#D8CFB8");
  f(0, 8, W, 1, "#E6DEC8"); // bright course under the vault
  for (let px = 0; px < W; px += 10) f(px, 8, 1, deckY - 8, "#C4BAA2");
  for (let py = 16; py < deckY - 4; py += 8) f(0, py, W, 1, "#C4BAA2");
  // Vaulted ceiling: dark steel band with arch ribs and hanging twin-globe
  // lamps (warm when lit).
  f(0, 0, W, 8, "#2E3038");
  for (let ax = 0; ax < W; ax += 40) {
    f(ax, 6, 38, 1, "#3A3D48");
    f(ax + 18, 0, 2, 8, "#3A3D48");
  }
  for (let lx = 30; lx + 8 < W; lx += 92) {
    f(lx + 3, 8, 1, 4, "#3A3D48"); // stem
    f(lx, 12, 7, 3, lamp);
    glow(f, lx + 3, 14, lamp);
  }
  // The line-color band: a red stripe with white trim running the full width.
  f(0, 24, W, 1, "#F0EAD8");
  f(0, 25, W, 3, "#C0392B");
  f(0, 28, W, 1, "#F0EAD8");
  // Teal tiled pillars on the reference cadence, with edge light and plinth.
  for (let px = 70; px < W - 20; px += 105) {
    f(px, 8, 11, deckY - 8, "#2E5850");
    f(px, 8, 2, deckY - 8, "#3E6E64");
    f(px + 9, 8, 2, deckY - 8, "#1F423C");
    f(px - 1, deckY - 6, 13, 6, "#23343A"); // plinth
    for (let py = 16; py < deckY - 8; py += 9) f(px + 2, py, 7, 1, "#264A44");
  }
  // Backlit ad posters between the pillars, three designs on rotation: a
  // sunset travel ad, a soda ad, and a show bill. Color varies second,
  // geometry first (per the art bible), and none reuses a state literal.
  let poster = 0;
  for (let px = 122; px + 18 < W - 20; px += 105, poster++) {
    box(f, px, 34, 18, 24, "#20242C");
    f(px + 1, 35, 16, 1, d.lit ? "#F0EAD8" : "#6E6A5E"); // backlight rim
    if (poster % 3 === 0) {
      f(px + 2, 37, 14, 12, "#E08A4A"); // sunset sky
      f(px + 2, 45, 14, 4, "#B05A32");
      f(px + 5, 40, 5, 5, "#F4D06A"); // sun
      f(px + 2, 49, 14, 7, "#3A3330"); // skyline silhouette
      f(px + 5, 47, 2, 4, "#3A3330");
      f(px + 11, 46, 2, 5, "#3A3330");
    } else if (poster % 3 === 1) {
      f(px + 2, 37, 14, 19, "#3E6E9E"); // soda blue
      f(px + 5, 40, 8, 10, "#E8E4D8"); // bottle
      f(px + 7, 38, 4, 3, "#E8E4D8");
      f(px + 6, 43, 6, 3, "#C0392B"); // label
      f(px + 3, 52, 12, 1, "#E8E4D8"); // script line
    } else {
      f(px + 2, 37, 14, 19, "#6E4E86"); // show-bill purple
      f(px + 8, 41, 2, 6, "#F4D06A"); // starburst
      f(px + 6, 43, 6, 2, "#F4D06A");
      f(px + 5, 40, 1, 1, "#F4D06A");
      f(px + 12, 40, 1, 1, "#F4D06A");
      f(px + 4, 52, 10, 1, "#E8E4D8"); // title line
    }
  }
  // Centered METRO sign with the red M roundel, hung from the vault.
  const mid = Math.round(W / 2);
  f(mid - 28, 8, 2, 6, "#3A3D48");
  f(mid + 26, 8, 2, 6, "#3A3D48");
  box(f, mid - 30, 14, 60, 14, "#1E4E86");
  for (let i = 0; i < 8; i++) f(mid - 24 + i * 6, 18, 3, 6, "#DCE6F0");
  f(mid - 46, 14, 14, 14, "#C0392B");
  f(mid - 42, 18, 6, 6, "#FFFFFF");
  f(mid - 41, 19, 1, 4, "#C0392B");
  f(mid - 39, 19, 1, 4, "#C0392B");
  f(mid - 37, 19, 1, 4, "#C0392B");
  // Station clock beside the sign.
  box(f, mid + 40, 16, 10, 10, "#20242C");
  f(mid + 42, 18, 6, 6, "#F0EAD8");
  f(mid + 44, 19, 1, 3, "#20242C");
  f(mid + 45, 21, 2, 1, "#20242C");
  // Lit route-map board near the left end.
  box(f, 20, 34, 52, 26, "#20303E");
  f(24, 38, 44, 2, "#5FB0DC");
  f(24, 44, 32, 1, "#E8C14A");
  f(24, 48, 38, 1, "#6bd47a");
  for (let i = 0; i < 6; i++) f(26 + i * 7, 40, 2, 2, "#F4F0E4");
  // Deck furniture on the far platform: wooden benches, a vending machine on
  // a longer cadence, and a bin. The train slides in FRONT of these.
  for (let bx = 110; bx < W - 24; bx += 100) {
    box(f, bx, deckY - 8, 22, 8, "#6A5240");
    f(bx + 1, deckY - 8, 20, 1, "#7A6250");
    f(bx + 2, deckY - 4, 2, 4, "#4A3A2E");
    f(bx + 18, deckY - 4, 2, 4, "#4A3A2E");
  }
  for (let vx = 160; vx + 12 < W - 24; vx += 210) {
    box(f, vx, deckY - 18, 12, 18, "#B04438");
    f(vx + 2, deckY - 16, 8, 9, d.lit ? "#FFE9B0" : "#6E5A4E"); // lit face
    for (let r = 0; r < 3; r++) f(vx + 3, deckY - 15 + r * 3, 6, 1, "#B04438");
    f(vx + 2, deckY - 5, 8, 3, "#3A3330"); // dispense tray
  }
  for (let tx = 86; tx < W - 24; tx += 200) {
    f(tx, deckY - 6, 6, 6, "#4E5A50");
    f(tx + 1, deckY - 6, 4, 1, "#2E3A30");
  }
  // WAY OUT at the right end: green sign over stair steps rising out of frame.
  const ex = W - 46;
  box(f, ex, 30, 26, 10, "#3E7E4E");
  for (let i = 0; i < 4; i++) f(ex + 3 + i * 5, 33, 3, 4, "#E8F4E8");
  f(ex + 22, 34, 2, 2, "#E8F4E8"); // arrow head
  for (let s = 0; s < 5; s++) f(ex + 2 + s * 5, deckY - 3 - s * 3, W - ex, 3, "#B8AE96");
  // The platform deck: light concrete edge, yellow tactile strip, slab face.
  f(0, deckY, W, 1, "#D8D4C8");
  f(0, deckY + 1, W, 1, "#E8C14A");
  f(0, deckY + 2, W, 2, "#caa84a");
  f(0, deckY + 4, W, 4, "#8A8578");
  f(0, deckY + 8, W, 2, "#6E6A5E");
  // The trough: retaining wall with cable conduits and maintenance doors,
  // grime under the deck lip, and the track bed the train rides.
  const troughY = deckY + 10;
  f(0, troughY, W, H - troughY, "#3A4046");
  f(0, troughY, W, 3, "#2E3238", 0.9); // shadow under the lip
  f(0, troughY + 8, W, 2, "#2A2E34"); // cable conduits
  f(0, troughY + 14, W, 1, "#2A2E34");
  for (let cxp = 24; cxp < W; cxp += 48) f(cxp, troughY + 7, 2, 9, "#22262C"); // clips
  for (let mx = 240; mx + 14 < W; mx += 480) {
    box(f, mx, troughY + 4, 14, H - troughY - 12, "#303640");
    f(mx + 10, troughY + 12, 2, 2, "#5A5E66"); // handle
  }
  // Track bed: ballast, sleepers, running rails, and the third rail.
  f(0, H - 8, W, 8, "#26282E");
  for (let sxp = 4; sxp < W; sxp += 10) f(sxp, H - 7, 3, 6, "#1C1E24");
  f(0, H - 6, W, 2, "#6E7686");
  f(0, H - 6, W, 1, "#9AA2B0");
  f(0, H - 2, W, 2, "#6E7686");
  for (let tr = 16; tr < W; tr += 64) f(tr, H - 10, 8, 2, "#50565E"); // third rail
}
