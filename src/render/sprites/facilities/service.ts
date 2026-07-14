import type { Unit } from "../../../engine/types";
import { person, SKIN } from "../../pixelSprites";
import { ACCENTS, rand, scatterPeople, serviceBack, serviceLabel, type DrawCtx } from "../common";

/**
 * In-tower service facilities: security, the clinic, housekeeping, the
 * recycling center, the metro station, and the parking spaces/ramp. Extracted
 * verbatim from `facilities.ts`.
 */

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

export function drawRecycling(d: DrawCtx, u: Unit, x: number, y: number, w: number, h: number) {
  const ctx = d.ctx;
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
  // The day's garbage, piling up rightward until the morning truck (canon:
  // the center visibly fills; a tower over capacity overflows before dusk).
  const fill = Math.max(0, Math.min(1, d.recycleFill ?? 0));
  const pileX0 = x + 36;
  const pileW = Math.max(0, w - 44);
  const bags = Math.round(fill * Math.floor(pileW / 7));
  for (let i = 0; i < bags; i++) {
    const bx = pileX0 + i * 7;
    const jitter = Math.floor(rand((u.id * 31 + i) | 0) * 3);
    // Bottom-row bag (dark sack with a highlight tie).
    ctx.fillStyle = i % 3 === 2 ? "#4a5a3a" : "#3a4232";
    ctx.fillRect(bx, y + h - 8 - jitter, 6, 6 + jitter);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(bx + 2, y + h - 9 - jitter, 2, 2);
    // A second row stacks up as the center passes half full.
    if (fill > 0.5 && i % 2 === 0 && i < bags - 1) {
      ctx.fillStyle = "#2f3628";
      ctx.fillRect(bx + 3, y + h - 13 - jitter, 6, 5);
    }
  }
  // Wall gauge: how full the plant is (green → amber → red), so the fill reads
  // even when the pile is hard to see at zoom.
  const gx = x + w - 6;
  const gh = h - 14;
  ctx.fillStyle = "#1b2a14";
  ctx.fillRect(gx, y + 6, 4, gh);
  ctx.fillStyle = fill >= 1 ? "#d6342f" : fill > 0.7 ? "#e0a94e" : "#6bd47a";
  const fh = Math.round(gh * fill);
  ctx.fillRect(gx + 1, y + 6 + gh - fh, 2, fh);
  if (fill >= 1) serviceLabel(ctx, "FULL", x + w - 34, y, "#ffd2c8", 44, w);
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
  // engine slides along the platform (see drawMetroTrain in vehicles.ts /
  // TowerEngine).
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

export function drawParking(d: DrawCtx, u: Unit, x: number, y: number, w: number, h: number) {
  const ctx = d.ctx;
  // Garage concrete: deck, ceiling beam and a service pipe running the span.
  ctx.fillStyle = "#454a52";
  ctx.fillRect(x, y + 2, w, h - 5);
  ctx.fillStyle = "#383c44";
  ctx.fillRect(x, y + 2, w, 3); // ceiling beam
  ctx.fillStyle = "#5a6068";
  ctx.fillRect(x, y + 6, w, 1); // pipe
  ctx.fillStyle = "#3c4048";
  ctx.fillRect(x, y + h - 4, w, 2); // deck edge
  // One space = ONE stall (canon: a Parking Space is a single spot, not a lot).
  // Frame the stall with two divider lines just inside the module edges, drawn
  // relative to `w` so a legacy 6-wide unit and a canon 4-wide unit both read as
  // a single bay.
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1;
  for (const lx of [x + 1.5, x + w - 1.5]) {
    ctx.beginPath();
    ctx.moveTo(lx, y + h - 14);
    ctx.lineTo(lx, y + h - 4);
    ctx.stroke();
  }
  // A single car, centered, shown only when this space actually holds one
  // (office cars by day, suite guests' overnight — see Simulation.parkingUsage).
  // A stable per-space roll vs the tower-wide usage fraction keeps the same
  // spaces filling first as the lot loads; a dead (unchained) space never shows
  // a car — none could ever have driven to it.
  const use = d.parkingDead ? 0 : (d.parkingUse ?? 0);
  if (rand((u.id * 31) | 0) < use) {
    const cw = Math.min(9, w - 4);
    const cx = x + Math.round((w - cw) / 2); // integer x so the car stays crisp (no half-pixel blur)
    ctx.fillStyle = ACCENTS[u.id % ACCENTS.length];
    ctx.fillRect(cx, y + h - 9, cw, 4); // body
    ctx.fillRect(cx + 2, y + h - 11, Math.max(1, cw - 4), 3); // cabin
    ctx.fillStyle = "#cfe4ff";
    ctx.fillRect(cx + 3, y + h - 10, Math.max(1, cw - 6), 2); // window
    ctx.fillStyle = "#1b1f2a";
    ctx.fillRect(cx + 1, y + h - 5, 2, 2); // wheels
    ctx.fillRect(cx + cw - 3, y + h - 5, 2, 2);
  }
}

export function drawParkingRamp(ctx: CanvasRenderingContext2D, u: Unit, x: number, y: number, w: number, h: number) {
  // Garage concrete backdrop, matching the spaces so a ramp reads as part of
  // the same deck.
  ctx.fillStyle = "#454a52";
  ctx.fillRect(x, y + 2, w, h - 5);
  ctx.fillStyle = "#383c44";
  ctx.fillRect(x, y + 2, w, 3);
  ctx.fillStyle = "#3c4048";
  ctx.fillRect(x, y + h - 4, w, 2);
  // The ramp slab, descending across the unit (cars change floors here).
  ctx.fillStyle = "#5a6068";
  ctx.beginPath();
  ctx.moveTo(x + 2, y + 6);
  ctx.lineTo(x + w - 2, y + h - 4);
  ctx.lineTo(x + w - 2, y + h - 1);
  ctx.lineTo(x + 2, y + 10);
  ctx.closePath();
  ctx.fill();
  // Hazard chevrons along the slab edge.
  ctx.strokeStyle = "#e8c14a";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    const px = x + 4 + t * (w - 10);
    const py = y + 7 + t * (h - 11);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + 4, py + 2);
    ctx.stroke();
  }
  // Support column + the blue "P" garage roundel.
  ctx.fillStyle = "#383c44";
  ctx.fillRect(x + 4, y + 5, 3, h - 9);
  ctx.fillStyle = "#2a5aa8";
  ctx.fillRect(x + 9, y + 5, 9, 9);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 8px system-ui, sans-serif";
  ctx.fillText("P", x + 11.5, y + 12.5);
  void u;
}
