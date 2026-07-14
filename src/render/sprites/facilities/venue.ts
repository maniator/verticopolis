import type { Unit } from "../../../engine/types";
import { personSeated, personStanding } from "../../pixelSprites";
import { shade, type DrawCtx } from "../common";

/**
 * The event venues: the party hall and the wedding hall. Extracted verbatim
 * from `facilities.ts`.
 */

/**
 * The two-floor function hall (catalog `floors: 2`, an 88px rect): a warm gold
 * and wine-red room with tall draped arched windows, chandeliers and a
 * string-light banner, a stage with a mirror ball and DJ, a checker dance
 * floor, and a long banquet table. Ported one rectangle at a time from the
 * committed reference draw code (page-03 `party`). The dancers (standing build),
 * the DJ and banquet guests (seated build) fill in seed order up to the hall's
 * occupant count, so an empty hall draws none and a full one fills; this retires
 * the old `scatterPeople` ghost crowd. Static fills only, no `d.anim` read; the
 * seed is geography so a TDT id renumber does not reshuffle the guests.
 */
export function drawPartyHall(d: DrawCtx, u: Unit, x: number, y: number, w: number, h: number) {
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
  // none.
  const n = Math.max(0, u.occupants | 0);
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

export function drawWeddingHall(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  // Elegant pale hall.
  ctx.fillStyle = "#f5efe0";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#e7dcc2";
  ctx.fillRect(x, y + h - 5, w, 5); // carpet runner base
  // Rooftop pennant banners.
  for (let i = 0, bx = x + 6; bx < x + w - 4; bx += 12, i++) {
    ctx.fillStyle = ["#e07a9a", "#7fb0e8", "#e8c14a"][i % 3];
    ctx.beginPath();
    ctx.moveTo(bx, y);
    ctx.lineTo(bx + 5, y);
    ctx.lineTo(bx + 2.5, y + 5);
    ctx.closePath();
    ctx.fill();
  }
  // Grand arched doorway with a red carpet.
  const cx = x + w / 2;
  const archW = Math.min(w * 0.4, 30);
  ctx.fillStyle = "#cdb98a";
  ctx.beginPath();
  ctx.moveTo(cx - archW / 2, y + h - 5);
  ctx.lineTo(cx - archW / 2, y + h * 0.45);
  ctx.arc(cx, y + h * 0.45, archW / 2, Math.PI, 0);
  ctx.lineTo(cx + archW / 2, y + h - 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#caa84a"; // gilded doors
  ctx.fillRect(cx - archW / 2 + 2, y + h * 0.5, archW - 4, h * 0.5 - 7);
  ctx.fillStyle = "#b8243f"; // red carpet
  ctx.fillRect(cx - 4, y + h - 5, 8, 5);
  // Interlocking wedding rings above the arch.
  ctx.strokeStyle = "#e8c14a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx - 4, y + h * 0.28, 4, 0, Math.PI * 2);
  ctx.arc(cx + 4, y + h * 0.28, 4, 0, Math.PI * 2);
  ctx.stroke();
  // Topiary by the doors.
  ctx.fillStyle = "#5a8a4a";
  ctx.beginPath();
  ctx.arc(cx - archW / 2 - 5, y + h - 8, 4, 0, Math.PI * 2);
  ctx.arc(cx + archW / 2 + 5, y + h - 8, 4, 0, Math.PI * 2);
  ctx.fill();
}
