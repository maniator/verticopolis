import type { DrawCtx } from "../common";
import { shade } from "../common";

/**
 * Raw structural and damage shells: the bare floor slab, the under-construction
 * scaffold, and the burned-out shell and flames. Extracted verbatim from
 * `structure.ts`.
 */

/**
 * The bare deck of a built-but-empty floor or corridor: a warm banded slab
 * (dark ceiling strip up top, a mid slab band, a dark base band) with faint
 * grout ticks, ported from page-05's `floorTile`. Drawn in horizontal strips
 * so a mobile GPU never sees one full-height fill on a tall run, and keyed on
 * nothing but the rect (baked `cache: true` into `floorGfx`). Integer pixels.
 */
export function drawFloor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const ww = Math.max(1, Math.round(w));
  const hh = Math.max(1, Math.round(h));
  // Warm base wash for the whole tile (a small per-tile fill, not a monolith).
  ctx.fillStyle = "#B7B0A0";
  ctx.fillRect(x0, y0, ww, hh);
  // Ceiling strip and its seam along the top band. Bounded to the tile height
  // so a degenerate (very short) rect never paints past the tile.
  const ceil = Math.min(hh, Math.max(3, Math.round(hh * 0.11)));
  ctx.fillStyle = "#8A8478";
  ctx.fillRect(x0, y0, ww, ceil);
  ctx.fillStyle = "#6E6A60";
  if (ceil < hh) ctx.fillRect(x0, y0 + ceil, ww, 1); // seam only when it lands inside the tile
  // Faint ceiling texture ticks.
  ctx.fillStyle = "#7A7468";
  for (let px = x0; px < x0 + ww; px += 8) ctx.fillRect(px, y0 + 1, 2, Math.min(3, ceil - 1));
  // Floor slab band across the bottom, with a polished top edge and dark base.
  // Bounded to the tile height so `fy` can never rise above `y0`.
  const slabH = Math.min(hh, Math.max(4, Math.round(hh * 0.23)));
  const fy = y0 + hh - slabH;
  const slab = "#9A9486";
  ctx.fillStyle = slab;
  ctx.fillRect(x0, fy, ww, slabH);
  ctx.fillStyle = shade(slab, 18);
  ctx.fillRect(x0, fy, ww, 1);
  ctx.fillStyle = shade(slab, -24);
  ctx.fillRect(x0, y0 + hh - 1, ww, 1);
  // Baseboard band where the wall meets the slab, with wall-base ticks above
  // it. Only when there is room above the slab, so the band and its ticks stay
  // inside the tile on a short rect.
  if (fy - 4 >= y0) {
    ctx.fillStyle = "#8A8478";
    ctx.fillRect(x0, fy - 2, ww, 2);
    ctx.fillStyle = "#7E786C";
    for (let px = x0 + 4; px < x0 + ww; px += 12) ctx.fillRect(px, fy - 4, 2, 4);
  }
  // Faint grout ticks down the slab so the deck reads tiled, not poured.
  ctx.fillStyle = "rgba(0,0,0,0.06)";
  const groutH = Math.max(0, slabH - 2); // never negative on a degenerate short rect
  for (let gx = x0 + 5; gx < x0 + ww; gx += 9) ctx.fillRect(gx, fy + 1, 1, groutH);
}

export function drawConstruction(d: DrawCtx, x: number, y: number, w: number, h: number) {
  const ctx = d.ctx;
  // Bare concrete shell.
  ctx.fillStyle = "#6f6a5e";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#5c574c";
  ctx.fillRect(x, y, w, 2);
  // Yellow/black hazard band along the floor.
  for (let hx = x; hx < x + w; hx += 8) {
    ctx.fillStyle = (Math.floor(hx / 8) % 2) === 0 ? "#e8c14a" : "#2a2a2a";
    ctx.fillRect(hx, y + h - 4, 4, 4);
  }
  // Scaffolding poles and cross-braces.
  ctx.strokeStyle = "rgba(220,220,230,0.55)";
  ctx.lineWidth = 1;
  for (let sx = x + 6; sx < x + w - 2; sx += 14) {
    ctx.beginPath();
    ctx.moveTo(sx, y + 2);
    ctx.lineTo(sx, y + h - 4);
    ctx.moveTo(sx, y + h - 4);
    ctx.lineTo(sx + 14, y + 2);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(220,220,230,0.4)";
  ctx.beginPath();
  ctx.moveTo(x + 2, y + h / 2);
  ctx.lineTo(x + w - 2, y + h / 2);
  ctx.stroke();
  // A little crane hook swinging on the global clock.
  const hookX = x + 8 + (Math.sin(d.anim) * 0.5 + 0.5) * Math.max(0, w - 16);
  ctx.strokeStyle = "#caa84a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(hookX, y - 2);
  ctx.lineTo(hookX, y + h * 0.4);
  ctx.stroke();
  ctx.fillStyle = "#caa84a";
  ctx.fillRect(hookX - 2, y + h * 0.4, 4, 3);
}

/** Charred interior behind the flames of a burning unit. */
export function drawBurntShell(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#241c18";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#3a2a20";
  ctx.fillRect(x, y + h - 4, w, 4);
  // Smoke smudges up the back wall.
  ctx.fillStyle = "rgba(20,16,14,0.55)";
  for (let sx = x + 3; sx < x + w - 2; sx += 11) ctx.fillRect(sx, y, 5, h - 4);
}

/** Animated flames licking up from the floor of a burning unit. */
export function drawFlames(d: DrawCtx, x: number, y: number, w: number, h: number) {
  const ctx = d.ctx;
  const base = y + h - 3;
  for (let fx = x + 2; fx < x + w - 2; fx += 6) {
    const phase = d.anim * 6 + fx * 0.7;
    const flame = (Math.sin(phase) * 0.5 + 0.5) * (h * 0.55) + h * 0.3;
    // Outer orange tongue.
    ctx.fillStyle = "#e8631e";
    ctx.beginPath();
    ctx.moveTo(fx, base);
    ctx.lineTo(fx + 3, base - flame);
    ctx.lineTo(fx + 6, base);
    ctx.closePath();
    ctx.fill();
    // Inner yellow core.
    ctx.fillStyle = "#ffd23a";
    ctx.beginPath();
    ctx.moveTo(fx + 1.5, base);
    ctx.lineTo(fx + 3, base - flame * 0.6);
    ctx.lineTo(fx + 4.5, base);
    ctx.closePath();
    ctx.fill();
  }
  // Ember glow wash.
  ctx.fillStyle = "rgba(232,99,30,0.18)";
  ctx.fillRect(x, y, w, h);
}
