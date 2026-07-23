import { visibleOccupants } from "../../engine/Crowd";
import type { Unit } from "../../engine/types";
import { castShadow, personSeated, personStanding, shade, shell, type RoomCtx } from "./common";

/**
 * Modern Clinic art: a small health clinic in one of five practices (dental,
 * urgent care, optometry, pharmacy, physio). Every practice keeps one anchor
 * shape, the clinical trim band with a small cross along the top, and its
 * subtype furnishes its own room, so a Dental and a Pharmacy read as clearly
 * different. Modern-only (never exported to the 1994 TDT), so nothing here
 * carries an ordinal.
 *
 * Drawing reads only bake-signature inputs (subtype via the look, the real
 * occupant count, `lit`, and a stable geography seed), so a placed room stays
 * cacheable, an empty clinic reads empty, and a TDT id renumber never reshuffles
 * the figures.
 */

export interface ClinicLook {
  wall: string;
  floor: string;
  /** The trim / cross accent color; the equipment picks its own colors, but the
   *  shared clinical band reads this. */
  accent: string;
  /** Which practice fills the clinic. 1:1 with the subtype, so the look table
   *  stays trivially pairwise-distinct. */
  practice: "dental" | "urgent" | "optometry" | "pharmacy" | "physio";
}

export const CLINIC_DEFAULT: ClinicLook = { wall: "#E8F0F2", floor: "#C8D0D4", accent: "#4AB0C0", practice: "dental" };
export const CLINIC_LOOKS: Record<string, ClinicLook> = {
  "Dental": { wall: "#E8F0F2", floor: "#C8D0D4", accent: "#4AB0C0", practice: "dental" },
  "Urgent Care": { wall: "#F0ECE4", floor: "#D0C8BC", accent: "#D04A4A", practice: "urgent" },
  "Optometry": { wall: "#E4E8F0", floor: "#C4C8D4", accent: "#5A6AC0", practice: "optometry" },
  "Pharmacy": { wall: "#E8F0E4", floor: "#C8D0C0", accent: "#4AA85A", practice: "pharmacy" },
  "Physio": { wall: "#F0E8EC", floor: "#D0C4C8", accent: "#E08A4A", practice: "physio" },
};

/** A stable per-room seed from GEOGRAPHY (floor, x), so the figures survive a
 *  save/export/import (which renumbers `u.id`). */
function figureSeed(u: Pick<Unit, "floor" | "x">): number {
  return (u.floor * 131 + u.x * 17) | 0;
}

/** The clinical trim band: the shared anchor. A pale trim rail with a small
 *  medical cross, the one shape every practice keeps. Returns the Y below it. */
function clinicalBand(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, accent: string): number {
  const band = 5;
  ctx.fillStyle = shade(accent, 40); // pale trim
  ctx.fillRect(x + 2, y + 2, w - 4, band);
  ctx.fillStyle = accent; // under-rail
  ctx.fillRect(x + 2, y + band + 1, w - 4, 1);
  // A small cross near the left.
  const cx = x + 5;
  const cy = y + 3;
  ctx.fillStyle = accent;
  ctx.fillRect(cx + 1, cy, 1, 3);
  ctx.fillRect(cx, cy + 1, 3, 1);
  return y + band + 2;
}

function drawDental(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, top: number, look: ClinicLook, occ: number, seed: number): void {
  // A reclined dental chair under an overhead lamp, a tool tray beside it.
  const chX = x + Math.round(w * 0.28);
  ctx.fillStyle = "#B8C4C8"; // chair
  ctx.fillRect(chX, floorY - 6, 12, 4);
  ctx.fillStyle = shade("#B8C4C8", -20);
  ctx.fillRect(chX, floorY - 2, 2, 2);
  if (occ > 0) personSeated(ctx, chX + 4, floorY - 4, seed); // reclined patient
  // Overhead lamp on an arm.
  ctx.fillStyle = "#8A9498";
  ctx.fillRect(chX + 4, top + 1, 1, 4);
  ctx.fillStyle = look.accent;
  ctx.fillRect(chX + 2, top + 5, 5, 2);
  // A tool tray on a stand.
  const tX = x + w - 5;
  ctx.fillStyle = "#9AA4A8";
  ctx.fillRect(tX, floorY - 8, 4, 1);
  ctx.fillRect(tX + 1, floorY - 7, 1, 7);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = look.accent;
    ctx.fillRect(tX + i, floorY - 9, 1, 1);
  }
  castShadow(ctx, chX, floorY, 12);
}

function drawUrgent(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, top: number, look: ClinicLook, occ: number, seed: number): void {
  // An exam bed behind a half-drawn curtain, an IV pole, a wall monitor.
  const bX = x + 3;
  ctx.fillStyle = "#DCE0E0"; // bed
  ctx.fillRect(bX, floorY - 5, 13, 3);
  ctx.fillStyle = look.accent; // a blanket stripe
  ctx.fillRect(bX, floorY - 3, 13, 1);
  if (occ > 0) personSeated(ctx, bX + 4, floorY - 3, seed); // a patient
  // Curtain rail + curtain on the right half.
  ctx.fillStyle = "#A0A8AC";
  ctx.fillRect(x + Math.round(w * 0.55), top, 1, floorY - top - 1);
  ctx.fillStyle = shade(look.accent, 40);
  ctx.fillRect(x + Math.round(w * 0.55), top, Math.round(w * 0.4), 2);
  // IV pole.
  const iX = bX + 14;
  ctx.fillStyle = "#9AA4A8";
  ctx.fillRect(iX, floorY - 14, 1, 14);
  ctx.fillStyle = "#C8E0EC";
  ctx.fillRect(iX - 1, floorY - 14, 3, 3);
  // Wall monitor with a heartbeat line.
  ctx.fillStyle = "#1A2228";
  ctx.fillRect(x + 3, top + 2, 8, 5);
  ctx.fillStyle = "#4AE07A";
  ctx.fillRect(x + 4, top + 5, 6, 1);
}

function drawOptometry(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, top: number, look: ClinicLook, occ: number, seed: number): void {
  // A phoropter (the twin-lens device) on a stand, an eye chart, a glasses shelf.
  const pX = x + 4;
  ctx.fillStyle = "#7A8288"; // phoropter body
  ctx.fillRect(pX, floorY - 10, 6, 4);
  ctx.fillStyle = "#2A3238"; // twin lenses
  ctx.fillRect(pX + 1, floorY - 9, 2, 2);
  ctx.fillRect(pX + 3, floorY - 9, 2, 2);
  ctx.fillStyle = "#9AA4A8"; // stand
  ctx.fillRect(pX + 2, floorY - 6, 1, 6);
  if (occ > 0) personSeated(ctx, pX + 8, floorY - 4, seed); // patient being tested
  // An eye chart on the back wall (rows of shrinking marks).
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(x + w - 8, top + 2, 6, 8);
  for (let r = 0; r < 3; r++) {
    ctx.fillStyle = look.accent;
    const rw = 5 - r * 2;
    ctx.fillRect(x + w - 8 + Math.round((6 - rw) / 2), top + 4 + r * 2, rw, 1);
  }
}

function drawPharmacy(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, top: number, look: ClinicLook, occ: number, seed: number): void {
  // Back-wall shelves of medicine bottles, a counter, an Rx sign.
  for (let sy = top + 2, r = 0; sy + 3 < floorY - 6; sy += 4, r++) {
    ctx.fillStyle = "#A0A8A0"; // shelf
    ctx.fillRect(x + 3, sy + 2, w - 6, 1);
    for (let bx = x + 4; bx + 1 < x + w - 4; bx += 2) {
      ctx.fillStyle = shade(look.accent, ((bx + r) % 3) * 18 - 18); // varied bottles
      ctx.fillRect(bx, sy, 1, 2);
    }
  }
  // The counter.
  ctx.fillStyle = "#B0B8B0";
  ctx.fillRect(x + 3, floorY - 5, w - 6, 5);
  ctx.fillStyle = shade("#B0B8B0", 20);
  ctx.fillRect(x + 3, floorY - 5, w - 6, 1);
  // Rx sign.
  ctx.fillStyle = look.accent;
  ctx.fillRect(x + w - 6, top + 1, 4, 3);
  if (occ > 0) personStanding(ctx, x + 5, floorY, seed); // a pharmacist/customer
}

function drawPhysio(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, top: number, look: ClinicLook, occ: number, seed: number): void {
  // A padded therapy table, a therapy ball, resistance bands on a rack.
  const tX = x + 3;
  ctx.fillStyle = look.accent; // padded table top
  ctx.fillRect(tX, floorY - 5, 12, 2);
  ctx.fillStyle = "#8A8288"; // legs
  ctx.fillRect(tX + 1, floorY - 3, 1, 3);
  ctx.fillRect(tX + 10, floorY - 3, 1, 3);
  if (occ > 0) personSeated(ctx, tX + 4, floorY - 3, seed); // a patient on the table
  // A therapy ball.
  const bX = x + w - 6;
  ctx.fillStyle = shade(look.accent, 20);
  ctx.fillRect(bX, floorY - 5, 5, 5);
  ctx.fillStyle = shade(look.accent, -20);
  ctx.fillRect(bX, floorY - 1, 5, 1);
  // Resistance bands hanging on a wall rack.
  ctx.fillStyle = "#8A8288";
  ctx.fillRect(x + 4, top + 2, 6, 1);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = ["#D04A4A", "#4AA85A", "#5A6AC0"][i];
    ctx.fillRect(x + 5 + i * 2, top + 3, 1, 4);
  }
}

/** The Modern Clinic. Reused for every practice subtype; the look's `practice`
 *  discriminant picks the interior so each renders as its own room. */
export function clinic(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  const look = (u.subtype !== undefined && CLINIC_LOOKS[u.subtype]) || CLINIC_DEFAULT;
  const floorY = shell(ctx, x, y, w, h, look.wall, look.floor);
  const top = clinicalBand(ctx, x, y, w, look.accent);
  const occ = visibleOccupants(u);
  const seed = figureSeed(u);
  switch (look.practice) {
    case "dental":
      drawDental(ctx, x, floorY, w, top, look, occ, seed);
      break;
    case "urgent":
      drawUrgent(ctx, x, floorY, w, top, look, occ, seed);
      break;
    case "optometry":
      drawOptometry(ctx, x, floorY, w, top, look, occ, seed);
      break;
    case "pharmacy":
      drawPharmacy(ctx, x, floorY, w, top, look, occ, seed);
      break;
    case "physio":
      drawPhysio(ctx, x, floorY, w, top, look, occ, seed);
      break;
  }
}
