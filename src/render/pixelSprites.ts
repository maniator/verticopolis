import type { FacilityKind, Unit, UnitState } from "../engine/types";
import { FACILITIES, hasBusinessHours, isOpenAt } from "../engine/facilities";
import { visibleOccupants } from "../engine/Crowd";

/**
 * Faithful "dollhouse cross-section" room art, following the SimTower design
 * spec: a flat pale back wall, a hard floor line, 2–4 big furniture pieces on
 * that line, the upper wall mostly empty, and tiny silhouette people. No
 * flickering window grid, no corner badges — those read as a modern facade and
 * clutter, which is exactly what the original avoids.
 *
 * Drawing is resolution-independent: each routine fills the screen rect it's
 * given. Baking these into fixed-size canvases (for Excalibur sprites) just
 * means calling them once into an offscreen context.
 */

// ---- Signature palette --------------------------------------------------

export const PAL = {
  wall: "#E8E4D0",
  floor: "#C8C0A8",
  slate: "#5A6E8C",
  brass: "#D8B05A",
  red: "#C24A3A",
  blue: "#4FA0C8",
  green: "#5AA85A",
  ink: "#2A2E38",
  white: "#F4F0E4",
  wood: "#8C6E50",
};

// No shirt may reuse the stress red (#C24A3A) — otherwise ~1-in-8 content
// commuters look pixel-identical to a "fed up" one (F10). The former red shirt
// is replaced with a muted teal so the stress tint reads unambiguously.
const SHIRTS = ["#5A6E8C", "#3E4654", "#6E5A4A", "#3F8C84", "#4FA0C8", "#5AA85A", "#D8B05A", "#9A5FB0"];
const SKIN = ["#E8C9A0", "#C99A6E", "#A9774E"];

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
function hash(seed: number): number {
  let x = (seed * 2654435761) | 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 13), 0x297a2d39);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export interface RoomCtx {
  ctx: CanvasRenderingContext2D;
  lit: boolean;
  anim: number;
  hour: number;
}

export { SHIRTS, SKIN };

/**
 * The iconic SimTower sim: a solid silhouette. `s` is the unit pixel size
 * (figure is ~3*s wide head, ~6*s tall). Seated drops the legs.
 */
export function person(ctx: CanvasRenderingContext2D, x: number, footY: number, s: number, seed: number, seated = false, tint?: string): void {
  const head = Math.max(2, Math.round(2 * s));
  const bodyW = Math.max(2, Math.round(2.4 * s));
  const bodyH = Math.max(2, Math.round((seated ? 3 : 4) * s));
  const top = footY - bodyH - head;
  // A `tint` (e.g. a stress color) overrides the usual shirt color so crowds
  // can visibly turn "angry" when the tower's transport is overwhelmed.
  ctx.fillStyle = tint ?? SHIRTS[Math.abs(seed) % SHIRTS.length];
  ctx.fillRect(x, top + head, bodyW, bodyH);
  ctx.fillStyle = SKIN[Math.abs(seed >> 4) % SKIN.length];
  ctx.fillRect(x, top, head, head);
  ctx.fillStyle = "rgba(30,24,20,0.65)"; // hair
  ctx.fillRect(x, top, head, Math.max(1, Math.round(head * 0.4)));
  if (!seated) {
    ctx.fillStyle = PAL.ink; // little legs
    ctx.fillRect(x, footY - Math.max(1, s), Math.max(1, Math.round(s)), Math.max(1, s));
    ctx.fillRect(x + bodyW - Math.max(1, Math.round(s)), footY - Math.max(1, s), Math.max(1, Math.round(s)), Math.max(1, s));
  }
}

/** Flat back wall + ceiling seam + hard floor line. Returns the floor-line Y. */
function shell(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: string, floor: string): number {
  ctx.fillStyle = wall;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(42,46,56,0.22)"; // ceiling seam
  ctx.fillRect(x, y, w, 1);
  const fh = Math.max(3, Math.round(h * 0.12));
  const floorY = y + h - fh;
  ctx.fillStyle = shade(floor, -22);
  ctx.fillRect(x, floorY, w, fh);
  ctx.fillStyle = shade(floor, 18); // polished top edge
  ctx.fillRect(x, floorY, w, 1);
  return floorY;
}

/** Optional single small wall item, high on the wall (never repeating). */
function wallItem(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, color: string): void {
  const iw = Math.min(w * 0.34, 22);
  ctx.fillStyle = color;
  ctx.fillRect(x + 4, y + 4, iw, 3);
}

// ---- Public entry -------------------------------------------------------

/** Rooms whose lights track whether anyone is actually inside. */
const POPULATED = new Set<FacilityKind>(["office", "condo", "hotelSingle", "hotelDouble", "hotelSuite"]);

export function drawRoom(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  // Commercial shows its shutter whenever it's outside business hours.
  if (
    hasBusinessHours(u.kind) &&
    u.state !== "empty" &&
    u.state !== "construction" &&
    !isOpenAt(u.kind, d.hour)
  ) {
    closedShutter(d, x, y, w, h, FACILITIES[u.kind].color);
    return;
  }
  switch (u.kind) {
    case "office":
      office(d, u, x, y, w, h);
      break;
    case "condo":
      condo(d, u, x, y, w, h);
      break;
    case "hotelSingle":
      hotel(d, u, x, y, w, h, 1);
      break;
    case "hotelDouble":
      hotel(d, u, x, y, w, h, 2);
      break;
    case "hotelSuite":
      hotel(d, u, x, y, w, h, 3);
      break;
    case "fastFood":
      fastFood(d, u, x, y, w, h);
      break;
    case "restaurant":
      restaurant(d, u, x, y, w, h);
      break;
    case "shop":
      shop(d, u, x, y, w, h);
      break;
    case "cinema":
      cinema(d, x, y, w, h);
      break;
    default:
      // Service / special facilities keep their existing iconographic look.
      ctx.fillStyle = "#3a3f4a";
      ctx.fillRect(x, y, w, h);
  }
  // Lights out at night: an empty home/workplace, or a condo whose residents
  // are asleep in the small hours.
  const lateNight = d.hour >= 23 || d.hour < 6;
  const emptyAtNight = d.lit && u.occupants <= 0 && POPULATED.has(u.kind);
  const asleepHome = u.kind === "condo" && u.occupants > 0 && lateNight;
  if ((emptyAtNight || asleepHome) && u.state !== "empty" && u.state !== "construction") {
    ctx.fillStyle = "rgba(8,10,22,0.5)";
    ctx.fillRect(x, y, w, h);
  }
  // A tenant on notice (satisfaction bottomed out) — flag it so the player can
  // spot the at-risk lease at a glance and fix the cause before they leave.
  if (u.state === "vacating") noticeBadge(ctx, x, y, w, h);
}

/** Amber corner ribbon marking a `vacating` (on-notice) lease. */
function noticeBadge(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const s = Math.min(12, w - 2, h - 2);
  if (s <= 0) return;
  ctx.fillStyle = "#E8A030";
  ctx.beginPath();
  ctx.moveTo(x + w - s, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + s);
  ctx.closePath();
  ctx.fill();
  // A small exclamation dash inside the ribbon.
  ctx.fillStyle = "#2A1E06";
  ctx.fillRect(x + w - 3, y + 2, 1, Math.max(2, s - 6));
  ctx.fillRect(x + w - 3, y + s - 3, 1, 1);
}

function vacancy(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label = "LEASE"): void {
  shell(ctx, x, y, w, h, "#C9CCC4", "#B2B0A4");
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  for (let i = -h; i < w; i += 9) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  if (w > 26) {
    ctx.fillStyle = "#D9D2B0";
    ctx.fillRect(x + w / 2 - 12, y + h / 2 - 5, 24, 10);
    ctx.fillStyle = "#7a6b3a";
    ctx.font = "7px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, x + w / 2, y + h / 2 + 2);
    ctx.textAlign = "left";
  }
}

function closedShutter(d: RoomCtx, x: number, y: number, w: number, h: number, accent: string): void {
  const { ctx } = d;
  ctx.fillStyle = shade(accent, -60);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#3A3F48";
  ctx.fillRect(x + 2, y + 4, w - 4, h - 7);
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1;
  for (let ly = y + 6; ly < y + h - 4; ly += 3) {
    ctx.beginPath();
    ctx.moveTo(x + 2, ly);
    ctx.lineTo(x + w - 2, ly);
    ctx.stroke();
  }
  if (w > 28) {
    ctx.fillStyle = "#1b1f2a";
    ctx.fillRect(x + w / 2 - 16, y + h / 2 - 5, 32, 10);
    ctx.fillStyle = "#E0556B";
    ctx.font = "bold 7px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("CLOSED", x + w / 2, y + h / 2 + 2);
    ctx.textAlign = "left";
  }
}

// ---- Office -------------------------------------------------------------

function office(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  if (u.state === "empty") return vacancy(ctx, x, y, w, h, "LEASE");
  const floorY = shell(ctx, x, y, w, h, d.lit || u.occupants > 0 ? "#DEE4EC" : "#D8DEE6", "#B8B2A0");
  wallItem(ctx, x, y, w, "#9FB8CC"); // whiteboard
  const slot = 22;
  const start = x + 6;
  const count = Math.max(1, Math.floor((w - 10) / slot));
  // Show exactly as many workers as are actually present (none on a weekend).
  // `visibleOccupants` subtracts the transient `outForMeal` overlay, so a
  // worker out on a lunch round-trip empties her desk until she walks back.
  const filled = Math.max(0, Math.min(count, visibleOccupants(u)));
  for (let i = 0; i < count; i++) {
    const dx = start + i * slot;
    // Desk.
    ctx.fillStyle = PAL.wood;
    ctx.fillRect(dx, floorY - 5, 15, 3);
    ctx.fillStyle = shade(PAL.wood, -22);
    ctx.fillRect(dx, floorY - 2, 15, 2);
    // Monitor.
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(dx + 1, floorY - 11, 6, 6);
    ctx.fillStyle = i < filled ? PAL.blue : "#3A4250";
    ctx.fillRect(dx + 2, floorY - 10, 4, 4);
    // Seated worker.
    if (i < filled) person(ctx, dx + 9, floorY, 1.4, (u.id * 7 + i * 31) | 0, true);
  }
}

// ---- Condo --------------------------------------------------------------

function condo(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  if (u.state === "empty") return vacancy(ctx, x, y, w, h, "SALE");
  // Residents are "up" only when home and not asleep in the small hours.
  // Read the meal-adjusted count so a household out to breakfast/dinner/
  // late-night visibly leaves the sofa empty for the round-trip's duration.
  const home = visibleOccupants(u) > 0 && !(d.hour >= 23 || d.hour < 6);
  const wall = hash(u.id) > 0.5 ? "#C8A88C" : "#B89CAE";
  const floorY = shell(ctx, x, y, w, h, wall, "#9A7A54");
  wallItem(ctx, x, y, w, "#7a5a44"); // framed picture
  const accent = SHIRTS[(u.id + 3) % SHIRTS.length];
  const base = x + 7;
  const sofaW = Math.min(w * 0.36, 30);
  // Sofa.
  ctx.fillStyle = shade(accent, -20);
  ctx.fillRect(base, floorY - 7, sofaW, 7);
  ctx.fillStyle = shade(accent, 22);
  ctx.fillRect(base, floorY - 10, sofaW, 3);
  ctx.fillStyle = shade(accent, -4);
  ctx.fillRect(base, floorY - 9, 3, 9);
  ctx.fillRect(base + sofaW - 3, floorY - 9, 3, 9);
  if (home) person(ctx, base + sofaW * 0.45, floorY, 1.4, (u.id * 5) | 0, true);
  // Standing lamp.
  ctx.fillStyle = "#7A6A50";
  ctx.fillRect(base + sofaW + 6, floorY - 12, 2, 12);
  ctx.fillStyle = home ? "#F0D890" : "#9a8f70";
  ctx.beginPath();
  ctx.moveTo(base + sofaW + 7, floorY - 16);
  ctx.lineTo(base + sofaW + 3, floorY - 11);
  ctx.lineTo(base + sofaW + 11, floorY - 11);
  ctx.closePath();
  ctx.fill();
  // TV.
  const tvW = Math.min(w * 0.18, 13);
  ctx.fillStyle = "#15151C";
  ctx.fillRect(x + w - tvW - 4, floorY - 11, tvW, 8);
  ctx.fillStyle = home ? "#8FB6FF" : "#2A2F3A";
  ctx.fillRect(x + w - tvW - 3, floorY - 10, tvW - 2, 6);
}

// ---- Hotel --------------------------------------------------------------

function hotel(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number, grade: number): void {
  const { ctx } = d;
  const asleep = u.state === "asleep";
  const dirty = u.state === "dirty";
  const wall = grade === 3 ? "#C8A86A" : "#D8C49A";
  const lit = !asleep && (u.occupants > 0 || d.lit);
  const floorY = shell(ctx, x, y, w, h, asleep ? "#3A3550" : wall, "#A88A5E");
  if (grade === 3) {
    // Suite sitting area on the left third.
    const sofaW = Math.min(w * 0.2, 18);
    ctx.fillStyle = "#7C5A6A";
    ctx.fillRect(x + 5, floorY - 6, sofaW, 6);
    ctx.fillStyle = "#8C6A7A";
    ctx.fillRect(x + 5, floorY - 9, sofaW, 3);
  }
  const base = x + (grade === 3 ? Math.min(w * 0.2, 18) + 10 : 6);
  const bedW = x + w - 5 - base;
  const bedTop = floorY - 9;
  ctx.fillStyle = "#5A3F2C"; // headboard
  ctx.fillRect(base, bedTop - 2, 4, 11);
  ctx.fillStyle = "#E8E2D2"; // mattress
  ctx.fillRect(base + 4, bedTop, bedW - 4, 9);
  ctx.fillStyle = shade(PAL.brass, 10); // foot band
  ctx.fillRect(base + 4, bedTop + 6, bedW - 4, 1);
  ctx.fillStyle = "#FBF7EC"; // pillow(s)
  ctx.fillRect(base + 5, bedTop + 1, Math.max(5, bedW * 0.2), 3);
  if (grade >= 2) ctx.fillRect(base + 5, bedTop + 5, Math.max(4, bedW * 0.16), 2);
  ctx.fillStyle = "#6A4A30"; // nightstand
  ctx.fillRect(x + w - 6, floorY - 6, 4, 6);

  if (asleep) {
    ctx.fillStyle = "#6677BB";
    ctx.fillRect(base + 6 + bedW * 0.2, bedTop + 2, bedW * 0.6, 5);
    ctx.fillStyle = SKIN[u.id % SKIN.length];
    ctx.fillRect(base + 6, bedTop + 1, 3, 3);
    ctx.fillStyle = "rgba(210,220,255,0.9)";
    ctx.font = "8px system-ui, sans-serif";
    ctx.fillText("z", base + 12, bedTop - 1);
  } else if (dirty) {
    ctx.fillStyle = "#B8A98A";
    ctx.fillRect(base + 5, bedTop + 1, bedW * 0.8, 6);
    ctx.fillStyle = "#D4623A";
    ctx.fillRect(x + w - 6, floorY - 9, 4, 3);
  } else if (lit) {
    ctx.fillStyle = "#FFD86A"; // ready: lamp on
    ctx.fillRect(x + w - 5, floorY - 11, 2, 5);
  }
}

// ---- Food ---------------------------------------------------------------

function fastFood(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  const floorY = shell(ctx, x, y, w, h, "#F0D8B0", "#B5742E");
  // Bold sign band — the fast-food signature.
  const band = Math.max(4, h * 0.16);
  ctx.fillStyle = "#E0452C";
  ctx.fillRect(x, y, w, band);
  ctx.fillStyle = "#FFD24A";
  for (let sx = x + 3; sx < x + w - 3; sx += 8) ctx.fillRect(sx, y + 2, 4, band - 3);
  // Counter.
  ctx.fillStyle = "#B5742E";
  ctx.fillRect(x + 4, floorY - 6, Math.min(w * 0.18, 20), 6);
  // 2-top tables with diners.
  let i = 0;
  for (let tx = x + Math.min(w * 0.18, 20) + 12; tx + 8 < x + w; tx += 16, i++) {
    ctx.fillStyle = "#F4F0E4";
    ctx.beginPath();
    ctx.arc(tx, floorY - 4, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#9a7748";
    ctx.fillRect(tx - 0.5, floorY - 3, 1, 3);
    if (i < Math.max(2, u.occupants) || hash((u.id + tx) | 0) > 0.45) {
      person(ctx, tx - 4, floorY, 1.2, (u.id + tx) | 0, true);
      person(ctx, tx + 3, floorY, 1.2, (u.id + tx + 5) | 0, true);
    }
  }
}

function restaurant(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  const floorY = shell(ctx, x, y, w, h, "#3A2230", "#2B2238");
  // Chandelier.
  ctx.fillStyle = "#6a5040";
  ctx.fillRect(x + w / 2 - 1, y + 2, 2, 4);
  ctx.fillStyle = d.lit ? "#FFE69A" : "#9a8a60";
  ctx.beginPath();
  ctx.arc(x + w / 2, y + 7, 3.5, 0, Math.PI * 2);
  ctx.fill();
  // White-clothed tables — the restaurant signature against the dark wall.
  let i = 0;
  for (let tx = x + 10; tx + 11 < x + w; tx += 20, i++) {
    ctx.fillStyle = "#F4F0E8";
    ctx.fillRect(tx, floorY - 6, 11, 6);
    ctx.fillStyle = "#E8A030"; // candle
    ctx.fillRect(tx + 5, floorY - 9, 1, 3);
    if (i < Math.max(2, u.occupants) || hash((u.id + tx) | 0) > 0.5) {
      person(ctx, tx - 3, floorY, 1.4, (u.id + tx) | 0, true);
      person(ctx, tx + 11, floorY, 1.4, (u.id + tx + 7) | 0, true);
    }
  }
}

// ---- Shop ---------------------------------------------------------------

function shop(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  if (u.state === "occupied" && !(d.hour >= 10 && d.hour < 21)) return closedShutter(d, x, y, w, h, "#b58ad6");
  const floorY = shell(ctx, x, y, w, h, "#EFE9F5", "#C8BCD2");
  // Striped awning — the retail signature.
  const accent = SHIRTS[(u.id + 2) % SHIRTS.length];
  const band = Math.max(3, h * 0.14);
  for (let sx = x; sx < x + w; sx += 10) {
    ctx.fillStyle = Math.floor((sx - x) / 10) % 2 === 0 ? "#FFFFFF" : accent;
    ctx.fillRect(sx, y, 5, band);
  }
  // Two shelves of colorful goods.
  const goods = ["#e85d5d", "#5db4e8", "#6bd47a", "#e8c14a", "#b07fe0", "#e88f4a"];
  for (let row = 0; row < 2; row++) {
    const ry = y + h * 0.34 + row * (h * 0.22);
    ctx.fillStyle = "#A98A6A";
    ctx.fillRect(x + 4, ry + 4, w - 8, 1);
    for (let gx = x + 6, k = 0; gx + 3 < x + w - 5; gx += 6, k++) {
      ctx.fillStyle = goods[(k + row) % goods.length];
      ctx.fillRect(gx, ry, 4, 4);
    }
  }
  if (u.occupants > 0 || hash(u.id) > 0.4) person(ctx, x + w - 9, floorY, 1.5, (u.id * 11) | 0);
}

// ---- Cinema -------------------------------------------------------------

function cinema(d: RoomCtx, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  shell(ctx, x, y, w, h, "#140D28", "#0A0716");
  // Marquee bulbs (slow chase).
  const chase = Math.floor(d.anim * 4);
  for (let i = 0, bx = x + 3; bx < x + w - 2; bx += 6, i++) {
    ctx.fillStyle = (i + chase) % 2 === 0 ? "#FFD24A" : "#FF6B6B";
    ctx.fillRect(bx, y + 2, 2, 2);
  }
  // Glowing screen cycling pastel frames.
  const frames = ["#9FC0FF", "#FFD9A0", "#C0FFD0", "#FFB0C0", "#D0C0FF"];
  const fr = Math.floor(d.anim * 2.5) % frames.length;
  const sw = Math.min(w * 0.5, 90);
  ctx.fillStyle = frames[fr];
  ctx.fillRect(x + w / 2 - sw / 2, y + 8, sw, h - 18);
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillRect(x + w / 2 - sw / 2, y + 8 + ((fr * 4) % Math.max(1, h - 22)), sw, 1);
  // Raked seats with audience heads.
  for (let i = 0, sx = x + 4; sx < x + w - 3; sx += 6, i++) {
    ctx.fillStyle = "#0A0716";
    ctx.fillRect(sx, y + h - 7, 4, 5);
    if (hash(i * 7 + 3) > 0.45) {
      ctx.fillStyle = "#2A2438";
      ctx.fillRect(sx + 1, y + h - 9, 2, 2);
    }
  }
}

/** Convenience used by the preview/gallery: pick a representative state. */
export function sampleState(kind: FacilityKind): UnitState {
  if (kind === "hotelSingle" || kind === "hotelDouble" || kind === "hotelSuite") return "occupied";
  return "occupied";
}
