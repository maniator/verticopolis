import { ACCENTS, scatterPeople } from "../common";

/**
 * The event venues: the party hall and the wedding hall. Extracted verbatim
 * from `facilities.ts`.
 */

export function drawPartyHall(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#2a1f3a";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#3a2f4a"; // dance floor
  ctx.fillRect(x, y + h - 5, w, 5);
  // Colored spotlights washing the floor.
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = ACCENTS[i % ACCENTS.length];
    ctx.globalAlpha = 0.4;
    ctx.fillRect(x + 6 + i * (w / 6), y + 3, 3, h - 8);
  }
  ctx.globalAlpha = 1;
  // Mirror ball.
  ctx.fillStyle = "#cdd6e6";
  ctx.beginPath();
  ctx.arc(x + w / 2, y + 7, 3, 0, Math.PI * 2);
  ctx.fill();
  // Dancers.
  scatterPeople(ctx, x + 8, x + w - 5, 11, y + h - 3, 1.3);
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
