import type { Unit } from "../../../engine/types";
import { ACCENTS, rand, shade, type DrawCtx } from "../common";
import { box, floorb, refMap } from "./serviceKit";
import { FLOOR, TILE } from "../../scale";

/**
 * The basement garage kinds: a single parking space and the parking ramp.
 * Both are ported from their Figma reference build scripts
 * (`page-01-parking-medical-security.build.js`, `page-01-parking-ramp.build.js`)
 * through the shared `refMap` scaler. Placement is engine truth (`basement:true`
 * and the ramp chain); the render only reflects it.
 *
 * The references were re-authored onto the live TILE 10 by FLOOR 45 grid, so
 * `RW`/`RH` equal the on-screen footprint and `refMap` is the identity. Keep them
 * that way: a reference that drifts off the shipped size resamples every rect,
 * and a resampled repeat (stall lines, car wheels, ceiling joists) loses its even
 * pitch.
 */

// ---- Parking spaces ---------------------------------------------------------

export function drawParking(d: DrawCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const ctx = d.ctx;
  const RW = 4 * TILE;
  const RH = FLOOR;
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
  F(9, fy - 16, 1, 15, "#DCDCD0", 0.5);
  F(W - 4, fy - 16, 1, 15, "#DCDCD0", 0.5);
  // A single car, centered, shown only when this space actually holds one and
  // is not dead. `parkingUse` and `parkingDead` are prepared inputs; a stable
  // per-space roll versus the tower-wide usage fraction fills the same spaces
  // first as the lot loads, and a dead (unchained) space never shows a car.
  const rawUse = d.parkingDead ? 0 : d.parkingUse ?? 0;
  const use = Number.isFinite(rawUse) ? rawUse : 0;
  if (rand((u.id * 31) | 0) < use) {
    const body = ACCENTS[u.id % ACCENTS.length];
    // Every part of the car is placed off `cx`/`cw` so the two windows and the
    // two wheels stay evenly spaced whatever the body width becomes.
    const cx = 13;
    const cw = 24;
    box(F, cx, fy - 9, cw, 7, body);
    F(cx + 3, fy - 13, cw - 6, 5, shade(body, -24));
    for (let k = 0; k < 2; k++) F(cx + 5 + k * 8, fy - 12, 6, 3, "#CFE4FF");
    for (const wo of [1, cw - 5]) F(cx + wo, fy - 3, 4, 3, "#1A1D24");
    F(cx + cw - 2, fy - 8, 2, 2, "#FFE27A");
    F(cx + 2, fy + 2, cw - 4, 1, "#000000", 0.25);
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
  const RW = 16 * TILE;
  const RH = FLOOR;
  const { F } = refMap(ctx, x, y, w, h, RW, RH);
  const W = RW;
  // The ramp reads as a raised driving surface via a shaded slab, a dark void
  // beneath, and a support column, so it is visibly the anchor that spaces
  // chain to. It enforces nothing; the chain is engine truth.
  const ground = RH - 4; // the floor line everything standing rests on
  const rampX0 = 22;
  const rampX1 = 107;
  const rampT = 8; // slab thickness, constant down the whole run
  // The near edge lands exactly on the floor line at the foot, so the void
  // beneath closes to nothing there instead of leaving a sliver.
  const farEdge = (px: number): number => 14 + Math.round(((px - rampX0) * (ground - rampT - 14)) / (rampX1 - rampX0));
  const nearEdge = (px: number): number => farEdge(px) + rampT;
  F(0, 0, W, RH, "#313640");
  // Ceiling beam, joists, pipe, and conduit. The joists sit on one derived
  // pitch under the pipe run, so they stay evenly spaced.
  F(0, 0, W, 4, "#4A4E56");
  F(0, 0, W, 1, "#5C606A");
  F(0, 4, W, 1, "#2E3238");
  const pipeX = 15;
  const pipeW = 131;
  const joists = 10;
  // Rounded per joist rather than stepped by a fixed pitch, so the run closes
  // on the pipe's last pixel instead of stopping short of it. Spacing stays
  // within a pixel of even, which a single integer pitch cannot manage here.
  for (let k = 0; k < joists; k++) F(pipeX + Math.round((k * (pipeW - 1)) / (joists - 1)), 5, 1, 2, "#34383E");
  F(pipeX, 6, pipeW, 1, "#6C7684");
  F(pipeX, 8, pipeW, 1, "#4A525C");
  for (let k = 0; k < 4; k++) F(36 + k * 29, 4, 1, 2, "#34383E");
  F(84, 10, 61, 1, "#5B6470");
  // Under-ramp void and support column.
  for (let px = rampX0; px <= rampX1; px++) {
    const ne = nearEdge(px);
    F(px, ne, 1, ground - ne, "#2A2E34");
  }
  F(61, 32, 5, ground - 32, "#3A3E46");
  // Road surface with light and dark edge rails.
  for (let px = rampX0; px <= rampX1; px++) {
    const fe = farEdge(px);
    const ne = nearEdge(px);
    F(px, fe, 1, ne - fe, "#565A62");
    F(px, fe, 1, 1, "#6E727A");
    F(px, ne - 1, 1, 1, "#3E434B");
  }
  for (let px = rampX0 + 4; px <= rampX1 - 2; px++) {
    F(px, farEdge(px) + 3, 1, 1, "#4C5058");
    F(px, farEdge(px) + 5, 1, 1, "#4C5058");
  }
  // Descending chevrons mark the direction of travel. Their y comes from the
  // slab itself, so they ride the slope instead of drifting off it.
  for (let k = 0; k < 4; k++) {
    const px = 36 + k * 20;
    const py = farEdge(px) + 4;
    F(px - 3, py - 3, 5, 2, "#D9BE55");
    F(px - 3, py + 1, 5, 2, "#D9BE55");
    F(px + 1, py - 1, 2, 2, "#D9BE55");
  }
  // Ramp-mouth portal (cars descend from above).
  F(rampX0 - 9, 12, 9, 12, "#24282E");
  F(rampX0 - 5, 12, 8, 2, "#D9BE55");
  for (let k = 0; k < 2; k++) F(rampX0 - 3 + k * 3, 12, 1, 2, "#2E3238");
  // Flat deck at the foot, continuing the slab thickness to the right wall.
  F(rampX1, farEdge(rampX1), W - rampX1, rampT, "#565A62");
  F(rampX1, farEdge(rampX1), W - rampX1, 1, "#6E727A");
  F(rampX1, ground - 1, W - rampX1, 1, "#3E434B");
  // Blue P roundel.
  const signX = 127;
  const signW = 11;
  for (const hx of [signX + 3, signX + signW - 3]) F(hx, 4, 1, 5, "#34383E");
  F(signX, 9, signW, 11, "#2F5DA8");
  F(signX, 9, signW, 1, "#1E3E76");
  F(signX + 3, 11, 2, 7, "#EDEFF2");
  F(signX + 3, 11, 5, 1, "#EDEFF2");
  F(signX + 7, 12, 1, 2, "#EDEFF2");
  F(signX + 3, 14, 5, 1, "#EDEFF2");
  // Pillars with hazard bands.
  for (const px of [5, 145]) {
    F(px, 8, 6, ground - 8, "#4A4E56");
    F(px, 8, 1, ground - 8, "#5C606A");
    F(px + 5, 8, 1, ground - 8, "#34383E");
    F(px - 1, ground - 2, 8, 2, "#4A4E56");
    F(px, 28, 6, 4, "#D9BE55");
    for (let k = 0; k < 2; k++) F(px + 1 + k * 2, 28, 1, 4, "#2E3238");
  }
  // Foundation, oil, lane arrow, stall divider, and a second-car nose.
  F(0, RH - 3, W, 2, "#3E424A");
  F(80, RH - 3, 1, 2, "#2E3238");
  F(127, ground - 2, 11, 2, "#2C3036");
  F(111, 37, 5, 1, "#9AA0A8");
  F(109, 36, 2, 3, "#9AA0A8");
  F(144, 34, 1, ground - 34, "#9AA0A8");
  F(W - 7, 33, 7, 5, "#6E6A62");
  F(W - 5, 36, 4, 4, "#16181C");
  F(W - 4, 36, 2, 1, "#6A6E76");
  // Primary parked car at the ramp foot (side view, wheels on the deck). Body
  // width drives the wheelbase, so the two wheels keep equal end margins.
  const carX = 122;
  const carW = 20;
  F(carX + 1, ground, carW - 2, 1, "#2C3036");
  for (const wo of [3, carW - 8]) {
    F(carX + wo, 36, 5, 4, "#16181C");
    F(carX + wo + 1, 36, 3, 1, "#6A6E76");
  }
  F(carX, 33, carW, 5, "#5D7FA6");
  F(carX, 33, carW, 1, "#7E9EC0");
  F(carX, 38, carW, 1, "#3E5876");
  F(carX + 5, 28, carW - 10, 5, "#5D7FA6");
  F(carX + 5, 28, carW - 10, 1, "#7E9EC0");
  F(carX + 6, 29, carW - 12, 3, "#AEBFD4");
  // A 2px center post splits the windscreen into two panes of equal width.
  F(carX + 9, 29, 2, 3, "#5D7FA6");
  F(carX, 36, 1, 1, "#E7D9A6");
  F(carX + carW, 36, 1, 1, "#C98A3A");
  void u;
}
