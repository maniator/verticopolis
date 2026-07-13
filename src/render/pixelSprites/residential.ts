import type { Unit } from "../../engine/types";
import { visibleOccupants } from "../../engine/Crowd";
import { PAL, SHIRTS, SKIN, geoVariant, maybeMirrored, person, shade, shell, vacancy, wallItem, type RoomCtx } from "./common";

/**
 * Residential and lodging room art: office, condo, and the three hotel grades,
 * with their geo-seeded wall bands. Extracted verbatim from `pixelSprites.ts`.
 */

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

// ---- Office -------------------------------------------------------------

export function office(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
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
      for (let i = 0; i < 3; i++) {
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

export function condo(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number): void {
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
        if (visibleOccupants(u) > 1) person(ctx, tx + 14, floorY, 1.4, (u.id * 5 + 11) | 0, true);
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

export function hotel(d: RoomCtx, u: Unit, x: number, y: number, w: number, h: number, grade: number): void {
  const { ctx } = d;
  const asleep = u.state === "asleep";
  const dirty = u.state === "dirty";
  // Rooms of the SAME grade stay uniform (party verdict: a hotel corridor is
  // identical rooms and the room's job is broadcasting ready/asleep/dirty),
  // but the GRADES are distinct geometry: a Single is one small bed, a Double
  // is two beds with a real gap, a Suite is a wide room with a sitting area
  // and a wide bed. Per-unit variety is only the linen wall tint (suite
  // drifts hue-only in its own gold band) and a mirrored floor plan.
  const wallBand = grade === 3 ? SUITE_WALLS : HOTEL_WALLS;
  const wall = wallBand[geoVariant(u, 0, wallBand.length)];
  // "Someone is here at all" gate stays canonical for hotels.
  const lit = !asleep && (u.occupants > 0 || d.lit);
  const floorY = shell(ctx, x, y, w, h, asleep ? "#3A3550" : wall, "#A88A5E");
  const flip = geoVariant(u, 1, 2) === 1;
  const bedTop = floorY - 9;
  // One bed per grade slot; each draws its own headboard, mattress, foot
  // band, pillow, and (asleep) sleeper, so a Double reads as two real beds.
  const bed = (bx: number, bw: number, pillows: number, sleeper: number) => {
    ctx.fillStyle = "#5A3F2C"; // headboard
    ctx.fillRect(bx, bedTop - 2, 3, 11);
    ctx.fillStyle = "#E8E2D2"; // mattress
    ctx.fillRect(bx + 3, bedTop, bw - 3, 9);
    ctx.fillStyle = shade(PAL.brass, 10); // foot band
    ctx.fillRect(bx + 3, bedTop + 6, bw - 3, 1);
    ctx.fillStyle = "#FBF7EC"; // pillow(s)
    ctx.fillRect(bx + 4, bedTop + 1, Math.max(4, Math.round(bw * 0.22)), 3);
    if (pillows >= 2) ctx.fillRect(bx + 4, bedTop + 5, Math.max(3, Math.round(bw * 0.18)), 2);
    if (asleep && sleeper < u.occupants) {
      ctx.fillStyle = "#6677BB"; // blanket
      ctx.fillRect(bx + 4 + Math.round(bw * 0.2), bedTop + 2, Math.round(bw * 0.6), 5);
      ctx.fillStyle = SKIN[(u.id + sleeper) % SKIN.length];
      ctx.fillRect(bx + 5, bedTop + 1, 3, 3);
    } else if (dirty) {
      ctx.fillStyle = "#B8A98A"; // rumpled bedding
      ctx.fillRect(bx + 4, bedTop + 1, Math.round(bw * 0.8), 6);
    }
  };
  // Bed positions per grade, in unmirrored room coordinates.
  const beds: { bx: number; bw: number; pillows: number }[] = [];
  if (grade === 1) {
    beds.push({ bx: x + 6, bw: Math.min(Math.round(w * 0.5), 24), pillows: 1 });
  } else if (grade === 2) {
    // Two beds with a REAL gap; two mattresses touching read as one long bed.
    const bw = Math.min(Math.round((w - 26) / 2), 24);
    beds.push({ bx: x + 6, bw, pillows: 1 });
    beds.push({ bx: x + 6 + bw + 8, bw, pillows: 1 });
  } else {
    // Suite: the sitting area owns the left third, a wide two-pillow bed the rest.
    const sofaW = Math.min(Math.round(w * 0.2), 18);
    beds.push({ bx: x + sofaW + 14, bw: Math.min(Math.round(w * 0.42), 40), pillows: 2 });
  }
  maybeMirrored(ctx, flip, x, w, () => {
    if (grade === 3) {
      const sofaW = Math.min(Math.round(w * 0.2), 18);
      ctx.fillStyle = "#7C5A6A"; // sitting area
      ctx.fillRect(x + 5, floorY - 6, sofaW, 6);
      ctx.fillStyle = "#8C6A7A";
      ctx.fillRect(x + 5, floorY - 9, sofaW, 3);
      ctx.fillStyle = "#7A6A50"; // floor lamp beside the sofa
      ctx.fillRect(x + sofaW + 8, floorY - 12, 2, 12);
      ctx.fillStyle = lit ? "#F0D890" : "#9a8f70";
      ctx.fillRect(x + sofaW + 6, floorY - 14, 6, 3);
    }
    beds.forEach((b, i) => bed(b.bx, b.bw, b.pillows, i));
    if (grade === 2) {
      // Shared nightstand between the two beds.
      const gapX = beds[0].bx + beds[0].bw + 2;
      ctx.fillStyle = "#6A4A30";
      ctx.fillRect(gapX, floorY - 5, 4, 5);
    }
  });
  // State cues and their nightstand anchor draw OUTSIDE the mirror so they
  // render pixel-identical on flipped rooms (Sally's rule: variation never
  // touches a state cue). asleep/dirty are exclusive unit states.
  ctx.fillStyle = "#6A4A30"; // nightstand
  ctx.fillRect(x + w - 6, floorY - 6, 4, 6);
  if (dirty) {
    ctx.fillStyle = "#D4623A"; // housekeeping tray by the nightstand
    ctx.fillRect(x + w - 6, floorY - 9, 4, 3);
  } else if (lit) {
    ctx.fillStyle = "#FFD86A"; // ready: lamp on
    ctx.fillRect(x + w - 5, floorY - 11, 2, 5);
  }
  if (asleep) {
    // The "z" is text, so it draws OUTSIDE the mirror wrapper at a computed
    // position (mirrored text would render backward), floating over the first
    // occupied bed.
    const zSrc = beds[0].bx + 8;
    const zx = flip ? 2 * x + w - zSrc - 5 : zSrc;
    ctx.fillStyle = "rgba(210,220,255,0.9)";
    ctx.font = "8px system-ui, sans-serif";
    ctx.fillText("z", zx, bedTop - 1);
  }
}
