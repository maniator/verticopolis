import { FACILITIES, isElevatorKind } from "../engine/facilities";
import type { FacilityKind, Transport, Unit } from "../engine/types";
import { drawRoom, person, SKIN } from "./pixelSprites";
import type { CarArrow } from "./carIndicator";

/** Facility kinds rendered by the faithful pixel-art room module. */
const ROOM_KINDS = new Set<FacilityKind>([
  "office",
  "condo",
  "hotelSingle",
  "hotelDouble",
  "hotelSuite",
  "fastFood",
  "restaurant",
  "shop",
  "cinema",
]);

/**
 * Procedural sprite drawing. Rather than ship external image assets, every
 * facility is drawn from layered shapes — walls, floors, furniture, windows
 * and signage — to evoke the chunky, detailed pixel look of the 1994 original.
 * Per-unit color variation (seeded by the unit id) keeps rows of identical
 * facilities from reading as one flat color block. All drawing is in screen
 * space.
 */

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) + amt);
  const g = clamp(((n >> 8) & 255) + amt);
  const b = clamp((n & 255) + amt);
  return `rgb(${r},${g},${b})`;
}
function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
/** Deterministic 0..1 from an integer seed — for stable per-unit variety. */
function rand(seed: number): number {
  let x = (seed * 2654435761) | 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 13), 0x297a2d39);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const ACCENTS = ["#e85d5d", "#5db4e8", "#6bd47a", "#e8c14a", "#b07fe0", "#e88f4a", "#4ad0c0"];

export interface DrawCtx {
  ctx: CanvasRenderingContext2D;
  /** Whether the tower interior should look "lit" (evening/night). */
  lit: boolean;
  /** Continuous animation time in seconds (for flicker / motion). */
  anim: number;
  /** In-game hour 0..23, for time-of-day behavior. */
  hour: number;
  /** 0..1 transport overcrowding; tints walking crowds "angry" when high. */
  stress?: number;
}

/** Draw a placed room/structure unit into the given screen rectangle. */
export function drawUnit(d: DrawCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const { ctx } = d;

  if (u.kind === "floor") return drawFloor(ctx, x, y, w, h);
  if (u.kind === "lobby") return drawLobby(d, x, y, w, h);
  if (u.state === "construction") return drawConstruction(d, x, y, w, h);

  // A unit ablaze: draw its gutted shell, then flames over the top.
  if (u.state === "fire") {
    drawBurntShell(ctx, x, y, w, h);
    drawFlames(d, x, y, w, h);
    return;
  }
  // A burned-out room after the fire: the shell, no flames — a scar to rebuild.
  if (u.state === "gutted") return drawBurntShell(ctx, x, y, w, h);

  // Faithful pixel-art rooms own all of their states (empty / closed / asleep…),
  // including their own "for lease"/"for sale" signage when vacant.
  if (ROOM_KINDS.has(u.kind)) return drawRoom(d, u, x, y, w, h);

  // Service / special facilities (security, housekeeping, medical, metro…) are
  // staffed amenities, not leased tenants — they're never "for lease", so always
  // draw their interior regardless of the internal empty/idle state.
  drawInterior(d, u, x, y, w, h);
}

/** Dispatch to the per-facility interior drawing (services & special only). */
function drawInterior(d: DrawCtx, u: Unit, x: number, y: number, w: number, h: number): void {
  const ctx = d.ctx;
  switch (u.kind) {
    case "partyHall":
      return drawPartyHall(ctx, x, y, w, h);
    case "parking":
      return drawParking(ctx, u, x, y, w, h);
    case "security":
      return drawSecurity(ctx, x, y, w, h);
    case "medical":
      return drawMedical(ctx, x, y, w, h);
    case "housekeeping":
      return drawHousekeeping(ctx, x, y, w, h);
    case "recycling":
      return drawRecycling(ctx, x, y, w, h);
    case "metro":
      return drawMetro(d, x, y, w, h);
    case "weddingHall":
      return drawWeddingHall(ctx, x, y, w, h);
    default:
      ctx.fillStyle = FACILITIES[u.kind].color;
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  }
}

// ---- Structure ----------------------------------------------------------

function drawFloor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#8c8676";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#9b9685";
  ctx.fillRect(x, y + 2, w, h - 5);
  ctx.fillStyle = "#6f6a5c";
  ctx.fillRect(x, y + h - 3, w, 3);
  ctx.fillStyle = "rgba(0,0,0,0.06)";
  for (let gx = x; gx < x + w; gx += 9) ctx.fillRect(gx, y + 2, 1, h - 5);
}

function drawLobby(d: DrawCtx, x: number, y: number, w: number, h: number) {
  const { ctx } = d;
  // Marble gradient.
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "#f3eed6");
  g.addColorStop(1, "#ddd4b2");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // Polished floor.
  ctx.fillStyle = "#cfc59c";
  ctx.fillRect(x, y + h - 4, w, 4);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(x, y + h - 4, w, 1);
  // Columns and gold trim.
  ctx.fillStyle = "rgba(150,135,95,0.5)";
  for (let cx = x + 9; cx < x + w - 3; cx += 18) ctx.fillRect(cx, y + 2, 2, h - 6);
  ctx.fillStyle = "#caa84a";
  ctx.fillRect(x, y + 1, w, 1);
  // Patrons milling about as silhouettes (static here; the renderer adds the
  // animated lobby crowd on top).
  for (let px = x + 6; px < x + w - 4; px += 15) {
    if (rand(px | 0) > 0.5) person(ctx, px, y + h - 3, 1.2, px | 0);
  }
}

function drawConstruction(d: DrawCtx, x: number, y: number, w: number, h: number) {
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
function drawBurntShell(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#241c18";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#3a2a20";
  ctx.fillRect(x, y + h - 4, w, 4);
  // Smoke smudges up the back wall.
  ctx.fillStyle = "rgba(20,16,14,0.55)";
  for (let sx = x + 3; sx < x + w - 2; sx += 11) ctx.fillRect(sx, y, 5, h - 4);
}

/** Animated flames licking up from the floor of a burning unit. */
function drawFlames(d: DrawCtx, x: number, y: number, w: number, h: number) {
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



// ---- Entertainment ------------------------------------------------------

function drawPartyHall(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
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
  for (let px = x + 8; px < x + w - 5; px += 11) {
    if (rand(px | 0) > 0.4) person(ctx, px, y + h - 3, 1.3, px | 0);
  }
}

// ---- Services -----------------------------------------------------------

function serviceBack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = shade(color, -45);
  ctx.fillRect(x, y + 2, w, h - 5);
  ctx.fillStyle = color;
  ctx.fillRect(x + 2, y + 4, w - 4, h - 9);
}

function drawSecurity(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
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
  ctx.fillStyle = "#dfe6f2";
  ctx.font = "7px system-ui, sans-serif";
  if (w > 44) ctx.fillText("SECURITY", x + 18, y + 11);
}

function drawMedical(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
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
  ctx.fillStyle = "#2a3550";
  ctx.font = "7px system-ui, sans-serif";
  if (w > 60) ctx.fillText("CLINIC", x + 22, y + 11);
}

function drawHousekeeping(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
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
  ctx.fillStyle = "#2a3a2a";
  ctx.font = "7px system-ui, sans-serif";
  if (w > 60) ctx.fillText("HOUSEKEEPING", x + 32, y + 11);
}

function drawRecycling(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
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

function drawMetro(d: DrawCtx, x: number, y: number, w: number, h: number) {
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
  for (let px = x + 8; px < x + w - 6; px += 13) {
    if (rand(px | 0) > 0.4) person(ctx, px, platY, 1.2, px | 0);
  }
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

function drawParking(ctx: CanvasRenderingContext2D, u: Unit, x: number, y: number, w: number, h: number) {
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

function drawWeddingHall(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
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

// ---- Transport ----------------------------------------------------------

export function drawTransport(
  ctx: CanvasRenderingContext2D,
  t: Transport,
  sx: number,
  topY: number,
  w: number,
  floorH: number,
): void {
  const f = FACILITIES[t.kind];
  const height = (t.top - t.bottom + 1) * floorH;

  // NOTE: this draws only the *static* structure. Everything that moves
  // (elevator cars, stair/escalator climbers) is a separate Excalibur Actor
  // positioned by the engine — see TowerEngine's dynamic layer.

  if (t.kind === "stairs") {
    // No solid background — as in the original, stairs are an open structure you
    // see the tower *through*; only the treads/handrail are drawn (in front of
    // rooms via the engine's z-order). One FLIGHT per connected floor pair: the
    // top band is just the arrival landing, so it stays empty — a two-floor
    // stairway draws exactly one staircase, not two stacked ones.
    for (let fl = 1; fl <= t.top - t.bottom; fl++) {
      const fy = topY + fl * floorH;
      const steps = 5;
      const stepW = (w - 2) / steps;
      const stepH = (floorH - 3) / steps;
      for (let s = 0; s < steps; s++) {
        const sxS = sx + 1 + s * stepW;
        const syS = fy + floorH - 2 - (s + 1) * stepH;
        ctx.fillStyle = "#a9a290";
        ctx.fillRect(sxS, syS, stepW + 1, stepH + 1);
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(sxS, syS, stepW + 1, 1);
      }
    }
    return;
  }

  if (t.kind === "escalator") {
    // Open structure like the stairs — no solid backing, you see the tower
    // behind it. Just the diagonal belt and step ridges, rising from the
    // BOTTOM band up to the arrival floor (the top band is the landing).
    const by = topY + (t.top - t.bottom) * floorH;
    ctx.strokeStyle = "#cfd4dc"; // belt
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx + 1, by + floorH - 1);
    ctx.lineTo(sx + w - 1, by + 1);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.28)"; // step ridges
    ctx.lineWidth = 1;
    for (let s = 2; s < w; s += 4) {
      const yy = by + floorH - (s / w) * floorH;
      ctx.beginPath();
      ctx.moveTo(sx + s, yy);
      ctx.lineTo(sx + s + 1, yy);
      ctx.stroke();
    }
    return;
  }

  if (isElevatorKind(t.kind)) {
    // Dark shaft tinted by elevator type, with rails and floor stops.
    ctx.fillStyle = shade(f.color, -34);
    ctx.fillRect(sx, topY, w, height);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(sx + 1, topY, 1, height);
    ctx.fillRect(sx + w - 2, topY, 1, height);
    // Floor numbers painted on the shaft backing, as in the original — the car
    // (a separate actor) rides over them, so only the empty shaft shows them.
    // (fillStyle is set per-element inside the loop below.)
    ctx.font = `bold ${Math.min(floorH - 4, 8)}px "MS Sans Serif", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Express elevators skip floors; like the original, a floor the car doesn't
    // stop at shows no stop line and no number — the shaft just passes through.
    const skip = t.skipFloors && t.skipFloors.length ? new Set(t.skipFloors) : null;
    for (let fl = 0; fl <= t.top - t.bottom; fl++) {
      const num = t.top - fl; // band fl counts down from the top floor
      if (skip && skip.has(num)) continue; // not a stop — leave the shaft blank here
      const fy = topY + fl * floorH;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(sx + 1, fy, w - 2, 1); // per-floor stop line
      const label = num >= 1 ? String(num) : `B${1 - num}`;
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.fillText(label, sx + w / 2, fy + floorH / 2);
    }
    // Motor/machinery housings cap the shaft top and bottom, as in the original
    // (where the extend-taller arrows also live — that interaction is a planned
    // follow-up).
    const mh = 5;
    for (const my of [topY, topY + height - mh]) {
      ctx.fillStyle = "#6b6f78";
      ctx.fillRect(sx, my, w, mh);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(sx, my, w, 1);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(sx, my + mh - 1, w, 1);
      for (let bx = sx + 2; bx < sx + w - 1; bx += 4) ctx.fillRect(bx, my + 2, 1, 1); // bolts
    }
  }
}

/** A single elevator car graphic, drawn at (0,0) into a w×floorH rect, carrying
 *  `riders` passengers. `arrow` is the direction lantern (null when idle) and
 *  `full` flags a car at capacity. The car is its own Excalibur Actor that the
 *  engine moves along the shaft (and swaps as it loads / changes direction). */
export function drawCar(
  ctx: CanvasRenderingContext2D,
  seed: number,
  w: number,
  floorH: number,
  riders: number,
  arrow: CarArrow = null,
  full = false,
): void {
  // Cab frame, then the lit interior inset within it.
  ctx.fillStyle = "#8e94a0";
  ctx.fillRect(1, 1, w - 2, floorH - 2);
  ctx.fillStyle = "#d8dce2";
  ctx.fillRect(2, 2, w - 4, floorH - 4);
  // Ceiling light strip.
  ctx.fillStyle = "#f3f6fa";
  ctx.fillRect(3, 2, w - 6, 2);
  // Riders stand on the cab floor.
  for (let p = 0; p < riders; p++) {
    person(ctx, 3 + p * 3.5, floorH - 3, 1.0, (p * 13 + seed) | 0);
  }
  // Door frames + the central seam, drawn over the riders so the cab reads as
  // an enclosed car.
  ctx.fillStyle = "rgba(40,44,54,0.22)";
  ctx.fillRect(2, 2, 1, floorH - 4);
  ctx.fillRect(w - 3, 2, 1, floorH - 4);
  ctx.fillStyle = "rgba(40,44,54,0.5)";
  ctx.fillRect(w / 2 - 0.5, 3, 1, floorH - 5);
  // FULL: a red bar across the top edge when the cab is at capacity.
  if (full) {
    ctx.fillStyle = "#ff4d4d";
    ctx.fillRect(2, 1, w - 4, 2);
  }
  // Direction lantern: a bright chevron near the top, only while the car moves.
  if (arrow) {
    const cxp = w / 2;
    const s = Math.max(1.5, Math.min(3, w * 0.12));
    const ty = full ? 4 : 2.5; // sit below the FULL bar when both show
    ctx.fillStyle = arrow === "up" ? "#7be88a" : "#ffab5e";
    ctx.beginPath();
    if (arrow === "up") {
      ctx.moveTo(cxp, ty);
      ctx.lineTo(cxp - s, ty + s);
      ctx.lineTo(cxp + s, ty + s);
    } else {
      ctx.moveTo(cxp, ty + s);
      ctx.lineTo(cxp - s, ty);
      ctx.lineTo(cxp + s, ty);
    }
    ctx.closePath();
    ctx.fill();
  }
}
