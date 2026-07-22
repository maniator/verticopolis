import { visibleOccupants } from "../../engine/Crowd";
import type { Unit } from "../../engine/types";
import { castShadow, hash, personStanding, shade, shell, type RoomCtx } from "./common";

/**
 * Modern Amusements art: an arcade / games hall with four attraction types
 * (classic cabinets, a VR lounge, a claw parlor, and a mini-golf bay). Every
 * attraction keeps one anchor shape, the neon marquee band across the top, and
 * its subtype furnishes the rest, so a Classic Arcade and a Mini Golf read as
 * clearly different rooms. The look tables and the draw body live here; the
 * kind is Modern-only (never exported to the 1994 TDT) so nothing here carries
 * an ordinal.
 *
 * Drawing reads only bake-signature inputs (subtype via the look, the real
 * occupant count, `lit`, and a stable geography seed), so a placed room stays
 * cacheable, an empty hall reads empty, a full one full, and a TDT id renumber
 * never reshuffles the crowd.
 */

export interface AmusementsLook {
  wall: string;
  floor: string;
  /** The marquee / accent neon color; the attraction's glowing elements pick
   *  their own screen hues, but the marquee and trim read this. */
  neon: string;
  /** Which attraction fills the hall. 1:1 with the subtype, so the look table
   *  stays trivially pairwise-distinct. */
  attraction: "arcade" | "vr" | "claw" | "golf";
}

export const AMUSEMENTS_DEFAULT: AmusementsLook = { wall: "#201830", floor: "#2A2038", neon: "#F04AA0", attraction: "arcade" };
export const AMUSEMENTS_LOOKS: Record<string, AmusementsLook> = {
  "Classic Arcade": { wall: "#201830", floor: "#2A2038", neon: "#F04AA0", attraction: "arcade" },
  "VR Lounge": { wall: "#101A2E", floor: "#16203A", neon: "#3AD0E0", attraction: "vr" },
  "Claw Parlor": { wall: "#3A1630", floor: "#2E1828", neon: "#FFC24A", attraction: "claw" },
  "Mini Golf": { wall: "#123018", floor: "#1E7A3A", neon: "#7AE06A", attraction: "golf" },
};

/** A stable per-room seed from GEOGRAPHY (floor, x), so the crowd and screen
 *  colors survive a save/export/import (which renumbers `u.id`). */
function figureSeed(u: Pick<Unit, "floor" | "x">): number {
  return (u.floor * 131 + u.x * 17) | 0;
}

/** The five arcade screen hues, a cheerful spread that keeps the dark room lively. */
const SCREEN_HUES = ["#F0503A", "#3AC0F0", "#6BE05A", "#F0C43A", "#C060F0"];

/** A small glowing screen: a bright field with a 1px inner scanline, so a dark
 *  arcade reads as full of lit displays rather than black boxes. */
function screen(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, hue: string): void {
  ctx.fillStyle = shade(hue, -50);
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2); // dark bezel
  ctx.fillStyle = hue;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = shade(hue, 60); // bright highlight blip
  ctx.fillRect(x + 1, y + 1, Math.max(1, w - 3), 1);
}

/** The marquee band: the shared anchor shape. A dark header strip with a glowing
 *  neon rule and evenly spaced bulb dots, so every attraction is unmistakably an
 *  amusements hall. Returns the Y just below the band. */
function marquee(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, neon: string, lit: boolean): number {
  const band = 5;
  ctx.fillStyle = "#14101C";
  ctx.fillRect(x, y, w, band);
  ctx.fillStyle = neon; // the glowing neon rule
  ctx.fillRect(x, y + band - 2, w, 1);
  const bulb = lit ? shade(neon, 70) : shade(neon, -20);
  for (let bx = x + 3; bx < x + w - 1; bx += 7) {
    ctx.fillStyle = bulb;
    ctx.fillRect(bx, y + 1, 2, 2);
  }
  return y + band;
}

function drawArcade(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, top: number, look: AmusementsLook, occ: number, seed: number): void {
  // A row of arcade cabinets along the back wall, each a tall box with a glowing
  // screen and a lit control panel; players stand at a share of them.
  const cabW = 11;
  const gap = 4;
  const cabH = Math.min(floorY - top - 2, 22);
  const cabY = floorY - cabH;
  let i = 0;
  for (let cx = x + 3; cx + cabW <= x + w - 3; cx += cabW + gap, i++) {
    ctx.fillStyle = shade(look.wall, 26); // cabinet body
    ctx.fillRect(cx, cabY, cabW, cabH);
    ctx.fillStyle = shade(look.wall, 44); // lit side edge
    ctx.fillRect(cx + cabW - 1, cabY, 1, cabH);
    screen(ctx, cx + 2, cabY + 2, cabW - 4, Math.round(cabH * 0.4), SCREEN_HUES[(i + seed) % SCREEN_HUES.length]);
    ctx.fillStyle = look.neon; // control-panel light strip
    ctx.fillRect(cx + 1, cabY + Math.round(cabH * 0.62), cabW - 2, 1);
    castShadow(ctx, cx, floorY, cabW);
    // A player at roughly every other cabinet, up to the real occupancy.
    if (i < occ * 2 && hash(seed * 31 + i) > 0.35) personStanding(ctx, cx + cabW - 2, floorY, seed + i * 7);
  }
}

function drawVr(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, top: number, look: AmusementsLook, occ: number, seed: number): void {
  // A sleek lounge: floor pods marked by a glowing ring, each with a standing
  // player wearing a bright headset visor. Cooler and emptier than the arcade.
  const podGap = Math.max(18, Math.round((w - 8) / 3));
  let i = 0;
  for (let px = x + Math.round(podGap / 2); px < x + w - 6; px += podGap, i++) {
    // Glowing floor ring under the pod.
    ctx.fillStyle = look.neon;
    ctx.fillRect(px - 6, floorY - 1, 12, 1);
    ctx.fillStyle = shade(look.neon, -40);
    ctx.fillRect(px - 6, floorY, 12, 1);
    // A tall accent pillar with a light bar (the pod's tracker mast).
    ctx.fillStyle = shade(look.wall, 30);
    ctx.fillRect(px - 7, top + 2, 2, floorY - top - 3);
    ctx.fillStyle = look.neon;
    ctx.fillRect(px - 7, top + 4, 2, 4);
    if (i < occ) {
      personStanding(ctx, px - 2, floorY, seed + i * 13);
      // Bright visor over the figure's face.
      ctx.fillStyle = shade(look.neon, 40);
      ctx.fillRect(px - 1, floorY - 16, 5, 2);
    }
  }
}

function drawClaw(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, top: number, look: AmusementsLook, occ: number, seed: number): void {
  // A bank of claw machines: glass cases lit from within, packed with colorful
  // plush prizes, a claw rail across the top. Candy-bright, kid crowd.
  const macW = 13;
  const gap = 4;
  const macH = Math.min(floorY - top - 2, 24);
  const macY = floorY - macH;
  let i = 0;
  for (let mx = x + 3; mx + macW <= x + w - 3; mx += macW + gap, i++) {
    ctx.fillStyle = shade(look.neon, -30); // machine frame
    ctx.fillRect(mx, macY, macW, macH);
    const glassY = macY + 4;
    const glassH = Math.round(macH * 0.5);
    ctx.fillStyle = shade(look.wall, 34); // lit glass case
    ctx.fillRect(mx + 1, glassY, macW - 2, glassH);
    // A jumble of plush prizes inside.
    for (let py = 0; py < 2; py++) {
      for (let gx = mx + 2; gx + 2 < mx + macW - 1; gx += 3) {
        ctx.fillStyle = SCREEN_HUES[(gx + py + seed) % SCREEN_HUES.length];
        ctx.fillRect(gx, glassY + glassH - 3 - py * 3, 2, 2);
      }
    }
    ctx.fillStyle = "#C0C4CC"; // claw rail + claw
    ctx.fillRect(mx + 1, glassY, macW - 2, 1);
    ctx.fillRect(mx + Math.round(macW / 2), glassY + 1, 1, 3);
    ctx.fillStyle = look.neon; // prize-chute glow
    ctx.fillRect(mx + 1, macY + macH - 3, macW - 2, 1);
    castShadow(ctx, mx, floorY, macW);
    if (i < occ * 2 && hash(seed * 23 + i) > 0.4) personStanding(ctx, mx + macW - 2, floorY, seed + i * 5);
  }
}

function drawGolf(ctx: CanvasRenderingContext2D, x: number, floorY: number, w: number, look: AmusementsLook, occ: number, seed: number): void {
  // A mini-golf bay: bright turf, a couple of holes with pin flags, a windmill
  // obstacle, and a putter mid-swing. The one non-dark attraction.
  ctx.fillStyle = look.floor; // extend the turf up a little as a putting green
  ctx.fillRect(x, floorY - 3, w, 3);
  ctx.fillStyle = shade(look.floor, 22); // mown highlight stripes
  for (let sx = x; sx < x + w; sx += 8) ctx.fillRect(sx, floorY - 3, 4, 1);
  // Holes with pin flags.
  const flags = ["#F0503A", "#F0C43A"];
  let f = 0;
  for (let hx = x + 12; hx < x + w - 6; hx += Math.max(20, Math.round((w - 16) / 2)), f++) {
    ctx.fillStyle = "#12200F"; // the cup
    ctx.fillRect(hx, floorY - 1, 3, 1);
    ctx.fillStyle = "#D8D0B8"; // flag pole
    ctx.fillRect(hx + 1, floorY - 12, 1, 11);
    ctx.fillStyle = flags[f % flags.length];
    ctx.fillRect(hx + 2, floorY - 12, 5, 3);
  }
  // A little windmill obstacle at the back.
  const wmX = x + Math.round(w * 0.72);
  ctx.fillStyle = shade(look.wall, 40);
  ctx.fillRect(wmX, floorY - 14, 6, 14);
  ctx.fillStyle = look.neon;
  ctx.fillRect(wmX - 3, floorY - 15, 12, 2); // sail bar
  ctx.fillRect(wmX + 2, floorY - 20, 2, 12);
  // A golfer mid-putt (only when someone is here), plus any extra visitors
  // watching. The watcher loop is bounded by the bay WIDTH, not the raw occupant
  // count, so a forged/corrupt save with a huge `occupants` can never over-iterate.
  if (occ > 0) {
    personStanding(ctx, x + 6, floorY, seed);
    ctx.fillStyle = "#D8D0B8"; // putter
    ctx.fillRect(x + 11, floorY - 6, 5, 1);
    ctx.fillRect(x + 15, floorY - 3, 1, 3);
  }
  for (let i = 1; i < occ; i++) {
    const px = x + 20 + i * 12;
    if (px >= x + w - 6) break;
    personStanding(ctx, px, floorY, seed + i * 9);
  }
}

/** The Modern Amusements hall. Reused for every attraction subtype; the look's
 *  `attraction` discriminant picks the interior so a Classic Arcade, VR Lounge,
 *  Claw Parlor, and Mini Golf each render as their own room. */
export function amusements(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  const look = (u.subtype !== undefined && AMUSEMENTS_LOOKS[u.subtype]) || AMUSEMENTS_DEFAULT;
  const floorY = shell(ctx, x, y, w, h, look.wall, look.floor);
  const top = marquee(ctx, x, y, w, look.neon, d.lit);
  const occ = visibleOccupants(u);
  const seed = figureSeed(u);
  switch (look.attraction) {
    case "arcade":
      drawArcade(ctx, x, floorY, w, top, look, occ, seed);
      break;
    case "vr":
      drawVr(ctx, x, floorY, w, top, look, occ, seed);
      break;
    case "claw":
      drawClaw(ctx, x, floorY, w, top, look, occ, seed);
      break;
    case "golf":
      drawGolf(ctx, x, floorY, w, look, occ, seed);
      break;
  }
  // A warm marquee glow wash near the top when the hall is lit at night.
  if (d.lit) {
    ctx.fillStyle = "rgba(255,220,140,0.06)";
    ctx.fillRect(x, top, w, Math.round((floorY - top) * 0.4));
  }
}
