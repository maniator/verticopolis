import type { Unit } from "../../engine/types";
import { PAL, geoVariant, hash, person, shade, shell, type RoomCtx } from "./common";

/**
 * Food and entertainment room art: fast food, restaurant, and cinema, with
 * their canon retail-subtype look tables. Extracted verbatim from
 * `pixelSprites.ts`. Each KIND keeps one anchor shape (the fast-food sign band,
 * the restaurant's dark dining room), and the subtype furnishes the rest. No
 * RNG: an undefined or unknown subtype falls back to the pre-variant look,
 * byte-identical. `src/tests/subtypeVisuals.test.ts` pins these tables against
 * the canon name lists.
 */

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

// ---- Food ---------------------------------------------------------------

export function fastFood(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
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

export function restaurant(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
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

// ---- Cinema -------------------------------------------------------------

export function cinema(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
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
