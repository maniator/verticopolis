import type { UnitView } from "../../../simport/view";
import { visibleOccupants } from "../../../engine/Crowd";
import { shade, type DrawCtx } from "../common";
import { personSeated, personStanding } from "../../pixelSprites/common";
import { layerBreak } from "../../pixelSprites/layers";

/**
 * The event venues: the party hall and the aquatic center. The wedding hall
 * lives in `weddingHall.ts`.
 */

/**
 * The two-floor function hall (catalog `floors: 2`, an 88px rect): a warm gold
 * and wine-red room with tall draped arched windows, chandeliers and a
 * string-light banner, a stage with a mirror ball and DJ, a checker dance
 * floor, and a long banquet table. Ported one rectangle at a time from the
 * committed reference draw code (page-03 `party`). The dancers (standing build),
 * the DJ and banquet guests (seated build) fill in seed order up to the hall's
 * occupant count, so an empty hall draws none and a full one fills; the seeded
 * ghost crowd this replaced is gone for good. Static fills only, no `d.anim` read; the
 * seed is geography so a TDT id renumber does not reshuffle the guests.
 */
export function drawPartyHall(d: DrawCtx, u: UnitView, x: number, y: number, w: number, h: number) {
  const ctx = d.ctx;
  const f = (bx: number, by: number, bw: number, bh: number, c: string, o = 1) => {
    ctx.fillStyle = c;
    if (o !== 1) ctx.globalAlpha = o;
    ctx.fillRect(Math.round(x + bx), Math.round(y + by), Math.max(1, Math.round(bw)), Math.max(1, Math.round(bh)));
    if (o !== 1) ctx.globalAlpha = 1;
  };
  const glow = (cx: number, cy: number, c: string) => {
    for (const [s, a] of [[4, 0.1], [3, 0.16], [2, 0.3], [1, 0.6]] as const) f(cx - s, cy - s, s * 2, s * 2, c, a);
  };
  const box = (bx: number, by: number, bw: number, bh: number, b: string) => {
    f(bx, by + bh, bw, 1, "#000000", 0.18);
    f(bx, by, bw, bh, b);
    f(bx, by, bw, 1, shade(b, 22));
    f(bx, by, 1, bh, shade(b, 12));
    f(bx + bw - 1, by, 1, bh, shade(b, -16));
    f(bx, by + bh - 1, bw, 1, shade(b, -22));
  };
  const twall = (bx: number, by: number, bw: number, bh: number, b: string) => {
    f(bx, by, bw, bh, b);
    f(bx, by, bw, Math.round(bh * 0.4), shade(b, 8));
    for (let py = by + 3; py < by + bh; py += 6) f(bx, py, bw, 1, shade(b, -8), 0.5);
    for (let dx = bx + 4, i = 0; dx < bx + bw; dx += 8, i++) for (let dy = by + 5 + (i % 2) * 3; dy < by + bh - 2; dy += 6) f(dx, dy, 1, 1, shade(b, 13), 0.5);
  };
  // Honest occupancy: dancers (standing), the DJ and banquet guests (seated)
  // fill in seed order up to the hall's occupant count; an empty hall draws
  // none. `visibleOccupants` is the people-system's canonical figure count; for
  // an attendance venue it equals `u.occupants` (only a meal trip's ORIGIN room
  // carries `outForMeal`, and these are destinations), so this matches the
  // spec's Always-rule without changing what draws. Both its inputs are already
  // bake-signature inputs, so no new signature input is needed.
  const n = visibleOccupants(u);
  const geoSeed = (u.floor * 131 + u.x * 17) | 0;
  let filled = 0;
  const seated = (px: number, footY: number) => { if (filled < n) personSeated(ctx, Math.round(x + px), Math.round(y + footY), geoSeed + filled++); };
  const standing = (px: number, footY: number) => { if (filled < n) personStanding(ctx, Math.round(x + px), Math.round(y + footY), geoSeed + filled++); };

  const fy = h - 6, railY = 52;
  twall(0, 0, w, fy, "#3A2A44");
  f(0, railY, w, fy - railY, "#4A2A3A"); // wine-red carpet
  f(0, fy, w, h - fy, "#2A1A22"); f(0, fy, w, 1, "#5A3A48"); // floor base fills the last rows to the full rect height
  f(0, 0, w, 2, "#241830"); f(0, 2, w, 1, "#5A4468");
  // Tall draped arched windows.
  for (let wx = 10; wx + 22 < w; wx += 44) {
    box(wx, 8, 22, railY - 14, "#1A2440");
    for (let i = 0; i < 3; i++) f(wx + 2, 10 + i * Math.round((railY - 18) / 3), 18, Math.round((railY - 20) / 3), ["#2A3A6A", "#20305A", "#18264A"][i]);
    for (let dx = wx + 3; dx < wx + 20; dx += 5) f(dx, 10, 1, railY - 16, "#F3D08A", 0.5);
    f(wx - 2, 7, 4, railY - 12, "#7A3A5A"); f(wx + 20, 7, 4, railY - 12, "#7A3A5A"); f(wx - 2, 6, 26, 2, "#8A4A6A");
  }
  // Warm gold chandeliers.
  [Math.round(w * 0.3), Math.round(w * 0.7)].forEach((cxN) => {
    f(cxN - 1, 2, 2, 5, "#C9A24B"); f(cxN - 8, 7, 16, 2, "#C9A24B");
    [-6, -2, 2, 6].forEach((o) => { f(cxN + o, 9, 1, 2, "#F8E2B4"); glow(cxN + o, 10, "#F8E2B4"); });
    glow(cxN, 10, "#FFE69A");
  });
  // String-light banner.
  for (let bx = 0; bx < w; bx += 10) f(bx, railY - 3, 5, 3, ["#E07A9A", "#7FB0E8", "#E8C14A", "#8FD0A0"][(bx / 10) % 4 | 0]);
  f(0, railY - 4, w, 1, "#C9A24B");
  layerBreak(ctx); // the shell ends; the stage, dance floor, table and guests follow
  // Stage with a mirror ball, colored spotlights, and a DJ (seated occupant).
  const stW = Math.round(w * 0.24);
  box(4, fy - 16, stW, 16, "#2A1F3A"); f(4, fy - 16, stW, 1, "#4A3A5A");
  f(Math.round(stW / 2), railY + 2, 1, 4, "#8A8A92"); f(Math.round(stW / 2) - 2, railY + 6, 5, 5, "#CDD6E6"); f(Math.round(stW / 2) - 1, railY + 7, 3, 3, "#FFFFFF", 0.6);
  ["#E85D5D", "#5db4e8", "#6bd47a"].forEach((c, i) => { f(8 + i * (stW / 3), railY + 8, 3, fy - 16 - (railY + 8), c, 0.28); });
  f(Math.round(stW / 2) - 4, fy - 24, 9, 3, "#3A3E4A"); // DJ console (stage furniture, always drawn)
  seated(Math.round(stW / 2) - 3, fy - 16);
  // Checker dance floor with dancing guests (standing build).
  const dfx = stW + 8, dfw = Math.round(w * 0.3);
  for (let px = dfx; px < dfx + dfw; px += 6) f(px + ((((px - dfx) / 6) | 0) % 2 ? 3 : 0), fy - 1, 3, 1, "#5A4A6E");
  for (let dx = dfx + 2; dx + 6 < dfx + dfw; dx += 11) standing(dx, fy);
  // Long banquet table with a light cloth and seated guests.
  const tx = dfx + dfw + 10, tw = w - tx - 6;
  f(tx, fy, tw, 1, "#000000", 0.2); box(tx, fy - 9, tw, 4, "#C9A24B"); f(tx, fy - 9, tw, 4, "#F0ECE0"); f(tx, fy - 9, tw, 1, "#FFFFFF"); f(tx, fy - 5, tw, 1, "#DCD6C6");
  for (let px = tx + 5; px < tx + tw - 3; px += 12) { f(px, fy - 11, 3, 2, "#E07A9A"); f(px + 1, fy - 13, 1, 2, "#4A7A4A"); }
  for (let px = tx + 2; px < tx + tw - 2; px += 6) f(px, fy - 8, 2, 1, "#FFFFFF");
  for (let sx = tx + 2; sx + 6 < tx + tw; sx += 13) { f(sx, fy - 14, 4, 5, "#5A3A5A"); seated(sx, fy); }
}

/**
 * The two-story Aquatic Center (catalog `floors: 2`, an 88px rect): a bright,
 * tiled pool hall lit by a row of skylights, with an upper diving platform and a
 * big lane pool below. Swimmers (standing build, waist-deep once the water layer
 * is drawn over them) and deck-chair loungers (seated build) fill in seed order
 * up to the venue's live attendee count (`u.occupants`, the attendance mirror),
 * so an empty pool draws none and a busy one fills. Static fills only, no `d.anim`
 * read; the seed is geography so a TDT id renumber does not reshuffle the crowd.
 */
export function drawAquaticCenter(d: DrawCtx, u: UnitView, x: number, y: number, w: number, h: number) {
  const ctx = d.ctx;
  const f = (bx: number, by: number, bw: number, bh: number, c: string, o = 1) => {
    ctx.fillStyle = c;
    if (o !== 1) ctx.globalAlpha = o;
    ctx.fillRect(Math.round(x + bx), Math.round(y + by), Math.max(1, Math.round(bw)), Math.max(1, Math.round(bh)));
    if (o !== 1) ctx.globalAlpha = 1;
  };
  const n = visibleOccupants(u);
  const geoSeed = (u.floor * 131 + u.x * 17) | 0;
  let filled = 0;
  const swim = (px: number, footY: number) => { if (filled < n) personStanding(ctx, Math.round(x + px), Math.round(y + footY), geoSeed + filled++); };
  const lounge = (px: number, footY: number) => { if (filled < n) personSeated(ctx, Math.round(x + px), Math.round(y + footY), geoSeed + filled++); };

  const WALL = "#2A5A66", WATER = "#2FA8C8", WATERLT = "#6FD6E4", DECK = "#D8E4E0";
  const fy = h - 6;
  // Aqua-tiled back wall with a faint tile grid.
  f(0, 0, w, fy, WALL); f(0, 0, w, 2, shade(WALL, 18));
  for (let ty = 7; ty < fy; ty += 7) f(0, ty, w, 1, shade(WALL, -12), 0.5);
  for (let tx = 8; tx < w; tx += 8) f(tx, 0, 1, fy, shade(WALL, -12), 0.4);
  // A row of skylights along the top.
  for (let wx = 6; wx + 14 < w; wx += 20) {
    f(wx, 4, 14, 11, "#BFE0EA"); f(wx, 4, 14, 1, "#FFFFFF", 0.6);
    for (let i = 1; i < 3; i++) f(wx + Math.round((i * 14) / 3), 4, 1, 11, shade("#BFE0EA", -16));
  }
  // The floor slab between the two stories, and a diving tower on the right.
  const midY = Math.round(h * 0.42);
  f(0, midY, w, 2, DECK); f(0, midY, w, 1, "#FFFFFF", 0.5);
  const dvX = w - 9;
  f(dvX, midY - 16, 2, 16, "#9AA6AA"); f(dvX - 9, midY - 16, 11, 2, "#EEF3F5"); // ladder + board
  // Poolside deck band, then the lane pool sunk into the lower story.
  f(0, midY + 2, w, 5, DECK);
  const poolTop = midY + 7, poolBot = fy - 1;
  f(3, poolTop, w - 6, poolBot - poolTop, WATER); f(3, poolTop, w - 6, 1, WATERLT);
  swim(dvX - 6, midY - 16); // a diver waiting on the board
  // Swimmers standing on the pool floor, drawn BEFORE the water overlay so it
  // covers their legs and they read as waist-deep.
  for (let sx = 7; sx + 3 < w - 6; sx += 7) swim(sx, poolBot - 1);
  // A translucent water layer over the lower pool: tints the submerged bodies.
  f(3, poolTop + 3, w - 6, poolBot - poolTop - 3, WATER, 0.55);
  // Lane ropes (dashed) and surface ripples on top.
  for (let ly = poolTop + 2; ly < poolBot - 1; ly += 4) for (let lx = 5; lx < w - 6; lx += 4) f(lx, ly, 2, 1, "#EAF6F8", 0.45);
  for (let rx = 6; rx < w - 6; rx += 5) f(rx, poolTop + 1 + ((rx >> 1) & 3), 3, 1, WATERLT, 0.5);
  // The shell ends: the diver on the board and the swimmers in the pool stay
  // with it, so only the deck-chair loungers come forward. The water, ropes
  // and ripples draw before the loungers, which sit on the deck above the
  // first pool row, so the order changes no pixel; the diver, swimmers and
  // loungers still fill in that order.
  layerBreak(ctx);
  // Deck-chair loungers along the poolside band.
  for (let lx = 5; lx + 5 < w - 4; lx += 11) { f(lx, midY + 3, 7, 2, "#E0A85A"); lounge(lx + 1, midY + 5); }
}
