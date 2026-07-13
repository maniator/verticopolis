import type { DrawCtx } from "../common";

/**
 * Raw structural and damage shells: the bare floor slab, the under-construction
 * scaffold, and the burned-out shell and flames. Extracted verbatim from
 * `structure.ts`.
 */

export function drawFloor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#8c8676";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#9b9685";
  ctx.fillRect(x, y + 2, w, h - 5);
  ctx.fillStyle = "#6f6a5c";
  ctx.fillRect(x, y + h - 3, w, 3);
  ctx.fillStyle = "rgba(0,0,0,0.06)";
  for (let gx = x; gx < x + w; gx += 9) ctx.fillRect(gx, y + 2, 1, h - 5);
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
