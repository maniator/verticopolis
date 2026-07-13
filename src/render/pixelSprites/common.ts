import type { FacilityKind, Unit } from "../../engine/types";
import { GRID } from "../../engine/facilities";

/**
 * Shared primitives for the dollhouse room art: the signature palette, the
 * seeded-variety helpers, the room shell/floor, and the silhouette person.
 * Extracted verbatim from `pixelSprites.ts`; imported by every per-kind draw
 * module and by the `pixelSprites.ts` barrel.
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
export const SHIRTS = ["#5A6E8C", "#3E4654", "#6E5A4A", "#3F8C84", "#4FA0C8", "#5AA85A", "#D8B05A", "#9A5FB0"];
export const SKIN = ["#E8C9A0", "#C99A6E", "#A9774E"];

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
export function hash(seed: number): number {
  let x = (seed * 2654435761) | 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 13), 0x297a2d39);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// ---- Per-unit variety (geo-seeded) ----------------------------------------
//
// Same-kind rooms vary like the 1994 original. The law (party-ratified after
// the owner's call): a variant must differ in GEOMETRY first (layout,
// furniture, or mirroring); color is support, and a palette-only variant is
// not a variant. State cues never vary. Hotels are the deliberate exception:
// real hotel rooms are uniform, so they take linen wall tints and a bed
// mirror only, and their whole job stays broadcasting ready/asleep/dirty. The
// seed is GEOGRAPHY rather than unit id: TDT import renumbers every id, but a room's
// (floor, x) footprint survives save, load, export, and import, so the same
// spot always wears the same look ("your mauve corner office on 40 stays
// mauve"). Matches the lobbyVariant(x) precedent. Anchors are listed twice in
// each table so the classic look stays the most common (seasoning rather
// than patchwork). Hue varies, luminance holds (roughly +/-10 per channel around
// each anchor) so the night scrim, heatmap tints, and lit/dark reads never
// grow ambiguous, and no variety color enters the reserved state palette
// (vacancy grays, notice amber, dirty tray, ready lamp, stress red).

/** Deterministic per-room pick: kind + geography + axis -> [0, n). Pure
 *  function of immutable unit fields, so it needs no bake-signature bit and
 *  never touches the sim RNG stream. The kind salt (ratified formula) keeps a
 *  bulldoze-and-rebuild of a different kind at the same footprint from
 *  inheriting correlated picks. */
export function geoVariant(u: Pick<Unit, "kind" | "floor" | "x">, axis: number, n: number): number {
  const kindSalt = (u.kind.length * 7919 + u.kind.charCodeAt(0) * 31) | 0;
  return Math.floor(hash(kindSalt + (u.floor - GRID.minFloor) * GRID.width + u.x + axis * 104729) * n);
}

/** Run `draw` mirrored horizontally inside the room rect when `flip` is set:
 *  the cheapest true-geometry variant. Callers must not draw TEXT inside
 *  `draw` (it would mirror); the hotel draws its "z" outside the wrapper. */
export function maybeMirrored(ctx: CanvasRenderingContext2D, flip: boolean, x: number, w: number, draw: () => void): void {
  if (!flip) return draw();
  ctx.save();
  ctx.translate(2 * x + w, 0);
  ctx.scale(-1, 1);
  draw();
  ctx.restore();
}

export interface RoomCtx {
  ctx: CanvasRenderingContext2D;
  lit: boolean;
  anim: number;
  hour: number;
}

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
export function shell(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, wall: string, floor: string): number {
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
export function wallItem(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, color: string): void {
  const iw = Math.min(w * 0.34, 22);
  ctx.fillStyle = color;
  ctx.fillRect(x + 4, y + 4, iw, 3);
}

/** Rooms whose lights track whether anyone is actually inside. */
export const POPULATED = new Set<FacilityKind>(["office", "condo", "hotelSingle", "hotelDouble", "hotelSuite"]);

/** Amber corner ribbon marking a `vacating` (on-notice) lease. */
export function noticeBadge(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
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

export function vacancy(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label = "LEASE"): void {
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

export function closedShutter(d: RoomCtx, x: number, y: number, w: number, h: number, accent: string): void {
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
