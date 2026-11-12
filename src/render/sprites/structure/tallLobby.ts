import type { DrawCtx } from "../common";
import { hash } from "../../pixelSprites/common";
import { layerBreak } from "../../pixelSprites/layers";
import { balconySlab, balustrade, glassRail, globePendants, mezzanineRows, painting, railPlanter } from "./tallLobbyMezzanine";
import {
  drawLobbyTile,
  ENTRANCE_GRAND_LEFT,
  ENTRANCE_GRAND_RIGHT,
  ENTRANCE_GRAND_SOLO,
  type EntranceKind,
  ENTRANCE_SERVICE,
  fluteColumn,
  framedPrint,
  LOBBY_VARIANTS,
  sconce,
  skyGlass,
} from "./lobby";

/**
 * Tall lobbies (#308): one slice of a lobby two or three stories high, drawn
 * whole over `stories` floors. Nothing is stretched: every story keeps the
 * one-story lobby's scale.
 *
 * - The bottom story is the one-story lobby tile itself, furniture,
 *   entrance and all, where people walk.
 * - Each story above is a mezzanine gallery over it: the same back wall
 *   (marble downstairs, skyline glass in a sky lobby), the same gilded
 *   cornice, and a balcony slab with a railing at its foot. Downstairs the
 *   railing is a cream balustrade and the wall carries columns, arched
 *   windows, paintings and sconces; in a sky lobby it is glass, with planter
 *   boxes trailing ivy and globe pendants (`tallLobbyMezzanine.ts`).
 * - Over the entrance, the mezzanine shows tall windows above the grand
 *   doors and a plain balustrade above the service door.
 *
 * Every slice is drawn whole and the renderer cuts it into one-story cells,
 * so adjacent slices line up into one continuous hall.
 */

/** A glazed opening with a gold frame and, when `head` is set, a round
 *  head: dark warm glass with a few city lights after dark, pale sky by day. */
function archedWindow(d: DrawCtx, x: number, y: number, w: number, h: number, head: boolean, seed: number): void {
  const { ctx, lit } = d;
  if (w < 3 || h < 6) return;
  ctx.fillStyle = "#C9A24B";
  ctx.fillRect(x, y + (head ? 2 : 0), w, h - (head ? 2 : 0));
  if (head) {
    ctx.fillRect(x + 1, y + 1, w - 2, 1);
    ctx.fillRect(x + 2, y, Math.max(1, w - 4), 1);
  }
  const gx = x + 1;
  const gy = y + (head ? 2 : 1);
  const gw = w - 2;
  const gh = h - (head ? 3 : 2);
  const g = ctx.createLinearGradient(0, gy, 0, gy + gh);
  g.addColorStop(0, lit ? "#2E2C34" : "#B7CCDA");
  g.addColorStop(1, lit ? "#26242C" : "#D3E0E8");
  ctx.fillStyle = g;
  ctx.fillRect(gx, gy, gw, gh);
  if (head) ctx.fillRect(x + 2, y + 1, Math.max(1, w - 4), 1);
  if (lit) {
    ctx.fillStyle = "#B89A62";
    for (let yy = 3; yy < gh - 1; yy += 4) {
      for (let xx = 0; xx < gw; xx += 2) {
        if (hash(seed * 97 + xx * 13 + yy * 5) > 0.8) ctx.fillRect(gx + xx, gy + yy, 1, 1);
      }
    }
  }
  ctx.fillStyle = "rgba(138,116,48,0.8)"; // mullion and transom bar
  if (gw >= 4) ctx.fillRect(gx + (gw >> 1), gy, 1, gh);
  ctx.fillRect(gx, gy + Math.round(gh * 0.6), gw, 1);
}

/** The mezzanine's back wall and its cornice: veined marble downstairs,
 *  warm stone around a skyline window in a sky lobby. */
function mezzanineWall(d: DrawCtx, x0: number, y: number, ww: number, railTop: number, ground: boolean, seed: number): void {
  const { ctx, lit } = d;
  if (ground) {
    const g = ctx.createLinearGradient(0, y, 0, railTop);
    g.addColorStop(0, "#F1E8CE");
    g.addColorStop(1, "#E3D7B3");
    ctx.fillStyle = g;
    ctx.fillRect(x0, y, ww, railTop - y + 9);
    ctx.fillStyle = "rgba(120,100,60,0.12)"; // faint veins, as downstairs
    ctx.fillRect(x0 + 3, y + 6, 1, railTop - y - 6);
  } else {
    ctx.fillStyle = "#C4BCA8";
    ctx.fillRect(x0, y, ww, railTop - y + 9);
    skyGlass(ctx, x0 + 1, y + 5, ww - 2, railTop - y - 4, lit, seed);
  }
  ctx.fillStyle = "#C9A24B"; // the gilded cornice every story shares
  ctx.fillRect(x0, y, ww, 3);
  ctx.fillStyle = "#8A7430";
  ctx.fillRect(x0, y + 3, ww, 1);
}

/** One mezzanine story of a lobby slice, `h` one story high. */
function drawMezzanine(d: DrawCtx, x0: number, y: number, ww: number, h: number, variant: number, ground: boolean): void {
  const { ctx, lit } = d;
  const { railTop, slabTop } = mezzanineRows(y, h);
  const cx = x0 + Math.floor(ww / 2);
  const seed = variant * 7 + Math.abs(y);
  mezzanineWall(d, x0, y, ww, railTop, ground, variant + 1);
  if (variant >= LOBBY_VARIANTS) {
    // Over the entrance: tall windows above the grand doors (the two grand
    // halves frame one window across both tiles), plain wall above the
    // service door.
    if (variant !== ENTRANCE_SERVICE) {
      const left = variant === ENTRANCE_GRAND_RIGHT ? x0 : x0 + 1;
      const right = variant === ENTRANCE_GRAND_LEFT ? x0 + ww : x0 + ww - 1;
      archedWindow(d, left, y + 6, right - left, railTop - y - 7, variant === ENTRANCE_GRAND_SOLO, seed);
    }
  } else if (variant === 0) {
    layerBreak(ctx);
    fluteColumn(ctx, cx, y, railTop - y + 6, ground); // a column per story, at the lobby's scale
  } else if (variant === 1) {
    if (ground) archedWindow(d, x0 + 2, y + 7, ww - 4, railTop - y - 8, true, seed);
  } else if (variant === 2) {
    if (ground) painting(ctx, cx, y + 10);
    else {
      layerBreak(ctx);
      globePendants(d, cx, y + 4, railTop - 2);
    }
  } else if (variant === 3) {
    if (ground) sconce(ctx, cx, y + 6, lit);
    else framedPrint(ctx, cx, y + 2);
  }
  layerBreak(ctx);
  balconySlab(ctx, x0, ww, slabTop, ground);
  if (ground) balustrade(ctx, x0, ww, railTop, slabTop);
  else {
    glassRail(d, x0, ww, railTop, slabTop);
    if (variant === 1 || variant === 3) railPlanter(ctx, x0, ww, railTop, seed);
  }
}

/** One slice of a tall lobby, `h` covering all its `stories`. `variant` is a
 *  pattern slot (`lobbyVariant`) or an entrance sentinel; a one-story lobby
 *  draws as the one-story tile. */
export function drawTallLobbyTile(
  d: DrawCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  variant: number,
  ground: boolean,
  stories: number,
): void {
  const s = Math.max(1, Math.min(3, Math.trunc(stories) || 1));
  if (s === 1) return drawLobbyTile(d, x, y, w, h, variant, ground);
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const ww = Math.max(1, Math.round(w));
  const storyH = Math.round(Math.max(1, Math.round(h)) / s);
  const entrance = variant >= LOBBY_VARIANTS;
  for (let k = 0; k < s - 1; k++) drawMezzanine(d, x0, y0 + k * storyH, ww, storyH, variant, ground || entrance);
  drawLobbyTile(d, x0, y0 + (s - 1) * storyH, ww, storyH, variant, ground || entrance);
}

/** Entrance kind to its sentinel variant, for {@link drawTallLobbyEntrance}. */
const ENTRANCE_VARIANT: Record<EntranceKind, number> = {
  "grand-left": ENTRANCE_GRAND_LEFT,
  "grand-right": ENTRANCE_GRAND_RIGHT,
  "grand-solo": ENTRANCE_GRAND_SOLO,
  service: ENTRANCE_SERVICE,
};

/** The ground entrance slice of a tall lobby, `h` covering all its stories. */
export function drawTallLobbyEntrance(d: DrawCtx, kind: EntranceKind, x: number, y: number, w: number, h: number, stories: number): void {
  drawTallLobbyTile(d, x, y, w, h, ENTRANCE_VARIANT[kind] ?? ENTRANCE_SERVICE, true, stories);
}
