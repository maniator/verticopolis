import type { Unit } from "../../engine/types";
import type { DrawCtx } from "./common";

// ---- Structure ----------------------------------------------------------

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

/** The lobby pattern repeats on this many structural tiles: column, plain,
 *  centerpiece (chandelier / planter), plain. The engine bakes one shared
 *  graphic per variant and picks by {@link lobbyVariant}, so adjacent tiles
 *  always line up into one continuous concourse. */
export const LOBBY_VARIANTS = 4;

/** Which pattern slot a lobby tile at grid x occupies. Defense-in-depth on
 *  top of deserialize's geometry clamps: a fractional, negative or non-finite
 *  x from any other caller (previews, tools, future fake units) still lands
 *  on a real variant instead of indexing the engine's baked-graphics array
 *  out of bounds. */
export function lobbyVariant(x: number): number {
  const t = Math.trunc(Number.isFinite(x) ? x : 0) % LOBBY_VARIANTS;
  return t < 0 ? t + LOBBY_VARIANTS : t;
}

export function drawLobby(d: DrawCtx, u: Unit, x: number, y: number, w: number, h: number) {
  // One pattern slice per structural tile of the unit, scaled to whatever the
  // caller renders a tile as (the engine bakes at TILE px; the gallery draws
  // bigger). Keyed by absolute tile x so runs stay aligned however sliced.
  // The slice count is capped by the pixel span so a forged width can't turn
  // this into a near-endless loop (deserialize clamps width too — second belt).
  const tiles = Math.max(1, Math.min(Math.round(u.width) || 1, Math.ceil(w)));
  const pitch = w / tiles;
  for (let t = 0; t < tiles; t++) {
    const x0 = x + t * pitch;
    const tw = t === tiles - 1 ? x + w - x0 : pitch;
    drawLobbyTile(d, x0, y, tw, h, lobbyVariant(u.x + t), u.floor === 1);
  }
}

/**
 * One 11px slice of the lobby concourse. The ground lobby (floor 1) is the
 * tower's grand entrance — warm marble, gilded cornice, red carpet, fluted
 * columns and chandeliers that glow in the evening. Sky lobbies read as their
 * cooler, airier cousins: pale stone, planters and framed art instead of
 * chandeliers, same gold trim so they still read as "lobby" at a glance.
 */
function drawLobbyTile(d: DrawCtx, x: number, y: number, w: number, h: number, variant: number, ground: boolean) {
  const { ctx, lit } = d;
  // Back wall: warm marble downstairs, cool stone up in the sky lobbies.
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, ground ? "#f8f1dc" : "#eef2f7");
  g.addColorStop(1, ground ? "#e3d7b3" : "#d6dee9");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // Wainscot line so the wall reads panelled, not flat.
  ctx.fillStyle = ground ? "rgba(120,100,60,0.16)" : "rgba(70,90,115,0.14)";
  ctx.fillRect(x, y + 19, w, 1);
  // Gilded cornice along the ceiling.
  ctx.fillStyle = "#caa84a";
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = "#8a7430";
  ctx.fillRect(x, y + 2, w, 1);
  // Polished floor with a sheen line.
  ctx.fillStyle = ground ? "#c9b177" : "#b3bfcd";
  ctx.fillRect(x, y + h - 5, w, 5);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillRect(x, y + h - 5, w, 1);
  ctx.fillStyle = ground ? "#8f7a48" : "#8794a4";
  ctx.fillRect(x, y + h - 1, w, 1);
  if (ground) {
    // Red carpet with gold edging, running the whole concourse.
    ctx.fillStyle = "#a3243c";
    ctx.fillRect(x, y + h - 4, w, 3);
    ctx.fillStyle = "#d9b356";
    ctx.fillRect(x, y + h - 5, w, 1);
  }

  // Decorations center on the slice and stay inside it, whatever the caller's
  // tile scale — in-engine each slice is its own 11px baked canvas, so anything
  // painted past the edge would be clipped into a visible seam.
  const cx = x + Math.floor(w / 2);
  if (variant === 0) {
    // Fluted column, cornice to floor, with gold capital and base.
    ctx.fillStyle = ground ? "#f1e8ce" : "#e4eaf2";
    ctx.fillRect(cx - 1, y + 5, 3, h - 12);
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.fillRect(cx - 1, y + 5, 1, h - 12);
    ctx.fillStyle = ground ? "rgba(105,90,55,0.4)" : "rgba(70,85,110,0.4)";
    ctx.fillRect(cx + 1, y + 5, 1, h - 12);
    ctx.fillStyle = "#caa84a";
    ctx.fillRect(cx - 2, y + 3, 5, 2);
    ctx.fillRect(cx - 2, y + h - 7, 5, 2);
  } else if (variant === 2 && ground) {
    // Chandelier — gold tiers on a chain, aglow after dark.
    ctx.fillStyle = "#8a7430";
    ctx.fillRect(cx, y + 3, 1, 3);
    ctx.fillStyle = lit ? "#ffd76b" : "#c8a343";
    ctx.fillRect(cx - 2, y + 6, 5, 2);
    ctx.fillRect(cx - 3, y + 9, 7, 2);
    ctx.fillStyle = lit ? "#fff1b0" : "#a3873a";
    for (const dx of [-3, 0, 3]) ctx.fillRect(cx + dx, y + 8, 1, 1);
    if (lit) {
      ctx.fillStyle = "rgba(255,214,110,0.28)";
      ctx.beginPath();
      ctx.arc(cx + 0.5, y + 9, Math.min(6.5, w / 2 - 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (variant === 2) {
    // Sky-lobby planter: a potted shrub instead of a chandelier.
    ctx.fillStyle = "#7c8798";
    ctx.fillRect(cx - 2, y + h - 9, 5, 4);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(cx - 2, y + h - 9, 5, 1);
    ctx.fillStyle = "#567f46";
    ctx.beginPath();
    ctx.arc(cx + 0.5, y + h - 11, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#6f9c58";
    ctx.fillRect(cx - 1, y + h - 13, 2, 2);
  } else if (variant === 3) {
    if (ground) {
      // Wall sconce, warm when the evening lights come on.
      ctx.fillStyle = "#caa84a";
      ctx.fillRect(cx - 1, y + 12, 3, 1);
      ctx.fillStyle = lit ? "#ffe9a0" : "#b5924a";
      ctx.fillRect(cx, y + 10, 1, 2);
    } else {
      // Framed print between the sky-lobby windows.
      ctx.fillStyle = "#8a7430";
      ctx.fillRect(cx - 2, y + 9, 5, 7);
      ctx.fillStyle = "#b9cadb";
      ctx.fillRect(cx - 1, y + 10, 3, 5);
      ctx.fillStyle = "#5d7a95";
      ctx.fillRect(cx - 1, y + 13, 3, 2);
    }
  }
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

/** Canvas size of the rooftop tower-crane graphic. */
export const CRANE_W = 128;
export const CRANE_H = 76;

/**
 * The rooftop tower crane that crowns the build while the tower is still
 * climbing (it comes down once the 100th floor caps the tower, as in the
 * original). Drawn fresh each frame into a CRANE_W×CRANE_H rect: the trolley
 * rides the jib, the hook reels a girder up and down, and a red aircraft
 * beacon blinks at the apex after dark — all on the decorative clock, so
 * pause/reduced-motion freezes it with everything else.
 */
export function drawCrane(ctx: CanvasRenderingContext2D, t: number, lit: boolean): void {
  const baseY = CRANE_H; // canvas bottom sits on the roof line
  const mx = 56; // mast center
  const jibY = 18; // jib chord height
  const steel = "#e0a83c";
  const dark = "#9a6f1e";
  // Roof pad under the mast.
  ctx.fillStyle = "#6b6f78";
  ctx.fillRect(mx - 7, baseY - 3, 14, 3);
  // Lattice mast: two chords with X-bracing.
  ctx.fillStyle = steel;
  ctx.fillRect(mx - 3, jibY, 2, baseY - 3 - jibY);
  ctx.fillRect(mx + 1, jibY, 2, baseY - 3 - jibY);
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let yy = jibY + 2; yy < baseY - 8; yy += 6) {
    ctx.moveTo(mx - 2, yy);
    ctx.lineTo(mx + 2, yy + 6);
    ctx.moveTo(mx + 2, yy);
    ctx.lineTo(mx - 2, yy + 6);
  }
  ctx.stroke();
  // Jib out to the right, counter-jib to the left.
  const jibEnd = CRANE_W - 4;
  const cjEnd = mx - 26;
  ctx.fillStyle = steel;
  ctx.fillRect(cjEnd, jibY, jibEnd - cjEnd, 2);
  ctx.fillRect(mx + 3, jibY + 4, jibEnd - mx - 6, 1);
  ctx.strokeStyle = dark;
  ctx.beginPath();
  for (let xx = mx + 6; xx < jibEnd - 4; xx += 7) {
    ctx.moveTo(xx, jibY + 2);
    ctx.lineTo(xx + 4, jibY + 4);
  }
  ctx.stroke();
  // Apex with tie bars holding both arms.
  ctx.fillStyle = steel;
  ctx.fillRect(mx - 1, jibY - 12, 2, 12);
  ctx.strokeStyle = steel;
  ctx.beginPath();
  ctx.moveTo(mx, jibY - 10);
  ctx.lineTo(jibEnd - 8, jibY);
  ctx.moveTo(mx, jibY - 10);
  ctx.lineTo(cjEnd + 3, jibY);
  ctx.stroke();
  // Counterweight block.
  ctx.fillStyle = "#7d838d";
  ctx.fillRect(cjEnd, jibY + 2, 7, 7);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(cjEnd, jibY + 2, 7, 1);
  // Operator cab, window lit in the evening.
  ctx.fillStyle = "#5a636e";
  ctx.fillRect(mx + 2, jibY + 2, 7, 6);
  ctx.fillStyle = lit ? "#ffe27a" : "#9fc0ff";
  ctx.fillRect(mx + 4, jibY + 3, 4, 3);
  // Trolley slides along the jib; the hook line reels a girder up and down.
  const span = jibEnd - (mx + 14) - 6;
  const trolleyX = mx + 14 + (Math.sin(t * 0.45) * 0.5 + 0.5) * span;
  const drop = 10 + (Math.sin(t * 0.27 + 2.1) * 0.5 + 0.5) * (CRANE_H - jibY - 28);
  ctx.fillStyle = dark;
  ctx.fillRect(trolleyX - 2, jibY + 4, 5, 3);
  ctx.strokeStyle = "#3c3f45";
  ctx.beginPath();
  ctx.moveTo(trolleyX + 0.5, jibY + 7);
  ctx.lineTo(trolleyX + 0.5, jibY + 7 + drop);
  ctx.stroke();
  ctx.fillStyle = "#d8dce2";
  ctx.fillRect(trolleyX - 1.5, jibY + 7 + drop, 4, 2);
  ctx.fillStyle = "#8f4f2f"; // the girder riding the hook
  ctx.fillRect(trolleyX - 6, jibY + 9 + drop, 13, 2);
  // Aircraft-warning beacon at the apex, blinking after dark.
  ctx.fillStyle = lit && Math.sin(t * 3.2) > 0 ? "#ff5a4a" : "#8a2f26";
  ctx.fillRect(mx - 1, jibY - 14, 2, 2);
}

/** Width in px of one exterior fire-escape segment. */
export const ESCAPE_W = 9;

/**
 * One floor-tall segment of the exterior escape stairs that cling to both
 * sides of the tower (a canon staple of the original's silhouette). `side` is
 * which outside wall it hangs off; the flight's diagonal flips with floor
 * parity so stacked segments read as one continuous zigzag down the facade.
 */
export function drawEscapeStairs(
  ctx: CanvasRenderingContext2D,
  side: "left" | "right",
  parity: 0 | 1,
  floorH: number,
): void {
  const w = ESCAPE_W;
  const rail = "#4e5866";
  const railHi = "#7b8694";
  // Outer support rail, hung clear of the wall.
  const outX = side === "left" ? 0 : w - 1;
  ctx.fillStyle = rail;
  ctx.fillRect(outX, 1, 1, floorH - 1);
  // Landing deck at the floor line, with guard rail above it.
  ctx.fillStyle = "#39414e";
  ctx.fillRect(0, floorH - 4, w, 3);
  ctx.fillStyle = railHi;
  ctx.fillRect(0, floorH - 4, w, 1);
  ctx.fillStyle = rail;
  ctx.fillRect(0, floorH - 12, w, 1);
  for (const px of [1, Math.floor(w / 2), w - 2]) ctx.fillRect(px, floorH - 12, 1, 8);
  // The flight itself, zigzagging with floor parity.
  const x0 = parity === 0 ? 1 : w - 2;
  const x1 = parity === 0 ? w - 2 : 1;
  ctx.strokeStyle = railHi;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5, 2);
  ctx.lineTo(x1 + 0.5, floorH - 4);
  ctx.stroke();
  ctx.fillStyle = "#5d6875";
  const steps = 6;
  for (let s = 1; s < steps; s++) {
    const sx = x0 + ((x1 - x0) * s) / steps;
    const sy = 2 + ((floorH - 6) * s) / steps;
    ctx.fillRect(Math.round(sx) - 1, Math.round(sy), 3, 1);
  }
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
