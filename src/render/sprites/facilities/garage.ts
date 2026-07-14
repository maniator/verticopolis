import type { Unit } from "../../../engine/types";
import { ACCENTS, rand, shade, type DrawCtx } from "../common";
import { box, floorb, refMap } from "./serviceKit";

/**
 * The basement garage kinds: a single parking space and the parking ramp.
 * Both are ported pixel-exact from their Figma reference build scripts
 * (`page-01-parking-medical-security.build.js`, `page-01-parking-ramp.build.js`)
 * through the shared `refMap` scaler. Placement is engine truth (`basement:true`
 * and the ramp chain); the render only reflects it.
 */

// ---- Parking spaces ---------------------------------------------------------

export function drawParking(d: DrawCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const ctx = d.ctx;
  const RW = 44;
  const RH = 44;
  const { F } = refMap(ctx, x, y, w, h, RW, RH);
  const W = RW;
  const fy = RH - 6;
  // Concrete deck, ceiling beam and pipe, support pillar, painted stall lines.
  F(0, 0, W, fy, "#565A62");
  F(0, 0, W, 3, "#3E424A");
  F(0, 4, W, 1, "#5E636B");
  floorb(F, 0, fy, W, 6, "#4A4E56");
  F(4, 2, 3, fy - 2, "#3E424A");
  F(4, 2, 1, fy - 2, "#4E535B");
  F(10, fy - 16, 1, 15, "#DCDCD0", 0.5);
  F(W - 4, fy - 16, 1, 15, "#DCDCD0", 0.5);
  // A single car, centered, shown only when this space actually holds one and
  // is not dead. `parkingUse` and `parkingDead` are prepared inputs; a stable
  // per-space roll versus the tower-wide usage fraction fills the same spaces
  // first as the lot loads, and a dead (unchained) space never shows a car.
  const rawUse = d.parkingDead ? 0 : d.parkingUse ?? 0;
  const use = Number.isFinite(rawUse) ? rawUse : 0;
  if (rand((u.id * 31) | 0) < use) {
    const body = ACCENTS[u.id % ACCENTS.length];
    box(F, 14, fy - 9, 26, 7, body);
    F(17, fy - 13, 20, 5, shade(body, -24));
    F(19, fy - 12, 7, 3, "#CFE4FF");
    F(28, fy - 12, 7, 3, "#CFE4FF");
    F(15, fy - 3, 4, 3, "#1A1D24");
    F(34, fy - 3, 4, 3, "#1A1D24");
    F(38, fy - 8, 2, 2, "#FFE27A");
    F(16, fy + 2, 20, 1, "#000000", 0.25);
  }
  // Blue P sign.
  F(W - 12, 8, 9, 9, "#2A5AA8");
  F(W - 10, 10, 2, 5, "#FFFFFF");
  F(W - 10, 10, 4, 1, "#FFFFFF");
  F(W - 7, 11, 1, 2, "#FFFFFF");
  F(W - 10, 12, 3, 1, "#FFFFFF");
}

// ---- Parking ramp -----------------------------------------------------------

export function drawParkingRamp(ctx: CanvasRenderingContext2D, u: Unit, x: number, y: number, w: number, h: number): void {
  const RW = 176;
  const RH = 44;
  const { F } = refMap(ctx, x, y, w, h, RW, RH);
  const W = RW;
  // The ramp reads as a raised driving surface via a shaded slab, a dark void
  // beneath, and a support column, so it is visibly the anchor that spaces
  // chain to. It enforces nothing; the chain is engine truth.
  const farEdge = (px: number): number => 14 + Math.round(((px - 24) * 18) / 94);
  const nearEdge = (px: number): number => farEdge(px) + 8;
  F(0, 0, W, RH, "#313640");
  // Ceiling beam, joists, pipe, and conduit.
  F(0, 0, W, 4, "#4A4E56");
  F(0, 0, W, 1, "#5C606A");
  F(0, 4, W, 1, "#2E3238");
  for (const jx of [16, 32, 48, 64, 80, 96, 112, 128, 144, 160]) F(jx, 5, 1, 2, "#34383E");
  F(16, 6, 144, 1, "#6C7684");
  F(16, 8, 144, 1, "#4A525C");
  for (const sxx of [40, 72, 104, 136]) F(sxx, 4, 1, 2, "#34383E");
  F(92, 10, 68, 1, "#5B6470");
  // Under-ramp void and support column.
  for (let px = 24; px <= 118; px++) {
    const ne = nearEdge(px);
    F(px, ne, 1, 40 - ne, "#2A2E34");
  }
  F(67, 31, 5, 9, "#3A3E46");
  // Road surface with light and dark edge rails.
  for (let px = 24; px <= 118; px++) {
    const fe = farEdge(px);
    const ne = nearEdge(px);
    F(px, fe, 1, ne - fe, "#565A62");
    F(px, fe, 1, 1, "#6E727A");
    F(px, ne - 1, 1, 1, "#3E434B");
  }
  for (let px = 28; px <= 116; px++) {
    F(px, farEdge(px) + 3, 1, 1, "#4C5058");
    F(px, farEdge(px) + 5, 1, 1, "#4C5058");
  }
  // Descending chevrons mark the direction of travel.
  for (const p of [[40, 21], [62, 25], [84, 29], [106, 34]] as const) {
    F(p[0] - 3, p[1] - 3, 5, 2, "#D9BE55");
    F(p[0] - 3, p[1] + 1, 5, 2, "#D9BE55");
    F(p[0] + 1, p[1] - 1, 2, 2, "#D9BE55");
  }
  // Ramp-mouth portal (cars descend from above).
  F(14, 12, 10, 12, "#24282E");
  F(19, 12, 8, 2, "#D9BE55");
  F(21, 12, 1, 2, "#2E3238");
  F(24, 12, 1, 2, "#2E3238");
  // Flat deck at the foot.
  F(118, 32, 58, 8, "#565A62");
  F(118, 32, 58, 1, "#6E727A");
  F(118, 39, 58, 1, "#3E434B");
  // Blue P roundel.
  F(143, 4, 1, 5, "#34383E");
  F(149, 4, 1, 5, "#34383E");
  F(140, 9, 12, 11, "#2F5DA8");
  F(140, 9, 12, 1, "#1E3E76");
  F(143, 11, 2, 7, "#EDEFF2");
  F(143, 11, 5, 1, "#EDEFF2");
  F(147, 12, 1, 2, "#EDEFF2");
  F(143, 14, 5, 1, "#EDEFF2");
  // Pillars with hazard bands.
  for (const px of [6, 160]) {
    F(px, 8, 6, 32, "#4A4E56");
    F(px, 8, 1, 32, "#5C606A");
    F(px + 5, 8, 1, 32, "#34383E");
    F(px - 1, 38, 8, 2, "#4A4E56");
    F(px, 27, 6, 4, "#D9BE55");
    F(px + 1, 27, 1, 4, "#2E3238");
    F(px + 3, 27, 1, 4, "#2E3238");
  }
  // Foundation, oil, lane arrow, stall divider, and a second-car nose.
  F(0, 41, W, 2, "#3E424A");
  F(88, 41, 1, 2, "#2E3238");
  F(140, 38, 12, 2, "#2C3036");
  F(122, 36, 6, 1, "#9AA0A8");
  F(120, 35, 2, 3, "#9AA0A8");
  F(158, 33, 1, 7, "#9AA0A8");
  F(168, 32, 8, 5, "#6E6A62");
  F(170, 35, 4, 4, "#16181C");
  F(171, 35, 2, 1, "#6A6E76");
  // Primary parked car at the ramp foot (side view, wheels on the deck).
  F(135, 40, 20, 1, "#2C3036");
  F(137, 35, 5, 4, "#16181C");
  F(149, 35, 5, 4, "#16181C");
  F(138, 35, 3, 1, "#6A6E76");
  F(150, 35, 3, 1, "#6A6E76");
  F(134, 32, 22, 5, "#5D7FA6");
  F(134, 32, 22, 1, "#7E9EC0");
  F(134, 37, 22, 1, "#3E5876");
  F(139, 27, 12, 5, "#5D7FA6");
  F(139, 27, 12, 1, "#7E9EC0");
  F(140, 28, 10, 3, "#AEBFD4");
  F(145, 28, 1, 3, "#5D7FA6");
  F(134, 35, 1, 1, "#E7D9A6");
  F(156, 35, 1, 1, "#C98A3A");
  void u;
}
