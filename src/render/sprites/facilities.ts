import type { Unit } from "../../engine/types";
import { person, SKIN } from "../pixelSprites";
import { ACCENTS, rand, scatterPeople, serviceBack, serviceLabel, type DrawCtx } from "./common";

// ---- Entertainment ------------------------------------------------------

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

// ---- Services -----------------------------------------------------------

export function drawSecurity(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  serviceBack(ctx, x, y, w, h, "#3f5f8f");
  // Guard desk + monitors + a badge star.
  const fy = y + h - 8;
  ctx.fillStyle = "#2a3a55";
  ctx.fillRect(x + 4, fy + 2, w - 8, 4);
  for (let mx = x + 6; mx + 4 < x + w - 4; mx += 8) {
    ctx.fillStyle = "#6bd47a";
    ctx.fillRect(mx, fy - 2, 4, 3);
  }
  // Seated guard behind the desk.
  person(ctx, x + 7, fy + 6, 1.2, x | 0, true);
  // Badge.
  star(ctx, x + 11, y + 9, 4, "#ffd24a");
  serviceLabel(ctx, "SECURITY", x + 18, y, "#dfe6f2", 44, w);
}

export function drawMedical(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  serviceBack(ctx, x, y, w, h, "#e6eaf2");
  // Red cross.
  ctx.fillStyle = "#d6342f";
  const cx = x + 11,
    cy = y + h / 2;
  ctx.fillRect(cx - 5, cy - 2, 10, 4);
  ctx.fillRect(cx - 2, cy - 5, 4, 10);
  // Beds with a resting patient + a standing nurse.
  for (let bx = x + 24; bx + 8 < x + w - 3; bx += 16) {
    ctx.fillStyle = "#cfd6e0";
    ctx.fillRect(bx, y + h - 8, 11, 5);
    ctx.fillStyle = "#9fb0c4";
    ctx.fillRect(bx, y + h - 8, 3, 5);
    ctx.fillStyle = SKIN[bx % SKIN.length];
    ctx.fillRect(bx + 8, y + h - 7, 2, 2); // patient head
    person(ctx, bx - 4, y + h - 3, 1.2, (bx + 3) | 0); // nurse
  }
  serviceLabel(ctx, "CLINIC", x + 22, y, "#2a3550", 60, w);
}

export function drawHousekeeping(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  serviceBack(ctx, x, y, w, h, "#bcd2bc");
  // Cleaning cart with towels + a mop.
  const fy = y + h - 9;
  ctx.fillStyle = "#7a8f7a";
  ctx.fillRect(x + 5, fy + 2, 12, 5);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 6, fy, 4, 3);
  ctx.fillStyle = "#cfe0ff";
  ctx.fillRect(x + 11, fy, 4, 3);
  // Mop handle.
  ctx.fillStyle = "#8a5a30";
  ctx.fillRect(x + 20, fy - 3, 1, 9);
  ctx.fillStyle = "#e8e0b0";
  ctx.fillRect(x + 18, fy + 5, 5, 2);
  // A housekeeper by the cart.
  person(ctx, x + 24, y + h - 3, 1.2, (x + 9) | 0);
  serviceLabel(ctx, "HOUSEKEEPING", x + 32, y, "#2a3a2a", 60, w);
}

export function drawRecycling(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  serviceBack(ctx, x, y, w, h, "#7f9f5f");
  // Three recycling bins.
  const colors = ["#3a7f3a", "#3a6faf", "#caa42e"];
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = colors[i];
    ctx.fillRect(x + 6 + i * 9, y + h - 9, 7, 6);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(x + 6 + i * 9, y + h - 9, 7, 1);
  }
  // Recycling arrows (simple triangle loop).
  ctx.strokeStyle = "#1b2a14";
  ctx.lineWidth = 1.5;
  const cx = x + Math.min(w - 12, 40),
    cy = y + h / 2 - 1,
    r = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 1.4);
  ctx.stroke();
  // A plant worker.
  person(ctx, x + Math.min(w - 16, 30), y + h - 3, 1.2, (x + 5) | 0);
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const px = cx + Math.cos(ang) * rad;
    const py = cy + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

export function drawMetro(d: DrawCtx, x: number, y: number, w: number, h: number) {
  const ctx = d.ctx;
  // Static station only — the train is a separate Excalibur Actor that the
  // engine slides along the platform (see drawMetroTrain / TowerEngine).
  ctx.fillStyle = "#2c3a44";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#33434f";
  ctx.fillRect(x, y, w, Math.max(2, h * 0.45)); // tiled upper wall
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  for (let tx = x + 6; tx < x + w; tx += 12) ctx.fillRect(tx, y + 2, 1, h * 0.4);
  // Platform.
  const platY = y + h - 6;
  ctx.fillStyle = "#5a6470";
  ctx.fillRect(x, platY, w, 6);
  ctx.fillStyle = "#caa84a"; // safety line
  ctx.fillRect(x, platY, w, 1);
  // A few commuters waiting on the platform.
  scatterPeople(ctx, x + 8, x + w - 6, 13, platY, 1.2);
  // Roundel "M" sign.
  ctx.fillStyle = "#d6342f";
  ctx.beginPath();
  ctx.arc(x + 10, y + 8, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 8px system-ui, sans-serif";
  ctx.fillText("M", x + 7, y + 11);
  ctx.fillStyle = "#ffd24a";
  ctx.font = "8px system-ui, sans-serif";
  ctx.fillText("METRO", x + 18, y + 10);
}

/** The subway carriage graphic, drawn at (0,0) into a w×9 rect. It is its own
 *  Excalibur Actor; the engine slides it in and out along the platform. */
export function drawMetroTrain(ctx: CanvasRenderingContext2D, w: number, headlightOn: boolean): void {
  ctx.fillStyle = "#cdd3da"; // silver carriage
  ctx.fillRect(0, 0, w, 9);
  ctx.fillStyle = "#e0454a"; // livery stripe
  ctx.fillRect(0, 6, w, 2);
  ctx.fillStyle = "#3a4250"; // window band
  for (let wx = 4; wx + 5 < w; wx += 9) ctx.fillRect(wx, 2, 5, 3);
  ctx.fillStyle = headlightOn ? "#ffe27a" : "#9fc0ff"; // headlight blink
  ctx.fillRect(1, 3, 2, 2);
}

export function drawParking(ctx: CanvasRenderingContext2D, u: Unit, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#454a52";
  ctx.fillRect(x, y + 2, w, h - 5);
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1;
  for (let lx = x + 8; lx < x + w; lx += 12) {
    ctx.beginPath();
    ctx.moveTo(lx, y + 4);
    ctx.lineTo(lx, y + h - 4);
    ctx.stroke();
  }
  // A couple of parked cars in varied colors.
  for (let cx = x + 2; cx + 9 < x + w; cx += 12) {
    if (rand((u.id + cx) | 0) > 0.5) continue;
    ctx.fillStyle = ACCENTS[(u.id + cx) % ACCENTS.length];
    ctx.fillRect(cx, y + h - 8, 9, 4);
    ctx.fillStyle = "#1b1f2a";
    ctx.fillRect(cx + 1, y + h - 4, 2, 2);
    ctx.fillRect(cx + 6, y + h - 4, 2, 2);
  }
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
