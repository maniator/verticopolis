import type { Unit } from "../../engine/types";
import { castShadow, hash, personSeated, personStanding, roomOccupants, shade, shell, type RoomCtx } from "./common";
import { artRow, authoredWidth } from "./artScale";

/**
 * Modern Boutique Bay art: a bay of small independent trades (florist, barber,
 * phone repair, vintage, tattoo, record store, gallery). Every trade keeps one
 * anchor shape, the shopfront fascia band across the top, and its subtype
 * furnishes its own shopfront, so a Florist and a Tattoo parlor read as clearly
 * different rooms. Modern-only (never exported to the 1994 TDT), so nothing here
 * carries an ordinal.
 *
 * Drawing reads only bake-signature inputs (subtype via the look, the real
 * occupant count, `lit`, and a stable geography seed), so a placed room stays
 * cacheable, an empty shop reads empty, and a TDT id renumber never reshuffles
 * the figures.
 */

export interface BoutiqueLook {
  wall: string;
  floor: string;
  /** The fascia / sign accent; the interior props pick their own colors, but the
   *  shared shopfront band reads this. */
  accent: string;
  /** Which trade fills the shop. 1:1 with the subtype, so the look table stays
   *  trivially pairwise-distinct. */
  trade: "florist" | "barber" | "phone" | "vintage" | "tattoo" | "records" | "gallery";
}

export const BOUTIQUE_DEFAULT: BoutiqueLook = { wall: "#E8F0E0", floor: "#C8B89A", accent: "#E86A8A", trade: "florist" };
export const BOUTIQUE_LOOKS: Record<string, BoutiqueLook> = {
  "Florist": { wall: "#E8F0E0", floor: "#C8B89A", accent: "#E86A8A", trade: "florist" },
  "Barber": { wall: "#E0E4EC", floor: "#8A6E50", accent: "#C0392B", trade: "barber" },
  "Phone Repair": { wall: "#DCE4EC", floor: "#B0B4BC", accent: "#3AC0E0", trade: "phone" },
  "Vintage": { wall: "#EBE0D0", floor: "#9A7A5A", accent: "#A85A8C", trade: "vintage" },
  "Tattoo": { wall: "#2A2A32", floor: "#3A3A42", accent: "#C83A5A", trade: "tattoo" },
  "Record Store": { wall: "#E4DAC8", floor: "#6A5A48", accent: "#E08A3A", trade: "records" },
  "Gallery": { wall: "#F0EEE8", floor: "#C4BCB0", accent: "#4A6A9A", trade: "gallery" },
};

/** A stable per-room seed from GEOGRAPHY (floor, x), so the figures and prop
 *  colors survive a save/export/import (which renumbers `u.id`). */
function figureSeed(u: Pick<Unit, "floor" | "x">): number {
  return (u.floor * 131 + u.x * 17) | 0;
}

const GARMENT_HUES = ["#C0506A", "#4A7AA8", "#5AA868", "#D8A03A", "#8A5AB0", "#D06A3A"];
const BLOOM_HUES = ["#E85A7A", "#F0A030", "#E0D040", "#C060A0", "#F07050"];

/** The fascia band: the shared anchor shape. A colored shopfront sign strip with
 *  a lit under-edge, so every trade is unmistakably part of the bay. Returns the
 *  Y just below the band. */
function fascia(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, accent: string, lit: boolean): number {
  const band = 5;
  ctx.fillStyle = shade(accent, -40);
  ctx.fillRect(x, y, w, band);
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = lit ? shade(accent, 70) : shade(accent, 20); // lit under-edge
  ctx.fillRect(x, y + band - 1, w, 1);
  return y + band;
}

/** A tidy display counter along the floor line, the shared retail cue. */
function counter(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, wood: string): number {
  const h = 6;
  const top = floorY - h;
  ctx.fillStyle = shade(wood, -20);
  ctx.fillRect(x + 3, top, w - 6, h);
  ctx.fillStyle = shade(wood, 24); // lit top edge
  ctx.fillRect(x + 3, top, w - 6, 1);
  return top;
}

function drawFlorist(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, top: number, seed: number): void {
  // Buckets of cut flowers along the floor, a hanging planter above.
  for (let bx = x + 4, i = 0; bx + 6 < x + w - 2; bx += 9, i++) {
    ctx.fillStyle = "#5A6E5A"; // zinc bucket
    ctx.fillRect(bx, floorY - 6, 6, 6);
    for (let s = 0; s < 3; s++) {
      const sx = bx + 1 + s * 2;
      ctx.fillStyle = "#3A7A46"; // stem
      ctx.fillRect(sx, floorY - 12, 1, 6);
      ctx.fillStyle = BLOOM_HUES[(i + s + seed) % BLOOM_HUES.length]; // bloom
      ctx.fillRect(sx - 1, floorY - 14, 3, 3);
    }
  }
  // A hanging planter with trailing green.
  const px = x + Math.round(w * 0.5);
  ctx.fillStyle = "#7A5A3A";
  ctx.fillRect(px - 4, top + 2, 8, 3);
  ctx.fillStyle = "#4A9A56";
  for (let i = 0; i < 5; i++) ctx.fillRect(px - 4 + i * 2, top + 5, 1, 3 + (i % 2) * 2);
}

function drawBarber(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, top: number, accent: string, occ: number, seed: number): void {
  // A barber chair facing a wall mirror, and the striped pole.
  const chX = x + Math.round(w * 0.34);
  ctx.fillStyle = "#3A3A44"; // chair base + seat
  ctx.fillRect(chX, floorY - 10, 10, 10);
  ctx.fillStyle = shade(accent, -10); // red leather seat
  ctx.fillRect(chX + 1, floorY - 11, 8, 3);
  if (occ > 0) personSeated(ctx, chX + 2, floorY - 8, seed); // seated client, lifted onto the chair
  // Wall mirror.
  ctx.fillStyle = "#B8C4C8";
  ctx.fillRect(chX - 1, top + 3, 5, 12);
  ctx.fillStyle = "#8A9498";
  ctx.fillRect(chX - 1, top + 3, 5, 1);
  // The barber pole by the door.
  const pX = x + w - 6;
  for (let py = top + 2; py < floorY - 2; py += 3) {
    ctx.fillStyle = (Math.floor((py - top) / 3) % 2 === 0) ? accent : "#F0F0F0";
    ctx.fillRect(pX, py, 3, 3);
  }
  castShadow(ctx, chX, floorY, 10);
}

function drawPhone(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, top: number, accent: string, seed: number): void {
  // A glass counter of glowing devices, and a wall of parts bins.
  const cTop = counter(ctx, x, floorY, w, "#3A4048");
  for (let dx = x + 6, i = 0; dx + 3 < x + w - 4; dx += 6, i++) {
    ctx.fillStyle = "#14181E"; // device body
    ctx.fillRect(dx, cTop - 4, 3, 4);
    ctx.fillStyle = (i % 2 === 0) ? accent : shade(accent, 30); // lit screen
    ctx.fillRect(dx, cTop - 4, 3, 2);
  }
  // Parts bins on the back wall.
  for (let by = top + 3, r = 0; by + 3 < cTop - 6; by += 5, r++) {
    for (let bx = x + 4; bx + 3 < x + w - 3; bx += 6) {
      ctx.fillStyle = shade("#8A929A", (hash(bx * 7 + by + seed) > 0.5 ? 12 : -12));
      ctx.fillRect(bx, by, 4, 3);
    }
  }
}

function drawVintage(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, top: number, seed: number): void {
  // Racks of hanging garments and a mannequin.
  const railY = top + 4;
  for (let rx = x + 4, i = 0; rx + 4 < x + w - 8; rx += 5, i++) {
    ctx.fillStyle = "#7A6A58"; // hanger
    ctx.fillRect(rx, railY, 1, 2);
    ctx.fillStyle = GARMENT_HUES[(i + seed) % GARMENT_HUES.length]; // garment
    ctx.fillRect(rx - 1, railY + 2, 4, Math.min(floorY - railY - 4, 12));
  }
  ctx.fillStyle = "#5A4A3A"; // rail bar
  ctx.fillRect(x + 3, railY - 1, Math.round(w * 0.6), 1);
  // A mannequin on a stand near the door.
  const mX = x + w - 7;
  ctx.fillStyle = "#D8CEC0";
  ctx.fillRect(mX, floorY - 14, 4, 9); // torso
  ctx.fillRect(mX + 1, floorY - 5, 1, 5); // stand
  ctx.fillStyle = GARMENT_HUES[(seed + 3) % GARMENT_HUES.length];
  ctx.fillRect(mX, floorY - 12, 4, 4); // dressed top
}

function drawTattoo(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, top: number, accent: string, occ: number, seed: number): void {
  // A reclined bench under an articulated lamp, framed flash art on the wall.
  const bX = x + 4;
  ctx.fillStyle = "#1E1E26"; // bench
  ctx.fillRect(bX, floorY - 6, Math.round(w * 0.42), 4);
  ctx.fillStyle = shade(accent, -20);
  ctx.fillRect(bX, floorY - 6, Math.round(w * 0.42), 1);
  if (occ > 0) personSeated(ctx, bX + 4, floorY - 4, seed); // reclined client on the bench
  // Articulated lamp arm.
  ctx.fillStyle = "#6A6A72";
  ctx.fillRect(bX + 2, top + 2, 1, 6);
  ctx.fillRect(bX + 2, top + 2, 8, 1);
  ctx.fillStyle = "#F8E2A4";
  ctx.fillRect(bX + 9, top + 3, 2, 2);
  // Framed flash-art designs on the back wall.
  for (let fx = x + Math.round(w * 0.56), i = 0; fx + 5 < x + w - 2; fx += 7, i++) {
    ctx.fillStyle = "#0E0E14";
    ctx.fillRect(fx, top + 3, 5, 6);
    ctx.fillStyle = i % 2 === 0 ? accent : "#C0C0C8";
    ctx.fillRect(fx + 1, top + 4, 3, 4);
  }
}

function drawRecords(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, top: number, accent: string, seed: number): void {
  // Crates of record spines, a wall poster, a turntable station.
  for (let cx = x + 4, i = 0; cx + 10 < x + w - 2; cx += 12, i++) {
    ctx.fillStyle = "#4A3A2A"; // crate
    ctx.fillRect(cx, floorY - 9, 10, 9);
    for (let s = 0; s < 8; s++) {
      ctx.fillStyle = shade(GARMENT_HUES[(s + i + seed) % GARMENT_HUES.length], -6); // leaning spines
      ctx.fillRect(cx + 1 + s, floorY - 8, 1, 7);
    }
  }
  // A poster on the back wall.
  ctx.fillStyle = shade(accent, -10);
  ctx.fillRect(x + 4, top + 3, 8, 9);
  ctx.fillStyle = shade(accent, 40);
  ctx.fillRect(x + 5, top + 4, 6, 3);
  // Turntable disc.
  const tX = x + w - 8;
  ctx.fillStyle = "#1A1A20";
  ctx.fillRect(tX, top + 5, 6, 6);
  ctx.fillStyle = accent;
  ctx.fillRect(tX + 2, top + 7, 2, 2);
}

function drawGallery(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, top: number, accent: string, seed: number): void {
  // Framed artworks under track-lighting spots, a viewing bench.
  for (let fx = x + 4, i = 0; fx + 8 < x + w - 3; fx += 11, i++) {
    ctx.fillStyle = "#2A2A2E"; // frame
    ctx.fillRect(fx, top + 4, 8, 9);
    ctx.fillStyle = "#F4F2EC"; // mat
    ctx.fillRect(fx + 1, top + 5, 6, 7);
    ctx.fillStyle = i % 3 === 0 ? accent : GARMENT_HUES[(i + seed) % GARMENT_HUES.length]; // the art
    ctx.fillRect(fx + 2, top + 6, 4, 5);
    ctx.fillStyle = "#F8E8C0"; // spotlight dot above
    ctx.fillRect(fx + 3, top + 1, 2, 1);
  }
  // A minimal viewing bench.
  ctx.fillStyle = "#8A8A90";
  ctx.fillRect(x + Math.round(w * 0.4), floorY - 3, Math.round(w * 0.25), 2);
}

/** The Modern Boutique Bay. Reused for every trade subtype; the look's `trade`
 *  discriminant picks the shopfront so each trade renders as its own room. */
export function boutiqueBay(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  const look = (u.subtype !== undefined && BOUTIQUE_LOOKS[u.subtype]) || BOUTIQUE_DEFAULT;
  const floorY = shell(ctx, x, y, w, h, look.wall, look.floor);
  const top = fascia(ctx, x, y, w, look.accent, d.lit);
  const occ = roomOccupants(u);
  const seed = figureSeed(u);
  switch (look.trade) {
    case "florist":
      drawFlorist(ctx, x, floorY, w, top, seed);
      break;
    case "barber":
      drawBarber(ctx, x, floorY, w, top, look.accent, occ, seed);
      break;
    case "phone":
      drawPhone(ctx, x, floorY, w, top, look.accent, seed);
      break;
    case "vintage":
      drawVintage(ctx, x, floorY, w, top, seed);
      break;
    case "tattoo":
      drawTattoo(ctx, x, floorY, w, top, look.accent, occ, seed);
      break;
    case "records":
      drawRecords(ctx, x, floorY, w, top, look.accent, seed);
      break;
    case "gallery":
      drawGallery(ctx, x, floorY, w, top, look.accent, seed);
      break;
  }
  // Browsing customers filling back from the door when the shop is busy,
  // bounded by width (inset like the other containers so every figure stays
  // inside the room rect). The 7px shoulder-to-shoulder pitch is authored art,
  // so the row is counted at the authored tile and stepped at the current one.
  // Counted off the pixel width, the bay lost two standing spots when the tile
  // narrowed and two customers who were in the shop went undrawn.
  // The door-side figure sits a pixel further in than the shopfront chrome does:
  // a figure is 6px of body between two 1px contact-shadow columns, so at the
  // chrome's own `w - 6` its shadow fell outside the bay, where both draw paths
  // clip it away and the figure reads a column short of the others.
  // The barber's chair and the tattoo bench each seat one of these same people,
  // so that client comes off the browsing row. Counting them separately drew a
  // one-customer bay as two figures, a ghost, which is the failure the honest
  // occupancy rule forbids in the other direction.
  const seatedClient = occ > 0 && (look.trade === "barber" || look.trade === "tattoo") ? 1 : 0;
  const spots = artRow(authoredWidth(u.width) - 7 - 3, x + w - 7, x + 3, 7, -1, 6);
  // Floored to match every other row: a forged fractional count must not round
  // a customer into existence.
  const browsing = Math.min(Math.max(0, Math.floor(occ) - seatedClient), spots.length);
  for (let i = 0; i < browsing; i++) {
    personStanding(ctx, spots[i], floorY, seed + i * 11);
  }
}
