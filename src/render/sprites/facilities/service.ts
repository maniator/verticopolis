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
  const { F, sx, sy } = refMap(ctx, x, y, w, h, RW, RH);
  const W = RW;
  const fy = RH - 6;
  wallp(F, 0, 0, W, fy, "#2C3A5A", false);
  floorb(F, 0, fy, W, 6, "#242A38");
  // Two-by-five wall of green-dot camera monitors.
  for (let r = 0; r < 2; r++) {
    for (let cN = 0; cN < 5; cN++) {
      const mx = 6 + cN * 10;
      const my = 6 + r * 11;
      box(F, mx, my, 8, 9, "#0E1420");
      F(mx + 1, my + 1, 6, 5, "#1A3A2A");
      F(mx + 1 + ((r + cN) % 3), my + 2, 1, 3, "#6bd47a", 0.8);
      F(mx + 1, my + 1, 6, 1, "#2A4A3A");
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
  for (let k = 0; k < 4; k++) F(79 + k * 2, 13, 1, 2, "#D8B05A");
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
  const { F, sx, sy } = refMap(ctx, x, y, w, h, RW, RH);
  const W = RW;
  const H = RH;
  const deck = H - 7;
  // Concrete hall: walls, roof ribs, girders, and a service pipe.
  F(0, 0, W, H, "#6C6C64");
  F(0, 0, W, Math.round(H * 0.5), "#75756B");
  for (let px = 0; px < W; px += 22) F(px, 2, 1, deck - 2, "#5A5A52");
  for (let py = 10; py < deck; py += 11) F(0, py, W, 1, "#616159");
  for (let px = 6; px < W; px += 22) F(px, 12, 1, 1, "#8A8A80");
  F(0, 3, W, 2, "#7A8088");
  F(0, 3, W, 1, "#9AA0A8");
  for (let px = 6; px < W; px += 16) F(px, 2, 2, 4, "#5A6068");
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
  for (let i = 0; i < 11; i++) F(96 + i * 6, 8, 3, 4, "#DCE8C0");
  // Conveyor belt carrying baled recyclables (no reserved red bale).
  const by = deck - 24;
  F(26, by, 120, 6, "#3A3E44");
  F(26, by, 120, 1, "#4E545C");
  F(26, by + 5, 120, 1, "#242830");
  for (let bx = 28; bx < 144; bx += 6) F(bx, by + 1, 3, 4, "#2E323A");
  F(24, by - 1, 4, 8, "#4A4E54");
  F(144, by - 1, 4, 8, "#4A4E54");
  const items = ["#4E7A4A", "#3E6A9E", "#C8A24A", "#C87A32", "#DCDCE0", "#8C5A3A"];
  for (let ix = 30, k = 0; ix < 140; ix += 13, k++) {
    F(ix, by - 4, 5, 4, items[k % items.length]);
    F(ix, by - 4, 5, 1, "#FFFFFF", 0.22);
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
    box(F, bx, deck - 16, 16, 16, c[0]);
    F(bx, deck - 16, 16, 2, c[1]);
    F(bx + 5, deck - 19, 6, 3, c[1]);
    F(bx + 4, deck - 11, 4, 1, "#FFFFFF", 0.85);
    F(bx + 7, deck - 12, 1, 3, "#FFFFFF", 0.85);
    F(bx + 8, deck - 8, 4, 1, "#FFFFFF", 0.85);
    F(bx + 8, deck - 9, 1, 2, "#FFFFFF", 0.85);
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
    F(gx2, deck - 5, 6, 5, i % 2 ? "#3A4232" : "#2F3628");
    F(gx2 + 2, deck - 6, 2, 2, "#FFFFFF", 0.28);
  }
  // Painted deck curb with hazard stripes.
  F(0, deck, W, 7, "#4A4A44");
  F(0, deck, W, 1, "#5E5E56");
  for (let i = 0; i < W; i += 6) {
    F(i, deck + 1, 3, 2, "#D8B23A");
    F(i + 3, deck + 1, 3, 2, "#2A2418");
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
    F(bx + 2, deck - 7 - jit, 2, 2, "#FFFFFF", 0.35);
    if (fill > 0.5 && i % 2 === 0 && i < bags - 1) F(bx + 3, deck - 11 - jit, 6, 5, "#2f3628");
  }
  // Live wall gauge: green, then amber past 0.7, then red with the FULL cue at
  // capacity. The FULL red is a deliberate state cue, not decoration.
  const gY = 14;
  const gH = deck - 18;
  F(W - 6, gY, 4, gH, "#1B2A14");
  const gauge = fill >= 1 ? "#d6342f" : fill > 0.7 ? "#e0a94e" : "#6bd47a";
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
  // ceiling, wall, pillars, benches, and platform tile across the real width
  // while the signage stays centered. Verticals scale with the three-floor
  // height. The platform sits just above the train trough near the bottom; the
  // train is a separate Excalibur actor (drawMetroTrain) that slides into it.
  // The platform draws EMPTY: real routed commuters ride the people-system
  // traffic overlay, so an empty tower shows an empty platform (no ghost crowd).
  const W = Math.max(1, w);
  const H = Math.max(1, h);
  const f: Fill = (px, py, pw, ph, color, alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x + px), Math.round(y + py), Math.max(1, Math.round(pw)), Math.max(1, Math.round(ph)));
    if (alpha !== 1) ctx.globalAlpha = 1;
  };
  const platY = Math.round(H * 0.82);
  const band = Math.round(H / 3);
  const lamp = roomGlow(d.lit);
  // Tunnel base and upper wall band.
  f(0, 0, W, H, "#3A4652");
  f(0, 0, W, band, "#45525F");
  // Vaulted ceiling arches.
  for (let ax = 0; ax < W; ax += 40) {
    f(ax, 2, 38, 2, "#4E5C6A");
    f(ax + 18, 0, 2, 6, "#4E5C6A");
  }
  // Ceiling light strips (warm when lit, dim otherwise).
  for (let lx = 22; lx < W; lx += 46) {
    f(lx, 6, 10, 2, lamp);
    glow(f, lx + 5, 9, lamp);
  }
  // Tiled back wall.
  for (let px = 0; px < W; px += 10) f(px, band, 1, platY - band, "#33414D");
  for (let py = band + 6; py < platY - 4; py += 8) f(0, py, W, 1, "#33414D");
  // Tiled pillars across the concourse (same ~105px cadence as the reference).
  for (let px = 70; px < W - 20; px += 105) {
    f(px, 20, 11, platY - 20, "#2E3A44");
    f(px, 20, 2, platY - 20, "#3E4C58");
    f(px + 9, 20, 2, platY - 20, "#242E36");
  }
  // Centered METRO sign with a red M roundel.
  const mid = Math.round(W / 2);
  box(f, mid - 30, 14, 60, 14, "#1E4E86");
  for (let i = 0; i < 8; i++) f(mid - 24 + i * 6, 18, 3, 6, "#DCE6F0");
  f(mid - 46, 14, 14, 14, "#C0392B");
  f(mid - 42, 18, 6, 6, "#FFFFFF");
  f(mid - 41, 19, 1, 4, "#C0392B");
  f(mid - 39, 19, 1, 4, "#C0392B");
  f(mid - 37, 19, 1, 4, "#C0392B");
  // Lit route-map board.
  box(f, 20, 54, 52, 28, "#20303E");
  f(24, 58, 44, 2, "#5FB0DC");
  f(24, 64, 32, 1, "#E8C14A");
  f(24, 68, 38, 1, "#6bd47a");
  for (let i = 0; i < 6; i++) f(26 + i * 7, 60, 2, 2, "#F4F0E4");
  // Platform benches, tiled along the platform.
  for (let bx = 110; bx < W - 24; bx += 100) {
    box(f, bx, platY - 7, 22, 7, "#6A5240");
    f(bx + 2, platY - 11, 2, 4, "#4A3A2E");
    f(bx + 18, platY - 11, 2, 4, "#4A3A2E");
  }
  // Yellow-edged platform.
  f(0, platY, W, 8, "#5A6470");
  f(0, platY, W, 1, "#6E7A88");
  f(0, platY + 7, W, 3, "#caa84a");
  f(0, platY + 7, W, 1, "#E8C14A");
  // Track bed below (the train actor rides here).
  f(0, H - 3, W, 3, "#1A2028");
  f(0, H - 2, W, 1, "#3A4652");
}
