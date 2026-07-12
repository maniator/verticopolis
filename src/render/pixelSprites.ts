import type { FacilityKind, Unit, UnitState } from "../engine/types";
import { FACILITIES, GRID, hasBusinessHours, isOpenAt } from "../engine/facilities";
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

// ---- Per-unit variety (geo-seeded) ----------------------------------------
//
// Same-kind rooms vary like the 1994 original. The law (party-ratified after
// the owner's call): a variant must differ in GEOMETRY first (layout,
// furniture, or mirroring); color is support, and a palette-only variant is
// not a variant. State cues never vary. Hotels are the deliberate exception:
// real hotel rooms are uniform, so they take linen wall tints and a bed
// mirror only, and their whole job stays broadcasting ready/asleep/dirty. The
// seed is GEOGRAPHY, not unit id: TDT import renumbers every id, but a room's
// (floor, x) footprint survives save, load, export, and import, so the same
// spot always wears the same look ("your mauve corner office on 40 stays
// mauve"). Matches the lobbyVariant(x) precedent. Anchors are listed twice in
// each table so the classic look stays the most common: seasoning, not
// patchwork. Hue varies, luminance holds (roughly +/-10 per channel around
// each anchor) so the night scrim, heatmap tints, and lit/dark reads never
// grow ambiguous, and no variety color enters the reserved state palette
// (vacancy grays, notice amber, dirty tray, ready lamp, stress red).

/** Deterministic per-room pick: geography + axis -> [0, n). Pure function of
 *  immutable unit fields, so it needs no bake-signature bit and never touches
 *  the sim RNG stream. */
function geoVariant(u: Pick<Unit, "floor" | "x">, axis: number, n: number): number {
  return Math.floor(hash((u.floor - GRID.minFloor) * GRID.width + u.x + axis * 104729) * n);
}

/** Run `draw` mirrored horizontally inside the room rect when `flip` is set:
 *  the cheapest true-geometry variant. Callers must not draw TEXT inside
 *  `draw` (it would mirror); the hotel draws its "z" outside the wrapper. */
function maybeMirrored(ctx: CanvasRenderingContext2D, flip: boolean, x: number, w: number, draw: () => void): void {
  if (!flip) return draw();
  ctx.save();
  ctx.translate(2 * x + w, 0);
  ctx.scale(-1, 1);
  draw();
  ctx.restore();
}

/** Office "Daylight Grays" (Sally's band): anchor double-weighted, lit wall
 *  paired with its matching unlit tone (each channel -6, mirroring the shipped
 *  #DEE4EC / #D8DEE6 anchor pair). */
const OFFICE_WALLS: { lit: string; unlit: string }[] = [
  { lit: "#DEE4EC", unlit: "#D8DEE6" },
  { lit: "#DEE4EC", unlit: "#D8DEE6" },
  { lit: "#E4E2DA", unlit: "#DEDCD4" },
  { lit: "#DCE6E0", unlit: "#D6E0DA" },
  { lit: "#E2DEE8", unlit: "#DCD8E2" },
];

/** Condo "Home Plasters": the two shipped hues (tan anchor double-weighted,
 *  mauve) plus sage and dusty violet, luminance-matched. */
const CONDO_WALLS = ["#C8A88C", "#C8A88C", "#B89CAE", "#A8B49C", "#B4A8BE"];

/** Condo framed-picture contents: same frame slot, three muted subjects. */
const CONDO_PICTURES = ["#7a5a44", "#7a5a44", "#5a6e7a", "#6e7a5a"];

/** Hotel "Linen Sands" (standard/double) and "Suite Gold" (hue drift only, so
 *  the grade tell survives). Anchors double-weighted. */
const HOTEL_WALLS = ["#D8C49A", "#D8C49A", "#D8CCA8", "#DCC0A0"];
const SUITE_WALLS = ["#C8A86A", "#C8A86A", "#C4AC74", "#CCA460"];


export interface RoomCtx {
  ctx: CanvasRenderingContext2D;
  lit: boolean;
  anim: number;
  hour: number;
}

// ---- Retail subtype looks ------------------------------------------------
//
// Each canon retail variant (docs/canon/tdt-format.md §7, names pinned in
// src/engine/retailSubtypes.ts) gets its own look, keyed by the canonical
// name. Design rules (party-ratified, revised by owner call: color is paint,
// composition is identity): each KIND keeps exactly ONE anchor shape (fast
// food its bold sign band, shops their striped awning, restaurants their
// dark dining light), and everything below that line is the variety's own
// furniture: a sushi bar has a bar, a pub has taps, a bookstore has
// bookcases. Every composition leads with one shape readable at 26px tall.
// No RNG anywhere: an undefined or unknown subtype falls back to the
// pre-variant look, byte-identical, so legacy saves and generic units render
// exactly as before. `src/tests/subtypeVisuals.test.ts` pins these tables
// against the canon name lists.

export interface FastFoodLook {
  band: string;
  stripe: string;
  wall: string;
  /** Interior composition: each variety furnishes the room differently; the
   *  sign band above is the one shape every fast food keeps. */
  interior: "classic" | "counterBar" | "teahouse" | "parlor" | "cafe";
}
const FASTFOOD_DEFAULT: FastFoodLook = { band: "#E0452C", stripe: "#FFD24A", wall: "#F0D8B0", interior: "classic" };
export const FASTFOOD_LOOKS: Record<string, FastFoodLook> = {
  "Japanese Soba": { band: "#3A4E8C", stripe: "#F4F0E4", wall: "#EAE2CC", interior: "counterBar" },
  "Chinese Cafe": { band: "#8E2424", stripe: "#E8C14A", wall: "#F0DCB8", interior: "teahouse" },
  "Hamburger Stand": FASTFOOD_DEFAULT,
  "Ice Cream": { band: "#E88AB0", stripe: "#FFFFFF", wall: "#F6ECF0", interior: "parlor" },
  "Coffee Shop": { band: "#6E4A32", stripe: "#E8DCC8", wall: "#EFE4D2", interior: "cafe" },
};

export interface RestaurantLook {
  wall: string;
  floor: string;
  fixture: "chandelier" | "lamps" | "lanterns" | "none" | "ember";
  /** Dining-floor composition: cloth tables, a pub bar, banquet rounds, a
   *  sushi bar, or steak-house booths. */
  interior: "cloth" | "pub" | "banquet" | "sushi" | "booths";
}
const RESTAURANT_DEFAULT: RestaurantLook = { wall: "#3A2230", floor: "#2B2238", fixture: "chandelier", interior: "cloth" };
export const RESTAURANT_LOOKS: Record<string, RestaurantLook> = {
  "English Pub": { wall: "#4A3626", floor: "#33251A", fixture: "lamps", interior: "pub" },
  "French": RESTAURANT_DEFAULT,
  "Chinese": { wall: "#5A2020", floor: "#3A1818", fixture: "lanterns", interior: "banquet" },
  "Sushi Bar": { wall: "#C8AA78", floor: "#8A6E48", fixture: "none", interior: "sushi" },
  "Steak House": { wall: "#4A2A22", floor: "#33201A", fixture: "ember", interior: "booths" },
};

export interface ShopLook {
  awning: string;
  wall: string;
  goods: string[];
  /** Full interior composition per trade: racks, cages, bookcases, a teller
   *  counter... The striped awning above is the one shape every shop keeps. */
  interior:
    | "racks"
    | "pets"
    | "florist"
    | "books"
    | "pharmacy"
    | "boutique"
    | "screens"
    | "bank"
    | "salon"
    | "post"
    | "sports";
}
export const SHOP_LOOKS: Record<string, ShopLook> = {
  "Men's Clothing": { awning: "#5A6E8C", wall: "#ECEEF2", goods: ["#3E4654", "#5A6E8C", "#6E5A4A", "#F4F0E4"], interior: "racks" },
  "Pet Store": { awning: "#8C6E50", wall: "#F0EEE2", goods: ["#C99A6E", "#E8C14A", "#5AA85A", "#F4F0E4"], interior: "pets" },
  "Flower Shop": { awning: "#E88AB0", wall: "#F2F5EC", goods: ["#e85d5d", "#E88AB0", "#e8c14a", "#F4F0E4"], interior: "florist" },
  "Book Store": { awning: "#3E4654", wall: "#F0EAD8", goods: ["#8C3A32", "#3E5A8C", "#4A7A4A", "#B08A3E", "#5A4A6E"], interior: "books" },
  "Drug Store": { awning: "#3A8A4A", wall: "#F4F7F2", goods: ["#FFFFFF", "#9FD0C8", "#5db4e8", "#E8E4D0"], interior: "pharmacy" },
  "Boutique": { awning: "#9A5FB0", wall: "#F5EFF7", goods: ["#E8B8CC", "#C8A8E0", "#F0E0B8", "#F4F0E4"], interior: "boutique" },
  "Electronics": { awning: "#2A2E38", wall: "#3E4654", goods: ["#4FA0C8", "#8FB6FF", "#5db4e8", "#2A2E38"], interior: "screens" },
  "Bank": { awning: "#D8B05A", wall: "#EDE9E2", goods: ["#D8B05A", "#B89040", "#EDE9E2"], interior: "bank" },
  "Hair Salon": { awning: "#B84848", wall: "#F2ECF0", goods: ["#8FB6D8", "#C8DCE8", "#F4F0E4"], interior: "salon" },
  "Post Office": { awning: "#4F6EC8", wall: "#EFEDE4", goods: ["#F4F0E4", "#E0CFA8", "#FFFFFF", "#C8B890"], interior: "post" },
  "Sports Gear": { awning: "#E88F4A", wall: "#EEF2F0", goods: ["#e85d5d", "#5db4e8", "#6bd47a", "#e8c14a"], interior: "sports" },
};

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
      cinema(d, u, x, y, w, h);
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
  // Geo-seeded variety, geometry first (party law): three true layouts (the
  // classic desk row, a meeting room, an executive corner), any of them
  // mirrored, with the Daylight Grays wall band as garnish. Occupancy stays
  // readable in every layout: seats map to the people actually present.
  const wallPick = OFFICE_WALLS[geoVariant(u, 0, OFFICE_WALLS.length)];
  const floorY = shell(ctx, x, y, w, h, d.lit || u.occupants > 0 ? wallPick.lit : wallPick.unlit, "#B8B2A0");
  const filled = Math.max(0, visibleOccupants(u));
  const layout = geoVariant(u, 3, 5); // 0-2 desk row (anchor weight), 3 meeting, 4 executive
  const flip = geoVariant(u, 4, 2) === 1;
  maybeMirrored(ctx, flip, x, w, () => {
    // One wall item per office, same slot: whiteboard, corkboard, or clock.
    const item = geoVariant(u, 1, 3);
    if (item === 2) {
      ctx.fillStyle = PAL.ink; // wall clock
      ctx.fillRect(x + 5, y + 3, 5, 5);
      ctx.fillStyle = "#E8E4D0";
      ctx.fillRect(x + 6, y + 4, 3, 3);
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(x + 7, y + 4, 1, 2);
    } else {
      wallItem(ctx, x, y, w, item === 0 ? "#9FB8CC" : "#C8A87A");
    }
    if (layout === 3) {
      // Meeting room: one long table, chairs both sides, workers around it.
      const tw = Math.min(Math.round(w * 0.6), 60);
      const tx = x + Math.round((w - tw) / 2);
      ctx.fillStyle = PAL.wood;
      ctx.fillRect(tx, floorY - 6, tw, 3);
      ctx.fillStyle = shade(PAL.wood, -22);
      ctx.fillRect(tx + 2, floorY - 3, 2, 3);
      ctx.fillRect(tx + tw - 4, floorY - 3, 2, 3);
      ctx.fillStyle = "#E8E4D0"; // papers on the table
      ctx.fillRect(tx + Math.round(tw / 2) - 2, floorY - 7, 4, 1);
      const seats = Math.max(2, Math.floor(tw / 12));
      for (let i = 0; i < Math.min(filled, seats); i++) {
        const sx = tx + 3 + (i % seats) * 12;
        person(ctx, sx, floorY, 1.3, (u.id * 7 + i * 31) | 0, true);
      }
    } else if (layout === 4) {
      // Executive corner: one big desk with its chair, then a side row of two
      // standard desks so a staffed office still shows its people.
      ctx.fillStyle = shade(PAL.wood, -10);
      ctx.fillRect(x + 6, floorY - 6, 20, 4);
      ctx.fillStyle = PAL.ink; // exec monitor
      ctx.fillRect(x + 8, floorY - 12, 7, 6);
      ctx.fillStyle = filled > 0 ? PAL.blue : "#3A4250";
      ctx.fillRect(x + 9, floorY - 11, 5, 4);
      if (filled > 0) person(ctx, x + 20, floorY, 1.5, (u.id * 7) | 0, true);
      ctx.fillStyle = PAL.green; // corner plant
      ctx.fillRect(x + 30, floorY - 9, 3, 4);
      ctx.fillStyle = "#8C5A3A";
      ctx.fillRect(x + 30, floorY - 5, 3, 3);
      const sideStart = x + 40;
      for (let i = 0; i < 2; i++) {
        const dx = sideStart + i * 22;
        if (dx + 15 > x + w - 4) break;
        ctx.fillStyle = PAL.wood;
        ctx.fillRect(dx, floorY - 5, 15, 3);
        ctx.fillStyle = PAL.ink;
        ctx.fillRect(dx + 1, floorY - 11, 6, 6);
        ctx.fillStyle = i + 1 < filled ? PAL.blue : "#3A4250";
        ctx.fillRect(dx + 2, floorY - 10, 4, 4);
        if (i + 1 < filled) person(ctx, dx + 9, floorY, 1.4, (u.id * 7 + (i + 1) * 31) | 0, true);
      }
    } else {
      // Classic desk row (the anchor layout), one seeded desk with a plant.
      const slot = 22;
      const start = x + 6;
      const count = Math.max(1, Math.floor((w - 10) / slot));
      const plantDesk = geoVariant(u, 2, count);
      const seated = Math.min(count, filled);
      for (let i = 0; i < count; i++) {
        const dx = start + i * slot;
        ctx.fillStyle = PAL.wood;
        ctx.fillRect(dx, floorY - 5, 15, 3);
        ctx.fillStyle = shade(PAL.wood, -22);
        ctx.fillRect(dx, floorY - 2, 15, 2);
        ctx.fillStyle = PAL.ink;
        ctx.fillRect(dx + 1, floorY - 11, 6, 6);
        ctx.fillStyle = i < seated ? PAL.blue : "#3A4250";
        ctx.fillRect(dx + 2, floorY - 10, 4, 4);
        if (i === plantDesk) {
          ctx.fillStyle = PAL.green;
          ctx.fillRect(dx + 8, floorY - 9, 3, 2);
          ctx.fillStyle = "#8C5A3A";
          ctx.fillRect(dx + 8, floorY - 7, 3, 2);
        }
        if (i < seated) person(ctx, dx + 9, floorY, 1.4, (u.id * 7 + i * 31) | 0, true);
      }
    }
  });
}

// ---- Condo --------------------------------------------------------------

function condo(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  if (u.state === "empty") return vacancy(ctx, x, y, w, h, "SALE");
  // Residents are "up" only when home and not asleep in the small hours.
  const home = visibleOccupants(u) > 0 && !(d.hour >= 23 || d.hour < 6);
  // Geo-seeded variety, geometry first (party law): three true layouts (the
  // living room anchor, a dining room with kitchenette, a study), any of them
  // mirrored, with the Home Plasters wall band as garnish. The standing lamp
  // appears in every layout so the home-glow signal survives the shuffle.
  const wall = CONDO_WALLS[geoVariant(u, 0, CONDO_WALLS.length)];
  const floorY = shell(ctx, x, y, w, h, wall, "#9A7A54");
  const accent = SHIRTS[(u.id + 3) % SHIRTS.length];
  const layout = geoVariant(u, 3, 5); // 0-2 living room (anchor weight), 3 dining, 4 study
  const flip = geoVariant(u, 4, 2) === 1;
  const lamp = (lx: number) => {
    ctx.fillStyle = "#7A6A50";
    ctx.fillRect(lx, floorY - 12, 2, 12);
    ctx.fillStyle = home ? "#F0D890" : "#9a8f70";
    ctx.beginPath();
    ctx.moveTo(lx + 1, floorY - 16);
    ctx.lineTo(lx - 3, floorY - 11);
    ctx.lineTo(lx + 5, floorY - 11);
    ctx.closePath();
    ctx.fill();
  };
  maybeMirrored(ctx, flip, x, w, () => {
    wallItem(ctx, x, y, w, CONDO_PICTURES[geoVariant(u, 1, CONDO_PICTURES.length)]);
    if (layout === 3) {
      // Dining room: kitchenette on the wall, a set table, chairs both sides.
      ctx.fillStyle = "#B8B4A8"; // kitchenette counter
      ctx.fillRect(x + 5, floorY - 8, 14, 8);
      ctx.fillStyle = "#2A2E38"; // stove burners
      ctx.fillRect(x + 7, floorY - 9, 2, 1);
      ctx.fillRect(x + 11, floorY - 9, 2, 1);
      ctx.fillStyle = "#9A968A"; // upper cabinet
      ctx.fillRect(x + 5, y + Math.round(h * 0.3), 14, 4);
      const tx = x + 28;
      ctx.fillStyle = PAL.wood; // dining table
      ctx.fillRect(tx, floorY - 6, 14, 2);
      ctx.fillStyle = shade(PAL.wood, -22);
      ctx.fillRect(tx + 1, floorY - 4, 2, 4);
      ctx.fillRect(tx + 11, floorY - 4, 2, 4);
      ctx.fillStyle = "#F4F0E4"; // place setting
      ctx.fillRect(tx + 5, floorY - 7, 4, 1);
      if (home) {
        person(ctx, tx - 4, floorY, 1.4, (u.id * 5) | 0, true);
        person(ctx, tx + 14, floorY, 1.4, (u.id * 5 + 11) | 0, true);
      }
      lamp(x + w - 10);
    } else if (layout === 4) {
      // Study: a bookshelf wall and a desk under the lamp.
      ctx.fillStyle = "#6A5240"; // bookcase
      ctx.fillRect(x + 5, y + Math.round(h * 0.3), 16, floorY - (y + Math.round(h * 0.3)));
      for (let row = 0; row < 2; row++) {
        for (let bx = x + 7, k = 0; bx + 2 < x + 19; bx += 3, k++) {
          ctx.fillStyle = ["#8C3A32", "#3E5A8C", "#B08A3E", "#4A7A4A"][k % 4];
          ctx.fillRect(bx, y + Math.round(h * 0.3) + 2 + row * 7, 2, 5);
        }
      }
      const dx = x + 30;
      ctx.fillStyle = PAL.wood; // desk
      ctx.fillRect(dx, floorY - 5, 15, 3);
      ctx.fillStyle = "#E8E4D0"; // open book
      ctx.fillRect(dx + 5, floorY - 6, 5, 1);
      if (home) person(ctx, dx + 9, floorY, 1.4, (u.id * 5) | 0, true);
      lamp(x + w - 10);
    } else {
      // Living room (the anchor layout): sofa, lamp, and the right-slot swap.
      const base = x + 7;
      const sofaW = Math.min(w * 0.36, 30);
      ctx.fillStyle = shade(accent, -20);
      ctx.fillRect(base, floorY - 7, sofaW, 7);
      ctx.fillStyle = shade(accent, 22);
      ctx.fillRect(base, floorY - 10, sofaW, 3);
      ctx.fillStyle = shade(accent, -4);
      ctx.fillRect(base, floorY - 9, 3, 9);
      ctx.fillRect(base + sofaW - 3, floorY - 9, 3, 9);
      if (home) person(ctx, base + sofaW * 0.45, floorY, 1.4, (u.id * 5) | 0, true);
      lamp(base + sofaW + 7);
      // Right slot: TV (weighted most common), a low bookshelf, or a plant.
      const slotW = Math.min(w * 0.18, 13);
      const slotX = x + w - slotW - 4;
      const rightSlot = geoVariant(u, 2, 5);
      if (rightSlot <= 2) {
        ctx.fillStyle = "#15151C"; // TV
        ctx.fillRect(slotX, floorY - 11, slotW, 8);
        ctx.fillStyle = home ? "#8FB6FF" : "#2A2F3A";
        ctx.fillRect(slotX + 1, floorY - 10, slotW - 2, 6);
      } else if (rightSlot === 3) {
        ctx.fillStyle = "#6A5240"; // low bookshelf
        ctx.fillRect(slotX, floorY - 11, slotW, 11);
        for (let row = 0; row < 2; row++) {
          for (let bx = slotX + 1, k = 0; bx + 2 < slotX + slotW - 1; bx += 3, k++) {
            ctx.fillStyle = ["#8C3A32", "#3E5A8C", "#B08A3E"][k % 3];
            ctx.fillRect(bx, floorY - 10 + row * 5, 2, 4);
          }
        }
      } else {
        ctx.fillStyle = "#8C5A3A"; // window plant
        ctx.fillRect(slotX + 2, floorY - 5, 5, 5);
        ctx.fillStyle = PAL.green;
        ctx.fillRect(slotX + 1, floorY - 10, 3, 5);
        ctx.fillRect(slotX + 5, floorY - 9, 3, 4);
      }
    }
  });
}

// ---- Hotel --------------------------------------------------------------

function hotel(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number, grade: number): void {
  const { ctx } = d;
  const asleep = u.state === "asleep";
  const dirty = u.state === "dirty";
  // Hotels are DELIBERATELY uniform (party verdict): a real hotel corridor is
  // identical rooms, and the room's whole job is broadcasting its state
  // (ready lamp / asleep z / dirty tray). Variety here is only the linen wall
  // tint (suite drifts hue-only in its own gold band so the grade tell
  // survives) and a mirrored bed; every state cue renders pixel-identical.
  const wallBand = grade === 3 ? SUITE_WALLS : HOTEL_WALLS;
  const wall = wallBand[geoVariant(u, 0, wallBand.length)];
  // "Someone is here at all" gate stays canonical for hotels.
  const lit = !asleep && (u.occupants > 0 || d.lit);
  const floorY = shell(ctx, x, y, w, h, asleep ? "#3A3550" : wall, "#A88A5E");
  const flip = geoVariant(u, 1, 2) === 1;
  const base = x + (grade === 3 ? Math.min(w * 0.2, 18) + 10 : 6);
  const bedW = x + w - 5 - base;
  const bedTop = floorY - 9;
  maybeMirrored(ctx, flip, x, w, () => {
    if (grade === 3) {
      // Suite sitting area on the left third.
      const sofaW = Math.min(w * 0.2, 18);
      ctx.fillStyle = "#7C5A6A";
      ctx.fillRect(x + 5, floorY - 6, sofaW, 6);
      ctx.fillStyle = "#8C6A7A";
      ctx.fillRect(x + 5, floorY - 9, sofaW, 3);
    }
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
    } else if (dirty) {
      ctx.fillStyle = "#B8A98A";
      ctx.fillRect(base + 5, bedTop + 1, bedW * 0.8, 6);
      ctx.fillStyle = "#D4623A";
      ctx.fillRect(x + w - 6, floorY - 9, 4, 3);
    } else if (lit) {
      ctx.fillStyle = "#FFD86A"; // ready: lamp on
      ctx.fillRect(x + w - 5, floorY - 11, 2, 5);
    }
  });
  if (asleep) {
    // The "z" is text, so it draws OUTSIDE the mirror wrapper at a computed
    // position (mirrored text would render backward).
    const zx = flip ? 2 * x + w - (base + 12) - 5 : base + 12;
    ctx.fillStyle = "rgba(210,220,255,0.9)";
    ctx.font = "8px system-ui, sans-serif";
    ctx.fillText("z", zx, bedTop - 1);
  }
}

// ---- Food ---------------------------------------------------------------

function fastFood(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  // Subtype look (canon variant); unknown/undefined = the classic burger look.
  const look = (u.subtype !== undefined && FASTFOOD_LOOKS[u.subtype]) || FASTFOOD_DEFAULT;
  const floorY = shell(ctx, x, y, w, h, look.wall, "#B5742E");
  // Bold sign band, the fast-food anchor shape: every variety keeps it.
  const band = Math.max(4, h * 0.16);
  ctx.fillStyle = look.band;
  ctx.fillRect(x, y, w, band);
  ctx.fillStyle = look.stripe;
  for (let sx = x + 3; sx < x + w - 3; sx += 8) ctx.fillRect(sx, y + 2, 4, band - 3);
  // Below the band, each variety furnishes its own room.
  const busyAt = (tx: number) => hash((u.id + tx) | 0) > 0.45 || u.occupants > 0;
  switch (look.interior) {
    case "counterBar": {
      // Soba bar: noren fringe under the sign, one long counter, stools.
      ctx.fillStyle = shade(look.band, -18);
      for (let sx = x + 4; sx < x + w - 4; sx += 7) ctx.fillRect(sx, y + band, 4, 4);
      ctx.fillStyle = "#8C6E48";
      ctx.fillRect(x + 4, floorY - 7, w - 8, 3);
      ctx.fillStyle = "#A8845C";
      ctx.fillRect(x + 4, floorY - 7, w - 8, 1);
      ctx.fillStyle = "#F4F0E4"; // steaming bowls along the counter
      for (let bx = x + 10; bx + 3 < x + w - 8; bx += 22) ctx.fillRect(bx, floorY - 9, 3, 2);
      for (let tx = x + 8, i = 0; tx + 4 < x + w - 6; tx += 13, i++) {
        ctx.fillStyle = "#5A4632"; // stool
        ctx.fillRect(tx + 1, floorY - 3, 2, 3);
        if (busyAt(tx)) person(ctx, tx, floorY - 2, 1.2, (u.id + tx) | 0, true);
      }
      break;
    }
    case "teahouse": {
      // Chinese cafe: a hanging lantern and square red-cloth tables with teapots.
      ctx.fillStyle = "#6a5040";
      ctx.fillRect(x + w / 2, y + band, 1, 3);
      ctx.fillStyle = "#E0554A";
      ctx.fillRect(x + w / 2 - 3, y + band + 3, 6, 5);
      ctx.fillStyle = "#E8C14A";
      ctx.fillRect(x + w / 2 - 3, y + band + 5, 6, 1);
      for (let tx = x + 8, i = 0; tx + 12 < x + w - 4; tx += 20, i++) {
        ctx.fillStyle = "#B03030"; // cloth
        ctx.fillRect(tx, floorY - 6, 10, 2);
        ctx.fillStyle = "#6A4A30"; // legs
        ctx.fillRect(tx + 1, floorY - 4, 1, 4);
        ctx.fillRect(tx + 8, floorY - 4, 1, 4);
        ctx.fillStyle = "#F4F0E4"; // teapot
        ctx.fillRect(tx + 4, floorY - 8, 2, 2);
        if (busyAt(tx)) {
          person(ctx, tx - 4, floorY, 1.2, (u.id + tx) | 0, true);
          person(ctx, tx + 11, floorY, 1.2, (u.id + tx + 5) | 0, true);
        }
      }
      break;
    }
    case "parlor": {
      // Ice cream: a white display freezer with a cone rack, then tall stools.
      const fw = Math.min(Math.round(w * 0.3), 26);
      ctx.fillStyle = "#F6F4F6";
      ctx.fillRect(x + 4, floorY - 8, fw, 8);
      ctx.fillStyle = "#BCD8E8"; // glass top
      ctx.fillRect(x + 4, floorY - 8, fw, 2);
      ctx.fillStyle = "#E8B870"; // cones
      for (let cx = x + 7; cx + 2 < x + 4 + fw - 2; cx += 6) {
        ctx.fillRect(cx, floorY - 11, 2, 3);
        ctx.fillStyle = ["#E88AB0", "#F4F0E4", "#8C5A3A"][Math.floor((cx - x) / 6) % 3]; // scoop
        ctx.fillRect(cx, floorY - 13, 2, 2);
        ctx.fillStyle = "#E8B870";
      }
      for (let tx = x + fw + 12, i = 0; tx + 4 < x + w - 4; tx += 14, i++) {
        ctx.fillStyle = "#C87A8E"; // tall stool
        ctx.fillRect(tx + 1, floorY - 5, 2, 5);
        ctx.fillRect(tx, floorY - 5, 4, 1);
        if (busyAt(tx)) person(ctx, tx, floorY - 4, 1.1, (u.id + tx) | 0, true);
      }
      break;
    }
    case "cafe": {
      // Coffee shop: espresso bar with machine, window bench with stools.
      const cw = Math.min(Math.round(w * 0.26), 22);
      ctx.fillStyle = "#5A4632";
      ctx.fillRect(x + 4, floorY - 7, cw, 7);
      ctx.fillStyle = "#8A8A92"; // espresso machine
      ctx.fillRect(x + 6, floorY - 11, 6, 4);
      ctx.fillStyle = "#F4F0E4"; // steam
      ctx.fillRect(x + 8, floorY - 13, 1, 2);
      const benchX = x + cw + 12;
      ctx.fillStyle = "#8C6E48"; // window bench
      ctx.fillRect(benchX, floorY - 6, Math.max(8, x + w - 6 - benchX), 2);
      for (let tx = benchX + 2, i = 0; tx + 4 < x + w - 6; tx += 13, i++) {
        ctx.fillStyle = "#5A4632";
        ctx.fillRect(tx + 1, floorY - 3, 2, 3);
        if (busyAt(tx)) person(ctx, tx, floorY - 2, 1.2, (u.id + tx) | 0, true);
      }
      break;
    }
    default: {
      // Classic burger stand: order counter and round 2-top tables (the
      // legacy composition, kept verbatim for undefined subtypes).
      ctx.fillStyle = "#B5742E";
      ctx.fillRect(x + 4, floorY - 6, Math.min(w * 0.18, 20), 6);
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
  }
}

function restaurant(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  // Subtype look (canon variant); unknown/undefined = the French dining room.
  const look = (u.subtype !== undefined && RESTAURANT_LOOKS[u.subtype]) || RESTAURANT_DEFAULT;
  const floorY = shell(ctx, x, y, w, h, look.wall, look.floor);
  // One light fixture per variety (the dark dining room is the kind anchor;
  // the sushi bar's bright room is carried by its counter instead).
  const glow = d.lit ? "#FFE69A" : "#9a8a60";
  switch (look.fixture) {
    case "chandelier": {
      ctx.fillStyle = "#6a5040";
      ctx.fillRect(x + w / 2 - 1, y + 2, 2, 4);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + 7, 3.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "lamps": {
      // Pub wall sconces at the quarter points (integer coordinates: see the
      // lanterns note below).
      for (const raw of [x + w * 0.25, x + w * 0.75]) {
        const fx = Math.round(raw);
        ctx.fillStyle = "#2A1E14";
        ctx.fillRect(fx - 1, y + 4, 2, 5);
        ctx.fillStyle = glow;
        ctx.fillRect(fx - 2, y + 3, 4, 3);
      }
      break;
    }
    case "lanterns": {
      // Paired hanging lanterns, red with a gold band. Integer coordinates
      // only: fractional rects antialias into smears on a 2D canvas and break
      // the crisp pixel style.
      for (const raw of [x + w * 0.33, x + w * 0.67]) {
        const fx = Math.round(raw);
        ctx.fillStyle = "#6a5040";
        ctx.fillRect(fx, y + 1, 1, 3);
        ctx.fillStyle = d.lit ? "#E0554A" : "#8a3a34";
        ctx.fillRect(fx - 3, y + 4, 6, 6);
        ctx.fillStyle = "#E8C14A";
        ctx.fillRect(fx - 3, y + 6, 6, 1);
      }
      break;
    }
    case "ember": {
      // Steak house: a grill on the left with an ember glow.
      ctx.fillStyle = "#1E1614";
      ctx.fillRect(x + 4, y + Math.round(h * 0.3), Math.min(Math.round(w * 0.16), 16), Math.round(h * 0.28));
      ctx.fillStyle = d.lit ? "#E8862A" : "#8a4a20";
      ctx.fillRect(x + 5, y + Math.round(h * 0.42), Math.min(Math.round(w * 0.16), 16) - 2, 3);
      break;
    }
    case "none":
      break;
  }
  // Dining floor per variety.
  const busyAt = (tx: number) => hash((u.id + tx) | 0) > 0.5 || u.occupants > 0;
  switch (look.interior) {
    case "pub": {
      // The bar owns the left side: counter, bottle shelf, taps, stools; wood
      // tables (no white cloth) fill the rest.
      const barW = Math.min(Math.round(w * 0.34), 34);
      ctx.fillStyle = "#2A1C10"; // bottle shelf
      ctx.fillRect(x + 5, y + Math.round(h * 0.3), barW - 4, 4);
      for (let bx = x + 7, k = 0; bx + 1 < x + barW - 1; bx += 4, k++) {
        ctx.fillStyle = ["#4A7A4A", "#B08A3E", "#8C3A32"][k % 3]; // bottles
        ctx.fillRect(bx, y + Math.round(h * 0.3) - 3, 2, 3);
      }
      ctx.fillStyle = "#4A3220"; // bar counter
      ctx.fillRect(x + 4, floorY - 8, barW, 5);
      ctx.fillStyle = "#6A4A30";
      ctx.fillRect(x + 4, floorY - 8, barW, 1);
      ctx.fillStyle = PAL.brass; // taps
      ctx.fillRect(x + 9, floorY - 11, 1, 3);
      ctx.fillRect(x + 14, floorY - 11, 1, 3);
      for (let tx = x + barW + 12, i = 0; tx + 10 < x + w - 4; tx += 19, i++) {
        ctx.fillStyle = "#6A4A30"; // wood table
        ctx.fillRect(tx, floorY - 6, 9, 2);
        ctx.fillStyle = "#B08A3E"; // pint
        ctx.fillRect(tx + 3, floorY - 8, 2, 2);
        if (busyAt(tx)) {
          person(ctx, tx - 4, floorY, 1.4, (u.id + tx) | 0, true);
          person(ctx, tx + 10, floorY, 1.4, (u.id + tx + 7) | 0, true);
        }
      }
      break;
    }
    case "banquet": {
      // Round banquet tables with a gold lazy-susan center, diners flanking.
      for (let tx = x + 12, i = 0; tx + 12 < x + w - 4; tx += 26, i++) {
        ctx.fillStyle = "#E8D8C0";
        ctx.beginPath();
        ctx.arc(tx + 5, floorY - 4, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#E8C14A";
        ctx.fillRect(tx + 4, floorY - 6, 3, 1);
        if (busyAt(tx)) {
          person(ctx, tx - 4, floorY, 1.4, (u.id + tx) | 0, true);
          person(ctx, tx + 12, floorY, 1.4, (u.id + tx + 7) | 0, true);
        }
      }
      break;
    }
    case "sushi": {
      // One long light-wood bar with a glass case, plates, and the chef
      // standing behind; diners sit along the front.
      ctx.fillStyle = "#E8DCC8";
      ctx.fillRect(x + 6, floorY - 8, w - 14, 3);
      ctx.fillStyle = "#BCD8E8"; // glass case line
      ctx.fillRect(x + 6, floorY - 10, w - 14, 1);
      for (let px = x + 10, k = 0; px + 2 < x + w - 10; px += 9, k++) {
        ctx.fillStyle = k % 2 === 0 ? "#F4F0E4" : "#E88AB0"; // plates
        ctx.fillRect(px, floorY - 9, 2, 1);
      }
      const chefX = Math.round(x + w * 0.5);
      person(ctx, chefX, floorY - 8, 1.3, (u.id * 13) | 0);
      ctx.fillStyle = "#FFFFFF"; // chef's hat
      ctx.fillRect(chefX, floorY - 8 - 12, 3, 2);
      for (let tx = x + 10, i = 0; tx + 4 < x + w - 10; tx += 15, i++) {
        if (busyAt(tx)) person(ctx, tx, floorY - 2, 1.2, (u.id + tx) | 0, true);
      }
      break;
    }
    case "booths": {
      // High-back booths: bench pairs framing a table, a steak-house room.
      for (let tx = x + Math.min(Math.round(w * 0.16), 16) + 10, i = 0; tx + 16 < x + w - 4; tx += 24, i++) {
        ctx.fillStyle = "#5A3A2A"; // benches
        ctx.fillRect(tx, floorY - 10, 3, 10);
        ctx.fillRect(tx + 13, floorY - 10, 3, 10);
        ctx.fillStyle = "#8C6E50"; // table
        ctx.fillRect(tx + 4, floorY - 6, 8, 2);
        ctx.fillStyle = "#F4F0E4"; // plate
        ctx.fillRect(tx + 7, floorY - 7, 2, 1);
        if (busyAt(tx)) {
          person(ctx, tx + 3, floorY, 1.3, (u.id + tx) | 0, true);
          person(ctx, tx + 10, floorY, 1.3, (u.id + tx + 7) | 0, true);
        }
      }
      break;
    }
    default: {
      // French dining room: white-clothed tables with candles (the legacy
      // composition, kept verbatim for undefined subtypes).
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
  }
}

// ---- Shop ---------------------------------------------------------------

function shop(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  if (u.state === "occupied" && !(d.hour >= 10 && d.hour < 21)) return closedShutter(d, x, y, w, h, "#b58ad6");
  // Subtype look (canon variant); unknown/undefined = the legacy generic shop
  // whose awning accent comes from the unit id (kept byte-identical).
  const look = u.subtype !== undefined ? SHOP_LOOKS[u.subtype] : undefined;
  const floorY = shell(ctx, x, y, w, h, look?.wall ?? "#EFE9F5", "#C8BCD2");
  // Striped awning, the retail anchor shape: every variety keeps the stripes,
  // and the accent is the variety's own so two Flower Shops match and a
  // variety reroll visibly changes the room.
  const accent = look?.awning ?? SHIRTS[(u.id + 2) % SHIRTS.length];
  const band = Math.max(3, h * 0.14);
  for (let sx = x; sx < x + w; sx += 10) {
    ctx.fillStyle = Math.floor((sx - x) / 10) % 2 === 0 ? "#FFFFFF" : accent;
    ctx.fillRect(sx, y, 5, band);
  }
  if (look === undefined) {
    // Legacy generic shop: two shelves of colorful goods, kept verbatim.
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
    return;
  }
  // Each trade furnishes its own room; the goods palette colors the details.
  const g = look.goods;
  const midY = Math.round(y + h * 0.36);
  switch (look.interior) {
    case "racks": {
      // Two clothing rails with hanging garments, and a dressed mannequin.
      for (const railY of [midY, Math.round(y + h * 0.6)]) {
        ctx.fillStyle = "#8A8A92";
        ctx.fillRect(x + 5, railY, Math.round(w * 0.6), 1);
        for (let gx = x + 7, k = 0; gx + 3 < x + Math.round(w * 0.6); gx += 5, k++) {
          ctx.fillStyle = g[k % g.length];
          ctx.fillRect(gx, railY + 1, 3, 6);
        }
      }
      const mx = x + w - 12;
      ctx.fillStyle = "#C8C8C8"; // plinth
      ctx.fillRect(mx, floorY - 2, 6, 2);
      ctx.fillStyle = g[0]; // suited mannequin
      ctx.fillRect(mx + 1, floorY - 9, 4, 7);
      ctx.fillStyle = "#E8E4DA";
      ctx.fillRect(mx + 2, floorY - 11, 2, 2);
      break;
    }
    case "pets": {
      // A cage stack and a glowing aquarium.
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          const cx = x + 6 + col * 11;
          const cy = midY + row * 8;
          ctx.fillStyle = "#B8A890";
          ctx.fillRect(cx, cy, 9, 6);
          ctx.fillStyle = "#8A7A64"; // bars
          for (let bx = cx + 1; bx < cx + 9; bx += 2) ctx.fillRect(bx, cy + 1, 1, 4);
          ctx.fillStyle = g[(row * 2 + col) % g.length]; // the resident
          ctx.fillRect(cx + 3, cy + 3, 3, 2);
        }
      }
      const ax = x + Math.max(30, Math.round(w * 0.55));
      ctx.fillStyle = "#2A4A64"; // aquarium
      ctx.fillRect(ax, floorY - 9, 14, 7);
      ctx.fillStyle = "#4FA0C8";
      ctx.fillRect(ax + 1, floorY - 8, 12, 5);
      ctx.fillStyle = "#E88F4A"; // fish
      ctx.fillRect(ax + 3, floorY - 6, 2, 1);
      ctx.fillRect(ax + 8, floorY - 7, 2, 1);
      break;
    }
    case "florist": {
      // Tiered flower stands and floor buckets in bloom.
      for (const [tierY, tierX, tierW] of [
        [midY, x + 5, Math.round(w * 0.5)],
        [Math.round(y + h * 0.58), x + 8, Math.round(w * 0.4)],
      ] as const) {
        ctx.fillStyle = "#A98A6A";
        ctx.fillRect(tierX, tierY + 4, tierW, 1);
        for (let gx = tierX + 2, k = 0; gx + 3 < tierX + tierW; gx += 5, k++) {
          ctx.fillStyle = "#4A7A4A"; // stem
          ctx.fillRect(gx + 1, tierY + 1, 1, 3);
          ctx.fillStyle = g[k % g.length]; // bloom
          ctx.fillRect(gx, tierY - 1, 3, 3);
        }
      }
      for (let bx = x + w - 18, k = 0; k < 2; bx += 8, k++) {
        ctx.fillStyle = "#8A8A92"; // bucket
        ctx.fillRect(bx, floorY - 4, 5, 4);
        ctx.fillStyle = g[(k + 1) % g.length];
        ctx.fillRect(bx, floorY - 6, 5, 2);
      }
      break;
    }
    case "books": {
      // Two full bookcases of spines and a reading table.
      for (const cx of [x + 5, x + Math.round(w * 0.4)]) {
        const cw = Math.min(18, Math.round(w * 0.26));
        ctx.fillStyle = "#6A5240"; // case
        ctx.fillRect(cx, midY - 3, cw, floorY - midY + 3);
        for (let row = 0; row < 2; row++) {
          for (let bx = cx + 2, k = 0; bx + 2 < cx + cw - 1; bx += 3, k++) {
            ctx.fillStyle = g[(k + row) % g.length];
            ctx.fillRect(bx, midY - 1 + row * 6, 2, 5);
          }
        }
      }
      ctx.fillStyle = "#8C6E50"; // reading table
      ctx.fillRect(x + w - 16, floorY - 5, 10, 2);
      ctx.fillStyle = g[1];
      ctx.fillRect(x + w - 13, floorY - 6, 3, 1);
      break;
    }
    case "pharmacy": {
      // Dispensing counter with a white-coated pharmacist, one aisle, the cross.
      ctx.fillStyle = "#3A8A4A";
      ctx.fillRect(x + w - 12, y + band + 2, 6, 2);
      ctx.fillRect(x + w - 10, y + band, 2, 6);
      const cw = Math.round(w * 0.36);
      ctx.fillStyle = "#F4F4F0"; // counter
      ctx.fillRect(x + 5, floorY - 7, cw, 5);
      person(ctx, x + 5 + Math.round(cw / 2), floorY - 7, 1.2, (u.id * 17) | 0, false, "#F4F0E4");
      ctx.fillStyle = "#A98A6A"; // aisle shelf
      ctx.fillRect(x + cw + 12, midY + 4, Math.round(w * 0.3), 1);
      for (let gx = x + cw + 14, k = 0; gx + 3 < x + cw + 12 + Math.round(w * 0.3); gx += 6, k++) {
        ctx.fillStyle = g[k % g.length];
        ctx.fillRect(gx, midY, 4, 4);
      }
      break;
    }
    case "boutique": {
      // Sparse chic: one short rail, a mannequin, a tall mirror.
      ctx.fillStyle = "#8A8A92";
      ctx.fillRect(x + 6, midY, Math.round(w * 0.3), 1);
      for (let gx = x + 9, k = 0; k < 3; gx += 8, k++) {
        ctx.fillStyle = g[k % g.length];
        ctx.fillRect(gx, midY + 1, 3, 6);
      }
      const mx = x + Math.round(w * 0.55);
      ctx.fillStyle = "#C8C8C8";
      ctx.fillRect(mx, floorY - 2, 6, 2);
      ctx.fillStyle = g[0];
      ctx.fillRect(mx + 1, floorY - 9, 4, 7);
      ctx.fillStyle = "#E8E4DA";
      ctx.fillRect(mx + 2, floorY - 11, 2, 2);
      ctx.fillStyle = "#B8C8D4"; // tall mirror
      ctx.fillRect(x + w - 10, midY - 2, 4, floorY - midY);
      ctx.fillStyle = "#8A8A92";
      ctx.fillRect(x + w - 11, midY - 3, 6, 1);
      break;
    }
    case "screens": {
      // A wall of glowing demo screens over a gadget counter.
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < Math.max(2, Math.floor((w - 16) / 10)); col++) {
          const sx = x + 6 + col * 10;
          if (sx + 7 > x + w - 6) break;
          ctx.fillStyle = "#15151C"; // bezel
          ctx.fillRect(sx, midY - 4 + row * 7, 7, 5);
          ctx.fillStyle = g[(row + col) % 3];
          ctx.fillRect(sx + 1, midY - 3 + row * 7, 5, 3);
        }
      }
      ctx.fillStyle = "#2A2E38"; // demo counter
      ctx.fillRect(x + 6, floorY - 4, w - 12, 3);
      ctx.fillStyle = g[1];
      ctx.fillRect(x + 10, floorY - 5, 3, 1);
      ctx.fillRect(x + Math.round(w / 2), floorY - 5, 3, 1);
      break;
    }
    case "bank": {
      // Teller counter with divider windows, a vault door, the brass coin.
      const cw = Math.round(w * 0.5);
      ctx.fillStyle = "#D8D4C8"; // counter
      ctx.fillRect(x + 5, floorY - 7, cw, 5);
      for (const wx of [x + 9, x + 9 + Math.round(cw / 2)]) {
        ctx.fillStyle = "#6A5240"; // teller window
        ctx.fillRect(wx, floorY - 12, 6, 5);
        ctx.fillStyle = "#E8E4DA";
        ctx.fillRect(wx + 1, floorY - 11, 4, 3);
      }
      const vx = x + w - 12;
      ctx.fillStyle = "#8A8A92"; // vault door
      ctx.beginPath();
      ctx.arc(vx, floorY - 6, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5A5A62";
      ctx.beginPath();
      ctx.arc(vx, floorY - 6, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PAL.brass; // the coin over the counter
      ctx.beginPath();
      ctx.arc(x + 8 + Math.round(cw / 2), y + band + 5, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "salon": {
      // Two styling stations (mirror + chair) and the barber pole.
      for (const sx of [x + 7, x + 7 + Math.round(w * 0.3)]) {
        ctx.fillStyle = "#C8DCE8"; // mirror
        ctx.fillRect(sx, midY - 3, 5, 6);
        ctx.fillStyle = "#8A8A92";
        ctx.fillRect(sx - 1, midY - 4, 7, 1);
        ctx.fillStyle = "#3E4654"; // chair
        ctx.fillRect(sx, floorY - 6, 4, 4);
        ctx.fillRect(sx + 1, floorY - 2, 2, 2);
      }
      const px = x + w - 9;
      ctx.fillStyle = "#F4F0E4"; // pole
      ctx.fillRect(px, y + band + 2, 3, 10);
      for (let py = 0; py < 10; py += 4) {
        ctx.fillStyle = py % 8 === 0 ? "#B84848" : "#4F6EC8";
        ctx.fillRect(px, y + band + 2 + py, 3, 2);
      }
      break;
    }
    case "post": {
      // Service counter, a stagger of parcels, and the mail drop box.
      const cw = Math.round(w * 0.34);
      ctx.fillStyle = "#D8D4C8";
      ctx.fillRect(x + 5, floorY - 7, cw, 5);
      person(ctx, x + 5 + Math.round(cw / 2), floorY - 7, 1.2, (u.id * 19) | 0);
      const pxs = x + cw + 12;
      ctx.fillStyle = "#C8A87A"; // parcels
      ctx.fillRect(pxs, floorY - 4, 6, 4);
      ctx.fillRect(pxs + 7, floorY - 4, 5, 4);
      ctx.fillStyle = "#B8986A";
      ctx.fillRect(pxs + 3, floorY - 8, 6, 4);
      ctx.fillStyle = "#4F6EC8"; // drop box
      ctx.fillRect(x + w - 11, floorY - 8, 5, 8);
      ctx.fillStyle = "#2A3A6A";
      ctx.fillRect(x + w - 10, floorY - 6, 3, 1);
      break;
    }
    case "sports": {
      // A ball bin, a stick rack, and a jersey on the wall.
      ctx.fillStyle = "#8A8A92"; // bin
      ctx.fillRect(x + 6, floorY - 5, 10, 5);
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = g[k % g.length];
        ctx.beginPath();
        ctx.arc(x + 9 + k * 3, floorY - 5, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let rx = x + Math.round(w * 0.42), k = 0; k < 4; rx += 3, k++) {
        ctx.fillStyle = k % 2 === 0 ? "#C8A87A" : "#A8845C"; // bats and sticks
        ctx.fillRect(rx, floorY - 9, 1, 9);
      }
      const jx = x + w - 13;
      ctx.fillStyle = g[0]; // jersey
      ctx.fillRect(jx, midY - 2, 7, 6);
      ctx.fillRect(jx - 1, midY - 2, 2, 3);
      ctx.fillRect(jx + 6, midY - 2, 2, 3);
      break;
    }
  }
  if (u.occupants > 0 || hash(u.id) > 0.4) person(ctx, x + w - 9, floorY, 1.5, (u.id * 11) | 0);
}

// ---- Cinema -------------------------------------------------------------

function cinema(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  // Every cinema used to show the identical audience and marquee phase in
  // every tower (the seeds were position-free constants); fold the geo seed
  // in so two cinemas never screen to the same crowd.
  const geo = geoVariant(u, 4, 997);
  shell(ctx, x, y, w, h, "#140D28", "#0A0716");
  // Marquee bulbs (slow chase, phase offset per cinema).
  const chase = Math.floor(d.anim * 4) + geo;
  for (let i = 0, bx = x + 3; bx < x + w - 2; bx += 6, i++) {
    ctx.fillStyle = (i + chase) % 2 === 0 ? "#FFD24A" : "#FF6B6B";
    ctx.fillRect(bx, y + 2, 2, 2);
  }
  // Glowing screen cycling pastel frames.
  const frames = ["#9FC0FF", "#FFD9A0", "#C0FFD0", "#FFB0C0", "#D0C0FF"];
  const fr = Math.floor(d.anim * 2.5 + geo) % frames.length;
  const sw = Math.min(w * 0.5, 90);
  ctx.fillStyle = frames[fr];
  ctx.fillRect(x + w / 2 - sw / 2, y + 8, sw, h - 18);
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.fillRect(x + w / 2 - sw / 2, y + 8 + ((fr * 4) % Math.max(1, h - 22)), sw, 1);
  // Raked seats with a per-cinema audience.
  for (let i = 0, sx = x + 4; sx < x + w - 3; sx += 6, i++) {
    ctx.fillStyle = "#0A0716";
    ctx.fillRect(sx, y + h - 7, 4, 5);
    if (hash(i * 7 + 3 + geo) > 0.45) {
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
