import { visibleOccupants } from "../../engine/Crowd";
import type { Unit } from "../../engine/types";
import { castShadow, hash, personSeated, personStanding, shade, shell, type RoomCtx } from "./common";

/**
 * Modern Fitness Club art: a members' gym in one of five formats (a weight
 * floor, a yoga studio, a spin studio, a boxing gym, a climbing wall). Every
 * format keeps one anchor shape, the wall-mirror strip along the top, and its
 * subtype furnishes its own equipment, so a Weight Floor and a Climbing Wall
 * read as clearly different rooms. Modern-only (never exported to the 1994 TDT),
 * so nothing here carries an ordinal.
 *
 * Drawing reads only bake-signature inputs (subtype via the look, the real
 * occupant count, `lit`, and a stable geography seed), so a placed room stays
 * cacheable, an empty club reads empty, and a TDT id renumber never reshuffles
 * the figures.
 */

export interface FitnessLook {
  wall: string;
  floor: string;
  /** The mirror-strip / accent color; the equipment picks its own colors, but
   *  the shared anchor reads this. */
  accent: string;
  /** Which format fills the club. 1:1 with the subtype, so the look table stays
   *  trivially pairwise-distinct. */
  format: "weights" | "yoga" | "spin" | "boxing" | "climb";
}

export const FITNESS_DEFAULT: FitnessLook = { wall: "#3A3E48", floor: "#2E323A", accent: "#C86A3A", format: "weights" };
export const FITNESS_LOOKS: Record<string, FitnessLook> = {
  "Weight Floor": { wall: "#3A3E48", floor: "#2E323A", accent: "#C86A3A", format: "weights" },
  "Yoga Studio": { wall: "#E8E0EC", floor: "#C8B8A0", accent: "#8AB86A", format: "yoga" },
  "Spin Studio": { wall: "#201828", floor: "#2A2030", accent: "#E0407A", format: "spin" },
  "Boxing Gym": { wall: "#4A2A2A", floor: "#3A2820", accent: "#D03A3A", format: "boxing" },
  "Climbing Wall": { wall: "#2A3A44", floor: "#24303A", accent: "#E0C040", format: "climb" },
};

/** A stable per-room seed from GEOGRAPHY (floor, x), so the figures survive a
 *  save/export/import (which renumbers `u.id`). */
function figureSeed(u: Pick<Unit, "floor" | "x">): number {
  return (u.floor * 131 + u.x * 17) | 0;
}

/** The mirror strip: the shared anchor. A bright glass band with a thin accent
 *  frame along the upper wall, the one shape every gym keeps. Returns the Y just
 *  below it. */
function mirrorStrip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, wall: string, accent: string, lit: boolean): number {
  const band = 6;
  ctx.fillStyle = shade(wall, lit ? 30 : 14); // glass
  ctx.fillRect(x + 2, y + 2, w - 4, band);
  ctx.fillStyle = shade(wall, 46); // bright highlight streak
  ctx.fillRect(x + 3, y + 3, Math.max(1, Math.round((w - 6) * 0.4)), 1);
  ctx.fillStyle = accent; // accent frame under the mirror
  ctx.fillRect(x + 2, y + band + 2, w - 4, 1);
  return y + band + 3;
}

function drawWeights(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, look: FitnessLook, occ: number, seed: number): void {
  // A dumbbell rack along the back and a flat bench with a lifter.
  ctx.fillStyle = shade(look.wall, 24); // rack frame
  ctx.fillRect(x + 3, floorY - 12, w - 6, 2);
  for (let dx = x + 5; dx + 4 < x + w - 4; dx += 6) {
    ctx.fillStyle = look.accent; // dumbbell ends
    ctx.fillRect(dx, floorY - 11, 2, 4);
    ctx.fillRect(dx + 3, floorY - 11, 2, 4);
    ctx.fillStyle = shade(look.wall, 40); // bar
    ctx.fillRect(dx + 2, floorY - 10, 1, 2);
  }
  // A flat bench.
  const bX = x + Math.round(w * 0.3);
  ctx.fillStyle = "#2A2A30";
  ctx.fillRect(bX, floorY - 5, 14, 3);
  ctx.fillRect(bX + 1, floorY - 2, 2, 2);
  ctx.fillRect(bX + 11, floorY - 2, 2, 2);
  if (occ > 0) personSeated(ctx, bX + 4, floorY - 3, seed); // a lifter on the bench
  castShadow(ctx, bX, floorY, 14);
}

function drawYoga(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, look: FitnessLook, occ: number, seed: number): void {
  // A calm studio: mats laid on the floor, standing figures mid-pose, a plant.
  let i = 0;
  for (let mx = x + 5; mx + 9 < x + w - 4; mx += 12, i++) {
    ctx.fillStyle = i % 2 === 0 ? look.accent : shade(look.accent, 30); // rolled/laid mats
    ctx.fillRect(mx, floorY - 2, 9, 2);
    if (i < occ) personStanding(ctx, mx + 2, floorY - 1, seed + i * 7);
  }
  // A potted plant in the corner.
  const pX = x + w - 6;
  ctx.fillStyle = "#7A5A3A";
  ctx.fillRect(pX, floorY - 4, 4, 4);
  ctx.fillStyle = "#4A9A56";
  ctx.fillRect(pX, floorY - 9, 4, 5);
}

function drawSpin(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, look: FitnessLook, occ: number, seed: number): void {
  // A dim room of stationary bikes lit by an accent glow, riders on some.
  ctx.fillStyle = shade(look.accent, -30); // floor light wash
  ctx.fillRect(x + 2, floorY - 1, w - 4, 1);
  let i = 0;
  for (let bx = x + 5; bx + 5 < x + w - 3; bx += 8, i++) {
    ctx.fillStyle = "#14141A"; // bike frame
    ctx.fillRect(bx, floorY - 9, 5, 9);
    ctx.fillStyle = look.accent; // flywheel accent
    ctx.fillRect(bx + 1, floorY - 7, 3, 3);
    ctx.fillStyle = "#2A2A32"; // handlebar
    ctx.fillRect(bx, floorY - 11, 3, 1);
    if (i < occ && hash(seed * 13 + i) > 0.25) personSeated(ctx, bx, floorY - 6, seed + i * 5);
  }
}

function drawBoxing(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, look: FitnessLook, occ: number, seed: number): void {
  // A heavy bag hanging from the ceiling, a ring corner post with ropes, a boxer.
  const bagX = x + Math.round(w * 0.34);
  ctx.fillStyle = "#4A4A52"; // chain
  ctx.fillRect(bagX + 2, floorY - 20, 1, 4);
  ctx.fillStyle = shade(look.accent, -10); // the bag
  ctx.fillRect(bagX, floorY - 16, 5, 12);
  ctx.fillStyle = shade(look.accent, 26);
  ctx.fillRect(bagX, floorY - 16, 5, 1);
  if (occ > 0) personStanding(ctx, bagX - 6, floorY, seed); // a boxer working the bag
  // A ring corner: a post and two rope lines.
  const rX = x + w - 5;
  ctx.fillStyle = "#C8C4B8"; // post
  ctx.fillRect(rX, floorY - 14, 2, 14);
  ctx.fillStyle = look.accent; // ropes
  ctx.fillRect(x + Math.round(w * 0.6), floorY - 12, rX - (x + Math.round(w * 0.6)), 1);
  ctx.fillRect(x + Math.round(w * 0.6), floorY - 8, rX - (x + Math.round(w * 0.6)), 1);
  castShadow(ctx, bagX, floorY, 5);
}

function drawClimb(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, top: number, look: FitnessLook, occ: number, seed: number): void {
  // A tall bouldering wall studded with colorful holds, a climber part-way up.
  const wallX = x + 4;
  const wallW = Math.round(w * 0.5);
  ctx.fillStyle = shade(look.wall, 18); // the wall panel
  ctx.fillRect(wallX, top, wallW, floorY - top);
  const holdHues = ["#E0407A", "#40C0E0", "#E0C040", "#60D060"];
  for (let hy = top + 3; hy < floorY - 3; hy += 5) {
    for (let hx = wallX + 3; hx + 2 < wallX + wallW - 1; hx += 7) {
      ctx.fillStyle = holdHues[(hx + hy + seed) % holdHues.length];
      ctx.fillRect(hx + ((hy / 5) % 2), hy, 2, 2);
    }
  }
  if (occ > 0) personStanding(ctx, wallX + Math.round(wallW * 0.5), floorY - Math.round((floorY - top) * 0.35), seed);
  // A crash mat at the base.
  ctx.fillStyle = shade(look.accent, -20);
  ctx.fillRect(wallX - 1, floorY - 2, wallW + 2, 2);
}

/** The Modern Fitness Club. Reused for every format subtype; the look's `format`
 *  discriminant picks the interior so each format renders as its own room. */
export function fitnessClub(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  const look = (u.subtype !== undefined && FITNESS_LOOKS[u.subtype]) || FITNESS_DEFAULT;
  const floorY = shell(ctx, x, y, w, h, look.wall, look.floor);
  const top = mirrorStrip(ctx, x, y, w, look.wall, look.accent, d.lit);
  const occ = visibleOccupants(u);
  const seed = figureSeed(u);
  switch (look.format) {
    case "weights":
      drawWeights(ctx, x, floorY, w, look, occ, seed);
      break;
    case "yoga":
      drawYoga(ctx, x, floorY, w, look, occ, seed);
      break;
    case "spin":
      drawSpin(ctx, x, floorY, w, look, occ, seed);
      break;
    case "boxing":
      drawBoxing(ctx, x, floorY, w, look, occ, seed);
      break;
    case "climb":
      drawClimb(ctx, x, floorY, w, top, look, occ, seed);
      break;
  }
}
