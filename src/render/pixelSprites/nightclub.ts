import { visibleOccupants } from "../../engine/Crowd";
import type { Unit } from "../../engine/types";
import { hash, personStanding, shade, shell, type RoomCtx } from "./common";

/**
 * Modern Nightclub art: a single dark room lit by colored beams, with a DJ booth,
 * a glowing dance floor, and a crowd of dancers that fills in with the real
 * occupant count. Unlike the container kinds it has no subtypes, so this is one
 * bespoke look. Modern-only (never exported to the 1994 TDT). The club only ever
 * draws while open (the closed shutter covers its daytime hours), so this is
 * always the after-dark scene.
 *
 * Drawing reads only bake-signature inputs (the real occupant count and a stable
 * geography seed), so a placed room stays cacheable, an empty club reads empty
 * (dark, no dancers), and a TDT id renumber never reshuffles the crowd.
 */

const WALL = "#181022"; // near-black purple
const FLOOR = "#241834";
const BEAMS = ["#F0409A", "#40C0F0", "#70E060", "#F0A040", "#B060F0"]; // club light colors

/** A stable per-room seed from GEOGRAPHY (floor, x), so the crowd and light
 *  colors survive a save/export/import (which renumbers `u.id`). */
function figureSeed(u: Pick<Unit, "floor" | "x">): number {
  return (u.floor * 131 + u.x * 17) | 0;
}

export function nightclub(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;
  const floorY = shell(ctx, x, y, w, h, WALL, FLOOR);
  const seed = figureSeed(u);
  const occ = visibleOccupants(u);

  // Ceiling light rig: a dark bar with colored spot fixtures, each throwing a
  // faint triangular beam down toward the floor.
  ctx.fillStyle = "#0E0A16";
  ctx.fillRect(x, y, w, 3);
  for (let lx = x + 4, i = 0; lx + 2 < x + w - 2; lx += 9, i++) {
    const c = BEAMS[(i + seed) % BEAMS.length];
    ctx.fillStyle = shade(c, 40); // the fixture
    ctx.fillRect(lx, y + 2, 2, 2);
    // A faint downward beam (a few translucent-looking descending dots).
    ctx.fillStyle = shade(c, -30);
    const spread = Math.round((floorY - y) * 0.5);
    for (let by = y + 4; by < y + 4 + spread; by += 3) {
      const bw = 1 + Math.round(((by - y) / spread) * 2);
      ctx.fillRect(lx + 1 - (bw >> 1), by, bw, 1);
    }
  }

  // A glowing checkered dance floor strip along the floor line.
  const danceX0 = x + 4;
  const danceX1 = x + Math.round(w * 0.66);
  for (let fx = danceX0, k = 0; fx + 3 < danceX1; fx += 4, k++) {
    ctx.fillStyle = (k % 2 === 0) ? shade(BEAMS[(k + seed) % BEAMS.length], -10) : "#14101E";
    ctx.fillRect(fx, floorY - 2, 4, 2);
  }

  // The DJ booth on the right: a raised console with two glowing decks and a DJ.
  const boothX = x + Math.round(w * 0.72);
  const boothW = w - (boothX - x) - 3;
  ctx.fillStyle = "#100A18";
  ctx.fillRect(boothX, floorY - 9, boothW, 9);
  ctx.fillStyle = shade(WALL, 26);
  ctx.fillRect(boothX, floorY - 9, boothW, 1);
  // Two turntables/decks glowing.
  ctx.fillStyle = BEAMS[seed % BEAMS.length];
  ctx.fillRect(boothX + 1, floorY - 8, 2, 2);
  ctx.fillRect(boothX + boothW - 3, floorY - 8, 2, 2);
  // The DJ behind the booth (only when the club is live, so an empty room reads empty).
  if (occ > 0) personStanding(ctx, boothX + Math.round(boothW / 2) - 3, floorY - 8, seed + 3);

  // Dancers on the floor, filling in with occupancy. Bounded by the dance-floor
  // width, so a forged occupant count can never over-iterate.
  let drawn = 0;
  for (let dx = danceX0 + 3; dx + 4 < danceX1 && drawn < occ; dx += 6, drawn++) {
    if (hash(seed * 17 + drawn) > 0.15) {
      personStanding(ctx, dx, floorY, seed + drawn * 7);
      // A colored uplight glow at the dancer's feet.
      ctx.fillStyle = BEAMS[(drawn + seed) % BEAMS.length];
      ctx.fillRect(dx - 1, floorY - 1, 5, 1);
    }
  }
}
