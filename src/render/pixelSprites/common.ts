import type { FacilityKind, Unit } from "../../engine/types";
import { GRID } from "../../engine/facilities";
import { visibleOccupants } from "../../engine/Crowd";

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
  // Overhaul additions (art bible "Canonical palette"). New keys only; the
  // anchors above stay byte-stable because residential/food/shop reference them
  // directly. No new key matches a reserved state color (see the guard test).
  warmWall: "#ECDFC2", // warm cream interior wall
  carpetGreen: "#6E7A48", // olive office carpet
  hotelPink: "#E8B7A8", // warm hotel bedding pink
  hotelRed: "#A83C4A", // deeper hotel red (headboard, drapes, trim)
  skyDay: "#9CC4DE", // day sky band in window views
  skyNight: "#2A3350", // night sky band in window views (background only)
  cityLight: "#F3D08A", // warm distant-window dot
  awningShadow: "#5A4038", // shaded band under awnings and canopies
  signWarm: "#EE8844", // warm marquee and sign fill
  glowLit: "#F8E2B4", // warm lamp glow, lit
  glowDim: "#8A7A5C", // same lamp, unlit or dim
  walnut: "#6B4A2B", // dark furniture wood (desks, headboards)
  oak: "#A9743C", // mid furniture wood
};

/** Reserved state-cue literals that decoration must never reuse. Exported so the
 *  guard test can assert no NEW decoration `PAL` key and no `SHIRTS` entry
 *  collides with one. The grandfathered anchor `PAL.red` is itself the stress
 *  red (a state cue, not decoration), so the guard checks the new keys, not all
 *  of `PAL`. Mirrors the art bible "Reserved" list. */
export const RESERVED_COLORS = [
  "#C24A3A", // stress red (fed-up mood)
  "#C9CCC4", // vacancy gray
  "#B2B0A4", // vacancy gray (darker)
  "#E8A030", // notice amber
  "#D4623A", // dirty tray
  "#FFD86A", // ready lamp
  "#E0556B", // closed sign
] as const;

// No shirt may reuse the stress red (#C24A3A); otherwise ~1-in-8 content
// commuters look pixel-identical to a "fed up" one (F10). The former red shirt
// is replaced with a muted teal so the stress tint reads unambiguously.
export const SHIRTS = ["#5A6E8C", "#3E4654", "#6E5A4A", "#3F8C84", "#4FA0C8", "#5AA85A", "#D8B05A", "#9A5FB0"];
export const SKIN = ["#E8C9A0", "#C99A6E", "#A9774E"];

export function shade(hex: string, amt: number): string {
  // Exported helpers take a bare color string; degrade a non-hex argument
  // gracefully instead of producing rgb(NaN,...). Every shipped caller passes a
  // #RRGGBB literal, so this leaves current output byte-identical.
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
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

/**
 * Which of a room's `stations` (stools, dance-floor spots, machines, mats,
 * bikes, places on a mat) have someone at them: a stable pseudo-random subset of
 * exactly `min(people, stations)` of them.
 *
 * The count is the point. Deciding each station on its own hash roll broke the
 * honest-occupancy rule in both directions at once: a hall with two visitors
 * could paint four figures at one column and none at the next, and where the
 * loop counted a skipped station against the occupancy anyway, people who were
 * in the room were simply never drawn.
 *
 * WHICH stations matters almost as much. Filling from one end would satisfy the
 * count and turn a quiet room into a solid block of figures against one wall
 * with an empty half beside it, so the subset is chosen by ranking the stations
 * on their hash and taking the busiest. That spreads a small crowd over the
 * whole row and is still a pure function of the room's own seed, which is what
 * lets these rooms bake to a cached sprite.
 */
/**
 * A room's occupancy as its art has to read it: whole people.
 *
 * `visibleOccupants` is the people system's canonical figure and stays
 * fractional, because the live census sums it. Art cannot draw four fifths of a
 * person, so every row already floors it, and a room that ALSO draws one gated
 * figure (a barber's seated client, a spa's tub guest, a golfer, the staff who
 * appear because the room is open) has to floor it at the same place or the two
 * halves disagree: at a forged 0.5 the rows correctly draw nobody while the
 * gate draws a whole person, which is a fraction rounded into a figure through
 * the door those rows shut.
 *
 * Used by the room kinds whose crowds this pass rewired. The others still read
 * `visibleOccupants` directly, which is the older behavior, not a decision.
 */
export function roomOccupants(u: { occupants: number; outForMeal?: number }): number {
  return Math.floor(visibleOccupants(u));
}

export function busyStations(stations: number, people: number, seed: number): Set<number> {
  // Floored so a forged save carrying a fractional count rounds the same way
  // here as a plain counting loop would.
  const want = Math.max(0, Math.min(Math.floor(people), stations));
  if (!(want > 0)) return new Set(); // nobody here, or a nonsense count
  const ranked = Array.from({ length: stations }, (_, i) => i);
  ranked.sort((a, b) => hash(seed + b) - hash(seed + a) || a - b); // index breaks a tie
  return new Set(ranked.slice(0, want));
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

// ---- The person() family (finalized two-scale figures) --------------------
//
// The overhaul's finalized human builds (art bible, Figma pages 06 to 07). These
// are fixed-size because every unit bakes at the same TILE=11 / FLOOR=44 scale,
// so a build reads at the same fraction of a floor everywhere. The legacy
// `person()` above stays byte-identical for existing callers; per-kind specs
// adopt these named builds as they repaint, so no call site changes here.

export type PersonBuild = "seated" | "standing" | "walker" | "rider" | "hiVis";
export type Mood = "content" | "impatient" | "fedUp";

interface BuildSpec {
  head: number;
  torso: number;
  legs: number;
  width: number;
  hardhat?: boolean;
}

/** Finalized geometry per build (owner-approved). Totals: seated 15, standing
 *  18, walker 24, rider 17, hi-vis 22 pixels tall. */
const BUILDS: Record<PersonBuild, BuildSpec> = {
  seated: { head: 5, torso: 10, legs: 0, width: 6 },
  standing: { head: 5, torso: 9, legs: 4, width: 6 },
  walker: { head: 5, torso: 13, legs: 6, width: 7 },
  rider: { head: 4, torso: 9, legs: 4, width: 6 },
  hiVis: { head: 5, torso: 12, legs: 5, width: 7, hardhat: true },
};

// Head detail literals, pinned by the pixelSpritesCommon guard.
const FIGURE_SKIN = SKIN[0]; // "#E8C9A0" skin field
const FIGURE_HAIR = "#3A2E28"; // 1px hair line
const FIGURE_EYE = "#F0D8B8"; // 1px eye highlight
const FIGURE_SHADOW = "rgba(0,0,0,0.24)"; // 1px contact shadow

/** Torso fill for a figure's mood. Content wears the class `SHIRTS` color;
 *  impatient warms to amber; fed up turns the reserved stress red. The impatient
 *  amber `#E8862A` is deliberately distinct from the reserved notice amber
 *  `#E8A030`. */
export function moodTint(mood: Mood, seed: number): string {
  if (mood === "impatient") return "#E8862A";
  if (mood === "fedUp") return "#C24A3A";
  return SHIRTS[Math.abs(seed) % SHIRTS.length];
}

/** Draw one finalized figure. `footY` is the baseline the feet stand on; the
 *  figure rises above it. `fill` is the torso (mood) color. Integer pixels. */
export function personFigure(ctx: CanvasRenderingContext2D, x: number, footY: number, build: PersonBuild, fill: string): void {
  const b = BUILDS[build];
  const x0 = Math.round(x);
  const foot = Math.round(footY);
  ctx.fillStyle = FIGURE_SHADOW; // 1px contact shadow under the feet
  ctx.fillRect(x0 - 1, foot, b.width + 2, 1);
  const legTop = foot - b.legs;
  if (b.legs > 0) {
    ctx.fillStyle = PAL.ink; // two ink legs at fixed columns (1px gap at every width); seated has none
    ctx.fillRect(x0 + 1, legTop, 2, b.legs);
    ctx.fillRect(x0 + 4, legTop, 2, b.legs);
  }
  const torsoTop = legTop - b.torso;
  ctx.fillStyle = fill; // torso: mood fill, darker left edge, lighter right edge
  ctx.fillRect(x0, torsoTop, b.width, b.torso);
  ctx.fillStyle = shade(fill, -26);
  ctx.fillRect(x0, torsoTop, 1, b.torso);
  ctx.fillStyle = shade(fill, 16);
  ctx.fillRect(x0 + b.width - 1, torsoTop, 1, b.torso);
  const headW = b.width - 2;
  const headX = x0 + 1;
  const headTop = torsoTop - b.head;
  ctx.fillStyle = FIGURE_SKIN; // head: skin field, hair line, eye highlight
  ctx.fillRect(headX, headTop, headW, b.head);
  ctx.fillStyle = FIGURE_HAIR;
  ctx.fillRect(headX, headTop, headW, 1);
  ctx.fillStyle = FIGURE_EYE;
  ctx.fillRect(headX + headW - 2, headTop + 2, 1, 1);
  if (b.hardhat) {
    ctx.fillStyle = "#F4D24A"; // hi-vis hardhat brim + vest stripe
    ctx.fillRect(headX - 1, headTop, headW + 2, 1);
    ctx.fillRect(x0, torsoTop + Math.round(b.torso * 0.4), b.width, 1);
  }
}

/** Named convenience builds. Each picks its torso fill from the seed and mood so
 *  call sites read clearly: `personWalker(ctx, x, y, seed)` or
 *  `personWalker(ctx, x, y, seed, "fedUp")`. */
export function personSeated(ctx: CanvasRenderingContext2D, x: number, footY: number, seed: number, mood: Mood = "content"): void {
  personFigure(ctx, x, footY, "seated", moodTint(mood, seed));
}
export function personStanding(ctx: CanvasRenderingContext2D, x: number, footY: number, seed: number, mood: Mood = "content"): void {
  personFigure(ctx, x, footY, "standing", moodTint(mood, seed));
}
export function personWalker(ctx: CanvasRenderingContext2D, x: number, footY: number, seed: number, mood: Mood = "content"): void {
  personFigure(ctx, x, footY, "walker", moodTint(mood, seed));
}
export function personRider(ctx: CanvasRenderingContext2D, x: number, footY: number, seed: number, mood: Mood = "content"): void {
  personFigure(ctx, x, footY, "rider", moodTint(mood, seed));
}
export function personHiVis(ctx: CanvasRenderingContext2D, x: number, footY: number, seed: number, mood: Mood = "content"): void {
  personFigure(ctx, x, footY, "hiVis", moodTint(mood, seed));
}

// ---- Shared room helpers (added, adopted per kind by later specs) ----------
//
// New shared helpers every enriched room can import. All key only on `lit` and
// other bake-signature inputs, never `d.anim`, so a static room stays cacheable.
// Unused by the current rooms; per-kind specs wire them in as they repaint.

/** The warm lamp-glow color for the room's lit state. */
export function roomGlow(lit: boolean): string {
  return lit ? PAL.glowLit : PAL.glowDim;
}

/** A 1px contact shadow under a prop, at the given baseline. */
export function castShadow(ctx: CanvasRenderingContext2D, x: number, footY: number, w: number): void {
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(Math.round(x), Math.round(footY), Math.max(1, Math.round(w)), 1);
}

/** A small ceiling fixture centered over `w`, glowing warm when `lit`. */
export function ceilingFixture(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, lit: boolean): void {
  const cx = Math.round(x + w / 2);
  const y0 = Math.round(y);
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(cx - 1, y0, 2, 2);
  ctx.fillStyle = roomGlow(lit);
  ctx.fillRect(cx - 3, y0 + 2, 6, 2);
}

/** A wainscot dado: the lower wall below `railY` in a shaded panel with a wood
 *  rail, so the lower wall reads as trim rather than a second floor. */
export function dado(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, railY: number, wall: string): void {
  const x0 = Math.round(x);
  const ww = Math.max(1, Math.round(w));
  const ry = Math.round(railY);
  ctx.fillStyle = shade(wall, -13);
  ctx.fillRect(x0, ry, ww, Math.max(1, Math.round(floorY) - ry));
  ctx.fillStyle = PAL.walnut;
  ctx.fillRect(x0, ry - 1, ww, 2);
  ctx.fillStyle = PAL.oak;
  ctx.fillRect(x0, ry - 1, ww, 1);
}

/** A framed window high on the back wall showing a recessed city skyline. `lit`
 *  is the codebase's evening/night flag: the sky is the night band when `lit`
 *  and the day band otherwise, and the distant `cityLight` windows glow only at
 *  night. The ink and slate mullion grid plus 1px sparse dots keep the view
 *  reading as background, never as occupants. */
export function windowView(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lit: boolean, seed: number): void {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const ww = Math.max(1, Math.round(w));
  const hh = Math.max(1, Math.round(h));
  ctx.fillStyle = lit ? PAL.skyNight : PAL.skyDay;
  ctx.fillRect(x0, y0, ww, hh);
  if (lit) {
    ctx.fillStyle = PAL.cityLight; // distant lit windows, night only
    for (let gx = 1; gx < ww - 1; gx += 3) {
      for (let gy = 1; gy < hh - 1; gy += 3) {
        if (hash(seed * 131 + gx * 17 + gy * 7) > 0.72) ctx.fillRect(x0 + gx, y0 + gy, 1, 1);
      }
    }
  }
  ctx.fillStyle = PAL.ink; // frame
  ctx.fillRect(x0, y0, ww, 1);
  ctx.fillRect(x0, y0 + hh - 1, ww, 1);
  ctx.fillRect(x0, y0, 1, hh);
  ctx.fillRect(x0 + ww - 1, y0, 1, hh);
  ctx.fillStyle = PAL.slate; // recessed mullion cross
  ctx.fillRect(x0 + (ww >> 1), y0, 1, hh);
  ctx.fillRect(x0, y0 + (hh >> 1), ww, 1);
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
export const POPULATED = new Set<FacilityKind>(["office", "condo", "rentalStudio", "rentalApartment", "hotelSingle", "hotelDouble", "hotelSuite"]);

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
